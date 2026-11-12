import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { createYnabClient } from "./api";
import { fakeYnab, groupOf, type FakeYnab, type FakeYnabTransaction } from "./fake-ynab";
import { PayeeRuleRepository, setAlways, undoAlways, unapprovedWithRules } from "./payee-rules";
import { createYnabWriter, type YnabWriter } from "./writer";

const groups = [groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"]]), groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]])];

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
