import type { YnabCategory } from "@/contracts/types";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { createYnabClient } from "./api";
import { CLEANUP_PAGE, SURE_FROM, buildItems, checkNumberOf, groupPage, loadCleanup, offeredCategories, pageAfter, payeeHistory, suggestForPayee } from "./cleanup";
import { fakeYnab, groupOf } from "./fake-ynab";
import type { YnabTransactionWire } from "./types";

const cat = (id: string, name: string, groupName = "Food"): YnabCategory => ({ id, groupId: groupName, groupName, name, hidden: false });
const categories = [cat("c1", "Groceries"), cat("c2", "Eating Out"), cat("c3", "Household", "Home"), cat("c4", "Stuff I Forgot to Budget For", "Surprises")];
const none = new Set<string>();

let n = 0;
const tx = (payee: string, categoryId: string | null, date: string, over: Partial<YnabTransactionWire> = {}): YnabTransactionWire => ({
  id: `t${++n}`,
  account_id: "a1",
  date,
  amount: -10_000,
  payee_name: payee,
  category_id: categoryId,
  approved: true,
  ...over,
});

describe("the cleanup's rules", () => {
  it("keeps the sure rule's N at three", () => {
    expect(SURE_FROM).toBe(3);
    expect(CLEANUP_PAGE).toBe(20);
  });

  it("is sure when the payee's last three categorized transactions all used one category", () => {
    const history = payeeHistory(
      [tx("Trader Joe's", "c2", "2026-01-01"), tx("Trader Joe's", "c1", "2026-09-01"), tx("Trader Joe's", "c1", "2026-09-08"), tx("Trader Joe's", "c1", "2026-09-15")],
      none,
    );
    const found = suggestForPayee("Trader Joe's", history, categories, null);
    expect(found).toMatchObject({ categoryId: "c1", confidence: "sure" });
  });

  it("is not sure when one of the last three differs, or fewer than three were categorized", () => {
    const mixed = payeeHistory([tx("Costco", "c1", "2026-09-01"), tx("Costco", "c1", "2026-09-08"), tx("Costco", "c3", "2026-09-15")], none);
    expect(suggestForPayee("Costco", mixed, categories, null)).toMatchObject({ categoryId: "c1", confidence: "likely" });
    const two = payeeHistory([tx("Costco", "c1", "2026-09-01"), tx("Costco", "c1", "2026-09-08")], none);
    expect(suggestForPayee("Costco", two, categories, null)?.confidence).toBe("likely");
    const one = payeeHistory([tx("Costco", "c1", "2026-09-01")], none);
    expect(suggestForPayee("Costco", one, categories, null)).toBeNull();
  });

  it("counts neither unapproved, nor uncategorized, nor split, nor transfer, nor deleted transactions as history", () => {
    const history = payeeHistory(
      [
        tx("Shell", "c2", "2026-09-01"),
        tx("Shell", "c3", "2026-09-02", { approved: false }),
        tx("Shell", null, "2026-09-03"),
        tx("Shell", "unc", "2026-09-04"),
        tx("Shell", "c3", "2026-09-05", { subtransactions: [{ amount: -5_000, category_id: "c3" }, { amount: -5_000, category_id: "c1" }] }),
        tx("Shell", "c3", "2026-09-06", { transfer_account_id: "a2" }),
        tx("Shell", "c3", "2026-09-07", { deleted: true }),
      ],
      new Set(["unc"]),
    );
    expect(history.get("shell")).toEqual([{ date: "2026-09-01", categoryId: "c2" }]);
  });

  it("matches the payee whatever the case and outer spaces", () => {
    const history = payeeHistory([tx("  TRADER JOE'S ", "c1", "2026-09-01"), tx("Trader Joe's", "c1", "2026-09-02"), tx("trader joe's", "c1", "2026-09-03")], none);
    expect(suggestForPayee("Trader Joe's", history, categories, null)?.confidence).toBe("sure");
  });

  it("offers only a category the budget offers", () => {
    const history = payeeHistory([tx("Old", "gone", "2026-09-01"), tx("Old", "gone", "2026-09-02"), tx("Old", "gone", "2026-09-03")], none);
    expect(suggestForPayee("Old", history, categories, null)).toBeNull();
  });

  it("builds items oldest first, a categorized one keeping its own category, and ticks only the sure", () => {
    const rows = [
      tx("Mystery", null, "2026-10-03", { approved: false }),
      tx("Trader Joe's", null, "2026-10-05", { approved: false }),
      tx("Shell", "c2", "2026-10-02", { approved: false, category_name: "Eating Out" }),
      tx("Trader Joe's", null, "2026-10-01", { approved: false }),
    ];
    const history = payeeHistory([tx("Trader Joe's", "c1", "2026-09-01"), tx("Trader Joe's", "c1", "2026-09-02"), tx("Trader Joe's", "c1", "2026-09-03")], none);
    const items = buildItems(rows, { categories, history, tally: null, notCounted: none });
    expect(items.map((i) => [i.payee, i.date])).toEqual([
      ["Trader Joe's", "2026-10-01"],
      ["Shell", "2026-10-02"],
      ["Mystery", "2026-10-03"],
      ["Trader Joe's", "2026-10-05"],
    ]);
    expect(items.map((i) => [i.categoryId, i.confidence, i.ticked])).toEqual([
      ["c1", "sure", true],
      ["c2", "unsure", false],
      ["c4", "unsure", false],
      ["c1", "sure", true],
    ]);
  });

  describe("an unsure guess (his words, 2026-11-11)", () => {
    const ctx = (over: Partial<Parameters<typeof buildItems>[1]> = {}) => ({ categories, history: payeeHistory([], none), tally: null, notCounted: none, ...over });

    it("puts a payee nothing is known of in Stuff I Forgot to Budget For, unticked, and says so", () => {
      const [item] = buildItems([tx("8631 Bus Dirpay", null, "2026-10-03", { approved: false })], ctx());
      expect(item).toMatchObject({ categoryId: "c4", confidence: "unsure", ticked: false });
      expect(item!.why).toContain("Stuff I Forgot to Budget For");
      expect(item!.why).not.toMatch(/everyday/i);
    });

    it("leaves no category chosen only when the budget has no Stuff I Forgot to Budget For", () => {
      const [item] = buildItems([tx("ABC Fundraising", null, "2026-10-03", { approved: false })], ctx({ categories: categories.slice(0, 3) }));
      expect(item).toMatchObject({ categoryId: null, confidence: "unsure", ticked: false });
    });

    it("keeps a sure group sure and ticked", () => {
      const history = payeeHistory([tx("Costco", "c1", "2026-09-01"), tx("Costco", "c1", "2026-09-02"), tx("Costco", "c1", "2026-09-03")], none);
      const [item] = buildItems([tx("Costco", null, "2026-10-03", { approved: false })], ctx({ history }));
      expect(item).toMatchObject({ categoryId: "c1", confidence: "sure", ticked: true });
    });

    it("tells the screen which categories the payee has been seen in, from its YNAB history and tally", () => {
      const history = payeeHistory([tx("Costco", "c1", "2026-09-01"), tx("Costco", "c3", "2026-09-02")], none);
      const tally = { budgetId: "b", since: "2024-01-01", readAt: 0, payees: { Costco: { c2: 1 } } };
      const [item] = buildItems([tx("Costco", null, "2026-10-03", { approved: false })], ctx({ history, tally }));
      expect([...item!.seen].sort()).toEqual(["c1", "c2", "c3"]);
      expect(item!.open).toBe(true);
    });
  });

  it("groups a page by payee, the groups with a sure one first, then by oldest", () => {
    const rows = [
      tx("Mystery", null, "2026-10-01", { approved: false }),
      tx("Shell", null, "2026-10-02", { approved: false }),
      tx("Trader Joe's", null, "2026-10-03", { approved: false }),
      tx("Shell", null, "2026-10-04", { approved: false }),
      tx("Trader Joe's", null, "2026-10-05", { approved: false }),
    ];
    const history = payeeHistory([tx("Trader Joe's", "c1", "2026-09-01"), tx("Trader Joe's", "c1", "2026-09-02"), tx("Trader Joe's", "c1", "2026-09-03")], none);
    const groups = groupPage(buildItems(rows, { categories, history, tally: null, notCounted: none }));
    expect(groups.map((g) => [g.payee, g.items.length, g.total])).toEqual([
      ["Trader Joe's", 2, -20],
      ["Mystery", 1, -10],
      ["Shell", 2, -20],
    ]);
  });

  it("pages twenty at a time, skipping past the ones left unapproved", () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ id: `i${i}` }));
    expect(pageAfter(items, 0).map((i) => i.id)).toHaveLength(20);
    expect(pageAfter(items, 40).map((i) => i.id)).toEqual(["i40", "i41", "i42", "i43", "i44"]);
    expect(pageAfter(items, 45)).toEqual([]);
  });
});

