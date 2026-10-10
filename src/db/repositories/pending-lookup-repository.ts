import { db } from "../database";
import type {
  Item,
  ItemFromPhotosAnswer,
  PendingLookup,
  CreatePendingLookupInput,
  TripItem,
} from "../../contracts/types";
import { TripItemRepository } from "./trip-item-repository";

const tripItemRepo = new TripItemRepository();

/** Lookups the runner has to act on: those waiting to be sent or at the factory. */
export const RUNNABLE_STATUSES: readonly PendingLookup["status"][] = [
  "waiting-to-send",
  "at-the-factory",
];

/** The weight the label gave, for a per_lb item only: the line's weightLbs, else no change. */
function weightChange(unitType: Item["unitType"], answer: ItemFromPhotosAnswer): { weightLbs?: number } {
  const weight = answer.weightLbs;
  return unitType === "per_lb" && answer.unitType === "per_lb" && weight !== undefined && weight > 0
    ? { weightLbs: weight }
    : {};
}

/**
 * The best guess for a line whose tag gave no price: the item's own last price
 * at this store, else its stored price, else the factory's estimate; null when
 * there is none. A guess is never written to the item.
 */
async function bestGuess(
  item: Item,
  storeId: string | undefined,
  storeName: string | undefined,
  answer: ItemFromPhotosAnswer,
): Promise<{ price: number; basis: string } | null> {
  if (storeId) {
    const history = await db.priceHistory.where("itemId").equals(item.id).toArray();
    const last = history
      .filter((entry) => entry.storeId === storeId && entry.price > 0)
      .sort((a, b) => b.recordedAt - a.recordedAt)[0];
    if (last) {
      return {
        price: last.price,
        basis: `Last price here${storeName ? ` at ${storeName}` : ""}.`,
      };
    }
  }
  if (item.currentPrice > 0) {
    return { price: item.currentPrice, basis: "Last price you paid." };
  }
  if (answer.estimatedPrice !== undefined && answer.estimatedPrice > 0) {
    return {
      price: answer.estimatedPrice,
      basis: answer.estimateNote?.trim() || "The factory's estimate.",
    };
  }
  return null;
}

export class PendingLookupRepository {
  /**
   * Records a pending lookup and puts its pending line in the trip. The line
   * carries a placeholder itemId (kept on the lookup) until it is filled.
   */
  async create(input: CreatePendingLookupInput): Promise<PendingLookup> {
    if (input.mode === "price-only") return this.createPriceOnly(input);
    const id = crypto.randomUUID();
    const now = Date.now();
    const lookup: PendingLookup = {
      id,
      barcode: input.barcode,
      tripId: input.tripId,
      itemId: `pending:${id}`,
      photos: input.photos,
      status: "waiting-to-send",
      createdAt: now,
    };
    const line: TripItem = {
      id: crypto.randomUUID(),
      tripId: input.tripId,
      itemId: lookup.itemId,
      price: 0,
      quantity: 1,
      lineTotal: 0,
      onSale: false,
      pending: true,
      addedAt: now,
    };

    await db.transaction("rw", [db.pendingLookups, db.tripItems], async () => {
      await db.pendingLookups.put(lookup);
      await db.tripItems.put(line);
    });
    return lookup;
  }

  /**
   * Records a price-only lookup for a known item: one tag photo, no pending
   * line (the item's own line stays as it is). An earlier answered or failed
   * price lookup for the same item on the trip is replaced.
   */
  private async createPriceOnly(
    input: Extract<CreatePendingLookupInput, { mode: "price-only" }>,
  ): Promise<PendingLookup> {
    const lookup: PendingLookup = {
      id: crypto.randomUUID(),
      barcode: input.barcode,
      tripId: input.tripId,
      itemId: input.itemId,
      mode: "price-only",
      photos: input.photos,
      status: "waiting-to-send",
      createdAt: Date.now(),
    };
    await db.transaction("rw", db.pendingLookups, async () => {
      const earlier = await this.listPriceOnlyByTrip(input.tripId);
      for (const old of earlier) {
        if (old.itemId === input.itemId && !RUNNABLE_STATUSES.includes(old.status)) {
          await db.pendingLookups.delete(old.id);
        }
      }
      await db.pendingLookups.put(lookup);
    });
    return lookup;
  }

