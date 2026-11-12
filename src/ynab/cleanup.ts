// The Clean up screen's rules: YNAB's unapproved transactions, each given the category its payee usually goes to and how sure that is.
// Sure is the only word that pre-ticks: the payee's last SURE_FROM categorized, approved transactions in YNAB all used one category.
// Nothing here writes; the writer's approve() does, on his tap.
import type { YnabCategory } from "@/contracts/types";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { fallbackCategory, seenCategoryIds, suggestAtOnce } from "@/sort/suggest";
import type { YnabClient } from "./api";
import { INTERNAL_GROUP, TALLY_WINDOW_DAYS, day, readTally, type Tally } from "./tally";
import type { YnabTransactionWire } from "./types";

/** How many transactions a page holds. */
export const CLEANUP_PAGE = 20;
/** How many of a payee's latest categorized transactions must all agree for it to be sure (PROVISIONAL). */
export const SURE_FROM = 3;
/** The fewest categorized transactions, one category holding over half of them, that make a payee likely. */
const LIKELY_FROM = 2;
const UNCATEGORIZED = "uncategorized";

export type Confidence = "sure" | "likely" | "unsure";

export interface Suggested {
  categoryId: string;
  confidence: Confidence;
  why: string;
}

export interface HistoryEntry {
  date: string;
  categoryId: string;
}

/** Per payee (its name, trimmed, lower case): the categorized, approved transactions, newest first. */
export type PayeeHistory = Map<string, HistoryEntry[]>;

/** The payee's own key: as YNAB names it, case and outer spaces aside. */
export const payeeKey = (name: string): string => name.trim().toLowerCase();

const isUncategorized = (id: string | null | undefined, name: string | null | undefined, notCounted: ReadonlySet<string>): boolean =>
  !id || notCounted.has(id) || (name ?? "").trim().toLowerCase() === UNCATEGORIZED;

/**
 * What YNAB holds of each payee's past: approved, undeleted transactions that are neither a split nor a transfer and sit in a real
 * category (not Uncategorized, nor one of `notCounted`). An unapproved one is YNAB's guess or his half-done work, not evidence.
 */
export function payeeHistory(rows: readonly YnabTransactionWire[], notCounted: ReadonlySet<string>): PayeeHistory {
  const history: PayeeHistory = new Map();
  for (const row of rows) {
    const payee = row.payee_name?.trim();
    if (!payee || row.deleted || row.approved === false || row.transfer_account_id) continue;
    if (row.subtransactions && row.subtransactions.length > 0) continue;
    if (isUncategorized(row.category_id, row.category_name, notCounted)) continue;
    const key = payeeKey(payee);
    history.set(key, [...(history.get(key) ?? []), { date: row.date, categoryId: row.category_id! }]);
  }
  for (const entries of history.values()) entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return history;
}

/**
 * The category a payee's uncategorized transactions go to, with how sure that is: sure when its last SURE_FROM all used one category;
 * else what he taught or the YNAB tally's majority (src/sort/suggest.ts), else the category holding over half of at least two of its
 * transactions, both likely. Null when nothing says.
 */
export function suggestForPayee(payee: string, history: PayeeHistory, categories: readonly YnabCategory[], tally: Tally | null): Suggested | null {
  const entries = history.get(payeeKey(payee)) ?? [];
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name;
  const offered = (id: string) => nameOf(id) !== undefined;

  const latest = entries.slice(0, SURE_FROM);
  if (latest.length === SURE_FROM && latest.every((e) => e.categoryId === latest[0]!.categoryId) && offered(latest[0]!.categoryId)) {
    return { categoryId: latest[0]!.categoryId, confidence: "sure", why: `Its last ${SURE_FROM} here all went to ${nameOf(latest[0]!.categoryId)}.` };
  }

  const atOnce = suggestAtOnce(payee, categories, tally);
  if (atOnce) return { categoryId: atOnce.categoryId, confidence: "likely", why: atOnce.why };

  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top && entries.length >= LIKELY_FROM && top[1] * 2 > entries.length && offered(top[0])) {
    return { categoryId: top[0], confidence: "likely", why: `${top[1]} of ${entries.length} here went to ${nameOf(top[0])}.` };
  }
  return null;
}

/** One unapproved transaction as the screen holds it. */
export interface CleanupItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  payee: string;
  key: string;
  /** dollars, negative for money out */
  amount: number;
  memo: string;
  /** the category it is to go to; null while none is chosen */
  categoryId: string | null;
  /** set when its category cannot be changed here (a split, a transfer, a category not on offer): what to call it */
  fixedLabel?: string;
  confidence: Confidence;
  why: string;
  ticked: boolean;
  /** the ids of the categories the payee has been seen in (its YNAB history and tally, what he taught): Food and Household are guessed only among these */
  seen: string[];
  /** nothing known of the payee: it holds Stuff I Forgot to Budget For until the AI answers or he chooses, which closes it */
  open: boolean;
}

export interface CleanupContext {
  /** the categories on offer: not hidden, not YNAB's own */
  categories: readonly YnabCategory[];
  history: PayeeHistory;
  tally: Tally | null;
  /** the ids of YNAB's own categories (Uncategorized, Inflow) */
  notCounted: ReadonlySet<string>;
}

