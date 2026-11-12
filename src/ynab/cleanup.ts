// The Clean up screen's rules: YNAB's unapproved transactions, each given the category its payee usually goes to and how sure that is.
// Sure is the only word that pre-ticks: the payee's last SURE_FROM categorized, approved transactions in YNAB all used one category.
// Nothing here writes; the writer's approve() does, on his tap (or, for a payee with a rule, src/ynab/payee-rules.ts before this lists it).
import type { YnabAccount, YnabCategory } from "@/contracts/types";
import { CheckImageRepository } from "@/db/repositories/check-image-repository";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { fallbackCategory, seenCategoryIds, suggestAtOnce } from "@/sort/suggest";
import { money } from "@/sort/waiting";
import type { YnabClient } from "./api";
import { memoFor, resolveCheckRead, type CheckRead } from "./check-read";
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
  /** set when the transaction was money in; an inflow is judged by the payee's earlier inflows only, an outflow by its outflows */
  inflow?: true;
}

/**
 * YNAB's Inflow: Ready to Assign: the one category in the budget's internal group that is not Uncategorized (found by its group, not
 * by its name). An inflow with nothing better to go by is suggested here, never into a spending category (the Governor, 2026-11-12).
 */
export const isInflowCategory = (c: Pick<YnabCategory, "groupName" | "name">): boolean =>
  c.groupName === INTERNAL_GROUP && c.name.trim().toLowerCase() !== UNCATEGORIZED;

/**
 * A check's payee text in YNAB: 'CHECK <number>', then the bank's account tail (the Governor's example: 'CHECK 1089 *8368'). The
 * number alone says which check; the pile of checks at the end of Clean up is every transaction this matches.
 */
export const CHECK_PAYEE = /^check\s+#?(\d+)\b/i;

/** The check number of a payee text that is a check ('CHECK 1089 *8368' gives '1089'), else null. */
export function checkNumberOf(payee: string): string | null {
  return CHECK_PAYEE.exec(payee.trim())?.[1] ?? null;
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
    // a check is not a payee to learn from: each is its own card and only its image says who was paid
    if (!payee || checkNumberOf(payee) !== null || row.deleted || row.approved === false || row.transfer_account_id) continue;
    if (row.subtransactions && row.subtransactions.length > 0) continue;
    if (isUncategorized(row.category_id, row.category_name, notCounted)) continue;
    const key = payeeKey(payee);
    history.set(key, [...(history.get(key) ?? []), { date: row.date, categoryId: row.category_id!, ...(row.amount > 0 ? { inflow: true as const } : {}) }]);
  }
  for (const entries of history.values()) entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return history;
}

/**
 * The category a payee's uncategorized transactions go to, with how sure that is: sure when its last SURE_FROM all used one category;
 * else what he taught or the YNAB tally's majority (src/sort/suggest.ts), else the category holding over half of at least two of its
 * transactions, both likely. Null when nothing says.
 */
export function suggestForPayee(
  payee: string,
  history: PayeeHistory,
  categories: readonly YnabCategory[],
  tally: Tally | null,
  direction: "out" | "in" = "out",
): Suggested | null {
  const entries = (history.get(payeeKey(payee)) ?? []).filter((e) => (direction === "in") === (e.inflow === true));
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name;
  const offered = (id: string) => nameOf(id) !== undefined;

  const latest = entries.slice(0, SURE_FROM);
  if (latest.length === SURE_FROM && latest.every((e) => e.categoryId === latest[0]!.categoryId) && offered(latest[0]!.categoryId)) {
    return { categoryId: latest[0]!.categoryId, confidence: "sure", why: `Its last ${SURE_FROM} here all went to ${nameOf(latest[0]!.categoryId)}.` };
  }

  // what he taught and the tally are about charges: an inflow has neither
  const atOnce = direction === "in" ? null : suggestAtOnce(payee, categories, tally);
  if (atOnce) return { categoryId: atOnce.categoryId, confidence: "likely", why: atOnce.why };

  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top && entries.length >= LIKELY_FROM && top[1] * 2 > entries.length && offered(top[0])) {
    return { categoryId: top[0], confidence: "likely", why: `${top[1]} of ${entries.length} here went to ${nameOf(top[0])}.` };
  }
  return null;
}

/** What an inflow goes to is called, in the why, as YNAB shows it on the budget. */
const READY_TO_ASSIGN = "Ready to Assign";

