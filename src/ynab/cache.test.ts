import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { createYnabClient } from "./api";
import { connectBudget, refreshCache } from "./cache";
import { accountOf, fakeYnab, groupOf, payeeOf } from "./fake-ynab";

const repo = new YnabRepository();

beforeEach(async () => {
  // the db singleton outlives the per-test IDBFactory, so start each test empty
  await Promise.all(db.tables.map((table) => table.clear()));
});

function budgets() {
  return [
    {
      id: "b1",
      name: "Our Budget",
      categoryGroups: [groupOf("g1", "Food", [["c1", "Groceries"]])],
      accounts: [accountOf("a1", "Checking")],
      payees: [payeeOf("p1", "Trader Joe's")],
    },
    {
      id: "b2",
      name: "Side Budget",
      categoryGroups: [groupOf("g9", "Fun", [["c9", "Movies"]])],
      accounts: [accountOf("a9", "Savings")],
      payees: [payeeOf("p9", "Cinema")],
    },
  ];
}

describe("caching a YNAB budget in Dexie", () => {
  it("connecting a budget fetches categories, accounts and payees and keeps the budget's name", async () => {
    const ynab = fakeYnab("good", budgets());
    await connectBudget(createYnabClient("good", ynab.fetch), { id: "b1", name: "Our Budget" });
    expect((await repo.getConnection())?.budgetName).toBe("Our Budget");
    expect((await repo.listCategories()).map((c) => c.name)).toEqual(["Groceries"]);
    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(["Checking"]);
    expect((await repo.listPayees()).map((p) => p.name)).toEqual(["Trader Joe's"]);
    expect((await repo.getConnection())?.payeesKnowledge).toBe(100);
  });

  it("keeps nothing of a connection whose reads fail half way", async () => {
    const ynab = fakeYnab("good", budgets());
    const client = createYnabClient("good", async (input, init) => {
      if (String(input).includes("/payees")) return new Response("{}", { status: 500 });
      return ynab.fetch(input, init);
    });
    await expect(connectBudget(client, { id: "b1", name: "Our Budget" })).rejects.toThrow("YNAB answered 500");
    expect(await repo.getConnection()).toBeUndefined();
    expect(await db.ynabCategories.count()).toBe(0);
  });

  it("choosing another budget replaces what the first left", async () => {
    const ynab = fakeYnab("good", budgets());
    const client = createYnabClient("good", ynab.fetch);
    await connectBudget(client, { id: "b1", name: "Our Budget" });
    await connectBudget(client, { id: "b2", name: "Side Budget" });
    expect((await repo.listCategories()).map((c) => c.name)).toEqual(["Movies"]);
    expect((await repo.listPayees()).map((p) => p.name)).toEqual(["Cinema"]);
  });

  it("a refresh reads only what changed since the last knowledge", async () => {
    const ynab = fakeYnab("good", budgets());
    const client = createYnabClient("good", ynab.fetch);
    await connectBudget(client, { id: "b1", name: "Our Budget" });
    ynab.calls.length = 0;
    ynab.knowledge = 120;
    await refreshCache(client);
    expect(ynab.calls.map((c) => c.path)).toEqual([
      "/v1/budgets/b1/categories?last_knowledge_of_server=100",
      "/v1/budgets/b1/accounts?last_knowledge_of_server=100",
      "/v1/budgets/b1/payees?last_knowledge_of_server=100",
    ]);
    expect((await repo.getConnection())?.payeesKnowledge).toBe(120);
  });

  it("a refresh with no connection does nothing", async () => {
    const ynab = fakeYnab("good", budgets());
    await refreshCache(createYnabClient("good", ynab.fetch));
    expect(ynab.calls).toEqual([]);
  });
});
