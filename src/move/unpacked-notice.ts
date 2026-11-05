import type { PackCounts } from "./pack";

// The line that says what an Unpack brought, kept across the reload the Unpack ends with. It lives in sessionStorage (this tab only, gone
// when the tab is) under a name that is not one of the app's localStorage keys, so it is neither packed nor forgotten with the data.
const NOTICE_KEY = "unpacked-counts";

/** What an Unpack says it brought, in the words Home and Settings > Move show. */
export function unpackedLine(c: PackCounts): string {
  return `Unpacked: ${c.stores} stores, ${c.items} items, ${c.trips} trips, ${c.priceHistory} prices, ${c.photos} photos.`;
}

export function rememberUnpacked(counts: PackCounts): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, JSON.stringify(counts));
  } catch {
    // storage refused: the unpack stands, only its line is lost
  }
}

/** The counts the last Unpack left, until clearUnpacked forgets them. */
export function peekUnpacked(): PackCounts | null {
  try {
    const raw = sessionStorage.getItem(NOTICE_KEY);
    if (raw === null) return null;
    const found = JSON.parse(raw) as Partial<PackCounts>;
    const { stores, items, trips, priceHistory, photos } = found;
    return [stores, items, trips, priceHistory, photos].every((n) => typeof n === "number")
      ? (found as PackCounts)
      : null;
  } catch {
    return null;
  }
}

export function clearUnpacked(): void {
  try {
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    // storage refused: nothing to forget
  }
}
