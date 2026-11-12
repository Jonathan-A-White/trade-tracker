// Budget ideas: payees that keep landing in 'Stuff I Forgot to Budget For' (src/sort/suggest.ts FALLBACK_NAME) are proposed as a new
// category with an amount (the Governor, 2026-11-12). The sweet spot he asked for (PROVISIONAL, his to confirm): group by what a spend
// is for, not by brand; propose only above SPEND_FROM dollars over twelve months or CHARGES_FROM charges; at most MAX_NEW_A_MONTH new
// proposals a month, biggest first; a small once-a-year spend folds into one yearly catch-all, a big one gets its own category.
// Nothing here reads or writes YNAB: it works on the charges it is given (chargesTo picks them from the transactions YNAB read).
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { fallbackCategory } from "@/sort/suggest";
import type { YnabClient } from "./api";
import { day } from "./tally";
import type { YnabTransactionWire } from "./types";

/** The recent window: a payee must have gone to the fallback this often within it to be proposed as a monthly spend. */
export const RECENT_MONTHS = 6;
/** The year the thresholds and the yearly spends are read over. */
export const YEAR_MONTHS = 12;
/** Charges to the fallback within the window that make a payee (or kind of spend) recurring. */
export const RECURRING_CHARGES = 3;
/** Months in a row with a charge that make a spend recurring. */
export const RECURRING_MONTHS = 2;
/** The most new proposals shown in a calendar month. */
export const MAX_NEW_A_MONTH = 3;
/** How long Not now hides a proposal. */
export const NOT_NOW_DAYS = 90;
/** The name of the yearly catch-all that small once-a-year spends fold into. */
export const CATCH_ALL_NAME = "Yearly extras";

/** The two thresholds a group must pass (either one) over the last twelve months, both set in Settings. */
export interface IdeaSettings {
  /** dollars */
  minSpend: number;
  minCharges: number;
}
export const DEFAULT_IDEA_SETTINGS: IdeaSettings = { minSpend: 150, minCharges: 3 };

/** One charge to the fallback category: dollars, positive. */
export interface IdeaCharge {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  payee: string;
  amount: number;
}

export interface BudgetIdea {
  /** stable across reads: the kind or the payee it was made from, or the catch-all */
  key: string;
  /** the category to add */
  name: string;
  cadence: "monthly" | "yearly";
  /** dollars: a month's average rounded up to $5 (monthly), or the year's total rounded up to $5 (yearly) */
  amount: number;
  /** a yearly target's next due date, YYYY-MM-DD: the first of the month before the month the spend recurs */
  dueDate?: string;
  /** dollars over the last twelve months: what ranks the ideas */
  total: number;
  payees: string[];
  /** the charges behind it */
  charges: IdeaCharge[];
}

export const roundUpTo5 = (dollars: number): number => Math.max(5, Math.ceil(Math.round(dollars * 100) / 100 / 5) * 5);
const nameKey = (name: string) => name.trim().toLowerCase();
const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * The charges to the category `categoryId` among the transactions YNAB read: outflows that are not deleted and not a transfer, a
 * split's part by its own amount. Dollars, positive.
 */
export function chargesTo(rows: readonly YnabTransactionWire[], categoryId: string): IdeaCharge[] {
  const out: IdeaCharge[] = [];
  for (const row of rows) {
    const payee = row.payee_name?.trim();
    if (!payee || row.deleted || row.transfer_account_id || !row.id) continue;
    const parts = row.subtransactions && row.subtransactions.length > 0 ? row.subtransactions : [row];
    const milli = parts.filter((p) => !p.deleted && !p.transfer_account_id && p.category_id === categoryId && p.amount < 0).reduce((sum, p) => sum + -p.amount, 0);
    if (milli > 0) out.push({ id: row.id, date: row.date, payee, amount: milli / 1000 });
  }
  return out;
}

// --- dates ------------------------------------------------------------------------------------------------------------------

