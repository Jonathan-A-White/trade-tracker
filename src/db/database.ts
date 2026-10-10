import Dexie, { type EntityTable } from "dexie";
import type {
  Store,
  Item,
  Trip,
  TripItem,
  PriceHistoryEntry,
  PendingLookup,
} from "../contracts/types";

export class TradeTrackerDB extends Dexie {
  stores!: EntityTable<Store, "id">;
  items!: EntityTable<Item, "id">;
  trips!: EntityTable<Trip, "id">;
  tripItems!: EntityTable<TripItem, "id">;
  priceHistory!: EntityTable<PriceHistoryEntry, "id">;
  pendingLookups!: EntityTable<PendingLookup, "id">;

  constructor() {
    super("TradeTrackerDB");
    this.version(1).stores({
      stores: "id, name, createdAt",
      items: "id, &barcode, name, category, createdAt",
      trips: "id, storeId, status, startedAt, [storeId+status], createdAt",
      tripItems: "id, tripId, itemId, [tripId+itemId], addedAt",
      priceHistory: "id, itemId, storeId, [itemId+storeId], recordedAt",
    });

    // Version 2: Add optional budget field to trips (no index needed)
    this.version(2).stores({});

    // Version 3: Add optional city and state fields to stores (no index needed)
    this.version(3).stores({});

    // Version 4: Add optional taxOverride field to tripItems (no index needed)
    this.version(4).stores({});

    // Version 5: Add tripItemId index to priceHistory for reimport cleanup
    this.version(5).stores({
      priceHistory: "id, itemId, storeId, [itemId+storeId], recordedAt, tripItemId",
    });

    // Version 6: Add optional bottleDeposit field to tripItems (no index needed)
    this.version(6).stores({});

    // Version 7: Add pendingLookups table (photographed products waiting on the
    // factory); tripItems gain an optional pending flag (no index needed).
    // pendingLookups later gained optional mode and noPrice fields: not indexed,
    // so the schema stays at 7.
    this.version(7).stores({
      pendingLookups: "id, tripId, barcode, status, createdAt",
    });

    // Version 8: trips gain an optional receiptReconcile record (what the last
    // receipt reconcile found; not indexed). tripItems later gained an optional
    // guess mark (a best-guess price): not indexed, so the schema stays at 8.
    // trips later gained an optional receiptPending mark (a receipt sent and not
    // yet answered): not indexed, so the schema stays at 8.
    this.version(8).stores({});
  }
}

export const db = new TradeTrackerDB();
