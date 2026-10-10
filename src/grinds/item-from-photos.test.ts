import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { GROCERY_CATEGORIES } from "@/core/categories";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

const grind = readJson("grinds/item-from-photos.json");
const instructions = readFileSync(
  resolve(process.cwd(), "grinds/item-from-photos.md"),
  "utf8"
);
const answerSchema = readJson("schemas/item-from-photos-answer-1.0.schema.json");
const inputSchema = readJson("schemas/item-from-photos-input-1.0.schema.json");

const ajv = new Ajv({ allErrors: true, strict: true });
const validateAnswer = ajv.compile(answerSchema);
const validateInput = ajv.compile(inputSchema);

const tagAnswer = {
  name: "Kerrygold Salted Butter",
  category: "Dairy & Eggs",
  unitType: "each",
  price: 4.99,
  size: "8 oz",
  confidence: "high",
  notes: "Price read from the shelf tag.",
};

const noPriceAnswer = {
  name: "Gala Apples",
  category: "Produce",
  unitType: "per_lb",
  price: null,
  confidence: "medium",
};

describe("grinds/item-from-photos.json", () => {
  it("names the app, kind, version, model, effort and attachment limits", () => {
    expect(grind.app).toBe("trade-tracker");
    expect(grind.kind).toBe("item-from-photos");
    expect(grind.versions).toEqual(["1.0"]);
    expect(grind.model).toBe("sonnet");
    expect(grind.effort).toBe("low");
    expect(grind.instructions).toBe("grinds/item-from-photos.md");
    expect(grind.answerSchema).toBe(
      "schemas/item-from-photos-answer-1.0.schema.json"
    );
    expect(grind.attachments).toEqual({
      min: 1,
      max: 2,
      mime: ["image/jpeg", "image/webp"],
      maxBytes: 4194304,
    });
  });
});

describe("item-from-photos answer schema", () => {
  it("accepts an answer with a price read from a shelf tag", () => {
    expect(validateAnswer(tagAnswer)).toBe(true);
  });

  it("accepts an answer with price null", () => {
    expect(validateAnswer(noPriceAnswer)).toBe(true);
  });

  it("accepts an optional weightLbs for a per-pound label, as a number", () => {
    expect(
      validateAnswer({ ...noPriceAnswer, price: 4.99, weightLbs: 2.03, size: "2.03 lb" })
    ).toBe(true);
    expect(validateAnswer({ ...noPriceAnswer, weightLbs: "2.03" })).toBe(false);
    expect(validateAnswer({ ...noPriceAnswer, weightLbs: -1 })).toBe(false);
  });

  it("tells the factory to read the weight from the label and never guess it", () => {
    expect(instructions).toContain("`weightLbs`");
    expect(instructions).toMatch(/never guess/i);
  });

  it("rejects a price given as a string", () => {
    expect(validateAnswer({ ...tagAnswer, price: "4.99" })).toBe(false);
  });

  it("rejects a missing price", () => {
    const { price: _price, ...rest } = tagAnswer;
    void _price;
    expect(validateAnswer(rest)).toBe(false);
  });

  it("rejects an unknown unit type, confidence or category", () => {
    expect(validateAnswer({ ...tagAnswer, unitType: "per_kg" })).toBe(false);
    expect(validateAnswer({ ...tagAnswer, confidence: "certain" })).toBe(false);
    expect(validateAnswer({ ...tagAnswer, category: "Gadgets" })).toBe(false);
  });

  it("rejects a negative price and extra fields", () => {
    expect(validateAnswer({ ...tagAnswer, price: -1 })).toBe(false);
    expect(validateAnswer({ ...tagAnswer, upc: "123" })).toBe(false);
  });

  it("allows exactly the app's categories plus 'other'", () => {
    const properties = answerSchema.properties as {
      category: { enum: string[] };
    };
    expect(properties.category.enum).toEqual([...GROCERY_CATEGORIES, "other"]);
  });
});

describe("item-from-photos input schema", () => {
  it("accepts a new-item request and a price-only request", () => {
    expect(
      validateInput({ barcode: "0123456789012", mode: "new-item" })
    ).toBe(true);
    expect(
      validateInput({
        barcode: "0123456789012",
        mode: "price-only",
        categories: ["Produce"],
      })
    ).toBe(true);
  });

  it("rejects an unknown mode or a missing barcode", () => {
    expect(validateInput({ barcode: "1", mode: "other" })).toBe(false);
    expect(validateInput({ mode: "new-item" })).toBe(false);
  });
});

describe("grinds/item-from-photos.md", () => {
  it("names every field of the answer schema", () => {
    const properties = answerSchema.properties as Record<string, unknown>;
    for (const field of Object.keys(properties)) {
      expect(instructions).toContain(`\`${field}\``);
    }
  });

  it("names every field of the input schema", () => {
    const properties = inputSchema.properties as Record<string, unknown>;
    for (const field of Object.keys(properties)) {
      expect(instructions).toContain(`\`${field}\``);
    }
  });

  describe("the price rule", () => {
    const priceRule = instructions
      .split(/\n- `/)
      .find((part) => part.startsWith("price`"));

    it("reads a price from any sign or tag, handwritten ones included", () => {
      expect(priceRule).toBeDefined();
      expect(priceRule).toMatch(/handwritten/i);
      expect(priceRule).toMatch(/sticker/i);
      expect(priceRule).toMatch(/plate|card/i);
      expect(priceRule).not.toMatch(/only from a shelf tag/i);
    });

    it("still forbids the package price, flyers, receipts and guessing", () => {
      expect(priceRule).toMatch(/printed on the package/i);
      expect(priceRule).toMatch(/flyer/i);
      expect(priceRule).toMatch(/receipt/i);
      expect(priceRule).toMatch(/never guess/i);
      expect(priceRule).toMatch(/`null`/);
    });

    it("lowers confidence and says so when a handwritten price is ambiguous", () => {
      expect(priceRule).toMatch(/ambiguous/i);
      expect(priceRule).toMatch(/confidence/i);
      expect(priceRule).toMatch(/notes/i);
    });

    it("lets the price-only mode read a handwritten sign too", () => {
      const priceOnly = instructions
        .split(/\n- /)
        .find((part) => part.startsWith("`price-only`"));
      expect(priceOnly).toBeDefined();
      expect(priceOnly).toMatch(/handwritten/i);
    });
  });
});
