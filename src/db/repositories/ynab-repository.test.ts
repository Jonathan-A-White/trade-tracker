import { db } from "../database";
import { YnabRepository } from "./ynab-repository";
import { accountOf, groupOf, payeeOf } from "@/ynab/fake-ynab";

const repo = new YnabRepository();

beforeEach(async () => {
  // the db singleton outlives the per-test IDBFactory, so start each test empty
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("YnabRepository", () => {
  it("has no connection until one is saved", async () => {
    expect(await repo.getConnection()).toBeUndefined();
  });

  it("saves the connection with the budget's name", async () => {
    await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    const connection = await repo.getConnection();
    expect(connection?.budgetName).toBe("Our Budget");
    expect(connection?.categoriesKnowledge).toBe(0);
  });

  it("caches categories with their group name, and drops the deleted ones", async () => {
    await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await repo.applyCategories(
      [groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]])],
      7,
    );
    expect((await repo.listCategories()).map((c) => `${c.groupName}/${c.name}`)).toEqual(["Food/Eating Out", "Food/Groceries"]);
    expect((await repo.getConnection())?.categoriesKnowledge).toBe(7);

    const gone = groupOf("g1", "Food", [["c2", "Eating Out"]]);
    gone.categories[0]!.deleted = true;
    await repo.applyCategories([gone], 9);
    expect((await repo.listCategories()).map((c) => c.name)).toEqual(["Groceries"]);
  });

  it("caches accounts and payees, updates a changed one, and removes a deleted one", async () => {
    await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await repo.applyAccounts([accountOf("a1", "Checking")], 3);
    await repo.applyPayees([payeeOf("p1", "Trader Joe's"), payeeOf("p2", "Stop & Shop")], 4);
    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(["Checking"]);
    expect((await repo.listPayees()).map((p) => p.name)).toEqual(["Stop & Shop", "Trader Joe's"]);

    await repo.applyPayees([{ ...payeeOf("p1", "Trader Joes"), deleted: false }, { ...payeeOf("p2", "x"), deleted: true }], 6);
    expect((await repo.listPayees()).map((p) => p.name)).toEqual(["Trader Joes"]);
    expect((await repo.getConnection())?.payeesKnowledge).toBe(6);
  });

  it("clears the connection and everything cached", async () => {
    await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await repo.applyPayees([payeeOf("p1", "Trader Joe's")], 4);
    await repo.clearAll();
    expect(await repo.getConnection()).toBeUndefined();
    expect(await db.ynabPayees.count()).toBe(0);
  });
});
