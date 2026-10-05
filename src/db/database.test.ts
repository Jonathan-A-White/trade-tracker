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

    expect(upgraded.verno).toBe(7);
    expect((await upgraded.stores.get("s1"))?.name).toBe("Stop & Shop");
    expect((await upgraded.items.get("i1"))?.barcode).toBe("0123");
    const line = await upgraded.tripItems.get("ti1");
    expect(line?.lineTotal).toBe(7);
    expect(line?.pending).toBeUndefined();
    expect(await upgraded.pendingLookups.count()).toBe(0);
    upgraded.close();
  });
});
