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
  }
}

export const db = new TradeTrackerDB();
