import type {
  YnabAccountWire,
  YnabBudgetSummary,
  YnabCategoryGroupWire,
  YnabDelta,
  YnabPayeeWire,
  YnabTransactionWire,
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

/** YNAB could not be reached, or answered something else than success. `status` is the HTTP status when it answered one. */
export class YnabError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "YnabError";
    this.status = status;
  }
}

/** YNAB answered 429: the hour's limit is used up. `retryAfterMs` is the wait it named, when it named one. */
export class YnabRateLimitedError extends YnabError {
  readonly retryAfterMs?: number;
  constructor(retryAfterMs?: number) {
    super("YNAB answered 429. Try again later.", 429);
    this.name = "YnabRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** YNAB answered 404: the transaction (or budget) is not there. */
export class YnabNotFoundError extends YnabError {
  constructor() {
    super("YNAB answered 404. Try again later.", 404);
    this.name = "YnabNotFoundError";
  }
}

/** What a write may be given besides its body. */
export interface YnabCallOptions {
  /** Aborts the call (the outbox aborts a send that outruns its time). */
  signal?: AbortSignal;
}

export interface YnabClientOptions {
  /** The longest one call may run; default `YNAB_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface YnabClient {
  budgets(): Promise<YnabBudgetSummary[]>;
  categoryGroups(budgetId: string, sinceKnowledge?: number): Promise<YnabDelta<YnabCategoryGroupWire>>;
  accounts(budgetId: string, sinceKnowledge?: number): Promise<YnabDelta<YnabAccountWire>>;
  payees(budgetId: string, sinceKnowledge?: number): Promise<YnabDelta<YnabPayeeWire>>;
  /** Creates a transaction; answers the id YNAB gave it. */
  createTransaction(budgetId: string, transaction: YnabTransactionWire, options?: YnabCallOptions): Promise<{ id: string }>;
  /** The transactions dated `sinceDate` (YYYY-MM-DD) or later. */
  transactionsSince(budgetId: string, sinceDate: string, options?: YnabCallOptions): Promise<YnabTransactionWire[]>;
  updateTransaction(budgetId: string, id: string, transaction: YnabTransactionWire, options?: YnabCallOptions): Promise<void>;
  deleteTransaction(budgetId: string, id: string, options?: YnabCallOptions): Promise<void>;
}

type Fetch = typeof fetch;

/** A client for one Personal Access Token. `fetchImpl` is the browser's fetch unless a test brings a fake YNAB. */
export function createYnabClient(
  token: string,
  fetchImpl: Fetch = (...args) => fetch(...args),
  clientOptions: YnabClientOptions = {},
): YnabClient {
  const timeoutMs = clientOptions.timeoutMs ?? YNAB_TIMEOUT_MS;

  /** One call, with a time limit of its own and the caller's signal. */
  async function call(method: string, path: string, body?: unknown, callOptions: YnabCallOptions = {}): Promise<Record<string, unknown>> {
    const run = new AbortController();
    const clock = setTimeout(() => run.abort(), timeoutMs);
    const outer = callOptions.signal;
    const onOuter = () => run.abort();
    if (outer?.aborted) run.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${YNAB_BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: run.signal,
        });
      } catch {
        throw new YnabError("Could not reach YNAB. Check the connection and try again.");
      }
      if (response.status === 401) throw new YnabRefusedError();
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        throw new YnabRateLimitedError(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined);
      }
      if (response.status === 404) throw new YnabNotFoundError();
      if (!response.ok) throw new YnabError(`YNAB answered ${response.status}. Try again later.`, response.status);
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new YnabError("YNAB answered something this app cannot read.");
      }
      const data = (parsed as { data?: unknown } | null)?.data;
      if (typeof data !== "object" || data === null) throw new YnabError("YNAB answered something this app cannot read.");
      return data as Record<string, unknown>;
    } finally {
      clearTimeout(clock);
      outer?.removeEventListener("abort", onOuter);
    }
  }

  function get(path: string, since?: number): Promise<Record<string, unknown>> {
    const query = since !== undefined && since > 0 ? `?last_knowledge_of_server=${since}` : "";
    return call("GET", `${path}${query}`);
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
    async createTransaction(budgetId, transaction, options) {
      const data = await call("POST", `/budgets/${enc(budgetId)}/transactions`, { transaction }, options);
      const id = (data.transaction as { id?: unknown } | undefined)?.id ?? (data.transaction_ids as unknown[] | undefined)?.[0];
      if (typeof id !== "string") throw new YnabError("YNAB answered something this app cannot read.");
      return { id };
    },
    async transactionsSince(budgetId, sinceDate, options) {
      const data = await call("GET", `/budgets/${enc(budgetId)}/transactions?since_date=${enc(sinceDate)}`, undefined, options);
      if (!Array.isArray(data.transactions)) throw new YnabError("YNAB answered something this app cannot read.");
      return data.transactions as YnabTransactionWire[];
    },
    async updateTransaction(budgetId, id, transaction, options) {
      await call("PUT", `/budgets/${enc(budgetId)}/transactions/${enc(id)}`, { transaction }, options);
    },
    async deleteTransaction(budgetId, id, options) {
      await call("DELETE", `/budgets/${enc(budgetId)}/transactions/${enc(id)}`, undefined, options);
    },
  };
}
