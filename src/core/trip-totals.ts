import type { TripItem } from "@/contracts/types";

/**
 * Whether a trip line adds to the trip's totals and item count. A pending
 * lookup line only counts once it has a price.
 */
export function countsTowardTotal(tripItem: {
  pending?: true;
  price: number;
}): boolean {
  return !tripItem.pending || tripItem.price > 0;
}

export interface TripTotals {
  /** The sum of the line totals that count. */
  subtotal: number;
  /** The units on the lines that count (each line's quantity). */
  itemCount: number;
  /** The bottle deposits on the lines that count, apart from the subtotal. */
  bottleDeposits: number;
}

/** What a trip's lines come to. Pure: the caller loads the lines. */
export function tripTotals(lines: readonly TripItem[]): TripTotals {
  const totals: TripTotals = { subtotal: 0, itemCount: 0, bottleDeposits: 0 };
  for (const line of lines) {
    if (!countsTowardTotal(line)) continue;
    totals.subtotal += line.lineTotal;
    totals.itemCount += line.quantity;
    totals.bottleDeposits += line.bottleDeposit ?? 0;
  }
  return totals;
}
