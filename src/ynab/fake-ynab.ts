// A fake api.ynab.com for tests: answers the four reads the app makes, with the server_knowledge and delta a real one gives,
// and keeps the transactions written to it (create, list since a date, update, delete).
import type { YnabAccountWire, YnabCategoryGroupWire, YnabPayeeWire } from "./types";

export interface FakeYnabBudget {
  id: string;
  name: string;
  categoryGroups: YnabCategoryGroupWire[];
  accounts: YnabAccountWire[];
  payees: YnabPayeeWire[];
}

/** A transaction as the fake keeps it (snake_case, as YNAB writes it). */
export interface FakeYnabTransaction {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  payee_name?: string | null;
  category_id?: string | null;
  memo?: string | null;
  cleared?: string;
  approved?: boolean;
  import_id?: string | null;
  subtransactions?: { amount: number; category_id?: string | null; memo?: string | null }[];
}

/** One request the fake received. */
export interface FakeYnabRequest {
  method: string;
  path: string;
  /** the JSON body of a write, as sent */
  body?: unknown;
  /** whether the request carried an abort signal (every call the app makes has a time limit) */
  hasSignal: boolean;
}

export interface FakeYnab {
  fetch: typeof fetch;
  /** every request made: method, path and query, and the Authorization header */
  calls: { path: string; authorization: string | null }[];
  /** the budgets' content; a test changes it between reads and sets `knowledge` to what the server is then at */
  budgets: FakeYnabBudget[];
  knowledge: number;
  /** every request made, with its method and the body of a write (`calls` is kept for the reads' tests) */
  requests: FakeYnabRequest[];
  /** the transactions in the budget; a delete removes the row */
  transactions: FakeYnabTransaction[];
  /** the next write lands in the budget, but its answer never comes (the fetch fails as a timeout does); reset after it */
  loseNextResponse: boolean;
  /** while set, every call answers 429, with a Retry-After header when `retryAfterSeconds` is given */
  rateLimited: { retryAfterSeconds?: number } | null;
}

export function groupOf(id: string, name: string, categories: [string, string][]): YnabCategoryGroupWire {
  return {
    id,
    name,
    hidden: false,
    deleted: false,
    categories: categories.map(([cid, cname]) => ({
      id: cid,
      category_group_id: id,
      name: cname,
      hidden: false,
      deleted: false,
    })),
  };
}

export function accountOf(id: string, name: string): YnabAccountWire {
  return { id, name, type: "checking", on_budget: true, closed: false, deleted: false };
}

export function payeeOf(id: string, name: string): YnabPayeeWire {
  return { id, name, deleted: false };
}

/** A fake YNAB that accepts exactly `token`; any other answers 401. */
export function fakeYnab(token: string, budgets: FakeYnabBudget[]): FakeYnab {
  const fake: FakeYnab = {
    budgets,
    knowledge: 100,
    calls: [],
    requests: [],
    transactions: [],
    loseNextResponse: false,
    rateLimited: null,
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      const authorization = headers.get("Authorization");
      const method = (init?.method ?? "GET").toUpperCase();
      fake.calls.push({ path: url.pathname + url.search, authorization });
      const sentBody: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      fake.requests.push({ method, path: url.pathname + url.search, body: sentBody, hasSignal: init?.signal != null });
      const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
      if (authorization !== `Bearer ${token}`) {
        return reply(401, { error: { id: "401", name: "unauthorized", detail: "Unauthorized" } });
      }
      if (fake.rateLimited) {
        const seconds = fake.rateLimited.retryAfterSeconds;
        return reply(429, { error: { id: "429", name: "too_many_requests" } }, seconds === undefined ? {} : { "Retry-After": String(seconds) });
      }
      const path = url.pathname.replace(/^\/v1/, "");
      const tx = /^\/budgets\/([^/]+)\/transactions(?:\/([^/]+))?$/.exec(path);
      if (tx) {
        if (!fake.budgets.some((b) => b.id === decodeURIComponent(tx[1]!))) return reply(404, { error: { id: "404.2", name: "resource_not_found" } });
        const written = (sentBody as { transaction?: Omit<FakeYnabTransaction, "id"> } | undefined)?.transaction;
        const lose = (response: Response): Response => {
          if (!fake.loseNextResponse) return response;
          fake.loseNextResponse = false;
          throw new DOMException("The operation timed out.", "TimeoutError");
        };
        if (method === "POST" && !tx[2] && written) {
          const made: FakeYnabTransaction = { ...written, id: `ynab-tx-${fake.transactions.length + 1}-${fake.requests.length}` };
          fake.transactions.push(made);
          return lose(reply(201, { data: { transaction_ids: [made.id], transaction: made, server_knowledge: fake.knowledge } }));
        }
        if (method === "GET" && !tx[2]) {
          const since = url.searchParams.get("since_date") ?? "";
          const rows = fake.transactions.filter((t) => t.date >= since);
          return reply(200, { data: { transactions: rows, server_knowledge: fake.knowledge } });
        }
        const at = fake.transactions.findIndex((t) => t.id === tx[2]);
        if (at < 0) return reply(404, { error: { id: "404.2", name: "resource_not_found" } });
        if (method === "PUT" && written) {
          const updated: FakeYnabTransaction = { ...written, id: tx[2]! };
          fake.transactions[at] = updated;
          return lose(reply(200, { data: { transaction: updated, server_knowledge: fake.knowledge } }));
        }
        if (method === "DELETE") {
          const [gone] = fake.transactions.splice(at, 1);
          return lose(reply(200, { data: { transaction: gone, server_knowledge: fake.knowledge } }));
        }
        return reply(400, { error: { id: "400", name: "bad_request" } });
      }
      if (path === "/budgets") {
        return reply(200, { data: { budgets: fake.budgets.map(({ id, name }) => ({ id, name })) } });
      }
      const m = /^\/budgets\/([^/]+)\/(categories|accounts|payees)$/.exec(path);
      const budget = m ? fake.budgets.find((b) => b.id === decodeURIComponent(m[1])) : undefined;
      if (!m || !budget) return reply(404, { error: { id: "404.2", name: "resource_not_found" } });
      const server_knowledge = fake.knowledge;
      if (m[2] === "categories") return reply(200, { data: { category_groups: budget.categoryGroups, server_knowledge } });
      if (m[2] === "accounts") return reply(200, { data: { accounts: budget.accounts, server_knowledge } });
      return reply(200, { data: { payees: budget.payees, server_knowledge } });
    },
  };
  return fake;
}
