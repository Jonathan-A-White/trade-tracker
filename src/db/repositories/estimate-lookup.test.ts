import { db } from "@/db/database";
import type { ItemFromPhotosAnswer } from "@/contracts/types";
import { PendingLookupRepository } from "./pending-lookup-repository";
import { TripRepository } from "./trip-repository";
import { TripItemRepository } from "./trip-item-repository";
import { ItemRepository } from "./item-repository";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

beforeEach(async () => {
  // the db singleton outlives the per-test IDBFactory, so start each test empty
  await Promise.all(db.tables.map((table) => table.clear()));
});

const estimateAnswer: ItemFromPhotosAnswer = {
  name: "Trader Joe's Reduced Sodium Italian Dressing",
  category: "Condiments & Sauces",
  unitType: "each",
  price: null,
  estimatedPrice: 3.49,
  estimateNote: "Typical price for a bottle of dressing.",
  confidence: "medium",
};

/** A trip with one line priced $0.00 (his 'clearly wrong' price) on an item whose stored price is 2.99. */
async function wrongPriceLine() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Shop", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const item = await itemRepo.create({
    barcode: "0123",
    name: "Italian Dressing",
    currentPrice: 2.99,
    unitType: "each",
  });
  const line = await tripItemRepo.addToTrip({
    tripId: trip.id,
    itemId: item.id,
    price: 0.01,
    quantity: 2,
    onSale: false,
  });
  return { trip, item, line };
}

describe("Use an estimate: asking", () => {
  it("drops the line's price, keeps the item's, and queues an estimate lookup for the factory", async () => {
    const { trip, item, line } = await wrongPriceLine();

    const lookup = await lookups.askForEstimate(line.id);

    expect(lookup?.mode).toBe("estimate");
    expect(lookup?.status).toBe("waiting-to-send");
    expect(lookup?.itemId).toBe(item.id);
    expect(lookup?.barcode).toBe("0123");
    expect(lookup?.photos).toEqual([]);
    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(0);
    expect(saved?.lineTotal).toBe(0);
    expect(saved?.guess).toBeUndefined();
    expect(saved?.quantity).toBe(2);
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(0);
    expect((await db.items.get(item.id))?.currentPrice).toBe(2.99);
  });

  it("a second ask for the same item on the trip replaces an earlier answered or failed one", async () => {
    const { line } = await wrongPriceLine();
    const first = await lookups.askForEstimate(line.id);
    await lookups.markFailed(first!.id, "No.");

    const second = await lookups.askForEstimate(line.id);

    expect(await lookups.getById(first!.id)).toBeUndefined();
    expect(await lookups.getById(second!.id)).toBeDefined();
  });

  it("does nothing for a line that is not there", async () => {
    expect(await lookups.askForEstimate("nope")).toBeUndefined();
  });
});

describe("Use an estimate: the answer", () => {
  it("shows the factory's price as a Guess with its note, counts it in the total, leaves the item's price", async () => {
    const { trip, item, line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;

    await lookups.applyAnswer(lookup.id, estimateAnswer);

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(3.49);
    expect(saved?.guess).toEqual({ basis: "Typical price for a bottle of dressing." });
    expect(saved?.priceFlag).toBeUndefined();
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBeCloseTo(6.98);
    expect((await db.items.get(item.id))?.currentPrice).toBe(2.99);
    expect(await db.priceHistory.where("itemId").equals(item.id).count()).toBe(1); // the scan's own entry only
    expect((await lookups.getById(lookup.id))?.status).toBe("applied");
  });

  it("does not use the item's or the line's last price, only the factory's", async () => {
    const { line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;

    await lookups.applyAnswer(lookup.id, { ...estimateAnswer, estimatedPrice: 5.25, estimateNote: undefined });

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(5.25);
    expect(saved?.guess?.basis).toBe("The factory's estimate.");
  });

  it("an answer with no estimate fails the lookup with a reason and leaves the line to be priced", async () => {
    const { line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;

    await lookups.applyAnswer(lookup.id, { ...estimateAnswer, estimatedPrice: undefined });

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(0);
    expect(saved?.priceFlag).toBe("add");
    const read = await lookups.getById(lookup.id);
    expect(read?.status).toBe("failed");
    expect(read?.error).toMatch(/estimate/i);
  });

  it("an estimate for the wrong unit is not used", async () => {
    const { line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;

    await lookups.applyAnswer(lookup.id, { ...estimateAnswer, unitType: "per_lb" });

    expect((await db.tripItems.get(line.id))?.price).toBe(0);
    expect((await lookups.getById(lookup.id))?.status).toBe("failed");
  });

  it("does not overwrite a price he typed while the factory was thinking", async () => {
    const { line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;
    await tripItemRepo.update(line.id, { price: 4.1 });

    await lookups.applyAnswer(lookup.id, estimateAnswer);

    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(4.1);
    expect(saved?.guess).toBeUndefined();
    expect((await lookups.getById(lookup.id))?.status).toBe("applied");
  });

  it("discard removes only the lookup and leaves the line", async () => {
    const { line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;

    const discarded = await lookups.discard(lookup.id);

    expect(discarded?.line).toBeUndefined();
    expect(await lookups.getById(lookup.id)).toBeUndefined();
    expect(await db.tripItems.get(line.id)).toBeDefined();
  });

  it("a failed estimate flags the line 'Add price'", async () => {
    const { line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;

    await lookups.markFailed(lookup.id, "The factory could not estimate this one.");

    expect((await db.tripItems.get(line.id))?.priceFlag).toBe("add");
  });

  it("lists estimate lookups with the price-only ones as the lookups a line can be waiting on", async () => {
    const { trip, line } = await wrongPriceLine();
    const lookup = (await lookups.askForEstimate(line.id))!;
    expect((await lookups.listLineLookupsByTrip(trip.id)).map((l) => l.id)).toEqual([lookup.id]);
  });
});
