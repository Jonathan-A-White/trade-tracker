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

export class PendingLookupRepository {
  /**
   * Records a pending lookup and puts its pending line in the trip. The line
   * carries a placeholder itemId (kept on the lookup) until it is filled.
   */
  async create(input: CreatePendingLookupInput): Promise<PendingLookup> {
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

  /** Throws a pending lookup away together with its pending line. */
  async discard(id: string): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup) return;

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
   * entry. The line carries a 'check' flag with a price and an 'add' flag
   * without; photos are dropped.
   */
  async applyAnswer(id: string, answer: ItemFromPhotosAnswer): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || lookup.status === "applied") return;

    await db.transaction(
      "rw",
      [db.pendingLookups, db.items, db.tripItems, db.priceHistory, db.trips],
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
          const linePrice = price ?? item.currentPrice;
          await tripItemRepo.update(line.id, {
            itemId: item.id,
            price: linePrice,
            pending: undefined,
            priceFlag: price === null ? "add" : "check",
          });
          const trip = await db.trips.get(lookup.tripId);
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
}
