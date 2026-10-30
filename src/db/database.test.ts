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

    expect(upgraded.verno).toBe(11);
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

    expect(upgraded.verno).toBe(11);
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

describe("TradeTrackerDB upgrade to version 9", () => {
  it("keeps existing data when upgrading from version 8 and adds the YNAB tables", async () => {
    // Build the version 8 database exactly as the previous release left it.
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
    old.version(8).stores({});
    await old.open();
    await old.table("stores").put({ id: "s1", name: "Stop & Shop", createdAt: 1, updatedAt: 1 });
    await old.table("trips").put({
      id: "t1",
      storeId: "s1",
      status: "active",
      startedAt: 1,
      scannedSubtotal: 7,
      createdAt: 1,
      updatedAt: 1,
    });
    old.close();

    const upgraded = new TradeTrackerDB();
    await upgraded.open();

    expect(upgraded.verno).toBe(11);
    expect((await upgraded.stores.get("s1"))?.name).toBe("Stop & Shop");
    expect((await upgraded.trips.get("t1"))?.scannedSubtotal).toBe(7);
    expect(await upgraded.ynabConnection.count()).toBe(0);
    expect(await upgraded.ynabCategories.count()).toBe(0);
    expect(await upgraded.ynabAccounts.count()).toBe(0);
    expect(await upgraded.ynabPayees.count()).toBe(0);

    await upgraded.ynabCategories.put({ id: "c1", groupId: "g1", groupName: "Food", name: "Groceries", hidden: false });
    expect((await upgraded.ynabCategories.where("groupId").equals("g1").toArray()).map((c) => c.name)).toEqual(["Groceries"]);
    upgraded.close();
  });
});

describe("TradeTrackerDB upgrade to version 10", () => {
  it("keeps existing data when upgrading from version 9 and adds the YNAB outbox and links", async () => {
    // Build the version 9 database exactly as the previous release left it.
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
    old.version(8).stores({});
    old.version(9).stores({
      ynabConnection: "id",
      ynabCategories: "id, groupId",
      ynabAccounts: "id",
      ynabPayees: "id",
    });
    await old.open();
    await old.table("stores").put({ id: "s1", name: "Stop & Shop", createdAt: 1, updatedAt: 1 });
    await old.table("ynabConnection").put({
      id: "connection",
      budgetId: "b1",
      budgetName: "Our Budget",
      connectedAt: 1,
      categoriesKnowledge: 3,
      accountsKnowledge: 3,
      payeesKnowledge: 3,
    });
    old.close();

    const upgraded = new TradeTrackerDB();
    await upgraded.open();

    expect(upgraded.verno).toBe(11);
    expect((await upgraded.stores.get("s1"))?.name).toBe("Stop & Shop");
    expect((await upgraded.ynabConnection.get("connection"))?.budgetName).toBe("Our Budget");
    expect(await upgraded.ynabOutbox.count()).toBe(0);
    expect(await upgraded.ynabLinks.count()).toBe(0);

    await upgraded.ynabOutbox.put({
      clientId: "c1",
      payload: { kind: "delete", localId: "l1" },
      stage: "waiting",
      queuedAt: 5,
      attempts: 0,
    });
    await upgraded.ynabLinks.put({ localId: "l1", ynabId: "y1", startedAt: 5 });
    expect((await upgraded.ynabOutbox.orderBy("queuedAt").toArray()).map((i) => i.clientId)).toEqual(["c1"]);
    expect((await upgraded.ynabLinks.get("l1"))?.ynabId).toBe("y1");
    upgraded.close();
  });
});

describe("TradeTrackerDB upgrade to version 11", () => {
  it("keeps existing data when upgrading from version 10 and adds the family's cards", async () => {
    // Build the version 10 database exactly as the previous release left it.
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
    old.version(8).stores({});
    old.version(9).stores({
      ynabConnection: "id",
      ynabCategories: "id, groupId",
      ynabAccounts: "id",
      ynabPayees: "id",
    });
    old.version(10).stores({
      ynabOutbox: "clientId, queuedAt",
      ynabLinks: "localId",
    });
    await old.open();
    await old.table("stores").put({ id: "s1", name: "Stop & Shop", createdAt: 1, updatedAt: 1 });
    await old.table("ynabLinks").put({ localId: "l1", ynabId: "y1", startedAt: 5 });
    old.close();

    const upgraded = new TradeTrackerDB();
    await upgraded.open();

    expect(upgraded.verno).toBe(11);
    expect((await upgraded.stores.get("s1"))?.name).toBe("Stop & Shop");
    expect((await upgraded.ynabLinks.get("l1"))?.ynabId).toBe("y1");
    expect(await upgraded.familyCards.count()).toBe(0);

    await upgraded.familyCards.put({ id: "k1", lastFour: "1234", owner: "Jonathan", accountId: "a1", createdAt: 5 });
    expect((await upgraded.familyCards.where("lastFour").equals("1234").first())?.owner).toBe("Jonathan");
    // a last four is one card
    await expect(upgraded.familyCards.put({ id: "k2", lastFour: "1234", owner: "Sam", createdAt: 6 })).rejects.toThrow();
    upgraded.close();
  });
});