/**
 * The category an uncategorized inflow goes to by the payee's earlier inflows alone: a spending category they point to (sure or likely,
 * as for a charge), else Ready to Assign when most of them went there, never sure, never the fallback. Null when nothing says.
 */
function suggestForInflow(payee: string, history: PayeeHistory, categories: readonly YnabCategory[], inflow: YnabCategory | undefined, forgotId: string | undefined): Suggested | null {
  const spending = categories.filter((c) => !isInflowCategory(c) && c.id !== forgotId);
  const found = suggestForPayee(payee, history, inflow ? [...spending, inflow] : spending, null, "in");
  if (found && found.categoryId === inflow?.id) return { ...found, confidence: "likely" };
  if (found) return found;
  if (!inflow) return null;
  const entries = (history.get(payeeKey(payee)) ?? []).filter((e) => e.inflow === true);
  const there = entries.filter((e) => e.categoryId === inflow.id).length;
  return there > 0 && there * 2 > entries.length ? { categoryId: inflow.id, confidence: "likely", why: `${there} of ${entries.length} earlier inflows here went to ${READY_TO_ASSIGN}.` } : null;
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
  /** the category YNAB holds for it now (null: none); what an undo puts back */
  ynabCategoryId: string | null;
  /** set when its category cannot be changed here (a split, a transfer, a category not on offer): what to call it */
  fixedLabel?: string;
  confidence: Confidence;
  why: string;
  ticked: boolean;
  /** the ids of the categories the payee has been seen in (its YNAB history and tally, what he taught): Food and Household are guessed only among these */
  seen: string[];
  /** nothing known of the payee: it holds Stuff I Forgot to Budget For until the AI answers or he chooses, which closes it */
  open: boolean;
  /** the check number, when the payee is a check ('CHECK 1089 *8368'): such an item sits in the Checks pile, its own card */
  check?: string;
  /** the memo to write on Approve (from a check image's read); none leaves YNAB's memo as it is */
  writeMemo?: string;
  /** a plain first line, said above the why: what a transfer moved, the parts of a split, or that YNAB already holds the category */
  note?: string;
}

export interface CleanupContext {
  /** the categories on offer: not hidden, not YNAB's own */
  categories: readonly YnabCategory[];
  history: PayeeHistory;
  tally: Tally | null;
  /** the ids of YNAB's own categories that are not to be learned from or chosen (Uncategorized) */
  notCounted: ReadonlySet<string>;
  /** YNAB's Inflow: Ready to Assign, where an inflow goes; also in `categories` so it can be chosen. Absent when the budget has none cached. */
  inflow?: YnabCategory;
  /** YNAB's accounts, cached: a transfer names its two accounts and their kind from these */
  accounts?: readonly YnabAccount[];
  /** every transaction read (the unapproved and the recent past): a transfer's other side is looked for among them */
  known?: readonly YnabTransactionWire[];
}

const LOAN_TYPES = new Set(["mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt", "otherLiability", "lineOfCredit"]);
const UNKNOWN_ACCOUNT = "another account";

/** The kind of a transfer from its two accounts' YNAB types; 'Transfer' when either account is not known. */
export function transferKind(a: YnabAccount | undefined, b: YnabAccount | undefined): string {
  if (!a || !b) return "Transfer";
  const card = (x: YnabAccount) => x.type === "creditCard";
  if (card(a) && card(b)) return "Move between credit cards";
  if (card(a) || card(b)) return "Credit card payment";
  if (LOAN_TYPES.has(a.type) || LOAN_TYPES.has(b.type)) return "Loan payment";
  if (!a.onBudget || !b.onBudget) return "Tracking account move";
  if (a.type === "savings" || b.type === "savings") return "Savings move";
  return "Move between your own bank accounts";
}

/**
 * A transfer card in plain words (the Governor, 2026-11-12): the note says what moved, from which account to which and of what kind;
 * the why says whether YNAB holds the other side. Sure only when that side is there and approved; matched but not approved (or not
 * among the transactions read) is likely; with no match it is unsure. None of them has a category: approving writes approved only.
 */
