// jsdom's Blob does not survive fake-indexeddb's structured clone; Node's does.
import { Blob } from "node:buffer";
import { db } from "@/db/database";
import { PendingLookupRepository } from "./pending-lookup-repository";
import { TripRepository } from "./trip-repository";
import { TripItemRepository } from "./trip-item-repository";
import { ItemRepository } from "./item-repository";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

async function startTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Shop", createdAt: now, updatedAt: now });
  return tripRepo.create({ storeId: "s1", startedAt: now });
}

describe("PendingLookupRepository", () => {
  it("round-trips a pending lookup with its photos", async () => {
    const trip = await startTrip();
    const photo = new Blob(["front of the box"], { type: "image/jpeg" }) as unknown as globalThis.Blob;

    const created = await lookups.create({
      barcode: "0044",
      tripId: trip.id,
      photos: [photo],
    });

    const read = await lookups.getById(created.id);
    expect(read).toBeDefined();
    expect(read?.barcode).toBe("0044");
    expect(read?.tripId).toBe(trip.id);
    expect(read?.status).toBe("waiting-to-send");
    expect(read?.itemId).toBe(created.itemId);
    expect(typeof read?.createdAt).toBe("number");
    expect(read?.photos).toHaveLength(1);
    expect(read?.photos[0].type).toBe("image/jpeg");
    expect(read?.photos[0].size).toBe(photo.size);
    expect(await read?.photos[0].text()).toBe("front of the box");
  });

  it("puts a pending line in the trip that adds nothing to the subtotal", async () => {
    const trip = await startTrip();
    const milk = await itemRepo.create({
      barcode: "1",
      name: "Milk",
      currentPrice: 3,
      unitType: "each",
    });
    await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: milk.id,
      price: 3,
      quantity: 2,
      onSale: false,
    });

    const lookup = await lookups.create({
      barcode: "0044",
      tripId: trip.id,
      photos: [],
    });

    const lines = await tripItemRepo.getByTrip(trip.id);
    const pending = lines.find((l) => l.pending);
    expect(pending?.itemId).toBe(lookup.itemId);
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(6);
  });

  it("fill by hand marks the lookup applied and turns the line into an ordinary one", async () => {
    const trip = await startTrip();
    const lookup = await lookups.create({
      barcode: "0044",
      tripId: trip.id,
      photos: [new Blob(["x"]) as unknown as globalThis.Blob],
    });
    const item = await itemRepo.create({
      barcode: "0044",
      name: "Oat Bars",
      currentPrice: 4.25,
      unitType: "each",
    });

    await lookups.fillByHand(lookup.id, item);

    expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].pending).toBeUndefined();
    expect(lines[0].itemId).toBe(item.id);
    expect(lines[0].lineTotal).toBe(4.25);
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(4.25);
  });

  it("discard removes the lookup and its pending line", async () => {
    const trip = await startTrip();
    const lookup = await lookups.create({
      barcode: "0044",
      tripId: trip.id,
      photos: [],
    });

    await lookups.discard(lookup.id);

    expect(await lookups.getById(lookup.id)).toBeUndefined();
    expect(await tripItemRepo.getByTrip(trip.id)).toHaveLength(0);
  });

  it("a pending line that has been given a price counts toward the total", async () => {
    const trip = await startTrip();
    const lookup = await lookups.create({
      barcode: "0044",
      tripId: trip.id,
      photos: [],
    });
    const line = (await tripItemRepo.getByTrip(trip.id))[0];

    await tripItemRepo.update(line.id, { price: 2 });

    expect(lookup.id).toBeDefined();
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(2);
  });
});
