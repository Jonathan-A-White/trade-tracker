import type {
  YnabAccountWire,
  YnabBudgetSummary,
  YnabCategoryGroupWire,
  YnabDelta,
  YnabPayeeWire,
} from "./types";

export const YNAB_BASE_URL = "https://api.ynab.com/v1";
/** A call that has not answered by now is given up; nothing waits on YNAB. */
export const YNAB_TIMEOUT_MS = 15_000;

export const YNAB_REFUSED = "YNAB did not accept this token.";

/** YNAB answered 401: the token is wrong, or was revoked. */
export class YnabRefusedError extends Error {
  constructor() {
    super(YNAB_REFUSED);
    this.name = "YnabRefusedError";
  }
}

/** YNAB could not be reached, or answered something else than success. */
export class YnabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YnabError";
  }
}

export interface YnabClient {
  budgets(): Promise<YnabBudgetSummary[]>;
  categoryGroups(budgetId: string, sinceKnowledge?: number): Promise<YnabDelta<YnabCategoryGroupWire>>;
  accounts(budgetId: string, sinceKnowledge?: number): Promise<YnabDelta<YnabAccountWire>>;
  payees(budgetId: string, sinceKnowledge?: number): Promise<YnabDelta<YnabPayeeWire>>;
}

type Fetch = typeof fetch;

/** A client for one Personal Access Token. `fetchImpl` is the browser's fetch unless a test brings a fake YNAB. */
export function createYnabClient(token: string, fetchImpl: Fetch = (...args) => fetch(...args)): YnabClient {
  async function get(path: string, since?: number): Promise<Record<string, unknown>> {
    const query = since !== undefined && since > 0 ? `?last_knowledge_of_server=${since}` : "";
    let response: Response;
    try {
      response = await fetchImpl(`${YNAB_BASE_URL}${path}${query}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(YNAB_TIMEOUT_MS),
      });
    } catch {
      throw new YnabError("Could not reach YNAB. Check the connection and try again.");
    }
    if (response.status === 401) throw new YnabRefusedError();
    if (!response.ok) throw new YnabError(`YNAB answered ${response.status}. Try again later.`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new YnabError("YNAB answered something this app cannot read.");
    }
    const data = (body as { data?: unknown } | null)?.data;
    if (typeof data !== "object" || data === null) throw new YnabError("YNAB answered something this app cannot read.");
    return data as Record<string, unknown>;
  }

  function listOf<T>(data: Record<string, unknown>, field: string): YnabDelta<T> {
    const rows = data[field];
    const serverKnowledge = data.server_knowledge;
    if (!Array.isArray(rows) || typeof serverKnowledge !== "number") {
      throw new YnabError("YNAB answered something this app cannot read.");
    }
    return { rows: rows as T[], serverKnowledge };
  }

  const enc = encodeURIComponent;
  return {
    async budgets() {
      const rows = (await get("/budgets"))["budgets"];
      if (!Array.isArray(rows)) throw new YnabError("YNAB answered something this app cannot read.");
      return (rows as YnabBudgetSummary[]).map(({ id, name }) => ({ id, name }));
    },
    async categoryGroups(budgetId, since) {
      return listOf(await get(`/budgets/${enc(budgetId)}/categories`, since), "category_groups");
    },
    async accounts(budgetId, since) {
      return listOf(await get(`/budgets/${enc(budgetId)}/accounts`, since), "accounts");
    },
    async payees(budgetId, since) {
      return listOf(await get(`/budgets/${enc(budgetId)}/payees`, since), "payees");
    },
  };
}