/** A month as a whole number (year * 12 + month), from a YYYY-MM-DD day. */
function monthIndex(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return y! * 12 + (m! - 1);
}
const pad = (n: number) => String(n).padStart(2, "0");
const firstOf = (index: number) => `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;

/** The day `months` months before `date`, YYYY-MM-DD (the day of the month kept as far as the month has it). */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const index = y! * 12 + (m! - 1) - months;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const last = new Date(year, month + 1, 0).getDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d!, last))}`;
}

// --- the proposals ---------------------------------------------------------------------------------------------------------

export interface ProposeOptions {
  /** today, YYYY-MM-DD */
  today: string;
  /** what a payee's spend is for ("Cleaning supplies"), or undefined when it is not known (the payee then stands alone) */
  kindOf: (payee: string) => string | undefined;
  settings: IdeaSettings;
  /** the categories the budget already has: an idea named like one is not made */
  existingNames?: readonly string[];
}

interface Group {
  key: string;
  name: string;
  charges: IdeaCharge[];
}

function groupCharges(charges: readonly IdeaCharge[], kindOf: ProposeOptions["kindOf"]): Group[] {
  const groups = new Map<string, Group>();
  for (const charge of [...charges].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const kind = kindOf(charge.payee)?.trim();
    const key = kind ? `kind:${nameKey(kind)}` : `payee:${nameKey(charge.payee)}`;
    const group = groups.get(key) ?? { key, name: kind || charge.payee, charges: [] };
    // a payee stands under the way it was last written
    if (!kind) group.name = charge.payee;
    group.charges.push(charge);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const sum = (charges: readonly IdeaCharge[]) => charges.reduce((s, c) => s + cents(c.amount), 0) / 100;
const payeesOf = (charges: readonly IdeaCharge[]) => [...new Set(charges.map((c) => c.payee))];

/** Whether the months with a charge include RECURRING_MONTHS in a row. */
function monthsRunning(charges: readonly IdeaCharge[]): boolean {
  const months = [...new Set(charges.map((c) => monthIndex(c.date)))].sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i < months.length; i++) {
    run = months[i] === months[i - 1]! + 1 ? run + 1 : 1;
    if (run >= RECURRING_MONTHS) return true;
  }
  return false;
}

/** The next due date of a yearly target for a spend that happened on `date`: the first of the month before it recurs, not already past. */
function dueDateFor(date: string, today: string): string {
  let due = monthIndex(date) + 12 - 1;
  while (due < monthIndex(today)) due += 12;
  return firstOf(due);
}

/**
 * The ideas for a year of charges to the fallback category. A group (one kind of spend, or a payee whose kind is not known) is a
 * MONTHLY idea when within the last RECENT_MONTHS it had RECURRING_CHARGES charges or charges in RECURRING_MONTHS months in a row, and
 * passes the thresholds over the last twelve months; its amount is the average a month since its first charge in the window, up to $5.
 * Any other group whose year's charges sit in one month or two neighbouring ones is a YEARLY spend: a year's total of at least minSpend
 * has a category of its own, a smaller one folds into one catch-all (CATCH_ALL_NAME) proposed when the folded ones pass the thresholds
 * together. Each yearly target is due the month before the spend recurs. Unordered; chooseShown ranks and limits.
 */
export function proposeIdeas(charges: readonly IdeaCharge[], options: ProposeOptions): BudgetIdea[] {
  const { today, settings } = options;
  const yearStart = monthsBefore(today, YEAR_MONTHS);
  const recentStart = monthsBefore(today, RECENT_MONTHS);
  const year = charges.filter((c) => c.date >= yearStart && c.date <= today);
  const taken = new Set((options.existingNames ?? []).map(nameKey));
  const passes = (total: number, count: number) => cents(total) >= cents(settings.minSpend) || count >= settings.minCharges;
  const ideas: BudgetIdea[] = [];
  const small: Group[] = [];

  for (const group of groupCharges(year, options.kindOf)) {
    const recent = group.charges.filter((c) => c.date >= recentStart);
    const total = sum(group.charges);
    if (recent.length >= RECURRING_CHARGES || monthsRunning(recent)) {
      if (!passes(total, group.charges.length)) continue;
      const months = Math.max(1, Math.min(RECENT_MONTHS, monthIndex(today) - monthIndex(recent[0]!.date) + 1));
      ideas.push({ key: group.key, name: group.name, cadence: "monthly", amount: roundUpTo5(sum(recent) / months), total, payees: payeesOf(group.charges), charges: group.charges });
      continue;
    }
    const spread = Math.max(...group.charges.map((c) => monthIndex(c.date))) - Math.min(...group.charges.map((c) => monthIndex(c.date)));
    if (spread > 1) continue;
    if (cents(total) >= cents(settings.minSpend)) {
      ideas.push({
        key: group.key,
        name: group.name,
        cadence: "yearly",
        amount: roundUpTo5(total),
        dueDate: dueDateFor(group.charges[0]!.date, today),
        total,
        payees: payeesOf(group.charges),
        charges: group.charges,
      });
    } else {
      small.push(group);
    }
  }

  const folded = small.flatMap((g) => g.charges);
  if (folded.length > 0 && passes(sum(folded), folded.length)) {
    const due = small.map((g) => dueDateFor(g.charges[0]!.date, today)).sort()[0]!;
    ideas.push({ key: "yearly:catch-all", name: CATCH_ALL_NAME, cadence: "yearly", amount: roundUpTo5(sum(folded)), dueDate: due, total: sum(folded), payees: payeesOf(folded), charges: folded });
  }
  return ideas.filter((i) => !taken.has(nameKey(i.name)));
}

/**
 * Which ideas are shown now. `introduced` are the keys first shown in this calendar month (kept by the caller); those still standing
 * stay, and new ones fill what is left of the MAX_NEW_A_MONTH, biggest first. An idea he dismissed (`dismissed`) is never shown but
 * counts as one of the month's, so dismissing makes no room. Returns what to show and the month's updated introduced list.
 */
export function chooseShown(ideas: readonly BudgetIdea[], introduced: readonly string[], dismissed: ReadonlySet<string>): { shown: BudgetIdea[]; introduced: string[] } {
  const ranked = [...ideas].sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1));
  const already = new Set(introduced);
  const room = Math.max(0, MAX_NEW_A_MONTH - introduced.length);
  const fresh = ranked.filter((i) => !already.has(i.key) && !dismissed.has(i.key)).slice(0, room);
  const now = [...introduced, ...fresh.map((i) => i.key)];
  const show = new Set(now);
  return { shown: ranked.filter((i) => show.has(i.key) && !dismissed.has(i.key)), introduced: now };
}

