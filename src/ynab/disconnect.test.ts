import { vault } from "bsv-kit/bsv";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { LEARNED_KEY } from "@/sort/suggest";
import { createYnabClient } from "./api";
import { disconnectYnab } from "./disconnect";
import { fakeYnab, groupOf, type FakeYnab } from "./fake-ynab";
import { TALLY_FAILED_KEY, TALLY_KEY, readTally, refreshTally } from "./tally";

const repo = new YnabRepository();
const NOW = Date.parse("2026-11-04T12:00:00Z");

let ynab: FakeYnab;

async function connect() {
  await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  await repo.applyCategories(ynab.budgets[0]!.categoryGroups, 1);
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.clear();
  ynab = fakeYnab("good", [
    {
      id: "b1",
      name: "Our Budget",
      categoryGroups: [groupOf("g1", "Food", [["c1", "Groceries"]])],
      accounts: [],
      payees: [],
    },
  ]);
  await connect();
});

const client = () => createYnabClient("good", ynab.fetch);
const reads = () => ynab.calls.filter((c) => c.path.includes("/transactions"));
const charge = (id: string) => ({ id, account_id: "a1", date: "2026-10-01", amount: -5_000, payee_name: "Costco", category_id: "c1" });

describe("turning YNAB off", () => {
  it("leaves no tally of his YNAB history on the phone", async () => {
    ynab.transactions.push(charge("t1"));
    await refreshTally(client(), { now: NOW });
    expect(readTally()).not.toBeNull();
    await disconnectYnab(new vault.MemoryStorage());
    expect(localStorage.getItem(TALLY_KEY)).toBeNull();
    expect(readTally()).toBeNull();
  });

  it("forgets what the payee rules approved (a copy of his YNAB data) and keeps the rules", async () => {
    await db.ynabRuleApprovals.put({ id: "t1", budgetId: "b1", ruleKey: "chewy", payee: "Chewy", amount: -1000, date: "2026-11-10", categoryId: "c1", previousCategoryId: null, approvedAt: 1, undone: false });
    await db.ynabPayeeRules.put({ key: "chewy", budgetId: "b1", payee: "Chewy", categoryId: "c1", createdAt: 1, approved: 1 });
    await disconnectYnab(new vault.MemoryStorage());
    expect(await db.ynabRuleApprovals.count()).toBe(0);
    expect(await db.ynabPayeeRules.count()).toBe(1);
  });

  it("forgets that a read failed, so turning YNAB on again is not made to wait the hour", async () => {
    localStorage.setItem(TALLY_FAILED_KEY, String(NOW));
    await disconnectYnab(new vault.MemoryStorage());
    expect(localStorage.getItem(TALLY_FAILED_KEY)).toBeNull();
  });

  it("keeps the categories he taught the suggestion: they are his own choices, not YNAB's data", async () => {
    const learned = JSON.stringify({ costco: { categoryId: "c1", name: "Groceries", at: 1 } });
    localStorage.setItem(LEARNED_KEY, learned);
    await disconnectYnab(new vault.MemoryStorage());
    expect(localStorage.getItem(LEARNED_KEY)).toBe(learned);
  });

  it("turning YNAB on again reads a new tally, not the old one", async () => {
    ynab.transactions.push(charge("t1"));
    await refreshTally(client(), { now: NOW });
    expect(reads()).toHaveLength(1);
    await disconnectYnab(new vault.MemoryStorage());
    await connect();
    ynab.transactions.push({ ...charge("t2"), payee_name: "Trader Joe's" });
    // a minute later, same budget: the old tally would still be fresh
    await refreshTally(client(), { now: NOW + 60_000 });
    expect(reads()).toHaveLength(2);
    expect(readTally()?.readAt).toBe(NOW + 60_000);
    expect(readTally()?.payees).toEqual({ Costco: { c1: 1 }, "Trader Joe's": { c1: 1 } });
  });

  it("a read that was in flight when YNAB went off does not write the tally back", async () => {
    ynab.transactions.push(charge("t1"));
    const pending = refreshTally(client(), { now: NOW });
    await disconnectYnab(new vault.MemoryStorage());
    await pending.catch(() => {});
    expect(readTally()).toBeNull();
  });
});
