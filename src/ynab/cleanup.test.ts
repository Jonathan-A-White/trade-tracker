import type { YnabCategory } from "@/contracts/types";
import { CLEANUP_PAGE, SURE_FROM, buildItems, checkNumberOf, groupPage, pageAfter, payeeHistory, suggestForPayee } from "./cleanup";
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
