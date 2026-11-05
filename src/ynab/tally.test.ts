import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { createYnabClient } from "./api";
import { fakeYnab, groupOf, type FakeYnab, type FakeYnabTransaction } from "./fake-ynab";
import { TALLY_FRESH_MS, TALLY_KEY, TALLY_WINDOW_DAYS, readTally, refreshTally, tallyTransactions } from "./tally";
import { YNAB_BUSY_KEY } from "./writer";

const repo = new YnabRepository();
const NOW = Date.parse("2026-11-04T12:00:00Z");

let ynab: FakeYnab;
let n = 0;
const charge = (payee: string, category: string | null, over: Partial<FakeYnabTransaction> = {}): FakeYnabTransaction => ({
  id: `t${++n}`,
  account_id: "a1",
  date: "2026-10-01",
  amount: -12_340,
  payee_name: payee,
  category_id: category,
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.clear();
  ynab = fakeYnab("good", [
    {
      id: "b1",
      name: "Our Budget",
      categoryGroups: [
        groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"], ["rta", "Inflow: Ready to Assign"]]),
        groupOf("g1", "Food", [["c1", "Groceries"]]),
        groupOf("g2", "Home", [["c3", "Household"]]),
        groupOf("g3", "Spending", [["c4", "Jonathan's Spending"]]),
      ],
      accounts: [],
      payees: [],
    },
  ]);
  await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  await repo.applyCategories(ynab.budgets[0]!.categoryGroups, 1);
});

const client = () => createYnabClient("good", ynab.fetch);
const reads = () => ynab.calls.filter((c) => c.path.includes("/transactions"));

describe("the tally of YNAB's transactions by payee and category", () => {
  it("counts each payee's charges by category; a split counts for each of its categories", () => {
    const payees = tallyTransactions(
      [
        charge("Amazon", "c3"),
        charge("Amazon", "c3"),
        charge("Amazon", "c4"),
        charge("Costco", null, {
          category_id: "split-id",
          subtransactions: [
            { amount: -50_000, category_id: "c1" },
            { amount: -20_000, category_id: "c3" },
            { amount: -5_000, category_id: "c3" },
          ],
        }),
      ],
      new Set(),
    );
    expect(payees).toEqual({ Amazon: { c3: 2, c4: 1 }, Costco: { c1: 1, c3: 1 } });
  });

  it("does not count transfers, a row with no category, YNAB's Uncategorized, an inflow, or a deleted row", () => {
    const payees = tallyTransactions(
      [
        charge("Transfer : Savings", null, { transfer_account_id: "a9" }),
        charge("Transfer : Card", "c3", { transfer_account_id: "a8" }),
        charge("Logos", null),
        charge("Logos", "unc", { category_name: "Uncategorized" }),
        charge("Logos", "unc2", { category_name: "Uncategorized" }),
        charge("Employer", "rta", { amount: 2_000_000 }),
        charge("Amazon", "c3", { amount: 15_000 }),
        charge("Amazon", "c3", { deleted: true }),
        charge("Costco", null, {
          subtransactions: [
            { amount: -50_000, category_id: "c1" },
            { amount: -20_000, category_id: null, transfer_account_id: "a9" },
            { amount: -1_000, category_id: null },
          ],
        }),
        charge("Logos", "c4"),
      ],
      new Set(["unc", "rta"]),
    );
    expect(payees).toEqual({ Logos: { c4: 1 }, Costco: { c1: 1 } });
  });

  it(`is read from YNAB in one call over the last ${TALLY_WINDOW_DAYS} days and kept on the phone`, async () => {
    ynab.transactions.push(
      charge("Logos", "c4", { date: "2026-09-01" }),
      charge("Logos", "c4", { date: "2025-01-10" }),
      charge("Logos", "c4", { date: "2024-11-03" }),
      charge("Logos", "unc"),
    );
    await refreshTally(client(), { now: NOW });
    expect(reads()).toHaveLength(1);
    // two years back from 2026-11-04
    expect(reads()[0]!.path).toContain("since_date=2024-11-04");
    expect(readTally()?.payees).toEqual({ Logos: { c4: 2 } });
    expect(readTally()?.budgetId).toBe("b1");
    expect(JSON.parse(localStorage.getItem(TALLY_KEY) ?? "null")).toMatchObject({ budgetId: "b1", payees: { Logos: { c4: 2 } } });
  });

  it("is read again only when it is old, so the tally costs YNAB at most one of its 200 calls an hour", async () => {
    await refreshTally(client(), { now: NOW });
    await refreshTally(client(), { now: NOW + 60_000 });
    await refreshTally(client(), { now: NOW + TALLY_FRESH_MS - 1 });
    expect(reads()).toHaveLength(1);
    ynab.transactions.push(charge("Logos", "c4"));
    await refreshTally(client(), { now: NOW + TALLY_FRESH_MS });
    expect(reads()).toHaveLength(2);
    expect(readTally()?.payees).toEqual({ Logos: { c4: 1 } });
  });

  it("a failed read keeps the tally it had and is not tried again within the hour", async () => {
    ynab.transactions.push(charge("Logos", "c4"));
    await refreshTally(client(), { now: NOW });
    ynab.rateLimited = { retryAfterSeconds: 60 };
    await expect(refreshTally(client(), { now: NOW + TALLY_FRESH_MS })).rejects.toThrow();
    await refreshTally(client(), { now: NOW + TALLY_FRESH_MS + 30 * 60_000 });
    expect(reads()).toHaveLength(2);
    expect(readTally()?.payees).toEqual({ Logos: { c4: 1 } });
    ynab.rateLimited = null;
    await refreshTally(client(), { now: NOW + TALLY_FRESH_MS + 60 * 60_000 });
    expect(reads()).toHaveLength(3);
  });

  it("waits while YNAB has said it is busy", async () => {
    localStorage.setItem(YNAB_BUSY_KEY, String(NOW + 10 * 60_000));
    await refreshTally(client(), { now: NOW });
    expect(reads()).toHaveLength(0);
    expect(readTally()).toBeNull();
  });

  it("is read anew for another budget, and nothing without a connection", async () => {
    await refreshTally(client(), { now: NOW });
    localStorage.setItem(TALLY_KEY, JSON.stringify({ ...readTally(), budgetId: "old" }));
    await refreshTally(client(), { now: NOW + 60_000 });
    expect(reads()).toHaveLength(2);
    await repo.clearAll();
    localStorage.clear();
    await refreshTally(client(), { now: NOW + 120_000 });
    expect(reads()).toHaveLength(2);
  });

  it("reads nothing kept that is not a tally", () => {
    localStorage.setItem(TALLY_KEY, "{not json");
    expect(readTally()).toBeNull();
    localStorage.setItem(TALLY_KEY, JSON.stringify({ budgetId: "b1", payees: { Logos: { c4: "nine" } } }));
    expect(readTally()).toBeNull();
  });
});
