// The AI's suggestion for a charge on the Sort sheet: the sort-charge grind's request (the charge, the family's categories
// with what is left in each, the last charges sorted at the same merchant), the byte budget that request is held to, and the
// answer read back into the sheet's own category ids. The history is kept on this phone as charges are sorted.
import type { YnabCategory } from "@/contracts/types";
import { MAX_PAYLOAD_BYTES, openMill, sealedRecordBytes } from "@/factory/mill";
import type { MillLicence } from "@/factory/mill";
import type { Grouping } from "./receiptSplits";

/** The grind the suggestion runs: grinds/sort-charge.json, version 1.0 of its input and answer. */
export const SORT_CHARGE_KIND = "sort-charge";
export const SORT_CHARGE_VERSION = "1.0";

/** The request is held this far under the mill's cap, so a longer name or a sealing that grew still goes through. */
export const HEADROOM_BYTES = 1000;
/** How many of a merchant's sorted charges go with the request. */
export const HISTORY_SENT = 20;
/** The longest the sheet waits for the mill's answer. */
export const SUGGEST_DEADLINE_MS = 20_000;

/** What was sorted at a merchant lately. Device-only. */
export const HISTORY_KEY = "tradetracker-sort-history";
/** How many sorted charges, of all merchants, this phone keeps. */
const HISTORY_KEPT = 300;
const WHY_MAX = 160;
/** The most receipt lines, and the longest line, the request carries (schemas/sort-charge-input-1.0). */
export const LINES_SENT = 80;
const LINE_TEXT_MAX = 80;

/** One sorted charge as the request tells it: into one category, or split. */
export interface HistoryLine {
  amount: number;
  category?: string;
  split?: { category: string; amount: number }[];
}

/** The app's input of the sort-charge grind (schemas/sort-charge-input-1.0). */
export interface SortChargeRequest {
  merchant: string;
  amount: number;
  owner?: string;
  categories: { name: string; left?: number }[];
  /** newest first */
  history: HistoryLine[];
  /** what the shopper's photographed receipt prints, line by line; the answer then groups these (its amounts are the lines' sums) */
  lines?: { text: string; price: number }[];
}

/** The app's answer of the sort-charge grind (schemas/sort-charge-answer-1.0). */
export interface SortChargeAnswer {
  category?: string;
  split?: { category: string; amount: number }[];
  why: string;
}

/** Asks the mill where a charge goes. Rejects with NotAllowed while the licence is not held (or an AbortError when the signal aborts). */
export type SortChargeAsk = (request: SortChargeRequest, signal?: AbortSignal) => Promise<SortChargeAnswer>;

/** The suggestion as the sheet applies it: the YNAB ids of the categories, and the why in one line. */
export type Suggestion = { why: string; categoryId: string } | { why: string; parts: { categoryId: string; amount: number }[] };

// --- the history ---------------------------------------------------------------------------------------------------------

interface HistoryRow {
  /** the merchant, lower case */
  m: string;
  amount: number;
  parts: { category: string; amount: number }[];
}

const merchantKey = (merchant: string) => merchant.trim().toLowerCase();

function readRows(): HistoryRow[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (r): r is HistoryRow =>
        typeof r === "object" &&
        r !== null &&
        typeof r.m === "string" &&
        typeof r.amount === "number" &&
        Array.isArray(r.parts) &&
        r.parts.every((p: unknown) => typeof p === "object" && p !== null && typeof (p as { category?: unknown }).category === "string" && typeof (p as { amount?: unknown }).amount === "number"),
    );
  } catch {
    return [];
  }
}

/** Keeps what a charge was sorted into: one part for a category, several for a split. */
export function recordCharge(merchant: string, amount: number, parts: { category: string; amount: number }[]): void {
  const m = merchantKey(merchant);
  if (!m || parts.length === 0) return;
  try {
    const rows = [...readRows(), { m, amount, parts }];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(-HISTORY_KEPT)));
  } catch {
    // a full or blocked store only costs the next suggestion its history
  }
}

/** The last charges sorted at a merchant, newest first, as the request tells them. */
export function readHistory(merchant: string): HistoryLine[] {
  const m = merchantKey(merchant);
  return readRows()
    .filter((r) => r.m === m)
    .reverse()
    .slice(0, HISTORY_SENT)
    .map((r) => (r.parts.length === 1 ? { amount: r.amount, category: r.parts[0]!.category } : { amount: r.amount, split: r.parts }));
}

// --- the request ---------------------------------------------------------------------------------------------------------

