import { receiptSplits, groupLines } from "./receiptSplits";

const sum = (rows: readonly { cents: number }[]) => rows.reduce((total, row) => total + row.cents, 0);

describe("receiptSplits", () => {
  it("spreads the tax across three categories in proportion, and the parts add up to the charge to the cent", () => {
    // lines: 20.00 + 15.00 + 5.00 = 40.00; tax 3.12; receipt total 43.12 = the charge
    const result = receiptSplits({
      groups: [
        { categoryId: "groceries", cents: 2000 },
        { categoryId: "household", cents: 1500 },
        { categoryId: "kids", cents: 500 },
      ],
      taxCents: 312,
      totalCents: 4312,
      chargeCents: 4312,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line).toBeNull();
    expect(result.rows.map((r) => r.categoryId)).toEqual(["groceries", "household", "kids"]);
    // 3.12 in 4 : 3 : 1 is 1.56, 1.17, 0.39 on top of 20.00, 15.00, 5.00
    expect(result.rows.map((r) => r.cents)).toEqual([2156, 1617, 539]);
    expect(sum(result.rows)).toBe(4312);
  });

  it("hands out the odd cents so no category loses one", () => {
    const result = receiptSplits({
      groups: [
        { categoryId: "a", cents: 333 },
        { categoryId: "b", cents: 333 },
        { categoryId: "c", cents: 334 },
      ],
      taxCents: 100,
      totalCents: 1100,
      chargeCents: 1100,
    });
    expect(result.ok && sum(result.rows)).toBe(1100);
  });

  it("takes the total as the lines plus the tax when no total is printed", () => {
    const result = receiptSplits({
      groups: [
        { categoryId: "a", cents: 1000 },
        { categoryId: "b", cents: 1000 },
      ],
      taxCents: 200,
      totalCents: null,
      chargeCents: 2200,
    });
    expect(result.ok && result.rows.map((r) => r.cents)).toEqual([1100, 1100]);
  });

  it("names a receipt under the charge as its own row he can place", () => {
    const result = receiptSplits({
      groups: [
        { categoryId: "groceries", cents: 3000 },
        { categoryId: "household", cents: 1000 },
      ],
      taxCents: 180,
      totalCents: 4180,
      chargeCents: 4312,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line).toBe("Receipt $41.80, charge $43.12: $1.32 not on the receipt");
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]).toEqual({ categoryId: "", cents: 132 });
    expect(sum(result.rows)).toBe(4312);
  });

  it("says a receipt over the charge plainly and writes nothing", () => {
    const result = receiptSplits({
      groups: [
        { categoryId: "groceries", cents: 4000 },
        { categoryId: "household", cents: 1000 },
      ],
      taxCents: 100,
      totalCents: 5100,
      chargeCents: 4312,
    });
    expect(result).toEqual({ ok: false, rows: [], line: "Receipt $51.00 is more than the charge $43.12. Place the charge by hand." });
  });

  it("has nothing to spread when no line has a price", () => {
    const result = receiptSplits({ groups: [], taxCents: null, totalCents: null, chargeCents: 1000 });
    expect(result.ok).toBe(false);
  });
});

describe("groupLines", () => {
  const lines = [
    { text: "BANANAS", price: 1.5 },
    { text: "PAPER TOWELS", price: 12.99 },
    { text: "MILK", price: 3.49 },
  ];

  it("adds up the lines of each category in cents, in the order the categories first appear", () => {
    const grouped = groupLines(lines, { split: [{ categoryId: "g", amount: 4.99 }, { categoryId: "h", amount: 12.99 }] });
    expect(grouped).toEqual([
      { categoryId: "g", cents: 499 },
      { categoryId: "h", cents: 1299 },
    ]);
  });

  it("is one group for one category", () => {
    expect(groupLines(lines, { categoryId: "g" })).toEqual([{ categoryId: "g", cents: 1798 }]);
  });

  it("is null when the grouping does not add up to the lines", () => {
    expect(groupLines(lines, { split: [{ categoryId: "g", amount: 4 }, { categoryId: "h", amount: 12.99 }] })).toBeNull();
  });
});
