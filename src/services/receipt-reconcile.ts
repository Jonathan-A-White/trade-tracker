import type { grist } from "bsv-kit/grist";
import { db } from "@/db/database";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import type {
  ReceiptReconcileAnswer,
  ReceiptReconcileAnswerLine,
  ReceiptReconcileRequest,
  ReceiptReconcileRequestLine,
} from "@/contracts/types";
import { parseReceiptAnswer } from "@/services/receipt-answer";

/** The grind the receipt reconcile runs: grinds/receipt-reconcile.json, version 1.0 of its input and answer. */
export const RECEIPT_KIND = "receipt-reconcile";
export const RECEIPT_VERSION = "1.0";

/** How long the page waits for the factory's answer before it gives up and says so. */
export const RECEIPT_TIMEOUT_MS = 10 * 60_000;

const tripItemRepo = new TripItemRepository();

/** The two things a receipt reconcile needs of bsv-kit/grist; a fake in tests. */
export interface ReceiptClient {
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

/** One trip line the receipt changed: the unit price (and count or weight) before and after. */
export interface ReceiptChange {
  tripItemId: string;
  name: string;
  oldPrice: number;
  newPrice: number;
  oldQuantity: number;
  newQuantity: number;
  oldWeightLbs: number | null;
  newWeightLbs: number | null;
}

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
    requestLines.push({
      tripItemId: line.id,
      name: item.name,
      barcode: item.barcode,
      price: line.price,
      quantity: line.quantity,
      weightLbs: line.weightLbs ?? null,
      unitType: item.unitType,
      onSale: line.onSale,
      bottleDeposit: line.bottleDeposit ?? null,
    });
  });
  return { store: store?.name ?? "", lines: requestLines };
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
      if (!(receiptLine.price > 0) || !Number.isFinite(receiptLine.price)) continue;

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
      if (!priceChanged && !quantityChanged && !weightChanged) continue;

      await tripItemRepo.update(line.id, {
        price: newPrice,
        ...(quantityChanged ? { quantity: newQuantity } : {}),
        ...(weightChanged && receiptWeight !== null ? { weightLbs: receiptWeight } : {}),
      });
      if (priceChanged) {
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
      changes.push({
        tripItemId: line.id,
        name: item.name,
        oldPrice: line.price,
        newPrice,
        oldQuantity: line.quantity,
        newQuantity,
        oldWeightLbs: line.weightLbs ?? null,
        newWeightLbs: newWeight ?? null,
      });
    }
  });

  return { changes, unmatched, total: answer.total, unreadable: answer.unreadable };
}