/** The request for one charge: its facts, the categories by name with what is left, and the history (newest first). */
export function buildRequest(
  charge: { merchant: string; amount: number; owner?: string },
  categories: readonly YnabCategory[],
  history: readonly HistoryLine[],
  lines?: readonly { text: string; price: number }[],
): SortChargeRequest {
  return {
    merchant: charge.merchant,
    amount: charge.amount,
    ...(charge.owner ? { owner: charge.owner } : {}),
    categories: categories.map((c) => ({ name: c.name, ...(c.balance === undefined ? {} : { left: c.balance }) })),
    history: [...history],
    ...(lines && lines.length > 0 ? { lines: lines.map((l) => ({ text: l.text.slice(0, LINE_TEXT_MAX), price: l.price })).slice(0, LINES_SENT) } : {}),
  };
}

/** The request with the oldest history shed, a charge at a time, until `measure` says it is within `limit` bytes. */
export function fitToBudget(request: SortChargeRequest, measure: (request: SortChargeRequest) => number, limit: number): SortChargeRequest {
  let fitted = request;
  while (fitted.history.length > 0 && measure(fitted) > limit) fitted = { ...fitted, history: fitted.history.slice(0, -1) };
  return fitted;
}

/**
 * The suggestion over the factory: a sort-charge grist, its answer waited for. `licence` is read at each call, and the mill
 * refuses with NotAllowed before it sends anything while it is not 'licensed'.
 */
export function makeSortChargeAsk(backendUrl: string, key: Uint8Array, licence: () => MillLicence): SortChargeAsk {
  const mill = openMill(backendUrl, key, licence);
  const measure = (request: SortChargeRequest) => sealedRecordBytes(key, SORT_CHARGE_KIND, SORT_CHARGE_VERSION, request, 0);
  return async (request, signal) => {
    const input = fitToBudget(request, measure, MAX_PAYLOAD_BYTES - HEADROOM_BYTES);
    const txid = await mill.send({ kind: SORT_CHARGE_KIND, v: SORT_CHARGE_VERSION, input });
    const reply = await mill.awaitAnswer<SortChargeAnswer>(txid, signal);
    if (reply.status !== "answered" || !reply.answer) throw new Error(reply.reason || "The factory could not answer this one.");
    return reply.answer;
  };
}

// --- the answer ----------------------------------------------------------------------------------------------------------

/**
 * The answer in the sheet's own terms, or null when it cannot be used: no why, a category the budget does not have, or a split
 * that does not add up to the charge. The mill's words are matched to a category by name, whatever the case.
 */
export function resolveSuggestion(answer: SortChargeAnswer, categories: readonly YnabCategory[], amount: number): Suggestion | null {
  const why = typeof answer.why === "string" ? answer.why.replace(/\s+/g, " ").trim().slice(0, WHY_MAX) : "";
  if (!why) return null;
  const idOf = (name: string) => categories.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.id;
  if (answer.split) {
    const parts = answer.split.map((p) => ({ categoryId: idOf(p.category), amount: p.amount }));
    if (parts.length < 2 || parts.some((p) => p.categoryId === undefined || !(p.amount > 0) || Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 1e-6)) return null;
    const total = parts.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
    if (total !== Math.round(amount * 100)) return null;
    return { why, parts: parts.map((p) => ({ categoryId: p.categoryId!, amount: p.amount })) };
  }
  const categoryId = answer.category ? idOf(answer.category) : undefined;
  return categoryId === undefined ? null : { why, categoryId };
}

/**
 * The answer to a request with receipt lines, in the sheet's own terms: the one category or the categories with what the lines in each
 * add up to (not shares of the charge). Null when it cannot be used: no why, or a category the budget does not have.
 */
export function resolveGrouping(answer: SortChargeAnswer, categories: readonly YnabCategory[]): { why: string; grouping: Grouping } | null {
  const why = typeof answer.why === "string" ? answer.why.replace(/\s+/g, " ").trim().slice(0, WHY_MAX) : "";
  if (!why) return null;
  const idOf = (name: string) => categories.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.id;
  if (answer.split) {
    const parts = answer.split.map((p) => ({ categoryId: idOf(p.category), amount: p.amount }));
    if (parts.length < 1 || parts.some((p) => p.categoryId === undefined || !(p.amount > 0))) return null;
    return { why, grouping: { split: parts.map((p) => ({ categoryId: p.categoryId!, amount: p.amount })) } };
  }
  const categoryId = answer.category ? idOf(answer.category) : undefined;
  return categoryId === undefined ? null : { why, grouping: { categoryId } };
}