/**
 * The unapproved transactions as items, oldest first; the sure ones are ticked. A categorized one keeps its own category. A payee
 * nothing is known of goes to Stuff I Forgot to Budget For, unticked (the Governor, 2026-11-11), left without a category only when the
 * budget has none such.
 */
export function buildItems(rows: readonly YnabTransactionWire[], context: CleanupContext): CleanupItem[] {
  const { categories, history, tally, notCounted } = context;
  const suggested = new Map<string, Suggested | null>();
  const suggestion = (payee: string) => {
    const key = payeeKey(payee);
    if (!suggested.has(key)) suggested.set(key, suggestForPayee(payee, history, categories, tally));
    return suggested.get(key)!;
  };
  return rows
    .filter((r) => !r.deleted && r.approved !== true && typeof r.id === "string")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id! < b.id! ? -1 : 1))
    .map((row): CleanupItem => {
      const payee = row.payee_name?.trim() || "No payee";
      const base = { id: row.id!, date: row.date, payee, key: payeeKey(payee), amount: row.amount / 1000, memo: row.memo?.trim() ?? "", seen: [] as string[], open: false };
      if (row.subtransactions && row.subtransactions.length > 0) {
        return { ...base, categoryId: null, fixedLabel: "Split", confidence: "unsure", why: "Split in YNAB.", ticked: false };
      }
      if (row.transfer_account_id) {
        return { ...base, categoryId: null, fixedLabel: "Transfer", confidence: "unsure", why: "A transfer.", ticked: false };
      }
      const found = suggestion(payee);
      const seen = [...new Set([...(history.get(payeeKey(payee)) ?? []).map((e) => e.categoryId), ...seenCategoryIds(payee, categories, tally)])];
      if (!isUncategorized(row.category_id, row.category_name, notCounted)) {
        const own = categories.find((c) => c.id === row.category_id);
        if (!own) {
          return { ...base, categoryId: null, fixedLabel: row.category_name?.trim() || "Another category", confidence: "unsure", why: "Already categorized in YNAB.", ticked: false };
        }
        const agrees = found?.categoryId === own.id;
        const confidence: Confidence = agrees ? found.confidence : "unsure";
        return { ...base, seen, categoryId: own.id, confidence, why: agrees ? found.why : `YNAB has it in ${own.name}.`, ticked: confidence === "sure" };
      }
      if (found) return { ...base, seen, categoryId: found.categoryId, confidence: found.confidence, why: found.why, ticked: found.confidence === "sure" };
      const forgot = fallbackCategory(categories);
      return forgot
        ? { ...base, seen, open: true, categoryId: forgot.id, confidence: "unsure", why: `Nothing here to go by, so ${forgot.name}.`, ticked: false }
        : { ...base, seen, open: true, categoryId: null, confidence: "unsure", why: "Nothing here to go by.", ticked: false };
    });
}

export interface CleanupGroup<T extends { key: string; payee: string; amount: number; confidence: Confidence } = CleanupItem> {
  key: string;
  payee: string;
  items: T[];
  /** dollars, the sum of its transactions */
  total: number;
}

/** A page's items by payee: the groups holding a sure one first, otherwise the oldest first; in a group the sure ones first. */
export function groupPage<T extends { key: string; payee: string; amount: number; confidence: Confidence }>(items: readonly T[]): CleanupGroup<T>[] {
  const groups = new Map<string, CleanupGroup<T>>();
  for (const item of items) {
    const group = groups.get(item.key) ?? { key: item.key, payee: item.payee, items: [], total: 0 };
    group.items.push(item);
    group.total = Math.round((group.total + item.amount) * 100) / 100;
    groups.set(item.key, group);
  }
  const sure = (g: CleanupGroup<T>) => g.items.some((i) => i.confidence === "sure");
  const ordered = [...groups.values()].map((g) => ({ ...g, items: [...g.items.filter((i) => i.confidence === "sure"), ...g.items.filter((i) => i.confidence !== "sure")] }));
  return [...ordered.filter(sure), ...ordered.filter((g) => !sure(g))];
}

/** The page of CLEANUP_PAGE items that starts at `start`. */
export function pageAfter<T>(items: readonly T[], start: number): T[] {
  return items.slice(start, start + CLEANUP_PAGE);
}

/** What the screen is built from: the categories on offer and every unapproved transaction as an item, oldest first. */
export async function loadCleanup(client: YnabClient, budgetId: string, now: number = Date.now()): Promise<{ items: CleanupItem[]; categories: YnabCategory[] }> {
  const all = await new YnabRepository().listCategories();
  const notCounted = new Set(all.filter((c) => c.groupName === INTERNAL_GROUP).map((c) => c.id));
  const categories = all.filter((c) => !c.hidden && c.groupName !== INTERNAL_GROUP);
  const [unapproved, past] = await Promise.all([
    client.unapprovedTransactions(budgetId),
    client.transactionsSince(budgetId, day(now - TALLY_WINDOW_DAYS * 24 * 60 * 60_000)),
  ]);
  const tally = readTally();
  const items = buildItems(unapproved, { categories, history: payeeHistory(past, notCounted), tally: tally?.budgetId === budgetId ? tally : null, notCounted });
  return { items, categories };
}