// --- what the phone keeps ---------------------------------------------------------------------------------------------------

/** What each payee's spend is for, as the AI said (an answer is kept so it is asked once). Copied from YNAB's payee names: forgotten with YNAB. */
export const KINDS_KEY = "tradetracker-budget-ideas-kinds";
/** The charges to the fallback category last read from YNAB. Forgotten with YNAB. */
export const CHARGES_KEY = "tradetracker-budget-ideas-charges";
/** The ideas he answered Not now or Never. His own choice: it stays when YNAB goes Off. */
export const DISMISSED_KEY = "tradetracker-budget-ideas-dismissed";
/** The ideas first shown this month. His own record, like the dismissals. */
export const INTRODUCED_KEY = "tradetracker-budget-ideas-introduced";
/** The two thresholds. A setting. */
export const IDEA_SETTINGS_KEY = "tradetracker-budget-ideas-settings";

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a full or blocked store only costs the next read
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readIdeaSettings(): IdeaSettings {
  const kept = readJson(IDEA_SETTINGS_KEY);
  if (isRecord(kept) && typeof kept.minSpend === "number" && typeof kept.minCharges === "number" && kept.minSpend > 0 && kept.minCharges >= 1) {
    return { minSpend: kept.minSpend, minCharges: Math.floor(kept.minCharges) };
  }
  return DEFAULT_IDEA_SETTINGS;
}
export function writeIdeaSettings(settings: IdeaSettings): void {
  writeJson(IDEA_SETTINGS_KEY, settings);
}

