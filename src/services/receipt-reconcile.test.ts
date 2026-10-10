import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import type { ReceiptReconcileAnswer, ReceiptReconcileAnswerLine } from "@/contracts/types";
import type { grist } from "bsv-kit/grist";
import {
  applyReceiptAnswer,
  buildReceiptRequest,
  reconcileReceipt,
} from "./receipt-reconcile";
import type { ReceiptClient } from "./receipt-reconcile";

const itemRepo = new ItemRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

async function seedTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  return trip;
}

async function addLine(
  tripId: string,
  barcode: string,
  name: string,
  price: number,
  quantity: number,
  options: { unitType?: "each" | "per_lb"; weightLbs?: number } = {},
) {
  const item = await itemRepo.create({
    barcode,
    name,
    currentPrice: price,
    unitType: options.unitType ?? "each",
  });
  const line = await tripItemRepo.addToTrip({
    tripId,
    itemId: item.id,
    price,
    quantity,
    weightLbs: options.weightLbs,
    onSale: false,
  });
  return { item, line };
}

function receiptLine(
  tripItemId: string | null,
  price: number,
  extra: Partial<ReceiptReconcileAnswerLine> = {},
): ReceiptReconcileAnswerLine {
  return {
    text: "LINE",
    price,
    quantity: 1,
    weightLbs: null,
    tripItemId,
    confidence: "high",
    ...extra,
  };
}

function answer(
  lines: ReceiptReconcileAnswerLine[],
  total: number | null = null,
): ReceiptReconcileAnswer {
  return { store: "Trader Joe's", date: null, subtotal: null, tax: null, total, lines, unreadable: null };
}

describe("buildReceiptRequest", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("sends the trip's priced lines with their barcodes and the store's name", async () => {
    const trip = await seedTrip();
    const { line } = await addLine(trip.id, "0042", "Milk", 3.99, 2);

    const request = await buildReceiptRequest(trip.id);

    expect(request.store).toBe("Trader Joe's");
    expect(request.lines).toEqual([
      {
        tripItemId: line.id,
        name: "Milk",
        barcode: "0042",
        price: 3.99,
        quantity: 2,
        weightLbs: null,
        unitType: "each",
        onSale: false,
        bottleDeposit: null,
      },
    ]);
  });
});

