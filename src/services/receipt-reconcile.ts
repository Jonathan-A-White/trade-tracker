import type { grist } from "bsv-kit/grist";
import { db } from "@/db/database";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { newManualBarcode } from "@/services/trip-exchange-service";
import type {
  Item,
  ReceiptChange,
  ReceiptPending,
  ReceiptReconcileAnswer,
  ReceiptReconcileAnswerLine,
  ReceiptReconcileRequest,
  ReceiptReconcileRequestLine,
  Trip,
  TripItem,
} from "@/contracts/types";
import { parseReceiptAnswer } from "@/services/receipt-answer";

/** The grind the receipt reconcile runs: grinds/receipt-reconcile.json, version 2.0 of its input (the compact rows), 1.0 of its answer. */
export const RECEIPT_KIND = "receipt-reconcile";
export const RECEIPT_VERSION = "2.0";

/** How long the page waits for the factory's answer before it gives up and says so. */
export const RECEIPT_TIMEOUT_MS = 10 * 60_000;

const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

/** The two things a receipt reconcile needs of bsv-kit/grist; a fake in tests. */
export interface ReceiptClient {
  /**
   * How big the sealed record would be and the most one record may be, measured the way bsv-kit's
   * send measures it. A fake may leave it out, and nothing is measured then.
   */
  measure?(input: ReceiptReconcileRequest, photoCount: number): { bytes: number; cap: number };
  /** Uploads the photos and posts the grist; resolves with its txid. */
  send(call: {
    input: ReceiptReconcileRequest;
    photos: grist.Photo[];
    clientId: string;
  }): Promise<string>;
  /** Polls until the mill's answer arrives; rejects with an AbortError when the signal aborts. */
  awaitAnswer(txid: string, signal: AbortSignal): Promise<grist.GristAnswer>;
}

export type ReceiptReconcileOutcome =
  | { ok: true; answer: ReceiptReconcileAnswer }
  | { ok: false; error: string };

export type { ReceiptChange };

export interface ReceiptApplyResult {
  changes: ReceiptChange[];
  /** Receipt lines the factory could not (or was not sure to) match to a trip line. */
  unmatched: ReceiptReconcileAnswerLine[];
  total: number | null;
  unreadable: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The trip's priced lines as the receipt-reconcile request sends them. */
export async function buildReceiptRequest(tripId: string): Promise<ReceiptReconcileRequest> {
  const trip = await db.trips.get(tripId);
  const store = trip ? await db.stores.get(trip.storeId) : undefined;
  const lines = (await tripItemRepo.getByTrip(tripId)).filter((line) => !line.pending);
  const items = await db.items.bulkGet(lines.map((line) => line.itemId));

  const requestLines: ReceiptReconcileRequestLine[] = [];
  lines.forEach((line, index) => {
    const item = items[index];
    if (!item) return;
    requestLines.push([line.id, item.name, line.price, line.quantity, line.weightLbs ?? null]);
  });
  return { store: store?.name ?? "", lines: requestLines };
}

/**
 * Null when the request fits one record; otherwise a plain sentence saying how many of the trip's
 * lines a receipt check can take, found by measuring the first lines until they just fit.
 */
function tooLargeSentence(
  client: ReceiptClient,
  request: ReceiptReconcileRequest,
  photoCount: number,
): string | null {
  if (!client.measure) return null;
  const fits = (count: number) => {
    const { bytes, cap } = client.measure!(
      { ...request, lines: request.lines.slice(0, count) },
      photoCount,
    );
    return bytes <= cap;
  };
  if (fits(request.lines.length)) return null;
  let low = 0;
  let high = request.lines.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return (
    `This trip has ${request.lines.length} lines, too many to check against a receipt at once. ` +
    `The factory can check ${low} lines. Take some lines off the trip, then send the receipt again.`
  );
}

function describeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : "";
  return message
    ? `The receipt could not be sent: ${message}`
    : "The receipt could not be sent. Check the connection and try again.";
}

/**
 * Sends the request and photos as one receipt-reconcile grist and waits for the
 * mill's answer, checked against the app's schema. Never throws: a refusal, a
 * failure, a network error, a timeout or an answer out of shape comes back as
 * a plain sentence, and nothing is written.
 */