/** The kinds kept, by payee (trimmed, lower case). */
export function readKinds(): Map<string, string> {
  const kept = readJson(KINDS_KEY);
  return new Map(isRecord(kept) ? Object.entries(kept).filter((e): e is [string, string] => typeof e[1] === "string") : []);
}
export function writeKind(payee: string, kind: string): void {
  const kinds = readKinds();
  kinds.set(nameKey(payee), kind);
  writeJson(KINDS_KEY, Object.fromEntries(kinds));
}

export interface KeptCharges {
  budgetId: string;
  /** epoch ms */
  readAt: number;
  charges: IdeaCharge[];
}
export function readCharges(): KeptCharges | null {
  const kept = readJson(CHARGES_KEY);
  return isRecord(kept) && typeof kept.budgetId === "string" && typeof kept.readAt === "number" && Array.isArray(kept.charges) ? (kept as unknown as KeptCharges) : null;
}
export function writeCharges(kept: KeptCharges): void {
  writeJson(CHARGES_KEY, kept);
}

export type Answer = "not-now" | "never";
/** Per idea key: the time a Not now ends (epoch ms), or null for Never. */
export type Dismissed = Record<string, number | null>;

export function readDismissed(): Dismissed {
  const kept = readJson(DISMISSED_KEY);
  return isRecord(kept) ? (Object.fromEntries(Object.entries(kept).filter((e) => e[1] === null || typeof e[1] === "number")) as Dismissed) : {};
}
export function dismiss(key: string, answer: Answer, now: number = Date.now()): void {
  writeJson(DISMISSED_KEY, { ...readDismissed(), [key]: answer === "never" ? null : now + NOT_NOW_DAYS * 24 * 60 * 60_000 });
}
export function isDismissed(kept: Dismissed, key: string, now: number = Date.now()): boolean {
  if (!(key in kept)) return false;
  const until = kept[key];
  return until === null || until === undefined || now < until;
}

/** The keys first shown in the calendar month of `today` (YYYY-MM-DD). */
export function readIntroduced(today: string): string[] {
  const kept = readJson(INTRODUCED_KEY);
  return isRecord(kept) && kept.month === today.slice(0, 7) && Array.isArray(kept.keys) ? kept.keys.filter((k): k is string => typeof k === "string") : [];
}
export function writeIntroduced(today: string, keys: readonly string[]): void {
  writeJson(INTRODUCED_KEY, { month: today.slice(0, 7), keys });
}

/** How old the charges read are read again. */
export const CHARGES_FRESH_MS = 12 * 60 * 60_000;

/**
 * The year's charges to Stuff I Forgot to Budget For: those kept when they are of the connected budget and under CHARGES_FRESH_MS old,
 * else read from YNAB (one call for the transactions of the last twelve months) and kept. Null when YNAB is not connected or the budget
 * has no such category (another family's); a failed read rejects with YNAB's error and keeps what was kept.
 */
export async function refreshIdeaCharges(client: YnabClient, options: { now?: number } = {}): Promise<KeptCharges | null> {
  const now = options.now ?? Date.now();
  const connection = await new YnabRepository().getConnection();
  if (!connection) return null;
  const forgot = fallbackCategory(await db.ynabCategories.toArray());
  if (!forgot) return null;
  const kept = readCharges();
  if (kept && kept.budgetId === connection.budgetId && now - kept.readAt < CHARGES_FRESH_MS) return kept;
  const since = monthsBefore(day(now), YEAR_MONTHS);
  const rows = await client.transactionsSince(connection.budgetId, since);
  const read: KeptCharges = { budgetId: connection.budgetId, readAt: now, charges: chargesTo(rows, forgot.id) };
  writeCharges(read);
  return read;
}

/** Forgets what was copied from YNAB (payee kinds, the charges read); his dismissals and the thresholds stay. */
export function forgetBudgetIdeas(): void {
  try {
    localStorage.removeItem(KINDS_KEY);
    localStorage.removeItem(CHARGES_KEY);
  } catch {
    // storage refused: nothing more to do
  }
}