function describeTransfer(row: YnabTransactionWire, accounts: readonly YnabAccount[], known: ReadonlyMap<string, YnabTransactionWire>): Pick<CleanupItem, "note" | "why" | "confidence" | "ticked"> {
  const mine = accounts.find((a) => a.id === row.account_id);
  const other = accounts.find((a) => a.id === row.transfer_account_id);
  const [from, to] = row.amount < 0 ? [mine, other] : [other, mine];
  const kind = transferKind(mine, other);
  const note = `${kind}: ${money(Math.abs(row.amount) / 1000)} from ${from?.name ?? UNKNOWN_ACCOUNT} to ${to?.name ?? UNKNOWN_ACCOUNT}, ${row.date}`;
  const where = other?.name ?? UNKNOWN_ACCOUNT;
  if (!row.transfer_transaction_id) return { note, why: `No matching transaction in ${where} yet.`, confidence: "unsure", ticked: false };
  const side = known.get(row.transfer_transaction_id);
  if (side && !side.deleted && side.approved === true) return { note, why: `YNAB has the other side in ${where}, and it is approved.`, confidence: "sure", ticked: true };
  if (side && !side.deleted) return { note, why: `YNAB has the other side in ${where}, not approved yet.`, confidence: "likely", ticked: false };
  return { note, why: `YNAB has the other side in ${where}.`, confidence: "likely", ticked: false };
}

/** A split's parts as one sentence: '$20.00 Groceries, $10.00 Household'. */
function describeSplit(row: YnabTransactionWire, categories: readonly YnabCategory[], accounts: readonly YnabAccount[]): string {
  const parts = (row.subtransactions ?? []).filter((p) => !p.deleted);
  const where = (p: (typeof parts)[number]) =>
    p.transfer_account_id ? `transfer to ${accounts.find((a) => a.id === p.transfer_account_id)?.name ?? UNKNOWN_ACCOUNT}` : (p.category_name?.trim() || categories.find((c) => c.id === p.category_id)?.name || "no category");
  return `Split in YNAB into ${parts.length === 1 ? "1 part" : `${parts.length} parts`}: ${parts.map((p) => `${money(Math.abs(p.amount) / 1000)} ${where(p)}`).join(", ")}.`;
}

/** What is said first of a transaction YNAB already has in a category. */
const alreadyIn = (category: string): string => `Already in ${category} in YNAB; only needs approving`;

/** The order of the list: every check after every other transaction, then oldest first. */
export function compareItems(a: { check?: boolean | string; date: string; id: string }, b: { check?: boolean | string; date: string; id: string }): number {
  if (!!a.check !== !!b.check) return a.check ? 1 : -1;
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1;
}

/**
 * The unapproved transactions as items, oldest first, the checks after all the rest; the sure ones are ticked. A categorized one keeps its own category. A payee
 * nothing is known of goes to Stuff I Forgot to Budget For, unticked (the Governor, 2026-11-11), left without a category only when the
 * budget has none such. Money in (a positive amount) never does: it goes to Inflow: Ready to Assign unless the payee's earlier inflows point
 * to a spending category (the Governor, 2026-11-12).
 */
