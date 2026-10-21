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

  it("waits for nothing without a client", async () => {
    const { trip } = await seed();
    const { client } = fakeClient();
    await sendReceipt(client, trip.id, []);
    const runner = makeRunner(null);
    // start() pumps once, synchronously, and a pump with no client asks nothing
    expect(client.awaitAnswer).not.toHaveBeenCalled();

    // the same runner given a client asks at once: the empty wait above was the missing client, not a dead runner
    runner.setClient(client);
    await waitFor(() => expect(client.awaitAnswer).toHaveBeenCalledTimes(1));
  });

  it("an answer that waited hours while the page was hidden is fetched and applied when the page is seen again", async () => {
    // his Trader Joe's receipt (mw-iy99ci.30): the mill answered in 41 s, the app was in the
    // background, and the deadline had passed by the time it was opened again
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
    const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
    const lineIds: string[] = [];
    for (let i = 0; i < 42; i++) {
      const item = await itemRepo.create({
        barcode: `00${i}`,
        name: `Item ${i}`,
        currentPrice: 1,
        unitType: "each",
      });
      const line = await tripItemRepo.addToTrip({
        tripId: trip.id,
        itemId: item.id,
        price: 1,
        quantity: 1,
        onSale: false,
      });
      lineIds.push(line.id);
    }
    // 46 receipt lines: 39 matched to a trip line, 7 not on the trip
    const answer: ReceiptReconcileAnswer = {
      store: "Trader Joe's",
      date: "2026-10-09",
      subtotal: null,
      tax: 2.84,
      total: 197.34,
      lines: Array.from({ length: 46 }, (_, i) => ({
        text: `RECEIPT LINE ${i}`,
        price: 2 + i / 100,
        quantity: 1,
        weightLbs: null,
        tripItemId: i < 39 ? lineIds[i] : null,
        confidence: "low" as const,
      })),
      unreadable: "The top part of the receipt is blurry.",
    };
    let pageVisible = false;
    const askedWhileHidden: string[] = [];
    const client: ReceiptClient = {
      send: vi.fn(async () => "direct:tx1"),
      // like bsv-kit's awaitAnswer, which pages the backend from the start: an answer already
      // there comes back at once
      awaitAnswer: vi.fn(async (txid: string) => {
        if (!pageVisible) askedWhileHidden.push(txid);
        return { re: txid, status: "answered" as const, answer, grind };
      }),
    };
    await sendReceipt(client, trip.id, []);
    await db.trips.update(trip.id, {
      receiptPending: {
        ...(await db.trips.get(trip.id))!.receiptPending!,
        sentAt: Date.now() - 4 * 60 * 60_000,
      },
    });
    const runner = new ReceiptRunner({ backoffBaseMs: 1 });
    runners.push(runner);
    runner.setVisible(false);
    runner.setClient(client);
    runner.start();

    pageVisible = true;
    runner.setVisible(true);

    await waitFor(async () => expect((await db.tripItems.get(lineIds[0]))?.price).toBe(2));
    // the factory was asked only once the page was seen, never while it was hidden
    expect(askedWhileHidden).toEqual([]);
    const saved = await db.trips.get(trip.id);
    expect(saved?.receiptPending).toBeUndefined();
    expect(saved?.receiptReconcile?.total).toBe(197.34);
    expect(saved?.receiptReconcile?.matchedTripItemIds).toHaveLength(39);
    expect(saved?.receiptReconcile?.unmatched).toHaveLength(7);
  });

  it("a receipt past its deadline gets one last look, then is left alone", async () => {
    const { trip } = await seed();
    const { client } = fakeClient();
    await sendReceipt(client, trip.id, []);
    await db.trips.update(trip.id, {
      receiptPending: {
        ...(await db.trips.get(trip.id))!.receiptPending!,
        sentAt: Date.now() - RECEIPT_TIMEOUT_MS - 1,
      },
    });
    const runner = new ReceiptRunner({ backoffBaseMs: 1, finalLookMs: 20 });
    runners.push(runner);
    runner.setClient(client);
    runner.start();
    await waitFor(() => expect(client.awaitAnswer).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(client.awaitAnswer).mock.calls[0][1];
    await waitFor(() => expect(signal.aborted).toBe(true));

    // a second receipt, still within its deadline, is asked about in the same pass as the first
    // is skipped: once it is asked, the pass has run and the first was not looked at again
    const first = (await db.trips.get(trip.id))!.receiptPending!;
    const second = await tripRepo.create({ storeId: "s1", startedAt: Date.now() });
    await db.trips.update(second.id, {
      receiptPending: { ...first, txid: "direct:tx2", sentAt: Date.now() },
    });
    runner.kick();
    await waitFor(() => expect(client.awaitAnswer).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.awaitAnswer).mock.calls.map((call) => call[0])).toEqual(["direct:tx1", "direct:tx2"]);
    expect((await db.trips.get(trip.id))?.receiptPending?.error).toBeUndefined();
  });

  it("an answer out of shape says the factory answered and why it was not used", async () => {
    const { trip, line } = await seed();
    const { client, waiting } = fakeClient();
    await sendReceipt(client, trip.id, []);
    makeRunner(client);
    await waitFor(() => expect(waiting.has("direct:tx1")).toBe(true));

    waiting.get("direct:tx1")!({
      re: "direct:tx1",
      status: "answered",
      answer: { total: 4 },
      grind,
    });

    await waitFor(async () =>
      expect((await db.trips.get(trip.id))?.receiptPending?.error).toMatch(/^The factory answered/),
    );
    expect((await db.tripItems.get(line.id))?.price).toBe(3.99);
  });
});
