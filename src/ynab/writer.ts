import { createOutbox, PermanentSendError } from "pwa-kit/outbox";
import type { Outbox, OutboxItem, OutboxPage, OutboxStatus } from "pwa-kit/outbox";
import { YnabOutboxRepository } from "@/db/repositories/ynab-outbox-repository";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import type { YnabTransactionInput, YnabWrite } from "@/contracts/types";
import { YnabError, YnabNotFoundError, YnabRateLimitedError, YnabRefusedError, type YnabClient } from "./api";
import type { YnabTransactionWire } from "./types";

/** Where the end of YNAB's rate-limit wait is kept (device-only, so a reload still waits). */
export const YNAB_BUSY_KEY = "tradetracker-ynab-busy-until";
/** YNAB cuts a memo at 200 characters. */
const MEMO_MAX = 200;
/** The hour's limit resets within an hour; that is the wait when YNAB names none. */
const BUSY_DEFAULT_MS = 60 * 60_000;
/** One send may make two calls (the recheck, then the create), each with its own time limit. */
const SEND_TIMEOUT_MS = 40_000;
const BUSY_PREFIX = "YNAB is busy, waiting until ";

/** The sentence for the screen while YNAB's hour is used up. */
export function busyLine(untilMs: number): string {
  const time = new Date(untilMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${BUSY_PREFIX}${time}`;
}

type BusyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface YnabWriterOptions {
  /** The YNAB client for the sealed token, or null while the key is locked. */
  getClient: () => Promise<YnabClient | null>;
  repo?: YnabOutboxRepository;
  connections?: YnabRepository;
  /** The page's online and visible state; default the browser's. */
  page?: OutboxPage;
  /** Where the rate-limit wait is kept; default localStorage. */
  storage?: BusyStorage;
  /** The longest one queued write may take to send. */
  timeoutMs?: number;
  backoff?: { baseMs?: number; maxMs?: number };
  onStatus?: (status: OutboxStatus) => void;
  newId?: () => string;
}

export interface YnabWriter {
  /** Starts sending what is queued; answers the call that stops it. */
  start(): () => void;
  /** Queues a transaction to be entered in YNAB; answers its local id (the marker 'TT:<id>' in YNAB's memo). */
  create(input: YnabTransactionInput, options?: { localId?: string }): Promise<string>;
  /** Queues a change to a transaction entered earlier. */
  update(localId: string, input: YnabTransactionInput): Promise<void>;
  /** Queues the deletion of a transaction entered earlier. */
  remove(localId: string): Promise<void>;
  retry(clientId: string): Promise<void>;
  discard(clientId: string): Promise<void>;
  status(): Promise<OutboxStatus>;
  itemStatus: Outbox<YnabWrite>["itemStatus"];
  settled(): Promise<void>;
}

const milliunits = (dollars: number): number => Math.round(dollars * 1000) * -1 || 0;

/** The memo with the marker as its tail: the user's words are cut, never the marker. */
function memoWithMarker(memo: string | undefined, localId: string): string {
  const marker = `TT:${localId}`;
  const words = memo?.trim() ?? "";
  if (!words) return marker;
  return `${words.slice(0, MEMO_MAX - marker.length - 1)} ${marker}`;
}

function toWire(input: YnabTransactionInput, localId: string): YnabTransactionWire {
  const wire: YnabTransactionWire = {
    account_id: input.accountId,
    date: input.date,
    amount: milliunits(input.amount),
    memo: memoWithMarker(input.memo, localId),
    cleared: "uncleared",
    approved: true,
  };
  if (input.payeeName) wire.payee_name = input.payeeName;
  if (input.splits && input.splits.length > 0) {
    const parts = input.splits.map((s) => ({
      amount: milliunits(s.amount),
      category_id: s.categoryId,
      ...(s.memo ? { memo: s.memo.slice(0, MEMO_MAX) } : {}),
    }));
    if (parts.reduce((sum, p) => sum + p.amount, 0) !== wire.amount) {
      throw new PermanentSendError("The split does not add up to the total.");
    }
    wire.subtransactions = parts;
  } else if (input.categoryId) {
    wire.category_id = input.categoryId;
  }
  return wire;
}

/** Writes to YNAB through the outbox: entered transactions (no import_id, so YNAB's own bank import matches them), created once, updated and deleted by their YNAB id. */
export function createYnabWriter(options: YnabWriterOptions): YnabWriter {
  const repo = options.repo ?? new YnabOutboxRepository();
  const connections = options.connections ?? new YnabRepository();
  const storage: BusyStorage | undefined = options.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  let busyTimer: ReturnType<typeof setTimeout> | undefined;

  const busyUntil = (): number => Number(storage?.getItem(YNAB_BUSY_KEY)) || 0;

  function waitForBusy(until: number): void {
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => outbox.kick(true), Math.max(0, until - Date.now()));
  }

  function beBusy(retryAfterMs: number | undefined): Error {
    const until = Date.now() + (retryAfterMs ?? BUSY_DEFAULT_MS);
    storage?.setItem(YNAB_BUSY_KEY, String(until));
    waitForBusy(until);
    return new Error(busyLine(until));
  }

  async function send(item: OutboxItem<YnabWrite>, signal: AbortSignal): Promise<void> {
    const until = busyUntil();
    if (until > Date.now()) throw new Error(busyLine(until));
    if (until) storage?.removeItem(YNAB_BUSY_KEY);

    const write = item.payload;
    const connection = await connections.getConnection();
    if (!connection) throw new PermanentSendError("YNAB is not connected.");
    const client = await options.getClient();
    if (!client) throw new Error("The key is locked, so the YNAB token cannot be opened.");
    const { budgetId } = connection;
    const call = { signal };
    let freshlyStarted = false;

    try {
      if (write.kind === "create") {
        const link = await repo.getLink(write.localId);
        if (link?.ynabId) return;
        const wire = toWire(write.transaction, write.localId);
        if (link) {
          // an earlier try may have landed without our hearing: look for it by its marker before posting again
          const marker = ` TT:${write.localId}`;
          const found = (await client.transactionsSince(budgetId, write.transaction.date, call)).find(
            (t) =>
              t.account_id === wire.account_id &&
              t.amount === wire.amount &&
              typeof t.id === "string" &&
              !t.deleted &&
              ((t.memo ?? "").endsWith(marker) || t.memo === `TT:${write.localId}`),
          );
          if (found?.id) {
            await repo.setYnabId(write.localId, found.id);
            return;
          }
        } else {
          await repo.markStarted(write.localId);
          freshlyStarted = true;
        }
        const created = await client.createTransaction(budgetId, wire, call);
        await repo.setYnabId(write.localId, created.id);
      } else if (write.kind === "update") {
        const ynabId = await repo.ynabIdOf(write.localId);
        if (!ynabId) throw new PermanentSendError("The transaction never reached YNAB, so there is nothing to change there.");
        await client.updateTransaction(budgetId, ynabId, toWire(write.transaction, write.localId), call);
      } else {
        const ynabId = await repo.ynabIdOf(write.localId);
        if (ynabId) {
          try {
            await client.deleteTransaction(budgetId, ynabId, call);
          } catch (err) {
            if (!(err instanceof YnabNotFoundError)) throw err; // already gone from YNAB: that is what was wanted
          }
        }
        await repo.removeLink(write.localId);
      }
    } catch (err) {
      if (err instanceof YnabRateLimitedError) {
        // a 429 refused the post, so nothing landed: the retry need not look for it first
        if (freshlyStarted) await repo.removeLink(write.localId);
        throw beBusy(err.retryAfterMs);
      }
      if (err instanceof YnabNotFoundError) {
        throw new PermanentSendError(write.kind === "update" ? "That transaction is no longer in YNAB." : "YNAB cannot find that budget.");
      }
      if (err instanceof YnabRefusedError) throw err;
      if (err instanceof YnabError && err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 408) {
        throw new PermanentSendError(`YNAB did not accept this transaction (${err.status}).`);
      }
      throw err;
    }
  }

  const outbox = createOutbox<YnabWrite>({
    table: repo.table,
    sender: (item, { signal }) => send(item, signal),
    onStatus: options.onStatus,
    page: options.page,
    timeoutMs: options.timeoutMs ?? SEND_TIMEOUT_MS,
    backoff: options.backoff,
    newId: options.newId,
    words: {
      // the rate-limit sentence is already the whole label
      willRetry: (reason) => (reason.startsWith(BUSY_PREFIX) ? reason : `Will try again: ${reason}`),
    },
  });

  return {
    start() {
      const stopOutbox = outbox.start();
      const until = busyUntil();
      if (until > Date.now()) waitForBusy(until);
      return () => {
        clearTimeout(busyTimer);
        stopOutbox();
      };
    },
    async create(input, createOptions = {}) {
      const localId = createOptions.localId ?? crypto.randomUUID();
      await outbox.enqueue({ kind: "create", localId, transaction: input }, { clientId: localId });
      return localId;
    },
    async update(localId, input) {
      await outbox.enqueue({ kind: "update", localId, transaction: input });
    },
    async remove(localId) {
      await outbox.enqueue({ kind: "delete", localId });
    },
    retry: (clientId) => outbox.retry(clientId),
    discard: (clientId) => outbox.discard(clientId),
    status: () => outbox.status(),
    itemStatus: (item) => outbox.itemStatus(item),
    settled: () => outbox.settled(),
  };
}
