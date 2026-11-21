// A charge from Amazon gets its Memo written for him from the Amazon order mail's items (Postern parses the mail and serves
// the item names as the alert's `items`: "2 Widgets, 1 Kitchen Gadgets"). The order is matched to the charge by amount and
// date; the memo is only offered, pre-filled in the Memo box for him to edit or clear (PROVISIONAL, mw-6ww.148.76).
import type { FamilyAlert } from "@/family/alerts-client";
import { parseAmount } from "./waiting";

/** The Memo's longest (the Sort sheet's own limit: YNAB keeps 200, the writer adds its marker). */
export const MEMO_LIMIT = 150;
/** An order mail counts for a charge when it came this long before the charge. */
export const ORDER_WINDOW_MS = 14 * 86_400_000;
/** Each item is cut to its first words: at most this many, and at most this many characters. */
const ITEM_WORDS = 5;
const ITEM_CHARS = 40;
/** What a memo made from a slice of a bigger order begins with. */
const PART_OF = "Part of: ";

/** One item cut to its first words (never a word cut mid-way), within ITEM_WORDS words and ITEM_CHARS characters. */
function cutItem(item: string): string {
  const words = item.split(/\s+/).filter(Boolean).slice(0, ITEM_WORDS);
  while (words.length > 1 && words.join(" ").length > ITEM_CHARS) words.pop();
  return words.join(" ");
}

/**
 * The memo for an order's items: the names in the mail's order, each cut to its first words and joined by '; '; when they do
 * not all fit in MEMO_LIMIT, as many as fit and then '& N more'. `part`: the charge is a slice of a bigger order, so it
 * begins 'Part of: '. Empty when there are no items.
 */
export function amazonMemo(items: string, part = false): string {
  const names = items.split(/\s*,\s*/).map(cutItem).filter(Boolean);
  if (names.length === 0) return "";
  const prefix = part ? PART_OF : "";
  const n = names.length;
  for (let k = n; k >= 1; k--) {
    const memo = `${prefix}${names.slice(0, k).join("; ")}${k < n ? `; & ${n - k} more` : ""}`;
    if (memo.length <= MEMO_LIMIT) return memo;
  }
  // even the first name does not fit: take as many of its words as do
  const words = names[0]!.split(" ");
  const tail = n > 1 ? `; & ${n - 1} more` : "";
  while (words.length > 0) {
    const memo = `${prefix}${words.join(" ")}${tail}`;
    if (memo.length <= MEMO_LIMIT) return memo;
    words.pop();
  }
  return "";
}

/** The order mail matched to a charge: its items, and whether the charge is only a slice of that order. */
export interface MatchedOrder {
  items: string;
  part: boolean;
}

/**
 * The 'amazon' alert whose amount equals the charge's, from the 14 days before it (the newest); failing that the newest in the
 * window whose amount is larger (a slice of a split order). Alerts with no items or no time are not matched.
 */
export function matchOrder(alerts: readonly FamilyAlert[], amount: number, when: string | undefined, now: number = Date.now()): MatchedOrder | null {
  const parsed = when ? Date.parse(when) : NaN;
  const at = Number.isNaN(parsed) ? now : parsed;
  const cents = Math.round(amount * 100);
  const near = alerts
    .filter((a) => {
      if (a.kind !== "amazon" || !a.items?.trim() || !a.when) return false;
      const ordered = Date.parse(a.when);
      return !Number.isNaN(ordered) && ordered <= at && at - ordered <= ORDER_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.when!) - Date.parse(a.when!) || b.seq - a.seq);
  const total = (a: FamilyAlert) => {
    const dollars = parseAmount(a.amount);
    return dollars === null ? null : Math.round(dollars * 100);
  };
  const same = near.find((a) => total(a) === cents);
  if (same) return { items: same.items!, part: false };
  const bigger = near.find((a) => {
    const t = total(a);
    return t !== null && t > cents;
  });
  return bigger ? { items: bigger.items!, part: true } : null;
}

/** True for a charge Amazon's card descriptor names ('AMAZON MKTPLACE PMTS', 'Amazon.com', 'AMZN Mktp US'). */
export function isAmazonMerchant(merchant: string): boolean {
  return /\bamazon\b|\bamzn\b|amazon\./i.test(merchant);
}

/** The memo to pre-fill for a charge: written from its order's items, or '' when it is not an Amazon charge or no order matches. */
export function orderMemo(alerts: readonly FamilyAlert[], merchant: string, amount: number, when: string | undefined): string {
  if (!isAmazonMerchant(merchant)) return "";
  const order = matchOrder(alerts, amount, when);
  return order ? amazonMemo(order.items, order.part) : "";
}
