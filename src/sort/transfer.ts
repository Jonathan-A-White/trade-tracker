// Whether a charge is really money moved between his own accounts: a payment to one of his credit cards, shown on the Sort sheet as
// a Transfer to that card's YNAB account, never as an expense with a budget category. Two things say so. The merchant's words read as
// a card payment ('AUTOPAY', 'Payment to Chase card', 'Chase Bank bill'); or the merchant is named like one of his card accounts
// ('Amazon & Whole Foods' for the account 'Chase Amazon'), which counts when the charge is on a cash account, or on a card number the
// book has no account for yet, and the merchant has never been sorted as an expense before. On a card account itself a purchase is never
// a payment to it, but the payment arriving there (the merchant says payment, or is the card's own whole name of two words or more)
// is a transfer from his checking or savings account (mw-6ww.148.59). A payment YNAB already holds as a transfer (same amount, within two
// days, on the charge's account, or on any account when its card number is unmapped) is shown as that transfer whatever the merchant
// says, and nothing is written to YNAB for it (mw-6ww.148.66).
import type { YnabAccount, YnabCategory, YnabPayee } from "@/contracts/types";
import type { RecentTransfer, Tally } from "@/ynab/tally";
import { seenCategoryIds } from "./suggest";

export type { RecentTransfer };

/** The merchant says it is a card payment. */
const PAYMENT_WORDS = [
  /\bauto\s?-?pay(ment)?\b/i,
  /\b(credit\s)?card\s(payment|pmt)\b/i,
  /\bpayment\s(to|for)\b.*\b(card|visa|mastercard|amex|bank)\b/i,
  /\b(bank|card|credit card)\sbill\b/i,
  /\bbill\spay(ment)?\b/i,
  /\bpayment\s(thank\s?you|received)\b/i,
];

/** Words that do not tell one card from another, or one merchant from another. */
const GENERIC = new Set([
  "a", "an", "and", "the", "of", "to", "for", "bank", "card", "cards", "credit", "visa", "mastercard", "amex", "american", "express", "discover",
  "payment", "pmt", "autopay", "bill", "rewards", "reward", "signature", "chase", "citi", "citibank", "capital", "one", "wells", "fargo",
  "barclays", "foods", "food", "store", "stores", "inc", "llc", "co", "usa", "us", "online", "mktp", "mktpl",
]);

function wordsOf(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !GENERIC.has(w));
}

/** What the sheet offers: the card account the charge pays, or the cards to choose from when the merchant says payment but not which. */
export type TransferOffer =
  /** `source`, when set, is the cash account the money comes from: the charge was read on the card itself, so the write goes on that account */
  | { account: YnabAccount; cards?: undefined; source?: YnabAccount; sources?: undefined; held?: undefined }
  /** `sources`: the payment arrived on the card and he has two or more checking or savings accounts, so he says which one paid it */
  | { account: YnabAccount; cards?: undefined; source?: undefined; sources: YnabAccount[]; held?: undefined }
  | { account?: undefined; cards: YnabAccount[]; source?: undefined; sources?: undefined; held?: undefined }
  /** YNAB already holds the payment as a transfer from `source` to `account`: nothing is asked and nothing is written */
  | { account: YnabAccount; cards?: undefined; source: YnabAccount; sources?: undefined; held: true };

/** A transfer YNAB already holds for the charge: the account the money left and the account it reached. */
export interface HeldTransfer {
  from: YnabAccount;
  to: YnabAccount;
}

const DAY_MS = 24 * 60 * 60_000;
/** How many days apart the charge and YNAB's transfer may be dated (the bank's day and the alert's differ). */
export const HELD_DAYS = 2;

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/**
 * The transfer YNAB already holds for a charge of `amount` dollars on `date` (YYYY-MM-DD), or null. The amount must be the same to the
 * cent and the day within HELD_DAYS. `on` is the account the charge was read on: a card is matched as the account the money reached, a
 * cash account as the one it left; with no account (an unmapped card number) a transfer between any two of his accounts matches. Of
 * several the nearest day wins.
 */
export function heldTransfer(amount: number, date: string, on: YnabAccount | undefined, accounts: readonly YnabAccount[], held: readonly RecentTransfer[]): HeldTransfer | null {
  const cents = Math.round(amount * 100);
  const want = dayNumber(date);
  let best: { gap: number; found: HeldTransfer } | null = null;
  for (const t of held) {
    if (Math.round(t.amount * 100) !== cents) continue;
    const gap = Math.abs(dayNumber(t.date) - want);
    if (!(gap <= HELD_DAYS) || (best && best.gap <= gap)) continue;
    const from = accounts.find((a) => a.id === t.from);
    const to = accounts.find((a) => a.id === t.to);
    if (!from || !to) continue;
    if (on && !(on.type === "creditCard" ? on.id === to.id : on.id === from.id)) continue;
    best = { gap, found: { from, to } };
  }
  return best?.found ?? null;
}

export function saysCardPayment(merchant: string): boolean {
  return PAYMENT_WORDS.some((re) => re.test(merchant));
}

/**
 * The transfer a charge is, or null when it is an expense. `from` is the account the charge is on, `soldAsExpense` whether the merchant
 * has been sorted into a category before (then a name alone does not make it a payment). `held`, the transfer YNAB already has for the
 * charge, comes first: it says what the charge is whatever the merchant is called.
 */
