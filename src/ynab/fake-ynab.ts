// A fake api.ynab.com for tests: answers the four reads the app makes, with the server_knowledge and delta a real one gives.
import type { YnabAccountWire, YnabCategoryGroupWire, YnabPayeeWire } from "./types";

export interface FakeYnabBudget {
  id: string;
  name: string;
  categoryGroups: YnabCategoryGroupWire[];
  accounts: YnabAccountWire[];
  payees: YnabPayeeWire[];
}

export interface FakeYnab {
  fetch: typeof fetch;
  /** every request made: method, path and query, and the Authorization header */
  calls: { path: string; authorization: string | null }[];
  /** the budgets' content; a test changes it between reads and sets `knowledge` to what the server is then at */
  budgets: FakeYnabBudget[];
  knowledge: number;
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
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      const authorization = headers.get("Authorization");
      fake.calls.push({ path: url.pathname + url.search, authorization });
      const reply = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (authorization !== `Bearer ${token}`) {
        return reply(401, { error: { id: "401", name: "unauthorized", detail: "Unauthorized" } });
      }
      const path = url.pathname.replace(/^\/v1/, "");
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
