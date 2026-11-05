// The suggestion for a charge on the Sort sheet. First what he taught (a category he changed a suggestion to, for that merchant),
// then what the merchant NORMALLY goes to by YNAB's tally (src/ynab/tally.ts): when one category holds over half of at least
// MAJORITY_FROM counted charges, it is suggested at once, with no grist. Otherwise the sort-charge grind is asked: its request (the
// charge, the family's categories with what is left in each, the merchant's tally, and, only when the tally has nothing, the last
// charges sorted on this phone), the byte budget that request is held to, and the answer read back into the sheet's own category ids.
import type { YnabCategory } from "@/contracts/types";
import { MAX_PAYLOAD_BYTES, openMill, sealedRecordBytes } from "@/factory/mill";
import type { MillLicence } from "@/factory/mill";
import type { Tally } from "@/ynab/tally";
import { meets, merchantKey } from "./merchant-match";
import type { Grouping } from "./receiptSplits";

/** The grind the suggestion runs: grinds/sort-charge.json, version 1.1 of its input (the one with the tally) and 1.0 of its answer. */
export const SORT_CHARGE_KIND = "sort-charge";
export const SORT_CHARGE_VERSION = "1.1";

/** The request is held this far under the mill's cap, so a longer name or a sealing that grew still goes through. */
export const HEADROOM_BYTES = 1000;
/** How many of a merchant's sorted charges go with the request. */
export const HISTORY_SENT = 20;
/** How long before the sheet says the suggestion is taking too long. */
export const SUGGEST_DEADLINE_MS = 20_000;
/** After that, how much longer the wait goes on: an answer that comes late still fills the sheet while nothing is chosen. */
export const SUGGEST_LATE_MS = 240_000;
/**
 * How often the wait reads the backend. bsv-kit's 20 s equalled the deadline, so an answer the mill sent 6 s after the send was
 * looked for at 20 s, after the sheet had given up (mw-mr4xgrw.40); the mill answers a sort-charge in about 4 s.
 */
export const SUGGEST_POLL_MS = 2_000;

/** What was sorted at a merchant lately. Device-only. */
export const HISTORY_KEY = "tradetracker-sort-history";
/** The category he chose over a suggestion, per merchant. Device-only. */
export const LEARNED_KEY = "tradetracker-sort-learned";
/** The fewest counted charges, one category holding over half of them, that make a suggestion with no grist (PROVISIONAL). */
export const MAJORITY_FROM = 2;
/** How many of a merchant's categories, most charges first, the request carries. */
export const TALLY_SENT = 20;
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
  /** newest first; empty when `tally` has the merchant */
  history: HistoryLine[];
  /** what the merchant's charges in YNAB went to: each category by name, with how many, most first (schemas/sort-charge-input-1.1) */
  tally: TallyLine[];
  /** what the shopper's photographed receipt prints, line by line; the answer then groups these (its amounts are the lines' sums) */
  lines?: { text: string; price: number }[];
}

/** One category of a merchant's tally as the request tells it. */
export interface TallyLine {
  category: string;
  count: number;
}