describe("checks (his words, 2026-11-12)", () => {
  const ctx = { categories, history: payeeHistory([], none), tally: null, notCounted: none };

  it("knows a check by its payee text: CHECK <number>, as YNAB writes it from the bank", () => {
    expect(checkNumberOf("CHECK 1089 *8368")).toBe("1089");
    expect(checkNumberOf("  check 77")).toBe("77");
    expect(checkNumberOf("Check #1090 *8368")).toBe("1090");
    expect(checkNumberOf("Checkers Drive-In")).toBeNull();
    expect(checkNumberOf("Trader Joe's")).toBeNull();
    expect(checkNumberOf("Check Into Cash")).toBeNull();
  });

  it("sorts checks after every other transaction, even an older one, and each check is its own card", () => {
    const rows = [
      tx("CHECK 1089 *8368", null, "2026-01-22", { approved: false, id: "k1" }),
      tx("CHECK 1090 *8368", null, "2026-01-23", { approved: false, id: "k2" }),
      tx("CHECK 1089 *8368", null, "2026-02-01", { approved: false, id: "k3" }),
      tx("Mystery", null, "2026-10-03", { approved: false }),
      tx("Shell", null, "2026-10-04", { approved: false }),
    ];
    const items = buildItems(rows, ctx);
    expect(items.map((i) => i.payee)).toEqual(["Mystery", "Shell", "CHECK 1089 *8368", "CHECK 1090 *8368", "CHECK 1089 *8368"]);
    expect(items.map((i) => i.check)).toEqual([undefined, undefined, "1089", "1090", "1089"]);
    const groups = groupPage(items);
    expect(groups.map((g) => [g.payee, g.items.length])).toEqual([
      ["Mystery", 1],
      ["Shell", 1],
      ["CHECK 1089 *8368", 1],
      ["CHECK 1090 *8368", 1],
      ["CHECK 1089 *8368", 1],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(5);
  });

  it("keeps a check with a sure group last too, and never learns a payee from a check's history", () => {
    const history = payeeHistory([tx("CHECK 1089 *8368", "c1", "2026-09-01"), tx("CHECK 1089 *8368", "c1", "2026-09-02"), tx("CHECK 1089 *8368", "c1", "2026-09-03")], none);
    expect(history.size).toBe(0);
    const [check] = buildItems([tx("CHECK 1089 *8368", null, "2026-01-22", { approved: false })], { ...ctx, history });
    expect(check).toMatchObject({ categoryId: "c4", confidence: "unsure", ticked: false, open: false });
  });
});

describe("an inflow (his words, 2026-11-12: 'Inflow should go to Ready to Assign')", () => {
  const groups = [
    groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"], ["rta", "Inflow: Ready to Assign"]]),
    groupOf("g1", "Food", [["c1", "Groceries"]]),
    groupOf("g3", "Surprises", [["c4", "Stuff I Forgot to Budget For"]]),
  ];
  const past = (payee: string, categoryId: string, date: string, amount = 100_000, categoryName = "x") =>
    ({ id: `h${++n}`, account_id: "a1", date, amount, payee_name: payee, category_id: categoryId, category_name: categoryName, approved: true }) as YnabTransactionWire;

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const repo = new YnabRepository();
    await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await repo.applyCategories(groups, 1);
  });

  const load = async (rows: YnabTransactionWire[]) => {
    const ynab = fakeYnab("good", [{ id: "b1", name: "Our Budget", categoryGroups: groups, accounts: [], payees: [] }]);
    ynab.transactions.push(...rows.map((r) => ({ ...r, id: r.id!, account_id: r.account_id! })));
    return loadCleanup(createYnabClient("good", ynab.fetch), "b1", Date.parse("2026-11-12"));
  };

  it("offers YNAB's Inflow: Ready to Assign (found in its internal group, not by name), and not Uncategorized", async () => {
    const { categories, notCounted } = offeredCategories(await new YnabRepository().listCategories());
    expect(categories.map((c) => c.id)).toContain("rta");
    expect(categories.map((c) => c.id)).not.toContain("unc");
    expect(notCounted.has("unc")).toBe(true);
    expect(notCounted.has("rta")).toBe(false);
  });

  it("suggests an uncategorized $108.93 Chase Rewards inflow into Ready to Assign, unticked, saying so", async () => {
    const { items } = await load([tx("Chase Rewards", null, "2026-03-17", { approved: false, amount: 108_930, id: "cr1" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount: 108.93, categoryId: "rta", confidence: "unsure", ticked: false, open: false });
    expect(items[0]!.why).toContain("Ready to Assign");
    expect(items[0]!.why).not.toContain("Stuff I Forgot");
  });

  it("is likely Ready to Assign when the payee's earlier inflows went there", async () => {
    const { items } = await load([
      past("Chase Rewards", "rta", "2026-01-10", 254_300, "Inflow: Ready to Assign"),
      past("Chase Rewards", "rta", "2026-02-10", 120_000, "Inflow: Ready to Assign"),
      tx("Chase Rewards", null, "2026-03-17", { approved: false, amount: 108_930, id: "cr1" }),
    ]);
    expect(items[0]).toMatchObject({ categoryId: "rta", confidence: "likely", ticked: false });
  });

  it("is likely Ready to Assign from a single earlier inflow there", async () => {
    const { items } = await load([past("Citi Rewards", "rta", "2026-01-10", 136_400), tx("Citi Rewards", null, "2026-03-17", { approved: false, amount: 196_010, id: "ci1" })]);
    expect(items[0]).toMatchObject({ categoryId: "rta", confidence: "likely" });
  });

  it("never lets the fallback in for an inflow, even when the budget's fallback category exists and the payee is unknown", () => {
    const categoriesWithRta = [...categories, cat("rta", "Inflow: Ready to Assign", "Internal Master Category")];
    const [item] = buildItems([tx("Mystery Refund", null, "2026-03-17", { approved: false, amount: 5_000 })], {
      categories: categoriesWithRta,
      history: payeeHistory([], none),
      tally: null,
      notCounted: new Set(["unc"]),
      inflow: categoriesWithRta[4],
    });
    expect(item!.categoryId).toBe("rta");
    expect(item!.categoryId).not.toBe("c4");
  });

  it("leaves an inflow with no category (not the fallback) when the budget offers no Ready to Assign", () => {
    const [item] = buildItems([tx("Mystery Refund", null, "2026-03-17", { approved: false, amount: 5_000 })], { categories, history: payeeHistory([], none), tally: null, notCounted: none });
    expect(item).toMatchObject({ categoryId: null, confidence: "unsure", ticked: false, open: false });
  });

  it("keeps a refund's own spending history: an inflow from a payee whose earlier inflows all went to Groceries is sure Groceries", async () => {
    const { items } = await load([
      past("Trader Joe's", "c1", "2026-01-10"),
      past("Trader Joe's", "c1", "2026-02-10"),
      past("Trader Joe's", "c1", "2026-03-10"),
      tx("Trader Joe's", null, "2026-03-17", { approved: false, amount: 12_000, id: "tj" }),
    ]);
    expect(items[0]).toMatchObject({ categoryId: "c1", confidence: "sure" });
  });

  it("does not let an inflow's history steer an outflow of the same payee, nor the reverse", async () => {
    const { items } = await load([
      past("Chase Rewards", "rta", "2026-01-10", 254_300),
      past("Chase Rewards", "rta", "2026-01-11", 254_300),
      past("Chase Rewards", "rta", "2026-01-12", 254_300),
      tx("Chase Rewards", null, "2026-03-17", { approved: false, amount: -5_000, id: "out" }),
    ]);
    expect(items[0]!.categoryId).toBe("c4");
  });
});