export async function reconcileReceipt(
  client: ReceiptClient,
  request: ReceiptReconcileRequest,
  photos: grist.Photo[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ReceiptReconcileOutcome> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? RECEIPT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const relay = () => controller.abort();
  options.signal?.addEventListener("abort", relay);

  try {
    const tooLarge = tooLargeSentence(client, request, photos.length);
    if (tooLarge) return { ok: false, error: tooLarge };
    const txid = await client.send({ input: request, photos, clientId: crypto.randomUUID() });
    const record = await client.awaitAnswer(txid, controller.signal);
    if (record.status !== "answered") {
      const reason = record.reason?.trim();
      return {
        ok: false,
        error: reason
          ? `The factory could not read the receipt: ${reason}`
          : "The factory could not read the receipt.",
      };
    }
    const parsed = parseReceiptAnswer(record.answer, request);
    return parsed.ok ? { ok: true, answer: parsed.answer } : parsed;
  } catch (err) {
    if (timedOut) {
      return {
        ok: false,
        error:
          "The factory did not answer in time. Your trip is as it was; try again in a little while.",
      };
    }
    if (controller.signal.aborted) {
      return { ok: false, error: "Stopped waiting for the factory." };
    }
    return { ok: false, error: describeFailure(err) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relay);
  }
}

/**
 * The photos of the receipt last sent for each trip, kept in memory so 'Send again' needs no new
 * photos while the app stays open (after a restart he photographs the receipt again).
 */
const sentPhotos = new Map<string, grist.Photo[]>();

export function lastSentReceiptPhotos(tripId: string): grist.Photo[] {
  return sentPhotos.get(tripId) ?? [];
}

/** True once the factory has had RECEIPT_TIMEOUT_MS to answer a receipt and has not. */
export function receiptTimedOut(pending: ReceiptPending, now: number): boolean {
  return now - pending.sentAt >= RECEIPT_TIMEOUT_MS;
}

/**
 * Sends the request and photos as one receipt-reconcile grist and marks the trip as waiting for
 * its answer (txid and sent time, kept in the database). The answer is fetched and applied by the
 * receipt runner, whether or not any page is open. Never throws: a refusal, a network error or a
 * request too large comes back as a plain sentence, and the trip is not marked.
 */
export async function sendReceipt(
  client: ReceiptClient,
  tripId: string,
  photos: grist.Photo[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const request = await buildReceiptRequest(tripId);
    const tooLarge = tooLargeSentence(client, request, photos.length);
    if (tooLarge) return { ok: false, error: tooLarge };
    const txid = await client.send({ input: request, photos, clientId: crypto.randomUUID() });
    sentPhotos.set(tripId, photos);
    await db.trips.update(tripId, { receiptPending: { txid, sentAt: Date.now(), request } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeFailure(err) };
  }
}

/** Drops the pending mark (he chose to send again). */
export async function clearReceiptPending(tripId: string): Promise<void> {
  await db.trips.update(tripId, { receiptPending: undefined });
}

async function failPending(tripId: string, txid: string, error: string): Promise<void> {
  await db.transaction("rw", db.trips, async () => {
    const trip = await db.trips.get(tripId);
    if (trip?.receiptPending?.txid !== txid) return;
    await db.trips.update(tripId, { receiptPending: { ...trip.receiptPending, error } });
  });
}

/**
 * The factory's answer to the receipt the trip is waiting on (matched by txid; an answer to a
 * receipt since sent again is dropped): checked against what was sent and applied, which clears the
 * pending mark; or, when it was refused or is out of shape, the mark keeps a plain sentence saying
 * so and nothing else changes. A completed trip's actual total follows the receipt's total.
 */
export async function settleReceipt(
  tripId: string,
  txid: string,
  record: grist.GristAnswer,
): Promise<void> {
  const pending = (await db.trips.get(tripId))?.receiptPending;
  if (!pending || pending.txid !== txid || pending.error) return;
  if (record.status !== "answered") {
    const reason = record.reason?.trim();
    await failPending(
      tripId,
      txid,
      reason
        ? `The factory could not read the receipt: ${reason}`
        : "The factory could not read the receipt.",
    );
    return;
  }
  const parsed = parseReceiptAnswer(record.answer, pending.request);
  if (!parsed.ok) {
    await failPending(tripId, txid, parsed.error);
    return;
  }
  try {
    const applied = await applyReceiptAnswer(tripId, parsed.answer);
    if (applied.total !== null && (await db.trips.get(tripId))?.status === "completed") {
      await db.trips.update(tripId, { actualTotal: applied.total, updatedAt: Date.now() });
    }
  } catch (err) {
    console.error("Failed to apply the receipt:", err);
    await failPending(
      tripId,
      txid,
      "The receipt could not be used, and your trip is as it was. Please try again.",
    );
  }
}

/**
 * Gives one trip line the receipt's figures for it, when they differ: the line's
 * price (and count, or per-pound weight), then the item's currentPrice and one
 * priceHistory entry when the unit price moved. Returns what changed, or null.
 * Must be called inside a read/write transaction over tripItems, trips, items
 * and priceHistory.
 */
async function applyToLine(
  receiptLine: ReceiptReconcileAnswerLine,
  line: TripItem,
  item: Item,
  trip: Trip | undefined,
  now: number,
): Promise<ReceiptChange | null> {
  if (!(receiptLine.price > 0) || !Number.isFinite(receiptLine.price)) return null;

  const perLb = item.unitType === "per_lb";
  const receiptWeight =
    perLb && receiptLine.weightLbs !== null && receiptLine.weightLbs > 0
      ? receiptLine.weightLbs
      : null;
  const newWeight = receiptWeight ?? line.weightLbs;
  const newQuantity =
    !perLb && Number.isInteger(receiptLine.quantity) && receiptLine.quantity >= 1
      ? receiptLine.quantity
      : line.quantity;
  const divisor = perLb && newWeight !== undefined && newWeight > 0 ? newWeight : newQuantity;
  const newPrice = round2(receiptLine.price / divisor);

  const priceChanged = newPrice !== round2(line.price);
  const quantityChanged = newQuantity !== line.quantity;
  const weightChanged = receiptWeight !== null && receiptWeight !== line.weightLbs;
  const wasGuess = line.guess !== undefined;
  if (!priceChanged && !quantityChanged && !weightChanged) {
    // the receipt agrees with a guess: the price is real now, though nothing changed
    if (wasGuess) {
      await tripItemRepo.update(line.id, { guess: undefined });
      if (item.currentPrice !== newPrice) {
        await db.items.update(item.id, { currentPrice: newPrice, updatedAt: now });
      }
    }
    return null;
  }

  await tripItemRepo.update(line.id, {
    price: newPrice,
    ...(wasGuess ? { guess: undefined } : {}),
    ...(quantityChanged ? { quantity: newQuantity } : {}),
    ...(weightChanged && receiptWeight !== null ? { weightLbs: receiptWeight } : {}),
  });
  if (priceChanged || (wasGuess && item.currentPrice !== newPrice)) {
    await db.items.update(item.id, { currentPrice: newPrice, updatedAt: now });
    if (trip) {
      await db.priceHistory.put({
        id: crypto.randomUUID(),
        itemId: item.id,
        storeId: trip.storeId,
        tripItemId: line.id,
        price: newPrice,
        recordedAt: now,
      });
    }
  }
  return {
    tripItemId: line.id,
    name: item.name,
    oldPrice: line.price,
    newPrice,
    oldQuantity: line.quantity,
    newQuantity,
    oldWeightLbs: line.weightLbs ?? null,
    newWeightLbs: newWeight ?? null,
    ...(wasGuess ? { wasGuess: true as const } : {}),
  };
}

/**
 * Applies a checked receipt answer to the trip, in one transaction. For each
 * receipt line matched to one of the trip's lines whose price (or count, or a
 * per-pound weight) differs, the trip line takes the receipt's figures and,
 * when the unit price moved, the item's currentPrice and one priceHistory entry
 * follow. The receipt's line price is for the whole line, so the unit price is
 * the line price over the weight (a per-pound line with a weight) or the count.
 * Barcode, name and category are never touched.
 */
export async function applyReceiptAnswer(
  tripId: string,
  answer: ReceiptReconcileAnswer,
): Promise<ReceiptApplyResult> {
  const changes: ReceiptChange[] = [];
  const unmatched: ReceiptReconcileAnswerLine[] = [];

  await db.transaction("rw", [db.tripItems, db.trips, db.items, db.priceHistory], async () => {
    const trip = await db.trips.get(tripId);
    const now = Date.now();
    const claimed = new Set<string>();

    for (const receiptLine of answer.lines) {
      const line = receiptLine.tripItemId
        ? await db.tripItems.get(receiptLine.tripItemId)
        : undefined;
      if (!line || line.tripId !== tripId || line.pending || claimed.has(line.id)) {
        unmatched.push(receiptLine);
        continue;
      }
      const item = await db.items.get(line.itemId);
      if (!item) {
        unmatched.push(receiptLine);
        continue;
      }
      claimed.add(line.id);
      const change = await applyToLine(receiptLine, line, item, trip, now);
      if (change) changes.push(change);
    }

    await db.trips.update(tripId, {
      receiptReconcile: {
        changes,
        unmatched,
        added: [],
        matchedTripItemIds: [...claimed],
        total: answer.total,
        unreadable: answer.unreadable,
      },
      receiptPending: undefined,
    });
  });

  return { changes, unmatched, total: answer.total, unreadable: answer.unreadable };
}

const RECEIPT_TABLES = [db.tripItems, db.trips, db.items, db.priceHistory];

/**
 * He places an unmatched receipt line (by its place in the trip's record) on
 * one of the trip's lines: the line takes the receipt's price as a matched one
 * does, moves to 'What changed' and is no longer 'Not on receipt'. Returns false
 * and changes nothing when the line is gone or already matched.
 */
export async function matchReceiptLine(
  tripId: string,
  unmatchedIndex: number,
  tripItemId: string,
): Promise<boolean> {
  return db.transaction("rw", RECEIPT_TABLES, async () => {
    const trip = await db.trips.get(tripId);
    const record = trip?.receiptReconcile;
    const receiptLine = record?.unmatched[unmatchedIndex];
    if (!trip || !record || !receiptLine) return false;
    const line = await db.tripItems.get(tripItemId);
    if (!line || line.tripId !== tripId || line.pending || record.matchedTripItemIds.includes(line.id)) {
      return false;
    }
    const item = await db.items.get(line.itemId);
    if (!item) return false;

    const change = await applyToLine(receiptLine, line, item, trip, Date.now());
    await db.trips.update(tripId, {
      receiptReconcile: {
        ...record,
        changes: change ? [...record.changes, change] : record.changes,
        unmatched: record.unmatched.filter((_, index) => index !== unmatchedIndex),
        matchedTripItemIds: [...record.matchedTripItemIds, line.id],
      },
    });
    return true;
  });
}

/**
 * He adds an unmatched receipt line as a new item: an Item named with the
 * receipt's text and the receipt's unit price, with a placeholder barcode (it
 * can be scanned later), and a trip line for it. Returns false and changes
 * nothing when the receipt line is gone.
 */
export async function addReceiptLineAsItem(
  tripId: string,
  unmatchedIndex: number,
): Promise<boolean> {
  return db.transaction("rw", RECEIPT_TABLES, async () => {
    const trip = await db.trips.get(tripId);
    const record = trip?.receiptReconcile;
    const receiptLine = record?.unmatched[unmatchedIndex];
    if (!trip || !record || !receiptLine) return false;

    const quantity =
      Number.isInteger(receiptLine.quantity) && receiptLine.quantity >= 1 ? receiptLine.quantity : 1;
    const price =
      receiptLine.price > 0 && Number.isFinite(receiptLine.price)
        ? round2(receiptLine.price / quantity)
        : 0;
    const name = receiptLine.text.trim() || "Receipt item";
    const item = await itemRepo.create({
      barcode: newManualBarcode(),
      name,
      currentPrice: price,
      unitType: "each",
    });
    const line = await tripItemRepo.addToTrip({
      tripId,
      itemId: item.id,
      price,
      quantity,
      onSale: false,
    });
    await db.trips.update(tripId, {
      receiptReconcile: {
        ...record,
        unmatched: record.unmatched.filter((_, index) => index !== unmatchedIndex),
        added: [...record.added, { tripItemId: line.id, name, price }],
        matchedTripItemIds: [...record.matchedTripItemIds, line.id],
      },
    });
    return true;
  });
}
