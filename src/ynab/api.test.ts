import { YNAB_REFUSED, YnabError, YnabRateLimitedError, YnabRefusedError, YnabNotFoundError, createYnabClient } from "./api";
import type { YnabTransactionWire } from "./types";
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

const wire: YnabTransactionWire = {
  account_id: "a1",
  date: "2026-10-30",
  amount: -12340,
  payee_name: "Trader Joe's",
  category_id: "c1",
  memo: "TT:one",
  cleared: "uncleared",
  approved: true,
};

describe("the YNAB client's transaction writes", () => {
  it("creates, lists since a date, updates and deletes a transaction", async () => {
    const ynab = fakeYnab("good", [budget]);
    const client = createYnabClient("good", ynab.fetch);

    const created = await client.createTransaction("b1", wire);
    expect(created.id).toBeTruthy();
    expect(ynab.requests.at(-1)).toMatchObject({ method: "POST", path: "/v1/budgets/b1/transactions", body: { transaction: wire } });

    expect((await client.transactionsSince("b1", "2026-10-01")).map((t) => t.id)).toEqual([created.id]);
    expect(ynab.requests.at(-1)?.path).toBe("/v1/budgets/b1/transactions?since_date=2026-10-01");

    await client.updateTransaction("b1", created.id, { ...wire, amount: -5000 });
    expect(ynab.requests.at(-1)).toMatchObject({ method: "PUT", path: `/v1/budgets/b1/transactions/${created.id}` });
    expect(ynab.transactions[0]?.amount).toBe(-5000);

    await client.deleteTransaction("b1", created.id);
    expect(ynab.requests.at(-1)).toMatchObject({ method: "DELETE", path: `/v1/budgets/b1/transactions/${created.id}` });
    expect(ynab.transactions).toEqual([]);
  });

  it("puts a time limit on every call", async () => {
    const ynab = fakeYnab("good", [budget]);
    const client = createYnabClient("good", ynab.fetch);
    const created = await client.createTransaction("b1", wire);
    await client.transactionsSince("b1", "2026-10-01");
    await client.updateTransaction("b1", created.id, wire);
    await client.deleteTransaction("b1", created.id);
    expect(ynab.requests.map((r) => r.hasSignal)).toEqual([true, true, true, true]);
  });

  it("gives up on a call that does not answer in time", async () => {
    const hangs: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const client = createYnabClient("good", hangs, { timeoutMs: 20 });
    await expect(client.createTransaction("b1", wire)).rejects.toThrow("Could not reach YNAB");
  });

  it("stops a call when the caller's signal aborts", async () => {
    const hangs: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const client = createYnabClient("good", hangs);
    const stop = new AbortController();
    const pending = client.createTransaction("b1", wire, { signal: stop.signal });
    stop.abort();
    await expect(pending).rejects.toThrow(YnabError);
  });

  it("says a 429 is the rate limit, with the wait it names", async () => {
    const ynab = fakeYnab("good", [budget]);
    ynab.rateLimited = { retryAfterSeconds: 90 };
    const client = createYnabClient("good", ynab.fetch);
    const limited = await client.createTransaction("b1", wire).catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(YnabRateLimitedError);
    expect((limited as YnabRateLimitedError).retryAfterMs).toBe(90_000);
    expect(limited).toBeInstanceOf(YnabError);

    ynab.rateLimited = {};
    const unnamed = await client.createTransaction("b1", wire).catch((e: unknown) => e);
    expect((unnamed as YnabRateLimitedError).retryAfterMs).toBeUndefined();
  });

  it("tells a transaction that is not there from other trouble", async () => {
    const client = createYnabClient("good", fakeYnab("good", [budget]).fetch);
    await expect(client.updateTransaction("b1", "nope", wire)).rejects.toBeInstanceOf(YnabNotFoundError);
    await expect(client.deleteTransaction("b1", "nope")).rejects.toBeInstanceOf(YnabNotFoundError);
  });

  it("tells a request YNAB refuses as wrong (4xx) apart from one it could not do now", async () => {
    const refuses = createYnabClient("good", async () => new Response("{}", { status: 400 }));
    const wrong = await refuses.createTransaction("b1", wire).catch((e: unknown) => e);
    expect((wrong as YnabError).status).toBe(400);
    const down = createYnabClient("good", async () => new Response("{}", { status: 503 }));
    const sick = await down.createTransaction("b1", wire).catch((e: unknown) => e);
    expect((sick as YnabError).status).toBe(503);
  });
});
