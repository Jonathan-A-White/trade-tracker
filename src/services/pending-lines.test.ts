import { Blob } from "node:buffer";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { exportTripsAsCsv } from "./csv-export-service";
import { exportAllData, exportTripsData } from "./export-service";
import { exportTripForAI } from "./trip-exchange-service";
import { importAllData } from "./import-service";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

async function seedTripWithMilkAndPending() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
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
    quantity: 1,
    onSale: false,
  });
  const lookup = await lookups.create({
    barcode: "0099887766",
    tripId: trip.id,
    photos: [new Blob(["photo"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
  });
  return { trip, lookup };
}

describe("pending lines in the CSV export and the import", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("leaves a pending line with no price out of the trips CSV", async () => {
    await seedTripWithMilkAndPending();
    const rows = (await exportTripsAsCsv()).split("\n");
    expect(rows).toHaveLength(2); // header + Milk
    expect(rows[1]).toContain("Milk");
    expect(rows.join("\n")).not.toContain("Unknown Item");
  });

  it("clears the pending lookups when an import replaces the trip items", async () => {
    const { trip } = await seedTripWithMilkAndPending();
    const backup = await exportAllData();
    expect(await lookups.listByTrip(trip.id)).toHaveLength(1);

    await importAllData(backup);

    expect(await db.pendingLookups.count()).toBe(0);
  });

  it("leaves a pending line with no price out of the JSON backup", async () => {
    await seedTripWithMilkAndPending();
    const backup = JSON.parse(await exportAllData());
    expect(backup.tripItems).toHaveLength(1);
    expect(backup.tripItems[0].pending).toBeUndefined();
    expect(backup.tripItems[0].price).toBe(3);
  });

  it("leaves a pending line with no price out of the trips JSON export", async () => {
    await seedTripWithMilkAndPending();
    const backup = JSON.parse(await exportTripsData());
    expect(backup.tripItems).toHaveLength(1);
    expect(backup.tripItems[0].price).toBe(3);
  });

  it("restores a backup without an 'Unknown Item' line or a lookup", async () => {
    const { trip } = await seedTripWithMilkAndPending();
    const backup = await exportAllData();

    await importAllData(backup);

    const lines = await db.tripItems.where("tripId").equals(trip.id).toArray();
    expect(lines).toHaveLength(1);
    const item = await db.items.get(lines[0].itemId);
    expect(item?.name).toBe("Milk");
    expect(lines.some((line) => line.pending)).toBe(false);
    expect(await db.pendingLookups.count()).toBe(0);
  });

  it("keeps a pending line that has a price in the JSON backup", async () => {
    await seedTripWithMilkAndPending();
    const pending = await db.tripItems.filter((line) => line.pending === true).first();
    await db.tripItems.update(pending!.id, { price: 2.5 });

    const backup = JSON.parse(await exportAllData());

    expect(backup.tripItems).toHaveLength(2);
  });

  it("leaves a pending line with no price out of exportTripForAI", async () => {
    const { trip } = await seedTripWithMilkAndPending();
    const data = JSON.parse(await exportTripForAI(trip.id));
    expect(data.example.items).toHaveLength(1);
    expect(data.example.items[0].name).toBe("Milk");
    expect(data.example.tripItems).toHaveLength(1);
    expect(data.example.tripItems[0].itemIndex).toBe(0);
  });
});
