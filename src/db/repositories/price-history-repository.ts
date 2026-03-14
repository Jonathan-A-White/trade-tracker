import { db } from "../database";
import type {
  PriceHistoryEntry,
  CreatePriceHistoryInput,
} from "../../contracts/types";

export interface PriceHistoryFilters {
  storeId?: string;
  after?: number;
  before?: number;
}

export class PriceHistoryRepository {
  async record(entry: CreatePriceHistoryInput): Promise<PriceHistoryEntry> {
    const priceEntry: PriceHistoryEntry = {
      id: crypto.randomUUID(),
      ...entry,
    };
    await db.priceHistory.put(priceEntry);
    return priceEntry;
  }

  async getByItem(
    itemId: string,
    filters?: PriceHistoryFilters
  ): Promise<PriceHistoryEntry[]> {
    let results: PriceHistoryEntry[];

    if (filters?.storeId) {
      results = await db.priceHistory
        .where("[itemId+storeId]")
        .equals([itemId, filters.storeId])
        .toArray();
    } else {
      results = await db.priceHistory
        .where("itemId")
        .equals(itemId)
        .toArray();
    }

    if (filters?.after) {
      results = results.filter((e) => e.recordedAt >= filters.after!);
    }
    if (filters?.before) {
      results = results.filter((e) => e.recordedAt <= filters.before!);
    }

    return results.sort((a, b) => a.recordedAt - b.recordedAt);
  }

  async getLatestPrice(
    itemId: string,
    storeId?: string
  ): Promise<PriceHistoryEntry | undefined> {
    let entries: PriceHistoryEntry[];

    if (storeId) {
      entries = await db.priceHistory
        .where("[itemId+storeId]")
        .equals([itemId, storeId])
        .toArray();
    } else {
      entries = await db.priceHistory
        .where("itemId")
        .equals(itemId)
        .toArray();
    }

    if (entries.length === 0) return undefined;

    return entries.reduce((latest, entry) =>
      entry.recordedAt > latest.recordedAt ? entry : latest
    );
  }

  async getBestPrice(
    itemId: string
  ): Promise<PriceHistoryEntry | undefined> {
    const entries = await db.priceHistory
      .where("itemId")
      .equals(itemId)
      .toArray();

    if (entries.length === 0) return undefined;

    return entries.reduce((best, entry) =>
      entry.price < best.price ? entry : best
    );
  }
}
