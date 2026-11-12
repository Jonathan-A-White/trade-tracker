import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { createYnabClient } from "./api";
import { fakeYnab, groupOf, type FakeYnab, type FakeYnabTransaction } from "./fake-ynab";
import { PayeeRuleRepository, RuleApprovalRepository, RULE_APPROVAL_DAYS, SHORT_RULE_KEY, readShortRule, setAlways, undoAlways, undoRuleApproval, unapprovedWithRules, writeShortRule } from "./payee-rules";
import { createYnabWriter, type YnabWriter } from "./writer";

const groups = [groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"], ["rta", "Inflow: Ready to Assign"]]), groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]])];

let ynab: FakeYnab;
let writer: YnabWriter;
const rules = new PayeeRuleRepository();
const client = () => createYnabClient("good", ynab.fetch);
const patches = () => ynab.requests.filter((r) => r.method === "PATCH");
const tx = (id: string, payee: string, over: Partial<FakeYnabTransaction> = {}): FakeYnabTransaction => ({
  id,
  account_id: "a1",
  date: "2026-10-01",
  amount: -10_000,
  payee_name: payee,
  category_id: null,
  approved: false,
  ...over,
});
const rule = (key: string, categoryId = "c1") => rules.put({ key, budgetId: "b1", payee: key, categoryId, createdAt: 1, approved: 0 });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  ynab = fakeYnab("good", [{ id: "b1", name: "Our Budget", categoryGroups: groups, accounts: [], payees: [] }]);
  const repo = new YnabRepository();
  await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  await repo.applyCategories(groups, 1);
  writer = createYnabWriter({ getClient: async () => client() });
});

describe("the payee rules", () => {
  it("are kept per payee key and listed for the budget", async () => {
    await rule("chewy");
    await rules.put({ key: "other", budgetId: "b2", payee: "Other", categoryId: "c1", createdAt: 2, approved: 0 });
    expect((await rules.list("b1")).map((r) => r.key)).toEqual(["chewy"]);
    await rules.remove("chewy");
    expect(await rules.list("b1")).toEqual([]);
  });

  it("approve a payee's new unapproved transactions in one PATCH, before anything is listed", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"), tx("t2", " CHEWY "), tx("t3", "Shell"));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.body).toEqual({
      transactions: [
        { id: "t1", category_id: "c1", approved: true },
        { id: "t2", category_id: "c1", approved: true },
      ],
    });
    expect(read.rows.map((r) => r.id)).toEqual(["t3"]);
    expect(read.approved).toBe(2);
    expect(read.error).toBeNull();
    expect((await rules.get("chewy"))?.approved).toBe(2);
  });

  it("leave splits and transfers alone and still listed", async () => {
    await rule("chewy");
    ynab.transactions.push(
      tx("sp", "Chewy", { subtransactions: [{ amount: -5_000, category_id: "c1" }, { amount: -5_000, category_id: "c2" }] }),
      tx("tr", "Chewy", { transfer_account_id: "a2" }),
      tx("ok", "Chewy"),
    );
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(read.rows.map((r) => r.id).sort()).toEqual(["sp", "tr"]);
    expect(ynab.transactions.find((t) => t.id === "sp")?.approved).toBe(false);
    expect(ynab.transactions.find((t) => t.id === "ok")?.approved).toBe(true);
  });

  it("make no request when nothing matches, and ignore a rule of another budget or for a category no longer on offer", async () => {
    await rules.put({ key: "chewy", budgetId: "b2", payee: "Chewy", categoryId: "c1", createdAt: 1, approved: 0 });
    await rule("shell", "gone");
    ynab.transactions.push(tx("t1", "Chewy"), tx("t2", "Shell"));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(patches()).toHaveLength(0);
    expect(read.rows).toHaveLength(2);
    expect(read.error).toBeNull();
  });

  it("on a failed write say so, keep the rows listed, and write each only once on the next load", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"), tx("t2", "Chewy"));
    ynab.failNextBulk = 500;
    const failed = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(failed.error).toMatch(/Could not approve 2 from payee rules/);
    expect(failed.rows).toHaveLength(2);
    expect(failed.approved).toBe(0);
    expect((await rules.get("chewy"))?.approved).toBe(0);
    expect(ynab.transactions.every((t) => !t.approved)).toBe(true);

    const again = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(again.rows).toEqual([]);
    expect(again.error).toBeNull();
    const third = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(third.rows).toEqual([]);
    expect(patches()).toHaveLength(2); // the failed one and the one that landed
    expect((await rules.get("chewy"))?.approved).toBe(2);
  });

  it("two loads at once write each transaction once", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"));
    await Promise.all([unapprovedWithRules(client(), "b1", writer.approve), unapprovedWithRules(client(), "b1", writer.approve)]);
    expect(patches()).toHaveLength(1);
    expect((await rules.get("chewy"))?.approved).toBe(1);
  });
});

