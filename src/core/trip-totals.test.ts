import type { TripItem } from "@/contracts/types";
import { countsTowardTotal, tripTotals } from "./trip-totals";

function line(overrides: Partial<TripItem> = {}): TripItem {
  return {
    id: crypto.randomUUID(),
    tripId: "t1",
    itemId: crypto.randomUUID(),
    price: 2,
    quantity: 1,
    lineTotal: 2,
    onSale: false,
    addedAt: 1,
    ...overrides,
  };
}

describe("tripTotals", () => {
  it("is all zeros for an empty trip", () => {
    expect(tripTotals([])).toEqual({ subtotal: 0, itemCount: 0, bottleDeposits: 0 });
  });

  it("sums line totals and counts units by quantity", () => {
    const totals = tripTotals([
      line({ price: 2, quantity: 3, lineTotal: 6 }),
      line({ price: 1.5, quantity: 1, lineTotal: 1.5 }),
    ]);
    expect(totals.subtotal).toBeCloseTo(7.5);
    expect(totals.itemCount).toBe(4);
  });

  it("adds up bottle deposits without putting them in the subtotal", () => {
    const totals = tripTotals([
      line({ price: 5, quantity: 1, lineTotal: 5, bottleDeposit: 0.6 }),
      line({ price: 1, quantity: 1, lineTotal: 1, bottleDeposit: 0.4 }),
      line({ price: 1, quantity: 1, lineTotal: 1 }),
    ]);
    expect(totals.bottleDeposits).toBeCloseTo(1);
    expect(totals.subtotal).toBeCloseTo(7);
  });

  it("leaves out a pending line that has no price yet", () => {
    const totals = tripTotals([
      line({ price: 4, quantity: 2, lineTotal: 8 }),
      line({ price: 0, quantity: 3, lineTotal: 0, pending: true }),
    ]);
    expect(totals).toEqual({ subtotal: 8, itemCount: 2, bottleDeposits: 0 });
  });

  it("counts a pending line once it has a price", () => {
    const totals = tripTotals([line({ price: 3, quantity: 1, lineTotal: 3, pending: true })]);
    expect(totals).toEqual({ subtotal: 3, itemCount: 1, bottleDeposits: 0 });
  });
});

describe("countsTowardTotal", () => {
  it("counts an ordinary line and a priced pending line, not an unpriced pending one", () => {
    expect(countsTowardTotal({ price: 0 })).toBe(true);
    expect(countsTowardTotal({ price: 2, pending: true })).toBe(true);
    expect(countsTowardTotal({ price: 0, pending: true })).toBe(false);
  });
});