/** A merchant's tally in the sheet's terms: the YNAB payee it met, and its counted charges per category on offer, most first. */
export interface MerchantTally {
  payee: string;
  counts: { categoryId: string; name: string; count: number }[];
  total: number;
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

// --- what is normal, and what he taught ----------------------------------------------------------------------------------

/**
 * The merchant's tally: the payees of YNAB that meet it (src/sort/merchant-match.ts), the one whose name says the most, joined with
 * any YNAB writes the same way; only the categories the sheet offers count. Null when no payee meets it or none of its charges count.
 */
export function tallyFor(merchant: string, tally: Tally | null, categories: readonly YnabCategory[]): MerchantTally | null {
  if (!tally) return null;
  const met = Object.keys(tally.payees).filter((payee) => meets(merchant, payee));
  if (met.length === 0) return null;
  const best = met.reduce((a, b) => (merchantKey(b).length > merchantKey(a).length ? b : a));
  const byCategory = new Map<string, number>();
  for (const payee of met.filter((p) => merchantKey(p) === merchantKey(best))) {
    for (const [id, count] of Object.entries(tally.payees[payee]!)) byCategory.set(id, (byCategory.get(id) ?? 0) + count);
  }
  const counts = categories
    .filter((c) => byCategory.has(c.id))
    .map((c) => ({ categoryId: c.id, name: c.name, count: byCategory.get(c.id)! }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  return total === 0 ? null : { payee: best, counts, total };
}

interface Learned {
  categoryId: string;
  name: string;
  at: number;
}

function readLearned(): Record<string, Learned> {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(LEARNED_KEY) ?? "{}");
    if (typeof kept !== "object" || kept === null || Array.isArray(kept)) return {};
    return Object.fromEntries(
      Object.entries(kept).filter(
        (e): e is [string, Learned] => typeof e[1] === "object" && e[1] !== null && typeof e[1].categoryId === "string" && typeof e[1].name === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Keeps the category he chose over the suggestion for a merchant; it is suggested there from then on, until he changes it again. */
export function learnChoice(merchant: string, category: { id: string; name: string }): void {
  const key = merchantKey(merchant);
  if (!key) return;
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify({ ...readLearned(), [key]: { categoryId: category.id, name: category.name, at: Date.now() } }));
  } catch {
    // a full or blocked store only costs the next suggestion what he taught
  }
}

/** What he taught for this merchant: the merchant as he sorted it, else the longest he sorted that meets it. */
function learnedFor(merchant: string): Learned | null {
  const learned = readLearned();
  const key = merchantKey(merchant);
  if (learned[key]) return learned[key];
  const met = Object.keys(learned).filter((k) => meets(merchant, k));
  if (met.length === 0) return null;
  return learned[met.reduce((a, b) => (b.length > a.length ? b : a))]!;
}

/** A suggestion made on the phone, with no grist: what he taught, or what the merchant normally goes to. */
export type AtOnce = { source: "learned" | "tally"; categoryId: string; why: string };

/**
 * The suggestion made at once, or null when the mill is to be asked: what he taught for the merchant when its category is on offer (by
 * id, else by name), else the category holding over half of at least MAJORITY_FROM of the merchant's counted charges. The newest
 * charge counts as one, like any other.
 */
export function suggestAtOnce(merchant: string, categories: readonly YnabCategory[], tally: Tally | null): AtOnce | null {
  const taught = learnedFor(merchant);
  if (taught) {
    const category =
      categories.find((c) => c.id === taught.categoryId) ?? categories.find((c) => c.name.trim().toLowerCase() === taught.name.trim().toLowerCase());
    if (category) return { source: "learned", categoryId: category.id, why: `You chose ${category.name} for this merchant.` };
  }
  const counted = tallyFor(merchant, tally, categories);
  const top = counted?.counts[0];
  if (!counted || !top || counted.total < MAJORITY_FROM || top.count * 2 <= counted.total) return null;
  return { source: "tally", categoryId: top.categoryId, why: `${top.count} of ${counted.total} here went to ${top.name}.` };
}

// --- the history ---------------------------------------------------------------------------------------------------------

interface HistoryRow {
  /** the merchant, lower case */
  m: string;
  amount: number;
  parts: { category: string; amount: number }[];
}

/** The history's own key: the merchant as the alert writes it, case and outer spaces aside. */
const historyKey = (merchant: string) => merchant.trim().toLowerCase();

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
  const m = historyKey(merchant);
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
  const m = historyKey(merchant);
  return readRows()
    .filter((r) => r.m === m)
    .reverse()
    .slice(0, HISTORY_SENT)
    .map((r) => (r.parts.length === 1 ? { amount: r.amount, category: r.parts[0]!.category } : { amount: r.amount, split: r.parts }));
}

// --- the request ---------------------------------------------------------------------------------------------------------

/**
 * The request for one charge: its facts, the categories by name with what is left, the merchant's tally (most first), and the history
 * (newest first) only when the tally has nothing: what the merchant normally goes to is the evidence, not what it went to last.
 */
export function buildRequest(
  charge: { merchant: string; amount: number; owner?: string },
  categories: readonly YnabCategory[],
  history: readonly HistoryLine[],
  lines?: readonly { text: string; price: number }[],
  tally?: MerchantTally | null,
): SortChargeRequest {
  const counted = (tally?.counts ?? []).slice(0, TALLY_SENT).map((c) => ({ category: c.name, count: c.count }));
  return {
    merchant: charge.merchant,
    amount: charge.amount,
    ...(charge.owner ? { owner: charge.owner } : {}),
    categories: categories.map((c) => ({ name: c.name, ...(c.balance === undefined ? {} : { left: c.balance }) })),
    history: counted.length > 0 ? [] : [...history],
    tally: counted,
    ...(lines && lines.length > 0 ? { lines: lines.map((l) => ({ text: l.text.slice(0, LINE_TEXT_MAX), price: l.price })).slice(0, LINES_SENT) } : {}),
  };
}

/**
 * The request with the oldest history shed, a charge at a time, and then the tally's least-counted categories, one at a time, until
 * `measure` says it is within `limit` bytes.
 */
export function fitToBudget(request: SortChargeRequest, measure: (request: SortChargeRequest) => number, limit: number): SortChargeRequest {
  let fitted = request;
  while (fitted.history.length > 0 && measure(fitted) > limit) fitted = { ...fitted, history: fitted.history.slice(0, -1) };
  while (fitted.tally.length > 0 && measure(fitted) > limit) fitted = { ...fitted, tally: fitted.tally.slice(0, -1) };
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
    const reply = await mill.awaitAnswer<SortChargeAnswer>(txid, signal, { intervalMs: SUGGEST_POLL_MS });
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
