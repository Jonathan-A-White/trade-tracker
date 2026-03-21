import { connecticutTaxModule } from "./connecticut";

describe("Connecticut tax module", () => {
  describe("category-level exemptions", () => {
    it("exempts standard grocery categories", () => {
      expect(connecticutTaxModule.isExempt("Produce")).toBe(true);
      expect(connecticutTaxModule.isExempt("Dairy & Eggs")).toBe(true);
      expect(connecticutTaxModule.isExempt("Meat & Seafood")).toBe(true);
      expect(connecticutTaxModule.isExempt("Frozen Foods")).toBe(true);
      expect(connecticutTaxModule.isExempt("Bakery")).toBe(true);
      expect(connecticutTaxModule.isExempt("Beverages")).toBe(true);
    });

    it("taxes non-food categories", () => {
      expect(connecticutTaxModule.isExempt("Health & Beauty")).toBe(false);
      expect(connecticutTaxModule.isExempt("Household & Cleaning")).toBe(false);
      expect(connecticutTaxModule.isExempt("Pet Supplies")).toBe(false);
      expect(connecticutTaxModule.isExempt("Paper & Plastic Goods")).toBe(false);
    });

    it("treats Snacks & Candy as exempt at category level", () => {
      // Category-level check returns exempt because the category contains
      // a mix of exempt and taxable items (resolved at item level)
      expect(connecticutTaxModule.isExempt("Snacks & Candy")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(connecticutTaxModule.isExempt("PRODUCE")).toBe(true);
      expect(connecticutTaxModule.isExempt("health & beauty")).toBe(false);
    });

    it("treats undefined category as not exempt", () => {
      expect(connecticutTaxModule.isExempt(undefined)).toBe(false);
    });
  });

  describe("item-level taxability in Snacks & Candy", () => {
    const calc = (name: string, price: number) =>
      connecticutTaxModule.calculate([
        { name, lineTotal: price, category: "Snacks & Candy" },
      ]);

    describe("candy/confections are taxable", () => {
      it.each([
        ["Black Soft Licorice Twist", 2.99],
        ["Spring Gummies", 3.99],
        ["Dark Chocolate Peanut Butter Cups", 5.99],
        ["Chocolate Covered Almonds", 4.99],
        ["Milk Chocolate Caramels", 3.49],
        ["Sour Gummy Worms", 2.99],
        ["Dark Chocolate Corn Nuts", 3.99],
        ["Taffy Assortment", 4.49],
        ["Raspberry Truffles", 5.99],
      ])("taxes %s", (name, price) => {
        const result = calc(name, price);
        expect(result.taxableAmount).toBeCloseTo(price, 2);
        expect(result.totalTax).toBeCloseTo(price * 0.0635, 2);
      });
    });

    describe("regular snacks are exempt", () => {
      it.each([
        ["Tortilla Chips", 3.49],
        ["Cheddar Pretzel Bites", 2.99],
        ["Organic Popcorn", 3.99],
        ["Trail Mix", 4.49],
        ["Granola Bar Variety Pack", 5.99],
        ["Rice Cakes", 2.49],
        ["Corn Nuts Original", 1.99],
        ["Chocolate Chip Cookies", 3.99],
        ["Mixed Nuts", 6.99],
        ["Beef Jerky", 5.49],
        ["Seaweed Snacks", 2.99],
      ])("exempts %s", (name, price) => {
        const result = calc(name, price);
        expect(result.exemptAmount).toBeCloseTo(price, 2);
        expect(result.totalTax).toBe(0);
      });
    });
  });

  describe("full trip calculation (TJ receipt scenario)", () => {
    const receiptItems = [
      // Exempt grocery items
      { name: "Organic Bananas", lineTotal: 1.29, category: "Produce" },
      { name: "Whole Milk", lineTotal: 4.49, category: "Dairy & Eggs" },
      { name: "Sourdough Bread", lineTotal: 3.99, category: "Bakery" },
      { name: "Chicken Breast", lineTotal: 8.99, category: "Meat & Seafood" },
      { name: "Frozen Pizza", lineTotal: 4.99, category: "Frozen Foods" },
      { name: "Tortilla Chips", lineTotal: 2.99, category: "Snacks & Candy" },
      // Taxable candy items in Snacks & Candy
      { name: "Black Soft Licorice Twist", lineTotal: 2.99, category: "Snacks & Candy" },
      { name: "Spring Gummies", lineTotal: 3.99, category: "Snacks & Candy" },
      { name: "Dark Chocolate Corn Nuts", lineTotal: 3.99, category: "Snacks & Candy" },
      { name: "Dark Chocolate Peanut Butter Cups", lineTotal: 5.99, category: "Snacks & Candy" },
      // Taxable non-food
      { name: "Smoked Chicken Tenders Dog Treats", lineTotal: 4.49, category: "Pet Supplies" },
      { name: "Ultra Moisturizing Hand Cream", lineTotal: 4.99, category: "Health & Beauty" },
    ];

    it("correctly splits taxable vs exempt amounts", () => {
      const result = connecticutTaxModule.calculate(receiptItems);
      // Taxable: 2.99 + 3.99 + 3.99 + 5.99 + 4.49 + 4.99 = 26.44
      expect(result.taxableAmount).toBeCloseTo(26.44, 2);
      // Exempt: 1.29 + 4.49 + 3.99 + 8.99 + 4.99 + 2.99 = 26.74
      expect(result.exemptAmount).toBeCloseTo(26.74, 2);
    });

    it("calculates correct tax amount", () => {
      const result = connecticutTaxModule.calculate(receiptItems);
      // 26.44 * 0.0635 = 1.6789... ≈ 1.68
      expect(result.totalTax).toBeCloseTo(1.68, 2);
    });

    it("marks correct items as taxable in line items", () => {
      const result = connecticutTaxModule.calculate(receiptItems);
      const taxableNames = result.lines
        .filter((l) => l.taxable)
        .map((l) => l.itemName);

      expect(taxableNames).toEqual([
        "Black Soft Licorice Twist",
        "Spring Gummies",
        "Dark Chocolate Corn Nuts",
        "Dark Chocolate Peanut Butter Cups",
        "Smoked Chicken Tenders Dog Treats",
        "Ultra Moisturizing Hand Cream",
      ]);
    });
  });
});
