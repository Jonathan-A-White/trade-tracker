import { calculateLineTotal, countGuessedPrices } from "./index";

describe("calculateLineTotal", () => {
  it("is price x quantity without a weight", () => {
    expect(calculateLineTotal(3, 2)).toBe(6);
    expect(calculateLineTotal(4.99, 1, undefined)).toBe(4.99);
  });

  it("is price x weight for a fractional weight, as on the chicken label", () => {
    expect(calculateLineTotal(4.99, 1, 2.03)).toBeCloseTo(10.13, 2);
  });

  it("never gives NaN for a per-pound price with no weight", () => {
    expect(Number.isNaN(calculateLineTotal(4.99, 1))).toBe(false);
  });
});

describe("countGuessedPrices", () => {
  it("counts Guess lines and lines with no price, and no others", () => {
    expect(
      countGuessedPrices([
        { price: 3 },
        { price: 3.49, guess: { basis: "Typical price" } },
        { price: 0 },
        { price: 0 },
        { price: 2.5 },
      ]),
    ).toBe(3);
  });

  it("is zero when every price is real", () => {
    expect(countGuessedPrices([{ price: 1 }, { price: 2 }])).toBe(0);
    expect(countGuessedPrices([])).toBe(0);
  });
});
