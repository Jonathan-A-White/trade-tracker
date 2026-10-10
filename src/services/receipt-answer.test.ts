import {
  RECEIPT_ANSWER_NOT_IN_SHAPE,
  parseReceiptAnswer,
} from "@/services/receipt-answer";
import type { ReceiptReconcileRequest } from "@/contracts/types";

const request: ReceiptReconcileRequest = {
  store: "Trader Joe's",
  lines: [
    ["ti-steak", "Shaved Steak", 11.34, 1, 1.12],
    ["ti-guac", "Guacamole", 5.99, 1, null],
  ],
};

function line(text: string, tripItemId: string | null) {
  return {
    text,
    price: 5.99,
    quantity: 1,
    weightLbs: null,
    tripItemId,
    confidence: "high" as const,
  };
}

function answerWith(lines: ReturnType<typeof line>[]) {
  return {
    store: "Trader Joe's",
    date: "2026-03-14",
    subtotal: 11.98,
    tax: 0,
    total: 11.98,
    lines,
    unreadable: null,
  };
}

describe("parseReceiptAnswer", () => {
  it("parses a valid answer", () => {
    const value = answerWith([line("SHAVED STEAK", "ti-steak"), line("GUACAMOLE", "ti-guac")]);
    const result = parseReceiptAnswer(value, request);
    expect(result).toEqual({ ok: true, answer: value });
  });

  it("makes a tripItemId that is not in the request null", () => {
    const result = parseReceiptAnswer(
      answerWith([line("GUACAMOLE", "ti-guac"), line("MYSTERY", "ti-made-up")]),
      request
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.lines.map((l) => l.tripItemId)).toEqual(["ti-guac", null]);
    }
  });

  it("makes both receipt lines null when two claim one tripItemId", () => {
    const result = parseReceiptAnswer(
      answerWith([
        line("GUAC", "ti-guac"),
        line("GUACAMOLE", "ti-guac"),
        line("SHAVED STEAK", "ti-steak"),
      ]),
      request
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.lines.map((l) => l.tripItemId)).toEqual([null, null, "ti-steak"]);
    }
  });

  it("does not change the value it was given", () => {
    const value = answerWith([line("MYSTERY", "ti-made-up")]);
    parseReceiptAnswer(value, request);
    expect(value.lines[0].tripItemId).toBe("ti-made-up");
  });

  it("refuses a malformed answer with a message", () => {
    for (const bad of [
      null,
      "receipt",
      { ...answerWith([]), total: "11.98" },
      { ...answerWith([]), extra: true },
      answerWith([{ ...line("X", null), confidence: "certain" as never }]),
    ]) {
      const result = parseReceiptAnswer(bad, request);
      expect(result).toEqual({ ok: false, error: RECEIPT_ANSWER_NOT_IN_SHAPE });
    }
    expect(RECEIPT_ANSWER_NOT_IN_SHAPE.length).toBeGreaterThan(10);
  });
});
