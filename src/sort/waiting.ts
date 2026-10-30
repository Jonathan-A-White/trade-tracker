// The charges waiting to be sorted, and the ones sorted today, as this phone sees them. The feed is the family's (every phone
// sees every alert); what is this phone's own is kept on the device: whose phone it is, what it handed to the other person,
// and what it sorted.
import { ANYONE, type CardBook } from "@/family/cards";
import type { FamilyAlert } from "@/family/alerts-client";
import type { YnabCategory } from "@/contracts/types";

/** Whose phone this is: one of the names the cards were added with. Device-only. */
export const ME_KEY = "tradetracker-family-me";
/** The alerts this phone said were not its person's. Device-only. */
export const HANDED_KEY = "tradetracker-sort-handed";
/** What was sorted lately, by this phone or seen gone from the feed. Device-only. */
export const SORTED_KEY = "tradetracker-sort-sorted";
/** The window event sent when any of the three changes, so every screen reads them again. */
export const SORT_CHANGED = "tradetracker-sort-changed";

/** A card's owner word for a card both people use. */
export const SHARED = "shared";
/** A sorted record is kept this long (it is only shown for today). */
const KEEP_MS = 2 * 24 * 60 * 60_000;

/** One charge waiting to be sorted. */
export interface WaitingCharge {
  alert: FamilyAlert;
  /** dollars, parsed from the alert's amount */
  amount: number;
  merchant: string;
  /** whose card: a name, 'shared' or 'anyone' */
  owner: string;
  /** this phone's person should sort it: their card, a shared one or one no card names, and not handed off */
  mine: boolean;
  /** this phone handed it to the other person */
  handed: boolean;
}

/** A charge sorted: by this phone (`by` is its person) or by another phone (seen gone from the feed). */
export interface SortedRecord {
  id: string;
  amount: number;
  merchant: string;
  by: string;
  at: number;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The dollars of an alert's amount ("42.17", "$1,042.17"); null when it is no amount. */
export function parseAmount(amount: string | undefined): number | null {
  if (amount === undefined) return null;
  const value = Number(amount.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

/**
 * The charges waiting, this phone's person's first: their own card's, a shared card's, and an unknown card's (both are
 * pinged for those); then the other person's. Newest first within each. `me` null: every charge is this phone's.
 */
export function waitingCharges(
  alerts: readonly FamilyAlert[],
  book: CardBook,
  me: string | null,
  handed: ReadonlySet<string>,
  sorted: ReadonlySet<string> = new Set(),
): WaitingCharge[] {
  const charges: WaitingCharge[] = [];
  for (const alert of alerts) {
    if (alert.kind !== "charge" || sorted.has(alert.id)) continue;
    const amount = parseAmount(alert.amount);
    if (amount === null) continue;
    const owner = book.owner(alert.last4);
    const isHanded = handed.has(alert.id);
    const ours = me === null || same(owner, me) || same(owner, SHARED) || owner === ANYONE;
    charges.push({ alert, amount, merchant: alert.merchant?.trim() || "A charge", owner, mine: ours && !isHanded, handed: isHanded });
  }
  return charges.sort((a, b) => Number(b.mine) - Number(a.mine) || b.alert.seq - a.alert.seq);
}

/** The people the cards name (not 'shared'), in the order first named. */
export function people(owners: readonly string[]): string[] {
  const found: string[] = [];
  for (const owner of owners) {
    const name = owner.trim();
    if (name && !same(name, SHARED) && !same(name, ANYONE) && !found.some((f) => same(f, name))) found.push(name);
  }
  return found;
}

/** The other person of a family of two, when the cards name exactly one besides `me`; null otherwise. */
export function otherPerson(owners: readonly string[], me: string | null): string | null {
  const others = people(owners).filter((name) => me === null || !same(name, me));
  return others.length === 1 ? others[0]! : null;
}

/** The YNAB date (YYYY-MM-DD, this phone's day) of a charge: when the alert says it happened, or today. */
export function chargeDate(when: string | undefined, now: Date = new Date()): string {
  const at = when ? new Date(when) : now;
  const day = Number.isNaN(at.getTime()) ? now : at;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** When a charge happened, in words: '2:14 PM' today, 'Yesterday 2:14 PM', 'Oct 28, 2:14 PM'. */
export function whenLine(when: string | undefined, now: Date = new Date()): string | null {
  if (!when) return null;
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return null;
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** Dollars as the sheet says them: '$43.12'. */
export function money(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}

/** Dollars rounded to the dollar, for a balance at a glance: '$212'. */
export function wholeMoney(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(dollars);
}

/** How short a category is for `amount`: the dollars it lacks, or null when it holds enough (or its balance is not known). */
export function shortBy(category: YnabCategory, amount: number): number | null {
  if (category.balance === undefined) return null;
  const lack = Math.round((amount - category.balance) * 100) / 100;
  return lack > 0 ? lack : null;
}

/** What is left in a category, in words: '$212 left', 'nothing left'. */
export function leftLine(balance: number): string {
  return balance > 0.5 ? `${wholeMoney(balance)} left` : "nothing left";
}

// --- what this phone keeps -------------------------------------------------------------------------------------------

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storage = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

function changed(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SORT_CHANGED));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readMe(): string | null {
  const me = storage()?.getItem(ME_KEY)?.trim();
  return me ? me : null;
}

export function writeMe(name: string | null): void {
  if (name && name.trim()) storage()?.setItem(ME_KEY, name.trim());
  else storage()?.removeItem(ME_KEY);
  changed();
}

export function readHanded(): Set<string> {
  const ids = readJson<unknown>(HANDED_KEY, []);
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/** Hands a charge to the other person: it leaves this phone's own part of Waiting. */
export function handOff(id: string): void {
  const ids = readHanded();
  ids.add(id);
  storage()?.setItem(HANDED_KEY, JSON.stringify([...ids].slice(-200)));
  changed();
}

/** Takes a handed charge back. */
export function takeBack(id: string): void {
  const ids = readHanded();
  if (!ids.delete(id)) return;
  storage()?.setItem(HANDED_KEY, JSON.stringify([...ids]));
  changed();
}

export function readSorted(now: number = Date.now()): SortedRecord[] {
  const rows = readJson<unknown>(SORTED_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is SortedRecord =>
      typeof r === "object" && r !== null && typeof r.id === "string" && typeof r.by === "string" && typeof r.at === "number" && now - r.at < KEEP_MS,
  );
}

/** Keeps that a charge was sorted (once per charge: the first record stands). */
export function recordSorted(records: readonly SortedRecord[]): void {
  if (records.length === 0) return;
  const kept = readSorted();
  const known = new Set(kept.map((r) => r.id));
  const added = records.filter((r) => !known.has(r.id));
  if (added.length === 0) return;
  storage()?.setItem(SORTED_KEY, JSON.stringify([...kept, ...added]));
  changed();
}

/** The records of today (this phone's day), newest first. */
export function sortedToday(records: readonly SortedRecord[], now: Date = new Date()): SortedRecord[] {
  const start = startOfDay(now);
  return records.filter((r) => r.at >= start).sort((a, b) => b.at - a.at);
}
