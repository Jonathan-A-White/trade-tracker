import { db } from "../database";
import type {
  Item,
  PendingLookup,
  CreatePendingLookupInput,
  TripItem,
} from "../../contracts/types";
import { TripItemRepository } from "./trip-item-repository";

const tripItemRepo = new TripItemRepository();

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
}