describe("applyReceiptAnswer", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("writes nothing for a line whose price is unchanged", async () => {
    const trip = await seedTrip();
    const { item, line } = await addLine(trip.id, "0042", "Milk", 3.99, 1);
    const historyBefore = await db.priceHistory.count();
    const itemBefore = await db.items.get(item.id);

    const result = await applyReceiptAnswer(trip.id, answer([receiptLine(line.id, 3.99)]));

    expect(result.changes).toEqual([]);
    expect(await db.priceHistory.count()).toBe(historyBefore);
    expect(await db.items.get(item.id)).toEqual(itemBefore);
    expect((await db.tripItems.get(line.id))?.price).toBe(3.99);
  });

  it("updates the line, the item's current price and the price history, keeping the barcode", async () => {
    const trip = await seedTrip();
    const { item, line } = await addLine(trip.id, "0042", "Milk", 3.99, 1);

    const result = await applyReceiptAnswer(trip.id, answer([receiptLine(line.id, 4.29)], 4.55));

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ name: "Milk", oldPrice: 3.99, newPrice: 4.29 });
    expect(result.total).toBe(4.55);
    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(4.29);
    expect(saved?.lineTotal).toBeCloseTo(4.29, 2);
    const savedItem = await db.items.get(item.id);
    expect(savedItem?.currentPrice).toBe(4.29);
    expect(savedItem?.barcode).toBe("0042");
    expect(savedItem?.name).toBe("Milk");
    const history = await db.priceHistory.where("itemId").equals(item.id).toArray();
    expect(history.some((entry) => entry.price === 4.29 && entry.tripItemId === line.id)).toBe(true);
  });

  it("takes the receipt's price for the whole line and divides it by the count", async () => {
    const trip = await seedTrip();
    const banana = await addLine(trip.id, "0001", "Bananas", 0.19, 7);
    const deal = await addLine(trip.id, "0002", "Beans", 2.5, 4);

    const result = await applyReceiptAnswer(
      trip.id,
      answer([
        receiptLine(banana.line.id, 1.61, { quantity: 7 }),
        receiptLine(deal.line.id, 11.99, { quantity: 4 }),
      ]),
    );

    expect(result.changes).toHaveLength(2);
    const bananaLine = await db.tripItems.get(banana.line.id);
    expect(bananaLine?.price).toBe(0.23);
    expect(bananaLine?.quantity).toBe(7);
    expect((await db.items.get(banana.item.id))?.currentPrice).toBe(0.23);
    const dealLine = await db.tripItems.get(deal.line.id);
    expect(dealLine?.price).toBe(3);
    expect(dealLine?.quantity).toBe(4);
    expect((await db.items.get(deal.item.id))?.currentPrice).toBe(3);
  });

  it("takes the receipt's count for an each line", async () => {
    const trip = await seedTrip();
    const { line } = await addLine(trip.id, "0003", "Cucumber", 3.49, 2);

    await applyReceiptAnswer(trip.id, answer([receiptLine(line.id, 10.47, { quantity: 3 })]));

    const saved = await db.tripItems.get(line.id);
    expect(saved?.quantity).toBe(3);
    expect(saved?.price).toBe(3.49);
    expect(saved?.lineTotal).toBeCloseTo(10.47, 2);
  });

  it("gives a per_lb line the receipt's weight and a price per pound", async () => {
    const trip = await seedTrip();
    const { item, line } = await addLine(trip.id, "0004", "Shaved Steak", 10.12, 1, {
      unitType: "per_lb",
      weightLbs: 1.12,
    });

    const result = await applyReceiptAnswer(
      trip.id,
      answer([receiptLine(line.id, 12.0, { weightLbs: 1.5 })]),
    );

    expect(result.changes).toHaveLength(1);
    const saved = await db.tripItems.get(line.id);
    expect(saved?.weightLbs).toBe(1.5);
    expect(saved?.price).toBe(8);
    expect(saved?.lineTotal).toBeCloseTo(12, 2);
    expect((await db.items.get(item.id))?.currentPrice).toBe(8);
  });

  it("ignores a weight the receipt prints for an each line", async () => {
    const trip = await seedTrip();
    const { line } = await addLine(trip.id, "0005", "Bread", 3, 1);

    await applyReceiptAnswer(trip.id, answer([receiptLine(line.id, 3.5, { weightLbs: 1.2 })]));

    const saved = await db.tripItems.get(line.id);
    expect(saved?.weightLbs).toBeUndefined();
    expect(saved?.price).toBe(3.5);
  });

  it("lists receipt lines with no trip line as not matched and leaves the trip alone", async () => {
    const trip = await seedTrip();
    const { line } = await addLine(trip.id, "0042", "Milk", 3.99, 1);

    const result = await applyReceiptAnswer(
      trip.id,
      answer([receiptLine(null, 2.5, { text: "MYSTERY" }), receiptLine("not-a-line", 9)]),
    );

    expect(result.unmatched.map((entry) => entry.text)).toEqual(["MYSTERY", "LINE"]);
    expect(result.changes).toEqual([]);
    expect((await db.tripItems.get(line.id))?.price).toBe(3.99);
  });

  it("does not touch a line of another trip", async () => {
    const trip = await seedTrip();
    const other = await tripRepo.create({ storeId: "s1", startedAt: Date.now() });
    const { item, line } = await addLine(other.id, "0042", "Milk", 3.99, 1);

    const result = await applyReceiptAnswer(trip.id, answer([receiptLine(line.id, 9)]));

    expect(result.changes).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
    expect((await db.tripItems.get(line.id))?.price).toBe(3.99);
    expect((await db.items.get(item.id))?.currentPrice).toBe(3.99);
  });

  it("gives a new trip the receipt's price when it scans a matched barcode", async () => {
    const trip = await seedTrip();
    const { line } = await addLine(trip.id, "0042", "Milk", 3.99, 1);
    await applyReceiptAnswer(trip.id, answer([receiptLine(line.id, 4.29)]));

    const next = await tripRepo.create({ storeId: "s1", startedAt: Date.now() + 1000 });
    const scanned = await itemRepo.findByBarcode("0042");
    expect(scanned?.currentPrice).toBe(4.29);
    const added = await tripItemRepo.addToTrip({
      tripId: next.id,
      itemId: scanned!.id,
      price: scanned!.currentPrice,
      quantity: 1,
      onSale: false,
    });
    expect(added.price).toBe(4.29);
    const history = await db.priceHistory.where("itemId").equals(scanned!.id).toArray();
    expect(history.map((entry) => entry.price)).toContain(4.29);
  });
});

describe("reconcileReceipt", () => {
  const request = { store: "Trader Joe's", lines: [] };
  const grind = { app: "trade-tracker", kind: "receipt-reconcile", v: "1.0" };

  function clientAnswering(record: grist.GristAnswer): ReceiptClient {
    return {
      send: vi.fn(async () => "direct:tx1"),
      awaitAnswer: vi.fn(async () => record),
    };
  }

  it("sends the request and photos as the receipt-reconcile input and returns the checked answer", async () => {
    const client = clientAnswering({
      re: "direct:tx1",
      status: "answered",
      answer: answer([], 9.99),
      grind,
    });
    const photos = [{ bytes: new Uint8Array([1]), mime: "image/jpeg" }];

    const outcome = await reconcileReceipt(client, request, photos);

    expect(outcome).toMatchObject({ ok: true, answer: { total: 9.99 } });
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: request, photos, clientId: expect.any(String) }),
    );
  });

  it("gives the reason of a refusal in words", async () => {
    const client = clientAnswering({ re: "x", status: "refused", reason: "Too dark.", grind });
    expect(await reconcileReceipt(client, request, [])).toEqual({
      ok: false,
      error: "The factory could not read the receipt: Too dark.",
    });
  });

  it("does not use an answer that is not in the schema's shape", async () => {
    const client = clientAnswering({ re: "x", status: "answered", answer: { total: "lots" }, grind });
    const outcome = await reconcileReceipt(client, request, []);
    expect(outcome.ok).toBe(false);
  });

  it("gives up with a plain sentence when the factory does not answer in time", async () => {
    const client: ReceiptClient = {
      send: vi.fn(async () => "direct:tx1"),
      awaitAnswer: (_txid, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
    };
    const outcome = await reconcileReceipt(client, request, [], { timeoutMs: 20 });
    expect(outcome).toMatchObject({ ok: false });
    expect(!outcome.ok && outcome.error).toContain("did not answer in time");
  });
});
