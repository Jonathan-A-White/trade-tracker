import Dexie from "dexie";
import { TradeTrackerDB } from "./database";

describe("TradeTrackerDB upgrade to version 7", () => {
  it("keeps existing data when upgrading from version 6 and adds pendingLookups", async () => {
    // Build the version 6 database exactly as the previous release left it.
    const old = new Dexie("TradeTrackerDB");
    old.version(1).stores({
      stores: "id, name, createdAt",
      items: "id, &barcode, name, category, createdAt",
      trips: "id, storeId, status, startedAt, [storeId+status], createdAt",
      tripItems: "id, tripId, itemId, [tripId+itemId], addedAt",
      priceHistory: "id, itemId, storeId, [itemId+storeId], recordedAt",
    });
    old.version(5).stores({
      priceHistory:
        "id, itemId, storeId, [itemId+storeId], recordedAt, tripItemId",
    });
    old.version(6).stores({});
    await old.open();
    await old.table("stores").put({
      id: "s1",
      name: "Stop & Shop",
      createdAt: 1,
      updatedAt: 1,
    });
    await old.table("items").put({
      id: "i1",
      barcode: "0123",
      name: "Milk",
      currentPrice: 3.5,
      unitType: "each",
      createdAt: 1,
      updatedAt: 1,
    });
    await old.table("tripItems").put({
      id: "ti1",
      tripId: "t1",
      itemId: "i1",
      price: 3.5,
      quantity: 2,
      lineTotal: 7,
      onSale: false,
      addedAt: 1,
    });
    old.close();

    const upgraded = new TradeTrackerDB();
    await upgraded.open();

    expect(upgraded.verno).toBe(8);
    expect((await upgraded.stores.get("s1"))?.name).toBe("Stop & Shop");
    expect((await upgraded.items.get("i1"))?.barcode).toBe("0123");
    const line = await upgraded.tripItems.get("ti1");
    expect(line?.lineTotal).toBe(7);
    expect(line?.pending).toBeUndefined();
    expect(await upgraded.pendingLookups.count()).toBe(0);
    upgraded.close();
  });
});

describe("TradeTrackerDB upgrade to version 8", () => {
  it("keeps existing trips when upgrading from version 7 and lets a trip carry its receipt result", async () => {
    // Build the version 7 database exactly as the previous release left it.
    const old = new Dexie("TradeTrackerDB");
    old.version(1).stores({
      stores: "id, name, createdAt",
      items: "id, &barcode, name, category, createdAt",
      trips: "id, storeId, status, startedAt, [storeId+status], createdAt",
      tripItems: "id, tripId, itemId, [tripId+itemId], addedAt",
      priceHistory: "id, itemId, storeId, [itemId+storeId], recordedAt",
    });
    old.version(5).stores({
      priceHistory:
        "id, itemId, storeId, [itemId+storeId], recordedAt, tripItemId",
    });
    old.version(7).stores({
      pendingLookups: "id, tripId, barcode, status, createdAt",
    });
    await old.open();
    await old.table("trips").put({
      id: "t1",
      storeId: "s1",
      status: "active",
      startedAt: 1,
      scannedSubtotal: 7,
      budget: 50,
      createdAt: 1,
      updatedAt: 1,
    });
    await old.table("tripItems").put({
      id: "ti1",
      tripId: "t1",
      itemId: "i1",
      price: 3.5,
      quantity: 2,
      lineTotal: 7,
      onSale: false,
      addedAt: 1,
    });
    old.close();

    const upgraded = new TradeTrackerDB();
    await upgraded.open();

    expect(upgraded.verno).toBe(8);
    const trip = await upgraded.trips.get("t1");
    expect(trip?.scannedSubtotal).toBe(7);
    expect(trip?.budget).toBe(50);
    expect(trip?.receiptReconcile).toBeUndefined();
    expect((await upgraded.tripItems.get("ti1"))?.lineTotal).toBe(7);

    await upgraded.trips.update("t1", {
      receiptReconcile: {
        changes: [],
        unmatched: [],
        added: [],
        matchedTripItemIds: ["ti1"],
        total: 7,
        unreadable: null,
      },
    });
    expect((await upgraded.trips.get("t1"))?.receiptReconcile?.matchedTripItemIds).toEqual(["ti1"]);
    upgraded.close();
  });
});
