import { YNAB_REFUSED, YnabError, YnabRefusedError, createYnabClient } from "./api";
import { accountOf, fakeYnab, groupOf, payeeOf } from "./fake-ynab";

const budget = {
  id: "b1",
  name: "Our Budget",
  categoryGroups: [groupOf("g1", "Food", [["c1", "Groceries"]])],
  accounts: [accountOf("a1", "Checking")],
  payees: [payeeOf("p1", "Trader Joe's")],
};

describe("the YNAB client", () => {
  it("lists the budgets with the token as a bearer", async () => {
    const ynab = fakeYnab("good", [budget, { ...budget, id: "b2", name: "Side Budget" }]);
    const client = createYnabClient("good", ynab.fetch);
    expect(await client.budgets()).toEqual([
      { id: "b1", name: "Our Budget" },
      { id: "b2", name: "Side Budget" },
    ]);
    expect(ynab.calls).toEqual([{ path: "/v1/budgets", authorization: "Bearer good" }]);
  });

  it("reads categories, accounts and payees of one budget with their server knowledge", async () => {
    const ynab = fakeYnab("good", [budget]);
    const client = createYnabClient("good", ynab.fetch);
    const categories = await client.categoryGroups("b1");
    expect(categories.serverKnowledge).toBe(100);
    expect(categories.rows[0]?.categories[0]?.name).toBe("Groceries");
    expect((await client.accounts("b1")).rows.map((a) => a.name)).toEqual(["Checking"]);
    expect((await client.payees("b1")).rows.map((p) => p.name)).toEqual(["Trader Joe's"]);
  });

  it("asks a delta with last_knowledge_of_server", async () => {
    const ynab = fakeYnab("good", [budget]);
    const client = createYnabClient("good", ynab.fetch);
    await client.payees("b1", 100);
    await client.payees("b1", 0);
    expect(ynab.calls.map((c) => c.path)).toEqual([
      "/v1/budgets/b1/payees?last_knowledge_of_server=100",
      "/v1/budgets/b1/payees",
    ]);
  });

  it("refuses a token YNAB answers 401 to, with the plain sentence", async () => {
    const client = createYnabClient("wrong", fakeYnab("good", [budget]).fetch);
    const refused = await client.budgets().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(YnabRefusedError);
    expect((refused as Error).message).toBe(YNAB_REFUSED);
    expect(YNAB_REFUSED).toBe("YNAB did not accept this token.");
  });

  it("says plainly when YNAB cannot be reached or answers an error", async () => {
    const down = createYnabClient("good", async () => {
      throw new TypeError("offline");
    });
    await expect(down.budgets()).rejects.toThrow(YnabError);
    const busy = createYnabClient("good", async () => new Response("{}", { status: 429 }));
    await expect(busy.budgets()).rejects.toThrow("YNAB answered 429");
    const odd = createYnabClient("good", async () => new Response(JSON.stringify({ data: { budgets: "no" } }), { status: 200 }));
    await expect(odd.budgets()).rejects.toThrow(YnabError);
  });
});
