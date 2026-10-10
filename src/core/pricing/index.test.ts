import { calculateLineTotal } from "./index";

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
