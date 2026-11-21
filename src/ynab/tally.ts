// The tally behind the Sort sheet's suggestion: how many of each payee's charges in YNAB went to each category, over the last two
// years. It is read from YNAB by the phone, which holds the token (no server of ours ever does), in one call, kept in localStorage,
// and read again only once it is TALLY_FRESH_MS old, so it costs at most one of YNAB's 200 calls an hour.
import { YnabRepository } from "@/db/repositories/ynab-repository";
import type { YnabClient } from "./api";
import type { YnabTransactionWire } from "./types";
import { YNAB_BUSY_KEY } from "./writer";

/** The tally, kept on this phone. Device-only; Clear All Data and turning YNAB Off forget it. */
export const TALLY_KEY = "tradetracker-ynab-tally";
/** When the last read failed: none is tried again for TALLY_RETRY_MS. A clock, not data. */
export const TALLY_FAILED_KEY = "tradetracker-ynab-tally-failed-at";
/** The window the tally counts: two years back from the day it is read (PROVISIONAL). */
export const TALLY_WINDOW_DAYS = 730;
/** How old a tally is read again. */
export const TALLY_FRESH_MS = 12 * 60 * 60_000;
/** How long after a failed read the next is tried. */
export const TALLY_RETRY_MS = 60 * 60_000;
/** YNAB's own group, holding Uncategorized and Inflow: Ready to Assign; nothing counted goes there. */
export const INTERNAL_GROUP = "Internal Master Category";
const UNCATEGORIZED = "uncategorized";

/** How far back the transfers kept with the tally reach: a card payment is shown as the transfer YNAB holds only while it is recent. */
export const TRANSFER_WINDOW_DAYS = 45;

/** Per payee as YNAB names it, per category id: how many charges. */
export type PayeeTally = Record<string, Record<string, number>>;

/** Per payee as YNAB names it, per category id: the smallest and the largest charge, in dollars, that went there (a split is not counted). */
export type PayeeSizes = Record<string, Record<string, { min: number; max: number }>>;

export interface Tally {
  budgetId: string;
  /** the first day counted, YYYY-MM-DD */
  since: string;
  /** when it was read, epoch ms */
  readAt: number;
  payees: PayeeTally;
  /** how big the charges were in each category, per payee; not set on a tally kept before it was (it is read again) */
  sizes?: PayeeSizes;
  /** the transfers between his accounts YNAB already holds, recent ones; not set on a tally kept before they were (it is read again) */
  transfers?: RecentTransfer[];
}

/** A transfer YNAB holds: the account the money left, the account it reached (YNAB account ids), the day, and the dollars. */
export interface RecentTransfer {
  from: string;
  to: string;
  date: string;
  amount: number;
}

const repo = new YnabRepository();

/** As much of a transaction YNAB reads back as the tally looks at. */
export type TallyRow = Pick<YnabTransactionWire, "amount" | "payee_name" | "category_id" | "category_name" | "transfer_account_id" | "deleted" | "subtransactions">;

/**
 * Counts each payee's charges by category. A charge is an outflow that is not deleted and not a transfer; a split counts once for each
 * category among its parts; a row with no category, or in YNAB's Uncategorized (by name, or one of `notCounted`), does not count.
 */
export function tallyTransactions(rows: readonly TallyRow[], notCounted: ReadonlySet<string>): PayeeTally {
  const counted = (part: { category_id?: string | null; category_name?: string | null; transfer_account_id?: string | null; deleted?: boolean }) =>
    !part.deleted &&
    !part.transfer_account_id &&
    !!part.category_id &&
    !notCounted.has(part.category_id) &&
    (part.category_name ?? "").trim().toLowerCase() !== UNCATEGORIZED;
  const payees: PayeeTally = {};
  for (const row of rows) {
    const payee = row.payee_name?.trim();
    if (!payee || row.deleted || row.transfer_account_id || !(row.amount < 0)) continue;
    const parts = row.subtransactions && row.subtransactions.length > 0 ? row.subtransactions : [row];
    const categories = new Set(parts.filter(counted).map((p) => p.category_id!));
    if (categories.size === 0) continue;
    const tally = (payees[payee] ??= {});
    for (const id of categories) tally[id] = (tally[id] ?? 0) + 1;
  }
  return payees;
}

/**
 * The size of each payee's charges by category, for a charge that goes whole into one category: an outflow that is not deleted, not a
 * transfer, not a split, and in a category that counts (as tallyTransactions counts). A merchant whose charges split by size (Mint
 * Mobile's renewals and its data top-ups) is told apart by these (src/sort/suggest.ts, suggestAtOnce).
 */
export function tallySizes(rows: readonly TallyRow[], notCounted: ReadonlySet<string>): PayeeSizes {
  const sizes: PayeeSizes = {};
  for (const row of rows) {
    const payee = row.payee_name?.trim();
    if (!payee || row.deleted || row.transfer_account_id || !(row.amount < 0) || (row.subtransactions && row.subtransactions.length > 0)) continue;
    if (!row.category_id || notCounted.has(row.category_id) || (row.category_name ?? "").trim().toLowerCase() === UNCATEGORIZED) continue;
    const dollars = Math.abs(row.amount) / 1000;
    const byCategory = (sizes[payee] ??= {});
    const kept = byCategory[row.category_id];
    byCategory[row.category_id] = kept ? { min: Math.min(kept.min, dollars), max: Math.max(kept.max, dollars) } : { min: dollars, max: dollars };
  }
  return sizes;
}

