import Ajv from "ajv";
import answerSchema from "../../schemas/receipt-reconcile-answer-1.0.schema.json";
import type { ReceiptReconcileAnswer, ReceiptReconcileRequest } from "@/contracts/types";

const validate = new Ajv({ allErrors: true, strict: true }).compile<ReceiptReconcileAnswer>(
  answerSchema,
);

export const RECEIPT_ANSWER_NOT_IN_SHAPE =
  "The factory's receipt answer was not in the expected shape, so it was not used.";

export type ParsedReceiptAnswer =
  | { ok: true; answer: ReceiptReconcileAnswer }
  | { ok: false; error: string };

/**
 * Checks a receipt answer against the app's own schema, then makes a tripItemId
 * null when it is not a line of the request or when two receipt lines claim it:
 * an unsure match is left for the shopper rather than guessed.
 */
export function parseReceiptAnswer(
  value: unknown,
  request: ReceiptReconcileRequest,
): ParsedReceiptAnswer {
  if (!validate(value)) return { ok: false, error: RECEIPT_ANSWER_NOT_IN_SHAPE };

  const known = new Set(request.lines.map((line) => line.tripItemId));
  const claims = new Map<string, number>();
  for (const line of value.lines) {
    if (line.tripItemId !== null && known.has(line.tripItemId)) {
      claims.set(line.tripItemId, (claims.get(line.tripItemId) ?? 0) + 1);
    }
  }

  const lines = value.lines.map((line) => {
    const id = line.tripItemId;
    return id !== null && known.has(id) && claims.get(id) === 1
      ? line
      : { ...line, tripItemId: null };
  });
  return { ok: true, answer: { ...value, lines } };
}
