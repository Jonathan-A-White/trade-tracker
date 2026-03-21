import Dexie, { type EntityTable } from "dexie";
import type {
  Store,
  Item,
  Trip,
  TripItem,
  PriceHistoryEntry,
} from "../contracts/types";

export class TradeTrackerDB extends Dexie {
  stores!: EntityTable<Store, "id">;
  items!: EntityTable<Item, "id">;
  trips!: EntityTable<Trip, "id">;
  tripItems!: EntityTable<TripItem, "id">;
  priceHistory!: EntityTable<PriceHistoryEntry, "id">;

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
  }
}

export const db = new TradeTrackerDB();