  /** The price-only lookups of a trip, oldest first. */
  async listPriceOnlyByTrip(tripId: string): Promise<PendingLookup[]> {
    return (await this.listByTrip(tripId)).filter((l) => l.mode === "price-only");
  }

  async getById(id: string): Promise<PendingLookup | undefined> {
    return db.pendingLookups.get(id);
  }

  async listByTrip(tripId: string): Promise<PendingLookup[]> {
    const all = await db.pendingLookups.where("tripId").equals(tripId).toArray();
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Fills a pending lookup by hand with a real item: its pending line is
   * replaced by an ordinary one for the item at the item's price, and the
   * lookup is marked applied (its photos are dropped).
   */
  async fillByHand(id: string, item: Item): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup) return;

    await db.transaction(
      "rw",
      [db.pendingLookups, db.tripItems, db.priceHistory, db.trips],
      async () => {
        const pendingLine = await db.tripItems
          .where("[tripId+itemId]")
          .equals([lookup.tripId, lookup.itemId])
          .first();
        if (pendingLine) await db.tripItems.delete(pendingLine.id);
        await tripItemRepo.addToTrip({
          tripId: lookup.tripId,
          itemId: item.id,
          price: item.currentPrice,
          quantity: pendingLine?.quantity ?? 1,
          onSale: false,
        });
        await db.pendingLookups.update(id, { status: "applied", photos: [] });
      },
    );
  }

  /**
   * Sets the quantity of a lookup's pending line (never below 1). The factory's
   * answer, or Fill by hand, turns the line into an ordinary one with it.
   */
  async setQuantity(id: string, quantity: number): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || lookup.mode === "price-only") return;
    const line = await db.tripItems
      .where("[tripId+itemId]")
      .equals([lookup.tripId, lookup.itemId])
      .first();
    if (!line) return;
    await tripItemRepo.update(line.id, { quantity: Math.max(1, Math.floor(quantity)) });
  }

  /** Throws a pending lookup away together with its pending line. */
  async discard(id: string): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup) return;
    // a price-only lookup has no line of its own: the item's line stays
    if (lookup.mode === "price-only") {
      await db.pendingLookups.delete(id);
      return;
    }

    await db.transaction("rw", [db.pendingLookups, db.tripItems, db.trips], async () => {
      const pendingLine = await db.tripItems
        .where("[tripId+itemId]")
        .equals([lookup.tripId, lookup.itemId])
        .first();
      if (pendingLine) await tripItemRepo.remove(pendingLine.id);
      await db.pendingLookups.delete(id);
    });
  }

  /** Lists every lookup the runner may have work for, oldest first. */
  async listRunnable(): Promise<PendingLookup[]> {
    const all = await db.pendingLookups
      .where("status")
      .anyOf([...RUNNABLE_STATUSES])
      .toArray();
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** The grist went out: the lookup is at the factory under its txid. */
  async markSent(id: string, gristTxid: string): Promise<void> {
    await db.pendingLookups.update(id, { status: "at-the-factory", gristTxid, error: undefined });
  }

  /** The lookup will not be answered as it stands; the reason is shown with Retry. */
  async markFailed(id: string, error: string): Promise<void> {
    await db.pendingLookups.update(id, { status: "failed", error });
  }

  /** Puts a failed lookup back in the queue to be sent afresh. */
  async retry(id: string): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || lookup.status !== "failed") return;
    await db.pendingLookups.update(id, {
      status: "waiting-to-send",
      gristTxid: undefined,
      answer: undefined,
      error: undefined,
    });
  }

  /**
   * Fills a lookup from a checked answer, in one transaction: a new item (or the
   * one already holding the barcode), its pending line turned into an ordinary
   * one, and, only when the tag gave a price, that price and one priceHistory
   * entry. The line carries a 'check' flag with a price. Without a tag price it
   * is filled with a best guess marked as such (the item's last price, else the
   * factory's estimate; never stored on the item), or flagged 'add' when there
   * is none. Photos are dropped.
   */
  async applyAnswer(id: string, answer: ItemFromPhotosAnswer): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || lookup.status === "applied") return;
    if (lookup.mode === "price-only") return this.applyPriceAnswer(lookup, answer);

    await db.transaction(
      "rw",
      [db.pendingLookups, db.items, db.tripItems, db.priceHistory, db.trips, db.stores],
      async () => {
        const price = answer.price;
        const now = Date.now();
        let item = await db.items.where("barcode").equals(lookup.barcode).first();
        if (!item) {
          item = {
            id: crypto.randomUUID(),
            barcode: lookup.barcode,
            name: answer.name,
            currentPrice: price ?? 0,
            unitType: answer.unitType,
            category: answer.category === "other" ? undefined : answer.category,
            createdAt: now,
            updatedAt: now,
          };
          await db.items.put(item);
        }

        const line = await db.tripItems
          .where("[tripId+itemId]")
          .equals([lookup.tripId, lookup.itemId])
          .first();
        if (line) {
          const trip = await db.trips.get(lookup.tripId);
          const store = trip ? await db.stores.get(trip.storeId) : undefined;
          const guess = price === null ? await bestGuess(item, trip?.storeId, store?.name, answer) : null;
          await tripItemRepo.update(line.id, {
            itemId: item.id,
            price: price ?? guess?.price ?? item.currentPrice,
            pending: undefined,
            priceFlag: price !== null ? "check" : guess ? undefined : "add",
            guess: guess ? { basis: guess.basis } : undefined,
            ...weightChange(item.unitType, answer),
          });
          if (price !== null && trip) {
            await db.priceHistory.put({
              id: crypto.randomUUID(),
              itemId: item.id,
              storeId: trip.storeId,
              tripItemId: line.id,
              price,
              recordedAt: now,
            });
          }
        }
        await db.pendingLookups.update(id, { status: "applied", photos: [], error: undefined });
      },
    );
  }

  /**
   * Fills a price-only lookup from a checked answer. Only the price fields
   * move: with a price, the item's currentPrice, the trip line for the item (if
   * any, flagged 'check') and one priceHistory entry for the trip's store; the
   * answer's name, category and unit are ignored. Without a price nothing
   * changes but the lookup, which remembers that no price was read.
   */
  private async applyPriceAnswer(
    lookup: PendingLookup,
    answer: ItemFromPhotosAnswer,
  ): Promise<void> {
    await db.transaction(
      "rw",
      [db.pendingLookups, db.items, db.tripItems, db.priceHistory, db.trips],
      async () => {
        const price = answer.price;
        const item = await db.items.get(lookup.itemId);
        const trip = await db.trips.get(lookup.tripId);
        if (price !== null && item) {
          const now = Date.now();
          await db.items.update(item.id, { currentPrice: price, updatedAt: now });
          const line = await db.tripItems
            .where("[tripId+itemId]")
            .equals([lookup.tripId, item.id])
            .first();
          if (line) {
            await tripItemRepo.update(line.id, {
              price,
              priceFlag: "check",
              ...weightChange(item.unitType, answer),
            });
          }
          if (trip) {
            await db.priceHistory.put({
              id: crypto.randomUUID(),
              itemId: item.id,
              storeId: trip.storeId,
              tripItemId: line?.id ?? "",
              price,
              recordedAt: now,
            });
          }
        }
        await db.pendingLookups.update(lookup.id, {
          status: "applied",
          photos: [],
          error: undefined,
          noPrice: price === null || !item ? true : undefined,
        });
      },
    );
  }
}
