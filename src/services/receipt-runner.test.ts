import { waitFor } from "@testing-library/react";
import type { grist } from "bsv-kit/grist";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import type { ReceiptReconcileAnswer } from "@/contracts/types";
import { RECEIPT_TIMEOUT_MS, sendReceipt } from "./receipt-reconcile";
import type { ReceiptClient } from "./receipt-reconcile";
import { ReceiptRunner } from "./receipt-runner";

const itemRepo = new ItemRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const grind = { app: "trade-tracker", kind: "receipt-reconcile", v: "2.0" };

function fakeClient() {
  const waiting = new Map<string, (record: grist.GristAnswer) => void>();
  const client: ReceiptClient = {
    send: vi.fn(async () => "direct:tx1"),
    awaitAnswer: vi.fn(
      (txid: string, signal: AbortSignal) =>
        new Promise<grist.GristAnswer>((resolve, reject) => {
          waiting.set(txid, resolve);
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ),
  };
  return { client, waiting };
}

function receipt(tripItemId: string, price: number, total: number): ReceiptReconcileAnswer {
  return {
    store: "Shop",
    date: null,
    subtotal: null,
    tax: null,
    total,
    lines: [{ text: "MILK", price, quantity: 1, weightLbs: null, tripItemId, confidence: "high" }],
    unreadable: null,
  };
}

async function seed(status: "active" | "completed" = "active") {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Shop", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  if (status === "completed") await db.trips.update(trip.id, { status: "completed" });
  const item = await itemRepo.create({ barcode: "0001", name: "Milk", currentPrice: 3.99, unitType: "each" });
  const line = await tripItemRepo.addToTrip({ tripId: trip.id, itemId: item.id, price: 3.99, quantity: 1, onSale: false });
  return { trip, line };
}

const runners: ReceiptRunner[] = [];
function makeRunner(client: ReceiptClient | null) {
  const runner = new ReceiptRunner({ backoffBaseMs: 1 });
  runners.push(runner);
  runner.setClient(client);
  runner.start();
  return runner;
}

describe("ReceiptRunner", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
  afterEach(() => runners.splice(0).forEach((runner) => runner.stop()));

  it("sending marks the trip with the txid and the sent time", async () => {
    const { trip } = await seed();
    const { client } = fakeClient();
    const before = Date.now();

    expect(await sendReceipt(client, trip.id, [])).toEqual({ ok: true });

    const pending = (await db.trips.get(trip.id))?.receiptPending;
    expect(pending?.txid).toBe("direct:tx1");
    expect(pending?.sentAt).toBeGreaterThanOrEqual(before);
    expect(pending?.request.lines).toHaveLength(1);
  });

  it("applies the answer when it arrives and clears the pending mark", async () => {
    const { trip, line } = await seed();
    const { client, waiting } = fakeClient();
    await sendReceipt(client, trip.id, []);
    makeRunner(client);
    await waitFor(() => expect(waiting.has("direct:tx1")).toBe(true));

    waiting.get("direct:tx1")!({
      re: "direct:tx1",
      status: "answered",
      answer: receipt(line.id, 4.29, 4.29),
      grind,
    });

    await waitFor(async () => expect((await db.tripItems.get(line.id))?.price).toBe(4.29));
    const saved = await db.trips.get(trip.id);
    expect(saved?.receiptPending).toBeUndefined();
    expect(saved?.receiptReconcile?.total).toBe(4.29);
  });

  it("a completed trip's actual total follows the receipt's total", async () => {
    const { trip, line } = await seed("completed");
    const { client, waiting } = fakeClient();
    await sendReceipt(client, trip.id, []);
    makeRunner(client);
    await waitFor(() => expect(waiting.has("direct:tx1")).toBe(true));

    waiting.get("direct:tx1")!({
      re: "direct:tx1",
      status: "answered",
      answer: receipt(line.id, 4.29, 4.5),
      grind,
    });

    await waitFor(async () => expect((await db.trips.get(trip.id))?.actualTotal).toBe(4.5));
  });

  it("a refusal keeps the reason on the pending mark and changes nothing else", async () => {
    const { trip, line } = await seed();
    const { client, waiting } = fakeClient();
    await sendReceipt(client, trip.id, []);
    makeRunner(client);
    await waitFor(() => expect(waiting.has("direct:tx1")).toBe(true));

    waiting.get("direct:tx1")!({ re: "direct:tx1", status: "refused", reason: "Too dark.", grind });

    await waitFor(async () =>
      expect((await db.trips.get(trip.id))?.receiptPending?.error).toBe(
        "The factory could not read the receipt: Too dark.",
      ),
    );
    expect((await db.tripItems.get(line.id))?.price).toBe(3.99);
  });

  it("waits for nothing without a client, and does not wait on a receipt that has timed out", async () => {
    const { trip } = await seed();
    const { client } = fakeClient();
    await sendReceipt(client, trip.id, []);
    const runner = makeRunner(null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.awaitAnswer).not.toHaveBeenCalled();

    await db.trips.update(trip.id, {
      receiptPending: {
        ...(await db.trips.get(trip.id))!.receiptPending!,
        sentAt: Date.now() - RECEIPT_TIMEOUT_MS - 1,
      },
    });
    runner.setClient(client);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.awaitAnswer).not.toHaveBeenCalled();
  });
});