export function transferOffer(
  merchant: string,
  from: YnabAccount | undefined,
  accounts: readonly YnabAccount[],
  soldAsExpense: boolean,
  held?: HeldTransfer | null,
): TransferOffer | null {
  if (held) return { account: held.to, source: held.from, held: true };
  if (!merchant.trim()) return null;
  if (from?.type === "creditCard") return paymentArriving(merchant, from, accounts, soldAsExpense);
  const cards = accounts.filter((a) => a.type === "creditCard" && !a.closed && a.id !== from?.id);
  if (cards.length === 0) return null;
  const mine = new Set(wordsOf(merchant));
  const named = cards.filter((c) => wordsOf(c.name).some((w) => mine.has(w)));
  if (saysCardPayment(merchant)) {
    if (named.length === 1) return { account: named[0]! };
    return cards.length === 1 ? { account: cards[0]! } : { cards: named.length > 1 ? named : cards };
  }
  if (named.length !== 1) return null;
  // a merchant already sorted as an expense is a payment only when it is the card's whole name (of two words or more), not one word of it
  return !soldAsExpense || isWholeName(named[0]!, mine) ? { account: named[0]! } : null;
}

/** The merchant is the card's own whole name: the same words, two or more of them. */
function isWholeName(card: YnabAccount, merchantWords: ReadonlySet<string>): boolean {
  const own = wordsOf(card.name);
  return own.length >= 2 && own.length === merchantWords.size && own.every((w) => merchantWords.has(w));
}

/** A charge read on a card account: a payment received there, paid from his checking or savings account (the one, or the one he chooses of several); any other purchase is an expense. */
function paymentArriving(merchant: string, card: YnabAccount, accounts: readonly YnabAccount[], soldAsExpense: boolean): TransferOffer | null {
  const own = wordsOf(card.name);
  const mine = wordsOf(merchant);
  const isItsName = own.length >= 2 && own.length === mine.length && own.every((w) => mine.includes(w));
  if (!saysCardPayment(merchant) && !(isItsName && !soldAsExpense)) return null;
  // a payment that names another of his cards is that card's, not this one's
  const other = accounts.some((a) => a.type === "creditCard" && !a.closed && a.id !== card.id && wordsOf(a.name).some((w) => mine.includes(w)));
  if (other) return null;
  const sources = accounts.filter((a) => (a.type === "checking" || a.type === "savings") && !a.closed);
  if (sources.length === 0) return null;
  return sources.length === 1 ? { account: card, source: sources[0]! } : { account: card, sources };
}

/**
 * YNAB's payee for the transfers into an account, the one a write names to make a transfer. It is found by the account id the payee
 * carries (so a renamed account, or a payee list read before the rename, still matches); a payee cached without one is found by its name
 * 'Transfer : <account>', unless it names a different account.
 */
export function transferPayee(account: YnabAccount, payees: readonly YnabPayee[]): YnabPayee | undefined {
  const byId = payees.find((p) => p.transferAccountId === account.id);
  if (byId) return byId;
  const want = `transfer : ${account.name}`.toLowerCase();
  return payees.find((p) => !p.transferAccountId && p.name.trim().toLowerCase().replace(/\s*:\s*/, " : ") === want);
}

/** What the one judge says of a charge: the transfer it is, or the cards whose transfer payee YNAB has not given us (then it is no offer). */
export interface TransferJudgement {
  offer: TransferOffer | null;
  /** the card accounts the charge reads as a payment to, that have no transfer payee cached: nothing can be written to them */
  missing: YnabAccount[];
}

/** What the judge looks at: the charge, the account it is on, and what the phone keeps of his YNAB. */
export interface JudgedCharge {
  merchant: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  /** the account the charge is on; undefined for a card number the book has no account for */
  account: YnabAccount | undefined;
  accounts: readonly YnabAccount[];
  payees: readonly YnabPayee[];
  categories: readonly YnabCategory[];
  tally: Tally | null;
  /** whether the merchant has been sorted into a category before, when the caller knows it better than the tally does (Clean up adds YNAB's own history) */
  soldAsExpense?: boolean;
}

/**
 * The one judgement of a card payment, shared by the Sort sheet and Home's Waiting: a transfer YNAB already holds first, else the
 * merchant's words or name (transferOffer), then whether the card has a transfer payee to write it to. A card without one is named in
 * `missing` instead of being dropped, so a payment never shows as an expense with no word of why.
 */
export function judgeTransfer(c: JudgedCharge): TransferJudgement {
  const held = heldTransfer(c.amount, c.date, c.account, c.accounts, c.tally?.transfers ?? []);
  const soldAsExpense = c.soldAsExpense ?? seenCategoryIds(c.merchant, c.categories, c.tally).size > 0;
  const offer = transferOffer(c.merchant, c.account, c.accounts, soldAsExpense, held);
  if (!offer || offer.held) return { offer, missing: [] };
  const writable = (a: YnabAccount) => transferPayee(a, c.payees) !== undefined;
  if (offer.cards) {
    const cards = offer.cards.filter(writable);
    if (cards.length === 0) return { offer: null, missing: offer.cards };
    return { offer: cards.length === 1 ? { account: cards[0]! } : { cards }, missing: [] };
  }
  return writable(offer.account) ? { offer, missing: [] } : { offer: null, missing: [offer.account] };
}

/** The line that says the transfer payee is missing: '' when none is. */
export function missingPayeeLine(missing: readonly YnabAccount[]): string {
  return missing.length === 0 ? "" : `Transfer payee missing for ${missing.map((a) => a.name).join(" or ")}`;
}

/** The transfer in words: 'Transfer from PNC Checking to Amazon & Whole Foods'; `to` and `source` are the ones chosen when the offer leaves a choice. */
export function transferTitle(offer: TransferOffer, to: YnabAccount | undefined, source: YnabAccount | undefined): string {
  if (offer.held && source && to) return `Transfer from ${source.name} to ${to.name}`;
  if (source && to) return `Transfer from ${source.name}`;
  if (to) return `Transfer to ${to.name}`;
  return "Transfer to a card";
}
