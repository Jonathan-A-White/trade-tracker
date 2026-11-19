// Whether a charge is really money moved between his own accounts: a payment to one of his credit cards, shown on the Sort sheet as
// a Transfer to that card's YNAB account, never as an expense with a budget category. Two things say so. The merchant's words read as
// a card payment ('AUTOPAY', 'Payment to Chase card', 'Chase Bank bill'); or the merchant is named like one of his card accounts
// ('Amazon & Whole Foods' for the account 'Chase Amazon'), which only counts when the charge is on a cash account (a purchase on the
// card itself is never a payment to it) and the merchant has never been sorted as an expense before.
import type { YnabAccount, YnabPayee } from "@/contracts/types";

/** The merchant says it is a card payment. */
const PAYMENT_WORDS = [
  /\bauto\s?-?pay(ment)?\b/i,
  /\b(credit\s)?card\s(payment|pmt)\b/i,
  /\bpayment\s(to|for)\b.*\b(card|visa|mastercard|amex|bank)\b/i,
  /\b(bank|card|credit card)\sbill\b/i,
  /\bbill\spay(ment)?\b/i,
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
export type TransferOffer = { account: YnabAccount; cards?: undefined } | { account?: undefined; cards: YnabAccount[] };

export function saysCardPayment(merchant: string): boolean {
  return PAYMENT_WORDS.some((re) => re.test(merchant));
}

/**
 * The transfer a charge is, or null when it is an expense. `from` is the account the charge is on, `soldAsExpense` whether the merchant
 * has been sorted into a category before (then a name alone does not make it a payment).
 */
export function transferOffer(merchant: string, from: YnabAccount | undefined, accounts: readonly YnabAccount[], soldAsExpense: boolean): TransferOffer | null {
  if (!from || from.type === "creditCard") return null;
  const cards = accounts.filter((a) => a.type === "creditCard" && !a.closed && a.id !== from.id);
  if (cards.length === 0 || !merchant.trim()) return null;
  const mine = new Set(wordsOf(merchant));
  const named = cards.filter((c) => wordsOf(c.name).some((w) => mine.has(w)));
  if (saysCardPayment(merchant)) {
    if (named.length === 1) return { account: named[0]! };
    return cards.length === 1 ? { account: cards[0]! } : { cards: named.length > 1 ? named : cards };
  }
  return named.length === 1 && !soldAsExpense ? { account: named[0]! } : null;
}

/** YNAB's payee for the transfers into an account, the one a write names to make a transfer ('Transfer : <account>'). */
export function transferPayee(account: YnabAccount, payees: readonly YnabPayee[]): YnabPayee | undefined {
  const want = `transfer : ${account.name}`.toLowerCase();
  return payees.find((p) => p.name.trim().toLowerCase().replace(/\s*:\s*/, " : ") === want);
}
