import Ajv from "ajv";
import answerSchema from "../../schemas/item-from-photos-answer-1.0.schema.json";
import type { ItemFromPhotosAnswer } from "@/contracts/types";

const validate = new Ajv({ allErrors: true, strict: true }).compile<ItemFromPhotosAnswer>(
  answerSchema,
);

export const ANSWER_NOT_IN_SHAPE =
  "The factory's answer was not in the expected shape, so it was not used.";

export type ParsedAnswer =
  | { ok: true; answer: ItemFromPhotosAnswer }
  | { ok: false; error: string };

/** Checks an answer against the app's own schema before anything is kept; bsv-kit only hands the record over. */
export function parseItemAnswer(value: unknown): ParsedAnswer {
  if (validate(value)) return { ok: true, answer: value };
  return { ok: false, error: ANSWER_NOT_IN_SHAPE };
}