export function buildItems(rows: readonly YnabTransactionWire[], context: CleanupContext): CleanupItem[] {
  const { categories, history, tally, notCounted } = context;
  const accounts = context.accounts ?? [];
  const known = new Map([...(context.known ?? []), ...rows].flatMap((r) => (r.id ? [[r.id, r] as const] : [])));
  const inflowCategory = context.inflow ?? categories.find(isInflowCategory);
  // a charge is judged among the spending categories; Ready to Assign is for money in
  const spending = categories.filter((c) => !isInflowCategory(c));
  const forgotId = fallbackCategory(categories)?.id;
  const suggested = new Map<string, Suggested | null>();
  const suggestion = (payee: string, inflow: boolean) => {
    const key = `${inflow ? "in" : "out"}:${payeeKey(payee)}`;
    if (!suggested.has(key)) suggested.set(key, inflow ? suggestForInflow(payee, history, categories, inflowCategory, forgotId) : suggestForPayee(payee, history, spending, tally));
    return suggested.get(key)!;
  };
  const orderOf = (r: YnabTransactionWire) => ({ check: checkNumberOf(r.payee_name?.trim() ?? "") ?? undefined, date: r.date, id: r.id! });
  return rows
    .filter((r) => !r.deleted && r.approved !== true && typeof r.id === "string")
    .sort((a, b) => compareItems(orderOf(a), orderOf(b)))
    .map((row): CleanupItem => {
      const payee = row.payee_name?.trim() || "No payee";
      const check = checkNumberOf(payee);
      // each check is its own card: its key is the transaction's, so one check never merges with another
      const key = check === null ? payeeKey(payee) : `check:${row.id}`;
      const base = { id: row.id!, date: row.date, payee, key, amount: row.amount / 1000, memo: row.memo?.trim() ?? "", ynabCategoryId: row.category_id ?? null, seen: [] as string[], open: false, ...(check === null ? {} : { check }) };
      if (row.subtransactions && row.subtransactions.length > 0) {
        return { ...base, categoryId: null, fixedLabel: "Split", note: describeSplit(row, categories, accounts), confidence: "unsure", why: "Approving it keeps its parts as they are.", ticked: false };
      }
      if (row.transfer_account_id) {
        return { ...base, categoryId: null, fixedLabel: "Transfer", ...describeTransfer(row, accounts, known) };
      }
      const isInflow = check === null && row.amount > 0;
      const found = check === null ? suggestion(payee, isInflow) : null;
      const seen = [...new Set([...(history.get(payeeKey(payee)) ?? []).map((e) => e.categoryId), ...seenCategoryIds(payee, categories, tally)])];
      if (!isUncategorized(row.category_id, row.category_name, notCounted)) {
        const own = categories.find((c) => c.id === row.category_id);
        if (!own) {
          const name = row.category_name?.trim() || "Another category";
          return { ...base, categoryId: null, fixedLabel: name, note: alreadyIn(name), confidence: "unsure", why: "This screen cannot change that category; approving keeps it.", ticked: false };
        }
        // YNAB already holds the category: what is checked is whether the payee's history agrees with it, and an agreeing one is ticked
        const agrees = found?.categoryId === own.id;
        const confidence: Confidence = agrees ? found.confidence : "unsure";
        const why = check !== null ? "Add the check's image and it is read for who was paid." : agrees ? found.why : found ? `Its history here went to ${categories.find((c) => c.id === found.categoryId)?.name ?? "another category"}, not ${own.name}.` : "Nothing in its history to check that.";
        return { ...base, seen, categoryId: own.id, note: alreadyIn(own.name), confidence, why, ticked: agrees };
      }
      if (found) return { ...base, seen, categoryId: found.categoryId, confidence: found.confidence, why: found.why, ticked: found.confidence === "sure" };
      if (isInflow) {
        // money in is not a charge: never the fallback, and the mill is not asked
        return inflowCategory
          ? { ...base, seen, categoryId: inflowCategory.id, confidence: "unsure", why: `Money in, with no earlier inflow from this payee to go by, so ${READY_TO_ASSIGN}.`, ticked: false }
          : { ...base, seen, categoryId: null, confidence: "unsure", why: "Nothing here to go by.", ticked: false };
      }
      const forgot = fallbackCategory(categories);
      if (check !== null) {
        // its image will say who was paid; until then it holds the fallback, not asked of the AI by its payee text
        return { ...base, seen, categoryId: forgot?.id ?? null, confidence: "unsure", why: "Add the check's image and it is read for who was paid.", ticked: false };
      }
      return forgot
        ? { ...base, seen, open: true, categoryId: forgot.id, confidence: "unsure", why: `Nothing here to go by, so ${forgot.name}.`, ticked: false }
        : { ...base, seen, open: true, categoryId: null, confidence: "unsure", why: "Nothing here to go by.", ticked: false };
    });
}

/**
 * The items a payee rule left for him because its category lacks the money (the setting 'Leave it for me'), each with a first line
 * naming the category and the shortfall. Its own category is not changed.
 */
export function withHeldNotes(items: readonly CleanupItem[], held: Readonly<Record<string, { categoryId: string; short: number }>>, categories: readonly YnabCategory[]): CleanupItem[] {
  if (Object.keys(held).length === 0) return [...items];
  return items.map((item) => {
    const h = held[item.id];
    if (!h) return item;
    const name = categories.find((c) => c.id === h.categoryId)?.name ?? "its category";
    const line = `Held for you: ${name} is short by ${shortMoney(h.short)} for this.`;
    return { ...item, note: item.note ? `${line} ${item.note}` : line };
  });
}

const shortMoney = (dollars: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);

/**
 * An item with a check image's read applied: the category it suggests (kept as it was when none), the why naming what was read, never
 * ticked, and the memo to write on Approve. A split or a transfer keeps its fixed label and takes only the memo.
 */
