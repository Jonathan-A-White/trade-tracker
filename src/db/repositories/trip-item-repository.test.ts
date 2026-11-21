import { db } from "@/db/database";
import { ItemRepository } from "./item-repository";
import { TripItemRepository } from "./trip-item-repository";
import { TripRepository } from "./trip-repository";

const itemRepo = new ItemRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

async function startTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  return tripRepo.create({ storeId: "s1", startedAt: now });
}

async function dressing(currentPrice = 0) {
  return itemRepo.create({
    barcode: "0099",
    name: "Reduced Sodium Italian Dressing",
    currentPrice,
    unitType: "each",
  });
}

describe("TripItemRepository.addToTrip with no price", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("gives a $0.00 item the last price paid here as a Guess, and the trip total counts it", async () => {
    const trip = await startTrip();
    const item = await dressing(0);
    await db.priceHistory.put({
      id: "h1",
      itemId: item.id,
      storeId: "s1",
      tripItemId: "old",
      price: 3.49,
      recordedAt: 1000,
    });

    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: item.currentPrice,
      quantity: 1,
      onSale: false,
    });

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(3.49);
    expect(saved?.lineTotal).toBeCloseTo(3.49, 2);
    expect(saved?.guess?.basis).toMatch(/last price here/i);
    expect(saved?.priceFlag).toBeUndefined();
    expect((await db.trips.get(trip.id))?.scannedSubtotal).toBeCloseTo(3.49, 2);
  });

  it("falls back to a price paid at another store", async () => {
    const trip = await startTrip();
    const item = await dressing(0);
    await db.priceHistory.put({
      id: "h1",
      itemId: item.id,
      storeId: "elsewhere",
      tripItemId: "old",
      price: 2.99,
      recordedAt: 1000,
    });

    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 0,
      quantity: 2,
      onSale: false,
    });

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(2.99);
    expect(saved?.lineTotal).toBeCloseTo(5.98, 2);
    expect(saved?.guess).toBeDefined();
  });

  it("ignores earlier $0.00 history entries when guessing", async () => {
    const trip = await startTrip();
    const item = await dressing(0);
    await db.priceHistory.put({
      id: "h1",
      itemId: item.id,
      storeId: "s1",
      tripItemId: "old",
      price: 4.19,
      recordedAt: 1000,
    });
    await db.priceHistory.put({
      id: "h2",
      itemId: item.id,
      storeId: "s1",
      tripItemId: "older",
      price: 0,
      recordedAt: 2000,
    });

    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 0,
      quantity: 1,
      onSale: false,
    });

    expect((await db.tripItems.get(line.id))?.price).toBe(4.19);
  });

  it("flags 'Add price' when no price was ever known, and writes no $0.00 history", async () => {
    const trip = await startTrip();
    const item = await dressing(0);

    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 0,
      quantity: 1,
      onSale: false,
    });

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(0);
    expect(saved?.guess).toBeUndefined();
    expect(saved?.priceFlag).toBe("add");
    expect(await db.priceHistory.count()).toBe(0);
  });

  it("a real price is kept as it is: no Guess, no flag, one history entry", async () => {
    const trip = await startTrip();
    const item = await dressing(3.99);

    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 3.99,
      quantity: 1,
      onSale: false,
    });

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(3.99);
    expect(saved?.guess).toBeUndefined();
    expect(saved?.priceFlag).toBeUndefined();
    expect(await db.priceHistory.count()).toBe(1);
  });

  it("adding the item again with no price keeps the price the line already has", async () => {
    const trip = await startTrip();
    const item = await dressing(0);
    const first = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 4.5,
      quantity: 1,
      onSale: false,
    });

    await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 0,
      quantity: 1,
      onSale: false,
    });

    const saved = await db.tripItems.get(first.id);
    expect(saved?.price).toBe(4.5);
    expect(saved?.quantity).toBe(2);
    expect(saved?.lineTotal).toBeCloseTo(9, 2);
  });
});
