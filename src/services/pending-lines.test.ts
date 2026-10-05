import { Blob } from "node:buffer";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { exportTripsAsCsv } from "./csv-export-service";
import { exportAllData } from "./export-service";
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
});
