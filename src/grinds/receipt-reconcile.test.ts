import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { tjReceiptSeedData } from "@/db/tj-receipt-seed-data";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

const grind = readJson("grinds/receipt-reconcile.json");
const instructions = readFileSync(
  resolve(process.cwd(), "grinds/receipt-reconcile.md"),
  "utf8"
);
const answerSchema = readJson("schemas/receipt-reconcile-answer-1.0.schema.json");
const inputSchema = readJson("schemas/receipt-reconcile-input-2.0.schema.json");

const ajv = new Ajv({ allErrors: true, strict: true });
const validateAnswer = ajv.compile(answerSchema);
const validateInput = ajv.compile(inputSchema);

const answer = {
  store: "Trader Joe's",
  date: "2026-03-14",
  subtotal: 22.62,
  tax: 0,
  total: 22.62,
  lines: [
    {
      text: "SHAVED STEAK",
      price: 12.7,
      quantity: 1,
      weightLbs: 1.12,
      tripItemId: "ti-steak",
      confidence: "high",
    },
    {
      text: "ORG POMEGRANATE JC",
      price: 1.29,
      quantity: 1,
      weightLbs: null,
      tripItemId: null,
      confidence: "low",
    },
  ],
  unreadable: null,
};

describe("grinds/receipt-reconcile.json", () => {
  it("names the app, kind, version, model, effort and attachment limits", () => {
    expect(grind.app).toBe("trade-tracker");
    expect(grind.kind).toBe("receipt-reconcile");
    expect(grind.versions).toEqual(["2.0"]);
    expect(grind.model).toBe("sonnet");
    expect(grind.effort).toBe("medium");
    expect(grind.instructions).toBe("grinds/receipt-reconcile.md");
    expect(grind.answerSchema).toBe(
      "schemas/receipt-reconcile-answer-1.0.schema.json"
    );
    expect(grind.attachments).toEqual({
      min: 1,
      max: 3,
      mime: ["image/jpeg", "image/webp"],
      maxBytes: 4194304,
    });
  });
});

describe("receipt-reconcile example request", () => {
  const example = readJson("grinds/receipt-reconcile.example.json");
  const scenario = readJson("grinds/examples/receipt-reconcile/trader-joes-trip.json");

  it("is valid against the input schema", () => {
    expect(validateInput(example), JSON.stringify(validateInput.errors)).toBe(true);
  });

  it("is the request of the grind's scenario", () => {
    expect(scenario.request).toEqual(example);
  });

  it("is built from the dev seed's Trader Joe's items, in short rows with no barcode", () => {
    const lines = example.lines as [string, string, number, number, number | null][];
    expect(lines.length).toBeGreaterThan(2);
    for (const [, name, price] of lines) {
      const seeded = tjReceiptSeedData.find((i) => i.name === name);
      expect(seeded, name).toBeDefined();
      expect(seeded?.currentPrice).toBe(price);
    }
    expect(JSON.stringify(example)).not.toMatch(/barcode|unitType|onSale|bottleDeposit/);
  });
});

describe("receipt-reconcile input schema", () => {
  it("rejects a missing store, a bad line and an extra key", () => {
    expect(validateInput({ lines: [] })).toBe(false);
    expect(validateInput({ store: "TJ", lines: [["a"]] })).toBe(false);
    expect(validateInput({ store: "TJ", lines: [], extra: 1 })).toBe(false);
  });

  it("takes a row of five and refuses a sixth value, an object row and the old fields", () => {
    expect(validateInput({ store: "TJ", lines: [["a", "Milk", 3.99, 2, null]] })).toBe(true);
    expect(validateInput({ store: "TJ", lines: [["a", "Milk", 3.99, 2, 1.1]] })).toBe(true);
    expect(validateInput({ store: "TJ", lines: [["a", "Milk", 3.99, 2, null, "0042"]] })).toBe(false);
    expect(validateInput({ store: "TJ", lines: [["a", "Milk", "3.99", 2, null]] })).toBe(false);
    expect(
      validateInput({ store: "TJ", lines: [{ tripItemId: "a", name: "Milk", price: 1, quantity: 1, weightLbs: null }] }),
    ).toBe(false);
  });
});

describe("receipt-reconcile answer schema", () => {
  it("accepts a hand-written answer", () => {
    expect(validateAnswer(answer), JSON.stringify(validateAnswer.errors)).toBe(true);
  });

  it("accepts an unreadable receipt with nulls and no lines", () => {
    expect(
      validateAnswer({
        store: null,
        date: null,
        subtotal: null,
        tax: null,
        total: null,
        lines: [],
        unreadable: "The photo is too blurry to read.",
      })
    ).toBe(true);
  });

  it("rejects an extra key, at the top and on a line", () => {
    expect(validateAnswer({ ...answer, barcode: "123" })).toBe(false);
    expect(
      validateAnswer({ ...answer, lines: [{ ...answer.lines[0], barcode: "1" }] })
    ).toBe(false);
  });

  it("rejects a missing field, a string price and an unknown confidence", () => {
    const { unreadable: _u, ...rest } = answer;
    void _u;
    expect(validateAnswer(rest)).toBe(false);
    expect(
      validateAnswer({ ...answer, lines: [{ ...answer.lines[0], price: "12.70" }] })
    ).toBe(false);
    expect(
      validateAnswer({
        ...answer,
        lines: [{ ...answer.lines[0], confidence: "certain" }],
      })
    ).toBe(false);
  });
});

describe("grinds/receipt-reconcile.md", () => {
  it("names every field of the answer schema, lines included", () => {
    const properties = answerSchema.properties as Record<string, unknown>;
    for (const field of Object.keys(properties)) {
      expect(instructions).toContain(`\`${field}\``);
    }
    const lineProps = (
      (properties.lines as { items: { properties: Record<string, unknown> } }).items
        .properties
    );
    for (const field of Object.keys(lineProps)) {
      expect(instructions).toContain(`\`${field}\``);
    }
  });

  it("names every field of the input schema", () => {
    const properties = inputSchema.properties as Record<string, unknown>;
    for (const field of Object.keys(properties)) {
      expect(instructions).toContain(`\`${field}\``);
    }
  });

  it("states the matching rules", () => {
    expect(instructions).toMatch(/abbreviat/i);
    expect(instructions).toMatch(/at most one/i);
    expect(instructions).toMatch(/discount/i);
    expect(instructions).toMatch(/never invent a barcode/i);
    expect(instructions).toMatch(/`null`/);
  });
});