describe("a rule made for an inflow (his words, 2026-11-12)", () => {
  it("defaults to Ready to Assign, approves the inflow there, and leaves an outflow of the same payee to him", async () => {
    ynab.transactions.push(tx("in1", "Chase Rewards", { amount: 254_300 }));
    const done = await setAlways({ budgetId: "b1", payee: "Chase Rewards", key: "chase rewards", categoryId: "rta", items: [{ id: "in1", ynabCategoryId: null }] }, writer.approve);
    expect(done.categoryId).toBe("rta");
    expect(await rules.get("chase rewards")).toMatchObject({ categoryId: "rta" });
    ynab.transactions.push(tx("in2", "Chase Rewards", { amount: 108_930 }), tx("out1", "Chase Rewards", { amount: -5_000 }));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(read.approved).toBe(1);
    expect(ynab.transactions.map((t) => [t.id, t.approved, t.category_id])).toEqual([["in1", true, "rta"], ["in2", true, "rta"], ["out1", false, null]]);
  });
});

describe("Always", () => {
  const items = [
    { id: "t1", ynabCategoryId: null },
    { id: "t2", ynabCategoryId: "c2" },
  ];

  beforeEach(() => {
    ynab.transactions.push(tx("t1", "Chewy"), tx("t2", "Chewy", { category_id: "c2" }), tx("t3", "Shell"));
  });

  it("approves them all into the category in one PATCH and saves the rule", async () => {
    const done = await setAlways({ budgetId: "b1", payee: "Chewy", key: "chewy", categoryId: "c1", items }, writer.approve);
    expect(patches()).toHaveLength(1);
    expect(ynab.transactions.map((t) => [t.id, t.approved, t.category_id])).toEqual([["t1", true, "c1"], ["t2", true, "c1"], ["t3", false, null]]);
    expect(await rules.get("chewy")).toMatchObject({ budgetId: "b1", payee: "Chewy", categoryId: "c1", approved: 2 });
    expect(done.restores).toEqual([{ id: "t1", categoryId: null }, { id: "t2", categoryId: "c2" }]);
  });

  it("saves no rule when the write fails", async () => {
    ynab.failNextBulk = 500;
    await expect(setAlways({ budgetId: "b1", payee: "Chewy", key: "chewy", categoryId: "c1", items }, writer.approve)).rejects.toThrow();
    expect(await rules.list("b1")).toEqual([]);
    expect(ynab.transactions.every((t) => !t.approved)).toBe(true);
  });

  it("undo puts them back as they were and takes the rule it made away", async () => {
    const done = await setAlways({ budgetId: "b1", payee: "Chewy", key: "chewy", categoryId: "c1", items }, writer.approve);
    await undoAlways(done, writer.restore);
    expect(ynab.transactions.map((t) => [t.id, t.approved, t.category_id])).toEqual([["t1", false, null], ["t2", false, "c2"], ["t3", false, null]]);
    expect(await rules.list("b1")).toEqual([]);
  });

  it("undo gives back the rule it replaced", async () => {
    await rules.put({ key: "chewy", budgetId: "b1", payee: "Chewy", categoryId: "c2", createdAt: 1, approved: 7 });
    const done = await setAlways({ budgetId: "b1", payee: "Chewy", key: "chewy", categoryId: "c1", items }, writer.approve);
    expect((await rules.get("chewy"))?.categoryId).toBe("c1");
    await undoAlways(done, writer.restore);
    expect(await rules.get("chewy")).toMatchObject({ categoryId: "c2", approved: 7 });
  });

  it("keeps the rule when the undo write fails", async () => {
    const done = await setAlways({ budgetId: "b1", payee: "Chewy", key: "chewy", categoryId: "c1", items }, writer.approve);
    ynab.failNextBulk = 500;
    await expect(undoAlways(done, writer.restore)).rejects.toThrow();
    expect(await rules.get("chewy")).toBeDefined();
    expect(ynab.transactions[0]?.approved).toBe(true);
  });
});

