import { db } from "@/db/database";
import type { Store, Item, Trip, TripItem } from "@/contracts/types";
import {
  exportTripForAI,
  validateTripImportData,
  importTripFromAI,
  isManualBarcode,
  nameSimilarity,
  findItemByDescriptionAndPrice,
} from "./trip-exchange-service";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function makeStore(overrides?: Partial<Store>): Store {
  return {
    id: crypto.randomUUID(),
    name: "Test Store",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeItem(overrides?: Partial<Item>): Item {
  return {
    id: crypto.randomUUID(),
    barcode: crypto.randomUUID(),
    name: "Test Item",
    currentPrice: 2.99,
    unitType: "each",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTrip(storeId: string, overrides?: Partial<Trip>): Trip {
  return {
    id: crypto.randomUUID(),
    storeId,
    status: "completed",
    startedAt: Date.now(),
    endedAt: Date.now(),
    scannedSubtotal: 5.98,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTripItem(tripId: string, itemId: string, overrides?: Partial<TripItem>): TripItem {
  return {
    id: crypto.randomUUID(),
    tripId,
    itemId,
    price: 2.99,
    quantity: 1,
    lineTotal: 2.99,
    onSale: false,
    addedAt: Date.now(),
    ...overrides,
  };
}

describe("isManualBarcode", () => {
  it("returns true for manual barcodes", () => {
    expect(isManualBarcode("manual-abc123")).toBe(true);
  });

  it("returns false for real barcodes", () => {
    expect(isManualBarcode("0123456789")).toBe(false);
  });
});

describe("exportTripForAI", () => {
  it("exports a trip with store, items, and instructions", async () => {
    const store = makeStore({ name: "Trader Joe's" });
    const item1 = makeItem({ name: "Organic Bananas", currentPrice: 0.29 });
    const item2 = makeItem({ name: "Almond Milk", currentPrice: 3.49 });
    const trip = makeTrip(store.id, { scannedSubtotal: 3.78 });
    const ti1 = makeTripItem(trip.id, item1.id, { price: 0.29, lineTotal: 0.29 });
    const ti2 = makeTripItem(trip.id, item2.id, { price: 3.49, lineTotal: 3.49 });

    await db.stores.put(store);
    await db.items.bulkPut([item1, item2]);
    await db.trips.put(trip);
    await db.tripItems.bulkPut([ti1, ti2]);

    const json = await exportTripForAI(trip.id);
    const data = JSON.parse(json);

    expect(data.type).toBe("trip-exchange");
    expect(data.version).toBe(1);
    expect(data.instructions).toContain("trip-import");
    expect(data.example.store.name).toBe("Trader Joe's");
    expect(data.example.items).toHaveLength(2);
    expect(data.example.tripItems).toHaveLength(2);
    const itemNames = data.example.items.map((i: { name: string }) => i.name);
    expect(itemNames).toContain("Organic Bananas");
    expect(itemNames).toContain("Almond Milk");
  });

  it("sets barcode to null for manual-barcode items", async () => {
    const store = makeStore();
    const item = makeItem({ barcode: "manual-abc123", name: "Receipt Item" });
    const trip = makeTrip(store.id);
    const ti = makeTripItem(trip.id, item.id);

    await db.stores.put(store);
    await db.items.put(item);
    await db.trips.put(trip);
    await db.tripItems.put(ti);

    const json = await exportTripForAI(trip.id);
    const data = JSON.parse(json);

    expect(data.example.items[0].barcode).toBeNull();
  });

  it("includes per-item bottleDeposit and taxable flag", async () => {
    const store = makeStore({ name: "Stop & Shop", state: "CT" });
    const soda = makeItem({ name: "Seltzer 12-pack" });
    const candy = makeItem({ name: "Swedish Fish" });
    const trip = makeTrip(store.id);
    const tiSoda = makeTripItem(trip.id, soda.id, {
      taxOverride: false,
      bottleDeposit: 0.6,
    });
    const tiCandy = makeTripItem(trip.id, candy.id, { taxOverride: true });

    await db.stores.put(store);
    await db.items.bulkPut([soda, candy]);
    await db.trips.put(trip);
    await db.tripItems.bulkPut([tiSoda, tiCandy]);

    const data = JSON.parse(await exportTripForAI(trip.id));

    const tripItems = data.example.tripItems as Array<{
      taxable?: boolean;
      bottleDeposit?: number;
    }>;
    const flags = tripItems.map((t) => t.taxable);
    expect(flags).toContain(false);
    expect(flags).toContain(true);
    const deposits = tripItems.map((t) => t.bottleDeposit);
    expect(deposits).toContain(0.6);
  });
});

describe("validateTripImportData", () => {
  const validData = {
    type: "trip-import",
    version: 1,
    store: { name: "Trader Joe's" },
    trip: { actualTotal: 25.0 },
    items: [
      { name: "Bananas", currentPrice: 0.29, unitType: "each" },
    ],
    tripItems: [
      { itemIndex: 0, price: 0.29, quantity: 2, onSale: false },
    ],
  };

  it("passes for valid data", () => {
    const result = validateTripImportData(validData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails for non-object", () => {
    const result = validateTripImportData("string");
    expect(result.valid).toBe(false);
  });

  it("fails for wrong type", () => {
    const result = validateTripImportData({ ...validData, type: "wrong" });
    expect(result.valid).toBe(false);
  });

  it("fails for missing store name", () => {
    const result = validateTripImportData({ ...validData, store: { name: "" } });
    expect(result.valid).toBe(false);
  });

  it("fails for invalid item", () => {
    const result = validateTripImportData({
      ...validData,
      items: [{ name: "", currentPrice: -1, unitType: "wrong" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("fails for out-of-range itemIndex", () => {
    const result = validateTripImportData({
      ...validData,
      tripItems: [{ itemIndex: 5, price: 1, quantity: 1, onSale: false }],
    });
    expect(result.valid).toBe(false);
  });
});

describe("importTripFromAI", () => {
  const validImport = {
    type: "trip-import",
    version: 1,
    store: { name: "Trader Joe's", city: "Portland", state: "OR" },
    trip: {
      startedAt: "2025-01-15T10:30:00Z",
      actualTotal: 12.47,
      note: "Weekly groceries",
    },
    items: [
      { name: "Organic Bananas", barcode: null, currentPrice: 0.29, unitType: "each", category: "produce" },
      { name: "Almond Milk", barcode: null, currentPrice: 3.49, unitType: "each", category: "dairy" },
    ],
    tripItems: [
      { itemIndex: 0, price: 0.29, quantity: 3, onSale: false },
      { itemIndex: 1, price: 3.49, quantity: 1, onSale: true },
    ],
  };

  it("imports a trip with new store and items", async () => {
    const result = await importTripFromAI(JSON.stringify(validImport));

    expect(result.storeCreated).toBe(true);
    expect(result.itemsCreated).toBe(2);
    expect(result.itemsMissingBarcode).toBe(2);

    // Verify trip was created
    const trip = await db.trips.get(result.tripId);
    expect(trip).toBeDefined();
    expect(trip!.status).toBe("completed");
    expect(trip!.actualTotal).toBe(12.47);
    expect(trip!.note).toBe("Weekly groceries");

    // Verify subtotal was calculated: 0.29*3 + 3.49*1 = 4.36
    expect(trip!.scannedSubtotal).toBeCloseTo(4.36, 2);

    // Verify items were created with manual barcodes
    const items = await db.items.toArray();
    expect(items).toHaveLength(2);
    expect(items.every((i) => isManualBarcode(i.barcode))).toBe(true);

    // Verify trip items
    const tripItems = await db.tripItems.where("tripId").equals(result.tripId).toArray();
    expect(tripItems).toHaveLength(2);

    // Verify price history was created
    const priceHistory = await db.priceHistory.toArray();
    expect(priceHistory).toHaveLength(2);
  });

  it("matches existing store by name (case-insensitive)", async () => {
    const store = makeStore({ name: "Trader Joe's" });
    await db.stores.put(store);

    const result = await importTripFromAI(JSON.stringify(validImport));

    expect(result.storeCreated).toBe(false);

    const trip = await db.trips.get(result.tripId);
    expect(trip!.storeId).toBe(store.id);
  });

  it("matches existing items by barcode", async () => {
    const existingItem = makeItem({ barcode: "1234567890", name: "Organic Bananas" });
    await db.items.put(existingItem);

    const importData = {
      ...validImport,
      items: [
        { name: "Organic Bananas", barcode: "1234567890", currentPrice: 0.29, unitType: "each" },
        { name: "Almond Milk", barcode: null, currentPrice: 3.49, unitType: "each" },
      ],
    };

    const result = await importTripFromAI(JSON.stringify(importData));

    expect(result.itemsMatched).toBe(1);
    expect(result.itemsCreated).toBe(1);
  });

  it("handles weight-based items", async () => {
    const importData = {
      type: "trip-import",
      version: 1,
      store: { name: "Test Store" },
      trip: { actualTotal: 5.99 },
      items: [
        { name: "Chicken Breast", barcode: null, currentPrice: 3.99, unitType: "per_lb" },
      ],
      tripItems: [
        { itemIndex: 0, price: 3.99, quantity: 1, weightLbs: 1.5, onSale: false },
      ],
    };

    const result = await importTripFromAI(JSON.stringify(importData));

    const tripItems = await db.tripItems.where("tripId").equals(result.tripId).toArray();
    expect(tripItems[0].weightLbs).toBe(1.5);
    // lineTotal = 3.99 * 1.5 = 5.985
    expect(tripItems[0].lineTotal).toBeCloseTo(5.985, 2);
  });

  it("persists per-item taxable and bottleDeposit", async () => {
    const importData = {
      type: "trip-import",
      version: 1,
      store: { name: "Stop & Shop", state: "CT" },
      trip: { actualTotal: 10.6 },
      items: [
        { name: "Seltzer 12-pack", barcode: null, currentPrice: 5.99, unitType: "each", category: "beverages" },
        { name: "Paper Towels", barcode: null, currentPrice: 4.0, unitType: "each", category: "household" },
      ],
      tripItems: [
        { itemIndex: 0, price: 5.99, quantity: 1, onSale: false, taxable: false, bottleDeposit: 0.6 },
        { itemIndex: 1, price: 4.0, quantity: 1, onSale: false, taxable: true },
      ],
    };

    const result = await importTripFromAI(JSON.stringify(importData));
    const tripItems = await db.tripItems.where("tripId").equals(result.tripId).toArray();
    const byPrice = new Map(tripItems.map((t) => [t.price, t]));

    expect(byPrice.get(5.99)!.bottleDeposit).toBe(0.6);
    expect(byPrice.get(5.99)!.taxOverride).toBe(false);
    expect(byPrice.get(4.0)!.taxOverride).toBe(true);
    expect(byPrice.get(4.0)!.bottleDeposit).toBeUndefined();
  });

  it("rejects negative bottleDeposit", () => {
    const bad = {
      type: "trip-import",
      version: 1,
      store: { name: "Stop & Shop" },
      trip: {},
      items: [{ name: "Seltzer", currentPrice: 5.99, unitType: "each" }],
      tripItems: [{ itemIndex: 0, price: 5.99, quantity: 1, onSale: false, bottleDeposit: -1 }],
    };
    const result = validateTripImportData(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("bottleDeposit"))).toBe(true);
  });

  it("rejects non-boolean taxable", () => {
    const bad = {
      type: "trip-import",
      version: 1,
      store: { name: "Store" },
      trip: {},
      items: [{ name: "Item", currentPrice: 1, unitType: "each" }],
      tripItems: [{ itemIndex: 0, price: 1, quantity: 1, onSale: false, taxable: "yes" }],
    };
    const result = validateTripImportData(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("taxable"))).toBe(true);
  });

  it("parses ISO date string for startedAt", async () => {
    const result = await importTripFromAI(JSON.stringify(validImport));
    const trip = await db.trips.get(result.tripId);
    const expected = new Date("2025-01-15T10:30:00Z").getTime();
    expect(trip!.startedAt).toBe(expected);
  });

  it("reuses an existing item by description + price when the import has no barcode", async () => {
    // Existing item with a real (scanned) barcode.
    const existing = makeItem({
      barcode: "0123456789012",
      name: "Almond Milk",
      currentPrice: 3.49,
    });
    await db.items.put(existing);

    const importData = {
      ...validImport,
      items: [
        { name: "Organic Bananas", barcode: null, currentPrice: 0.29, unitType: "each" },
        // Same product/price as the existing item, no barcode on the receipt.
        { name: "Almond milk", barcode: null, currentPrice: 3.49, unitType: "each" },
      ],
    };

    const result = await importTripFromAI(JSON.stringify(importData));

    // Bananas created; Almond Milk matched to the existing item, not duplicated.
    expect(result.itemsMatched).toBe(1);
    expect(result.itemsCreated).toBe(1);
    expect(result.itemsMissingBarcode).toBe(1);

    // No duplicate "Almond Milk" item was created.
    const almondMilks = await db.items
      .filter((i) => i.name.toLowerCase().includes("almond milk"))
      .toArray();
    expect(almondMilks).toHaveLength(1);

    // The imported line links to the existing item, so it carries the real barcode.
    const tripItems = await db.tripItems.where("tripId").equals(result.tripId).toArray();
    const linkedItemIds = tripItems.map((t) => t.itemId);
    expect(linkedItemIds).toContain(existing.id);
  });

  it("matches fuzzily when the receipt name has extra words but the price matches", async () => {
    const existing = makeItem({
      barcode: "9990001112223",
      name: "Almond Milk",
      currentPrice: 3.49,
    });
    await db.items.put(existing);

    const importData = {
      ...validImport,
      items: [
        { name: "Almond Milk Unsweetened 64oz", barcode: null, currentPrice: 3.49, unitType: "each" },
      ],
      tripItems: [{ itemIndex: 0, price: 3.49, quantity: 1, onSale: false }],
    };

    const result = await importTripFromAI(JSON.stringify(importData));
    expect(result.itemsMatched).toBe(1);
    expect(result.itemsCreated).toBe(0);
  });

  it("does not reuse an existing item when the price differs", async () => {
    const existing = makeItem({
      barcode: "0123456789012",
      name: "Almond Milk",
      currentPrice: 3.49,
    });
    await db.items.put(existing);

    const importData = {
      ...validImport,
      items: [
        { name: "Almond Milk", barcode: null, currentPrice: 2.0, unitType: "each" },
      ],
      tripItems: [{ itemIndex: 0, price: 2.0, quantity: 1, onSale: false }],
    };

    const result = await importTripFromAI(JSON.stringify(importData));
    expect(result.itemsMatched).toBe(0);
    expect(result.itemsCreated).toBe(1);
    expect(result.itemsMissingBarcode).toBe(1);
  });

  it("adopts a real barcode onto a placeholder item matched by description + price", async () => {
    const placeholder = makeItem({
      barcode: "manual-old-uuid",
      name: "Shaved Beef Steak",
      currentPrice: 11.65,
    });
    await db.items.put(placeholder);

    const importData = {
      ...validImport,
      items: [
        { name: "Shaved Beef Steak", barcode: "0044700000000", currentPrice: 11.65, unitType: "each" },
      ],
      tripItems: [{ itemIndex: 0, price: 11.65, quantity: 1, onSale: false }],
    };

    const result = await importTripFromAI(JSON.stringify(importData));
    expect(result.itemsMatched).toBe(1);
    expect(result.itemsCreated).toBe(0);

    const updated = await db.items.get(placeholder.id);
    expect(updated!.barcode).toBe("0044700000000");
    expect(isManualBarcode(updated!.barcode)).toBe(false);
  });
});

describe("nameSimilarity", () => {
  it("scores identical normalized names as 1", () => {
    expect(nameSimilarity("Almond Milk", "almond milk")).toBe(1);
    expect(nameSimilarity("Shaved  Beef Steak", "shaved beef steak")).toBe(1);
  });

  it("tolerates extra words via token containment", () => {
    expect(nameSimilarity("Almond Milk", "Almond Milk 64oz")).toBe(1);
  });

  it("scores clearly different products low", () => {
    expect(nameSimilarity("Almond Milk", "Almond Butter")).toBeLessThan(0.6);
  });

  it("returns 0 for empty names", () => {
    expect(nameSimilarity("", "Milk")).toBe(0);
  });
});

describe("findItemByDescriptionAndPrice", () => {
  it("returns undefined when nothing matches", async () => {
    await db.items.put(makeItem({ name: "Bananas", currentPrice: 0.29 }));
    const match = await findItemByDescriptionAndPrice("Almond Milk", 3.49);
    expect(match).toBeUndefined();
  });

  it("prefers a real barcode over a placeholder on equal name match", async () => {
    const placeholder = makeItem({
      barcode: "manual-xyz",
      name: "Almond Milk",
      currentPrice: 3.49,
    });
    const real = makeItem({
      barcode: "0123456789012",
      name: "Almond Milk",
      currentPrice: 3.49,
    });
    await db.items.bulkPut([placeholder, real]);

    const match = await findItemByDescriptionAndPrice("Almond Milk", 3.49);
    expect(match!.id).toBe(real.id);
  });
});

describe("reimportTripFromAI and pending lookups", () => {
  it("deletes the pending lookups of the trip whose items it replaces", async () => {
    const { reimportTripFromAI } = await import("./trip-exchange-service");
    const store = makeStore();
    await db.stores.add(store);
    const trip = makeTrip(store.id);
    await db.trips.add(trip);
    await db.pendingLookups.put({
      id: "l1",
      barcode: "0099887766",
      tripId: trip.id,
      itemId: "pending:l1",
      photos: [],
      status: "waiting-to-send",
      createdAt: Date.now(),
    });
    const json = JSON.stringify({
      type: "trip-import",
      store: { name: "Test Store" },
      trip: { startedAt: new Date().toISOString() },
      items: [{ name: "Milk", barcode: "123456789012", currentPrice: 2, unitType: "each" }],
      tripItems: [{ itemIndex: 0, price: 2, quantity: 1, onSale: false }],
    });
    await reimportTripFromAI(trip.id, json);
    expect(await db.pendingLookups.where("tripId").equals(trip.id).count()).toBe(0);
  });
});
