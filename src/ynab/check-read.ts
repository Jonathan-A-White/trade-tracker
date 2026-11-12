// Reading a check image (Clean up's Checks pile): the check-read grind (grinds/check-read.json) is shown the image and reads who the
// check is made out to ('Pay to the order of') and its memo line, and suggests a category from them. The app turns that into a
// suggestion that is never pre-ticked, and the payee read into the YNAB memo on Approve; nothing is written until he taps Approve.
import type { CheckReadAnswer, YnabCategory } from "@/contracts/types";
import { MAX_PAYLOAD_BYTES, openMill, sealedRecordBytes } from "@/factory/mill";
import type { MillLicence } from "@/factory/mill";
import { fallbackCategory, guessAllowed } from "@/sort/suggest";
import type { Confidence } from "./cleanup";

/** The grind the check read runs: grinds/check-read.json, version 1.0 of its input and answer. */
export const CHECK_READ_KIND = "check-read";
export const CHECK_READ_VERSION = "1.0";
/** The longest the card waits for the mill to read the image. */
export const CHECK_READ_DEADLINE_MS = 180_000;
const POLL_MS = 3_000;
/** YNAB cuts a memo at 200 characters. */
export const MEMO_MAX = 200;
const WHY_MAX = 240;

/** What the grind is asked: the check as YNAB lists it and the budget's categories. */
export interface CheckReadRequest {
  /** YNAB's payee text, e.g. 'CHECK 1089 *8368' */
  check: string;
  /** YYYY-MM-DD */
  date: string;
  /** dollars, positive */
  amount: number;
  categories: { name: string }[];
}

/** Reads one check image; rejects with a plain sentence when the mill cannot. */
export type CheckReader = (request: CheckReadRequest, photo: Blob, signal: AbortSignal) => Promise<CheckReadAnswer>;

/** The read over the factory: a check-read grist with the image, its answer waited for. `licence` is read at each call. */
export function makeCheckReadAsk(backendUrl: string, key: Uint8Array, licence: () => MillLicence): CheckReader {
  const mill = openMill(backendUrl, key, licence);
  return async (request, photo, signal) => {
    const photos = [{ bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type || "image/jpeg" }];
    if (sealedRecordBytes(key, CHECK_READ_KIND, CHECK_READ_VERSION, request, photos.length) > MAX_PAYLOAD_BYTES) {
      throw new Error("The image is too big to send. Add a smaller one.");
    }
    const txid = await mill.send({ kind: CHECK_READ_KIND, v: CHECK_READ_VERSION, input: request, photos });
    const reply = await mill.awaitAnswer<CheckReadAnswer>(txid, signal, { intervalMs: POLL_MS });
    if (reply.status !== "answered" || !reply.answer) throw new Error(reply.reason || "The factory could not read this image.");
    return reply.answer;
  };
}

/** The read in the card's own terms. */
export interface CheckRead {
  payTo: string;
  memo: string;
  /** the category it suggests; null when none fits (or none the budget has) */
  categoryId: string | null;
  confidence: Confidence;
  /** names what was read, then why */
  why: string;
}

const clean = (text: unknown, max: number): string => (typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The answer as the card holds it, or null when it says nothing. A read is at best Likely (only a payee's history is Sure), and the
 * why always names what was read. Food, Household and Groceries are never named for a payee read off a check, which has no history
 * there: it falls to Stuff I Forgot to Budget For, saying so.
 */
export function resolveCheckRead(answer: CheckReadAnswer, categories: readonly YnabCategory[]): CheckRead | null {
  const payTo = clean(answer.payTo, 120);
  const memo = clean(answer.memo, 120);
  const why = clean(answer.why, WHY_MAX);
  if (!payTo && !why) return null;
  const read = [payTo && `Pay to ${payTo}`, memo && `memo "${memo}"`].filter(Boolean).join(", ");
  const named = clean(answer.category, 60).toLowerCase();
  let category = named ? categories.find((c) => c.name.trim().toLowerCase() === named) : undefined;
  let note = why;
  if (category && !guessAllowed(category, new Set())) {
    const fallback = fallbackCategory(categories);
    // a budget with no such category (another family's) keeps the answer as it came
    if (fallback) {
      note = `New to ${category.name} here, so ${fallback.name}.`;
      category = fallback;
    }
  }
  const sure = answer.confidence === "high" && category !== undefined && note === why;
  return {
    payTo,
    memo,
    categoryId: category?.id ?? null,
    confidence: sure ? "likely" : "unsure",
    why: [read && `Read: ${read}.`, note].filter(Boolean).join(" "),
  };
}

/** The memo to write on Approve: what YNAB already holds, then 'Paid to <payee> (<the check's memo>)'; never twice, cut at 200. */
export function memoFor(existing: string, read: Pick<CheckRead, "payTo" | "memo">): string {
  const held = existing.trim();
  if (!read.payTo) return held.slice(0, MEMO_MAX);
  const paid = `Paid to ${read.payTo}${read.memo ? ` (${read.memo})` : ""}`;
  if (held.includes(paid)) return held.slice(0, MEMO_MAX);
  return (held ? `${held} · ${paid}` : paid).slice(0, MEMO_MAX);
}
