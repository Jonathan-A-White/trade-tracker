import type { PendingLookup } from "@/contracts/types";

/** The capture screen in tag-only mode for a known item; `from` is where to go back to (default: the active trip). */
export function photoPricePath(item: { barcode: string; id: string }, from?: string): string {
  const params = new URLSearchParams({
    barcode: item.barcode,
    mode: "price-only",
    itemId: item.id,
  });
  if (from) params.set("from", from);
  return `/trips/active/photo?${params.toString()}`;
}

/** What the shopper reads of a price lookup: null once it has nothing left to say. */
export type PriceLookupNote =
  | { kind: "waiting"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "no-price"; text: string };

export function priceLookupNote(lookup: PendingLookup | undefined): PriceLookupNote | null {
  if (!lookup) return null;
  if (lookup.status === "failed") {
    return { kind: "failed", text: lookup.error || "The factory could not read this tag." };
  }
  if (lookup.status === "applied") {
    return lookup.noPrice ? { kind: "no-price", text: "No price read" } : null;
  }
  return { kind: "waiting", text: "Waiting on the factory" };
}
