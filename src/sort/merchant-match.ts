// Whether a card alert's merchant and a YNAB payee (or two alerts' merchants) are the same business, though the bank and YNAB
// write it differently: 'JONES FAMILY FARMS, LL SHELTON USA' and 'Jones Family Farms', 'TRADER JOE S #552' and 'Trader Joe's'.
//
// The rule. Each name is read as its words: lower case, accents and apostrophes dropped, anything else not a letter or a digit a
// space, a card processor's prefix ('SQ *', 'TST*', 'PAYPAL *') and a leading 'the' dropped, and every word with a digit in it
// dropped (store numbers and order codes change from charge to charge). Two names meet when the letters of one's words, run
// together, are the letters of the other's first words, run together and ending where one of its words ends: the shorter name is
// how the longer one begins ('jones family farms' begins 'jones family farms ll shelton usa'; 'traderjoes' is 'trader joe s').
// The words that begin both must hold one that is not a common word ('family', 'farms', 'market', 'store'...), so 'Family' does
// not meet 'FAMILY DOLLAR', and two names that merely share a word somewhere ('Jones Family Farms', 'Family Dollar') never meet.

/** Card processors' prefixes, dropped from the front of a merchant. */
const PREFIXES = new Set(["sq", "tst", "sp", "pp", "paypal", "pypl"]);

/** Words too common to make two names the same business on their own. */
const COMMON = new Set([
  "a",
  "an",
  "and",
  "of",
  "the",
  "family",
  "farm",
  "farms",
  "store",
  "stores",
  "market",
  "markets",
  "shop",
  "shops",
  "food",
  "foods",
  "gas",
  "cafe",
  "coffee",
  "restaurant",
  "grill",
  "pizza",
  "bar",
  "kitchen",
  "deli",
  "bakery",
  "online",
  "service",
  "services",
  "co",
  "inc",
  "llc",
  "ll",
  "usa",
  "us",
  "new",
  "home",
  "house",
]);

/** A merchant's or payee's words, as the rule above reads them. */
export function merchantWords(name: string): string[] {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "" && !/\d/.test(w));
  while (words.length > 1 && PREFIXES.has(words[0]!)) words.shift();
  if (words.length > 1 && words[0] === "the") words.shift();
  return words;
}

/** A merchant as one key: its words, one space between. The same business charged twice keys the same. */
export function merchantKey(name: string): string {
  return merchantWords(name).join(" ");
}

/** Whether `short`'s letters are how `long`'s words begin, ending at one of `long`'s words; the words matched, or null. */
function beginsWith(long: string[], short: string[]): string[] | null {
  const letters = short.join("");
  let run = "";
  for (let i = 0; i < long.length; i++) {
    run += long[i];
    if (run === letters) return long.slice(0, i + 1);
    if (!letters.startsWith(run)) return null;
  }
  return null;
}

/** Whether two names are the same business by the rule above. */
export function meets(a: string, b: string): boolean {
  const wa = merchantWords(a);
  const wb = merchantWords(b);
  if (wa.length === 0 || wb.length === 0) return false;
  if (wa.join("") === wb.join("")) return true;
  const matched = beginsWith(wa, wb) ?? beginsWith(wb, wa);
  return matched !== null && matched.join("").length >= 3 && matched.some((w) => !COMMON.has(w));
}