describe("what the rules approved is kept for Home", () => {
  const approvals = new RuleApprovalRepository();

  it("records each transaction a rule approved, with its payee, amount, date, category and the category it had", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy", { amount: -12_340, date: "2026-11-10" }), tx("t2", "Chewy", { category_id: "c2" }), tx("t3", "Shell"));
    await unapprovedWithRules(client(), "b1", writer.approve);
    const kept = await approvals.recent("b1");
    expect(kept.map((a) => a.id).sort()).toEqual(["t1", "t2"]);
    expect(kept.find((a) => a.id === "t1")).toMatchObject({ ruleKey: "chewy", payee: "Chewy", amount: -12_340, date: "2026-11-10", categoryId: "c1", previousCategoryId: null, undone: false });
    expect(kept.find((a) => a.id === "t2")?.previousCategoryId).toBe("c2");
  });

  it("records nothing when the write fails, and nothing for a transaction he approved himself", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"));
    ynab.failNextBulk = 500;
    await unapprovedWithRules(client(), "b1", writer.approve);
    expect(await approvals.recent("b1")).toEqual([]);
    await setAlways({ budgetId: "b1", payee: "Chewy", key: "chewy", categoryId: "c1", items: [{ id: "t1", ynabCategoryId: null }] }, writer.approve);
    expect(await approvals.recent("b1")).toEqual([]);
  });

  it("lists only the last RULE_APPROVAL_DAYS days, of the budget asked for", async () => {
    const now = Date.now();
    const base = { ruleKey: "chewy", payee: "Chewy", amount: -1000, date: "2026-11-01", categoryId: "c1", previousCategoryId: null, undone: false };
    await db.ynabRuleApprovals.bulkPut([
      { ...base, id: "new", budgetId: "b1", approvedAt: now - 1000 },
      { ...base, id: "old", budgetId: "b1", approvedAt: now - (RULE_APPROVAL_DAYS + 1) * 86_400_000 },
      { ...base, id: "other", budgetId: "b2", approvedAt: now },
    ]);
    expect((await approvals.recent("b1")).map((a) => a.id)).toEqual(["new"]);
  });

  it("Undo puts it back unapproved and as it was, keeps the rule, and the rule does not approve it again", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"), tx("t2", "Chewy"));
    await unapprovedWithRules(client(), "b1", writer.approve);
    const [first] = (await approvals.recent("b1")).filter((a) => a.id === "t1");
    await undoRuleApproval(first!, writer.restore);
    expect(ynab.transactions.map((t) => [t.id, t.approved, t.category_id])).toEqual([["t1", false, null], ["t2", true, "c1"]]);
    expect(await rules.get("chewy")).toBeDefined();
    expect((await approvals.recent("b1")).map((a) => a.id)).toEqual(["t2"]);
    const again = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(again.rows.map((r) => r.id)).toEqual(["t1"]);
    expect(ynab.transactions.find((t) => t.id === "t1")?.approved).toBe(false);
  });

  it("a failed Undo changes nothing", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"));
    await unapprovedWithRules(client(), "b1", writer.approve);
    const [first] = await approvals.recent("b1");
    ynab.failNextBulk = 500;
    await expect(undoRuleApproval(first!, writer.restore)).rejects.toThrow();
    expect((await approvals.recent("b1")).map((a) => a.id)).toEqual(["t1"]);
  });

  it("forgets an undone one once YNAB no longer holds it unapproved", async () => {
    await rule("chewy");
    ynab.transactions.push(tx("t1", "Chewy"));
    await unapprovedWithRules(client(), "b1", writer.approve);
    await undoRuleApproval((await approvals.recent("b1"))[0]!, writer.restore);
    ynab.transactions[0]!.approved = true; // he approved it in YNAB
    await unapprovedWithRules(client(), "b1", writer.approve);
    expect(await db.ynabRuleApprovals.count()).toBe(0);
  });
});