export function applyCheckRead(item: CleanupItem, read: CheckRead): CleanupItem {
  const writeMemo = memoFor(item.memo, read);
  const memoPatch = writeMemo && writeMemo !== item.memo ? { writeMemo } : {};
  if (item.fixedLabel) return { ...item, ...memoPatch };
  return {
    ...item,
    ...memoPatch,
    // the read's category replaces what YNAB held, so "Already in <category>" no longer says what the card will do
    ...(read.categoryId ? { categoryId: read.categoryId, note: undefined } : {}),
    confidence: read.categoryId ? read.confidence : "unsure",
    why: read.why,
    ticked: false,
    open: false,
  };
}

export interface CleanupGroup<T extends { key: string; payee: string; amount: number; confidence: Confidence; check?: string } = CleanupItem> {
  key: string;
  payee: string;
  items: T[];
  /** dollars, the sum of its transactions */
  total: number;
}

/**
 * A page's items by payee: the groups holding a sure one first, otherwise the oldest first; in a group the sure ones first. Each check
 * is a group of its own and the checks come last, oldest first.
 */
export function groupPage<T extends { key: string; payee: string; amount: number; confidence: Confidence; check?: string }>(items: readonly T[]): CleanupGroup<T>[] {
  const groups = new Map<string, CleanupGroup<T>>();
  for (const item of items) {
    const group = groups.get(item.key) ?? { key: item.key, payee: item.payee, items: [], total: 0 };
    group.items.push(item);
    group.total = Math.round((group.total + item.amount) * 100) / 100;
    groups.set(item.key, group);
  }
  const sure = (g: CleanupGroup<T>) => g.items.some((i) => i.confidence === "sure");
  const ordered = [...groups.values()].map((g) => ({ ...g, items: [...g.items.filter((i) => i.confidence === "sure"), ...g.items.filter((i) => i.confidence !== "sure")] }));
  const isCheck = (g: CleanupGroup<T>) => g.items.some((i) => i.check !== undefined);
  const others = ordered.filter((g) => !isCheck(g));
  return [...others.filter(sure), ...others.filter((g) => !sure(g)), ...ordered.filter(isCheck)];
}

/** The page of CLEANUP_PAGE items that starts at `start`. */
export function pageAfter<T>(items: readonly T[], start: number): T[] {
  return items.slice(start, start + CLEANUP_PAGE);
}

/**
 * The categories on offer (not hidden, not YNAB's own, but with YNAB's Inflow: Ready to Assign, where an inflow goes), the ids of YNAB's
 * own that are never learned from or chosen (Uncategorized), and the Inflow category, from the cached list.
 */
export function offeredCategories(all: readonly YnabCategory[]): { categories: YnabCategory[]; notCounted: Set<string>; inflow: YnabCategory | undefined } {
  const inflow = all.find(isInflowCategory);
  return {
    notCounted: new Set(all.filter((c) => c.groupName === INTERNAL_GROUP && !isInflowCategory(c)).map((c) => c.id)),
    categories: [...all.filter((c) => !c.hidden && c.groupName !== INTERNAL_GROUP), ...(inflow ? [inflow] : [])],
    inflow,
  };
}

/**
 * What the screen is built from: the categories on offer and every unapproved transaction as an item, oldest first. The unapproved
 * ones are read here unless the caller has them (src/ynab/payee-rules.ts reads them and approves the payee rules' first).
 */
export async function loadCleanup(
  client: YnabClient,
  budgetId: string,
  now: number = Date.now(),
  read?: readonly YnabTransactionWire[],
): Promise<{ items: CleanupItem[]; categories: YnabCategory[] }> {
  const repo = new YnabRepository();
  const { categories, notCounted, inflow } = offeredCategories(await repo.listCategories());
  const accounts = await repo.listAccounts();
  const [unapproved, past] = await Promise.all([
    read ?? client.unapprovedTransactions(budgetId),
    client.transactionsSince(budgetId, day(now - TALLY_WINDOW_DAYS * 24 * 60 * 60_000)),
  ]);
  const tally = readTally();
  const built = buildItems(unapproved, { categories, history: payeeHistory(past, notCounted), tally: tally?.budgetId === budgetId ? tally : null, notCounted, inflow, accounts, known: [...past, ...unapproved] });
  // a check whose image was read on an earlier visit has that read applied again; the mill is not asked twice
  const kept = await new CheckImageRepository().many(built.filter((i) => i.check !== undefined).map((i) => i.id));
  const items = built.map((item) => {
    const answer = kept.get(item.id)?.read;
    const read = answer && resolveCheckRead(answer, categories);
    return read ? applyCheckRead(item, read) : item;
  });
  return { items, categories };
}
