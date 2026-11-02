/**
 * Matching a printed receipt line to a trip line by name alone, for trip lines the factory was
 * never shown (they were still pending lookups when the receipt went out). Receipts abbreviate
 * ("HOL VANILLA SUGAR", "ORG APPLE STRWBRY CRUSHE"), so a printed word fits a trip word when it
 * is the same word or an abbreviation of it (same first letter, its letters in order inside the
 * trip word). A trip line is a candidate only when every significant printed word fits it, and the
 * match is made only when exactly one trip line is a candidate: two like names ask instead.
 */

/** Printed words that carry no product: store brand marks and fillers. */
const NOISE = new Set(["hol", "org", "tj", "the", "and", "for", "with", "trader", "joe", "joes"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

function isSubsequence(short: string, long: string): boolean {
  let at = 0;
  for (const letter of long) {
    if (letter === short[at]) at += 1;
    if (at === short.length) return true;
  }
  return false;
}

function fits(printed: string, tripWord: string): boolean {
  if (printed === tripWord) return true;
  return (
    printed.length >= 4 &&
    printed[0] === tripWord[0] &&
    printed.length <= tripWord.length &&
    isSubsequence(printed, tripWord)
  );
}

/** The one candidate whose name every significant printed word fits, or null. */
export function matchByName(
  printed: string,
  candidates: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  // numbers and sizes ("5.3 OZ", "4LB") and one or two letter words are not the product
  const significant = words(printed).filter(
    (word) => word.length >= 3 && !/\d/.test(word) && !NOISE.has(word),
  );
  if (significant.length === 0) return null;

  const hits = candidates.filter((candidate) => {
    const tripWords = words(candidate.name);
    return significant.every((word) => tripWords.some((tripWord) => fits(word, tripWord)));
  });
  return hits.length === 1 ? hits[0].id : null;
}