describe("a rule's category that lacks the money (his words, 2026-11-12)", () => {
  const approvals = new RuleApprovalRepository();

  beforeEach(async () => {
    localStorage.removeItem(SHORT_RULE_KEY);
    // Fun Money holds $5.00 of available
    const withBalance = [...groups, groupOf("g2", "Fun", [["c3", "Fun Money", 5_000]])];
    ynab.budgets[0]!.categoryGroups = withBalance;
    await new YnabRepository().applyCategories(withBalance, 2);
  });

  it("defaults to approving and noting", () => {
    expect(readShortRule()).toBe("approve");
    writeShortRule("hold");
    expect(readShortRule()).toBe("hold");
    localStorage.setItem(SHORT_RULE_KEY, "nonsense");
    expect(readShortRule()).toBe("approve");
  });

  it("approves anyway by default and records how far over budget it left the category", async () => {
    await rule("shell", "c3");
    ynab.transactions.push(tx("t1", "Shell", { amount: -12_500 }));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(read.approved).toBe(1);
    expect(read.held).toEqual({});
    expect(ynab.transactions[0]).toMatchObject({ approved: true, category_id: "c3" });
    expect((await approvals.recent("b1"))[0]).toMatchObject({ id: "t1", shortBy: 7.5 });
  });

  it("notes nothing when the category holds enough, or its balance is not known", async () => {
    await rule("shell", "c3");
    await rule("chewy", "c1");
    ynab.transactions.push(tx("t1", "Shell", { amount: -5_000 }), tx("t2", "Chewy", { amount: -900_000 }));
    await unapprovedWithRules(client(), "b1", writer.approve);
    const kept = await approvals.recent("b1");
    expect(kept).toHaveLength(2);
    expect(kept.every((a) => a.shortBy === undefined)).toBe(true);
  });

  it("counts what the same read already put into the category", async () => {
    await rule("shell", "c3");
    ynab.transactions.push(tx("t1", "Shell", { amount: -3_000 }), tx("t2", "Shell", { amount: -3_000 }));
    await unapprovedWithRules(client(), "b1", writer.approve);
    const kept = await approvals.recent("b1");
    expect(kept.find((a) => a.id === "t1")?.shortBy).toBeUndefined();
    expect(kept.find((a) => a.id === "t2")?.shortBy).toBe(1);
  });

  it("with the setting on Leave it for me, does not approve a short one, lists it with its shortfall, and approves the rest", async () => {
    writeShortRule("hold");
    await rule("shell", "c3");
    await rule("chewy", "c1");
    ynab.transactions.push(tx("t1", "Shell", { amount: -12_500 }), tx("t2", "Chewy"));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(read.approved).toBe(1);
    expect(read.rows.map((r) => r.id)).toEqual(["t1"]);
    expect(read.held).toEqual({ t1: { categoryId: "c3", short: 7.5 } });
    expect(ynab.transactions.find((t) => t.id === "t1")).toMatchObject({ approved: false, category_id: null });
    expect(ynab.transactions.find((t) => t.id === "t2")?.approved).toBe(true);
    expect((await approvals.recent("b1")).map((a) => a.id)).toEqual(["t2"]);
    expect((await rules.get("shell"))?.approved).toBe(0);
  });

  it("with the setting on Leave it for me still approves one the category can cover", async () => {
    writeShortRule("hold");
    await rule("shell", "c3");
    ynab.transactions.push(tx("t1", "Shell", { amount: -5_000 }));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(read.approved).toBe(1);
    expect(read.held).toEqual({});
  });

  it("never calls money in short", async () => {
    writeShortRule("hold");
    await rule("shell", "c3");
    ynab.transactions.push(tx("t1", "Shell", { amount: 40_000 }));
    const read = await unapprovedWithRules(client(), "b1", writer.approve);
    expect(read.approved).toBe(1);
  });
});
