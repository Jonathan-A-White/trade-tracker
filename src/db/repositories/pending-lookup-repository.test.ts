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
  describe("quantity of a pending line", () => {
    it("setQuantity saves the quantity on the pending line at once", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0044", tripId: trip.id, photos: [] });

      await lookups.setQuantity(lookup.id, 3);

      const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.pending);
      expect(line?.quantity).toBe(3);
      expect(line?.itemId).toBe(lookup.itemId);
    });

    it("never goes below 1", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0044", tripId: trip.id, photos: [] });

      await lookups.setQuantity(lookup.id, 0);

      const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.pending);
      expect(line?.quantity).toBe(1);
    });

    it("does nothing for an unknown lookup", async () => {
      await expect(lookups.setQuantity("nope", 2)).resolves.toBeUndefined();
    });

    it("the item the factory fills in keeps that quantity and counts price x quantity", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0044", tripId: trip.id, photos: [] });
      await lookups.setQuantity(lookup.id, 2);

      await lookups.applyAnswer(lookup.id, {
        name: "Oat Bars",
        unitType: "each",
        category: "other",
        price: 4.25,
        confidence: "high",
      });

      const lines = await tripItemRepo.getByTrip(trip.id);
      expect(lines).toHaveLength(1);
      expect(lines[0].pending).toBeUndefined();
      expect(lines[0].quantity).toBe(2);
      expect(lines[0].lineTotal).toBe(8.5);
      expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(8.5);
    });

    it("fill by hand starts from that quantity", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0777", tripId: trip.id, photos: [] });
      await lookups.setQuantity(lookup.id, 3);
      const item = await itemRepo.create({
        barcode: "0777",
        name: "Oat Bars",
        currentPrice: 2,
        unitType: "each",
      });

      await lookups.fillByHand(lookup.id, item);

      const lines = await tripItemRepo.getByTrip(trip.id);
      expect(lines).toHaveLength(1);
      expect(lines[0].quantity).toBe(3);
      expect(lines[0].lineTotal).toBe(6);
    });

    it("the quantity survives a reload (it is in the database)", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0044", tripId: trip.id, photos: [] });
      await lookups.setQuantity(lookup.id, 4);

      const fresh = new TripItemRepository();
      expect((await fresh.getByTrip(trip.id))[0].quantity).toBe(4);
    });
  });
  describe("weight read from a per-pound label", () => {
    beforeEach(async () => {
      // the db singleton outlives the per-test IDBFactory, so start each test empty
      await Promise.all(db.tables.map((table) => table.clear()));
    });

    const chicken = {
      name: "Fresh Boneless Skinless Chicken Thighs",
      unitType: "per_lb" as const,
      category: "Meat & Seafood",
      price: 4.99,
      weightLbs: 2.03,
      size: "2.03 lb",
      confidence: "high" as const,
    };

    it("applyAnswer sets the line's weightLbs so the total is price x weight", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0055", tripId: trip.id, photos: [] });

      await lookups.applyAnswer(lookup.id, chicken);

      const lines = await tripItemRepo.getByTrip(trip.id);
      expect(lines).toHaveLength(1);
      expect(lines[0].weightLbs).toBe(2.03);
      expect(lines[0].price).toBe(4.99);
      expect(lines[0].lineTotal).toBeCloseTo(10.13, 2);
      expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBeCloseTo(10.13, 2);
    });

    it("a per_lb answer without a weight leaves the line as price x quantity", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0055", tripId: trip.id, photos: [] });
      await lookups.setQuantity(lookup.id, 2);

      await lookups.applyAnswer(lookup.id, { ...chicken, weightLbs: undefined });

      const [line] = await tripItemRepo.getByTrip(trip.id);
      expect(line.weightLbs).toBeUndefined();
      expect(line.lineTotal).toBeCloseTo(9.98, 2);
    });

    it("ignores a weight on an each item", async () => {
      const trip = await startTrip();
      const lookup = await lookups.create({ barcode: "0055", tripId: trip.id, photos: [] });

      await lookups.applyAnswer(lookup.id, { ...chicken, unitType: "each" });

      const [line] = await tripItemRepo.getByTrip(trip.id);
      expect(line.weightLbs).toBeUndefined();
      expect(line.lineTotal).toBe(4.99);
    });

    it("a price-only answer with a weight sets the weight on the item's per_lb line", async () => {
      const trip = await startTrip();
      const thighs = await itemRepo.create({
        barcode: "0055",
        name: "Chicken Thighs",
        currentPrice: 3.99,
        unitType: "per_lb",
      });
      await tripItemRepo.addToTrip({
        tripId: trip.id,
        itemId: thighs.id,
        price: 3.99,
        quantity: 1,
        onSale: false,
      });
      const lookup = await lookups.create({
        barcode: "0055",
        tripId: trip.id,
        photos: [],
        mode: "price-only",
        itemId: thighs.id,
      });

      await lookups.applyAnswer(lookup.id, chicken);

      const [line] = await tripItemRepo.getByTrip(trip.id);
      expect(line.price).toBe(4.99);
      expect(line.weightLbs).toBe(2.03);
      expect(line.lineTotal).toBeCloseTo(10.13, 2);
    });

    it("a price-only answer with a weight leaves an each item's line alone", async () => {
      const trip = await startTrip();
      const milk = await itemRepo.create({
        barcode: "0055",
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
        barcode: "0055",
        tripId: trip.id,
        photos: [],
        mode: "price-only",
        itemId: milk.id,
      });

      await lookups.applyAnswer(lookup.id, chicken);

      const [line] = await tripItemRepo.getByTrip(trip.id);
      expect(line.weightLbs).toBeUndefined();
      expect(line.lineTotal).toBe(9.98);
    });
  });
});