/** As much of a transaction YNAB reads back as the transfers look at. */
export type TransferRow = Pick<YnabTransactionWire, "account_id" | "date" | "amount" | "transfer_account_id" | "deleted">;

/**
 * The transfers of `rows` dated `since` or later: each once, though YNAB holds both its sides, as the account the money left, the account
 * it reached, the day and the dollars. A deleted row, a row that is no transfer, and one of no amount are left out.
 */
export function recentTransfers(rows: readonly TransferRow[], since: string): RecentTransfer[] {
  const found = new Map<string, RecentTransfer>();
  for (const row of rows) {
    if (row.deleted || !row.transfer_account_id || !row.amount || row.date < since) continue;
    const out = row.amount < 0;
    const transfer: RecentTransfer = {
      from: out ? row.account_id : row.transfer_account_id,
      to: out ? row.transfer_account_id : row.account_id,
      date: row.date,
      amount: Math.abs(row.amount) / 1000,
    };
    found.set(`${transfer.from}>${transfer.to}@${transfer.date}:${transfer.amount}`, transfer);
  }
  return [...found.values()];
}

function isRecentTransfer(value: unknown): value is RecentTransfer {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<RecentTransfer>;
  return typeof t.from === "string" && typeof t.to === "string" && typeof t.date === "string" && typeof t.amount === "number";
}

function isPayeeSizes(value: unknown): value is PayeeSizes {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(
    (byCategory) =>
      typeof byCategory === "object" &&
      byCategory !== null &&
      Object.values(byCategory as Record<string, unknown>).every((r) => {
        const range = r as { min?: unknown; max?: unknown } | null;
        return typeof range === "object" && range !== null && typeof range.min === "number" && typeof range.max === "number";
      }),
  );
}

function isTally(value: unknown): value is Tally {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<Tally>;
  if (typeof t.budgetId !== "string" || typeof t.since !== "string" || typeof t.readAt !== "number") return false;
  if (typeof t.payees !== "object" || t.payees === null) return false;
  if (t.transfers !== undefined && !(Array.isArray(t.transfers) && t.transfers.every(isRecentTransfer))) return false;
  if (t.sizes !== undefined && !isPayeeSizes(t.sizes)) return false;
  return Object.values(t.payees).every(
    (byCategory) => typeof byCategory === "object" && byCategory !== null && Object.values(byCategory).every((n) => typeof n === "number" && n > 0),
  );
}

/** The tally kept on this phone, or null when none is (or what is kept is not one). */
export function readTally(): Tally | null {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(TALLY_KEY) ?? "null");
    return isTally(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** Makes the tally one that is read again by the next sheet, keeping what it holds until then (the Settings refresh asks for this). */
export function staleTally(): void {
  const kept = readTally();
  if (!kept) return;
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify({ ...kept, readAt: 0 }));
  } catch {
    // storage refused: the tally is read again when it is old
  }
}

/** Forgets the tally and the note of a failed read: what YNAB said of his spending does not outlive his connection to it. */
export function forgetTally(): void {
  try {
    localStorage.removeItem(TALLY_KEY);
    localStorage.removeItem(TALLY_FAILED_KEY);
  } catch {
    // storage refused: nothing more to do
  }
}

/** A day as YNAB writes it, YYYY-MM-DD, on this phone's calendar. */
export function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Reads the tally of the connected budget from YNAB when the one kept is of another budget or TALLY_FRESH_MS old: one call, for the
 * transactions of the last TALLY_WINDOW_DAYS. Nothing is asked without a connection, while YNAB has said it is busy, or within
 * TALLY_RETRY_MS of a failed read. A failed read keeps what was kept and rejects with YNAB's error.
 */
export async function refreshTally(client: YnabClient, options: { now?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  const connection = await repo.getConnection();
  if (!connection) return;
  const kept = readTally();
  // a tally kept before the transfers, or the sizes, were kept with it has none: it is read again, and a delta would not bring them
  if (kept && kept.budgetId === connection.budgetId && kept.transfers !== undefined && kept.sizes !== undefined && now - kept.readAt < TALLY_FRESH_MS) return;
  const stamp = (key: string) => Number(localStorage.getItem(key)) || 0;
  if (stamp(YNAB_BUSY_KEY) > now) return;
  const failedAt = stamp(TALLY_FAILED_KEY);
  if (failedAt && now - failedAt < TALLY_RETRY_MS && now >= failedAt) return;

  const since = day(now - TALLY_WINDOW_DAYS * 24 * 60 * 60_000);
  let rows: YnabTransactionWire[];
  try {
    rows = await client.transactionsSince(connection.budgetId, since);
  } catch (err) {
    try {
      localStorage.setItem(TALLY_FAILED_KEY, String(now));
    } catch {
      // storage refused: the next sheet tries again
    }
    throw err;
  }
  const internal = new Set((await repo.listCategories()).filter((c) => c.groupName === INTERNAL_GROUP).map((c) => c.id));
  // YNAB may have been turned Off (or another budget chosen) while the read was out: what it brought is then not kept.
  if ((await repo.getConnection())?.budgetId !== connection.budgetId) return;
  const tally: Tally = { budgetId: connection.budgetId, since, readAt: now, payees: tallyTransactions(rows, internal), sizes: tallySizes(rows, internal), transfers: recentTransfers(rows, day(now - TRANSFER_WINDOW_DAYS * 24 * 60 * 60_000)) };
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(tally));
    localStorage.removeItem(TALLY_FAILED_KEY);
  } catch {
    // a full or blocked store only costs the suggestion its tally
  }
}
