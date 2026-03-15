import { db } from "../database";
import type {
  TripItem,
  CreateTripItemInput,
  PriceHistoryEntry,
} from "../../contracts/types";
import { calculateLineTotal } from "../../core/pricing";

export class TripItemRepository {
  async addToTrip(input: CreateTripItemInput): Promise<TripItem> {
    // Check if this item already exists in the trip
    const existing = await db.tripItems
      .where("tripId")
      .equals(input.tripId)
      .filter((ti) => ti.itemId === input.itemId)
      .first();

    if (existing) {
      // Merge: increment quantity (or add weight for per-lb items)
      const newQuantity = existing.quantity + input.quantity;
      const newWeight =
        existing.weightLbs !== undefined && input.weightLbs !== undefined
          ? existing.weightLbs + input.weightLbs
          : existing.weightLbs ?? input.weightLbs;
      const newPrice = input.price; // Use the latest price
      const lineTotal = calculateLineTotal(newPrice, newQuantity, newWeight);

      await db.transaction("rw", [db.tripItems, db.priceHistory, db.trips], async () => {
        await db.tripItems.update(existing.id, {
          quantity: newQuantity,
          weightLbs: newWeight,
          price: newPrice,
          lineTotal,
          onSale: input.onSale,
        });

        const trip = await db.trips.get(input.tripId);
        if (trip) {
          const priceEntry: PriceHistoryEntry = {
            id: crypto.randomUUID(),
            itemId: input.itemId,
            storeId: trip.storeId,
            tripItemId: existing.id,
            price: input.price,
            recordedAt: Date.now(),
          };
          await db.priceHistory.put(priceEntry);
        }

        await this.recalcTripSubtotal(input.tripId);
      });

      return { ...existing, quantity: newQuantity, weightLbs: newWeight, price: newPrice, lineTotal, onSale: input.onSale };
    }

    const lineTotal = calculateLineTotal(
      input.price,
      input.quantity,
      input.weightLbs
    );

    const tripItem: TripItem = {
      id: crypto.randomUUID(),
      ...input,
      lineTotal,
      addedAt: Date.now(),
    };

    await db.transaction("rw", [db.tripItems, db.priceHistory, db.trips], async () => {
      await db.tripItems.put(tripItem);

      // Look up the trip to get the storeId for the price history entry
      const trip = await db.trips.get(input.tripId);
      if (trip) {
        const priceEntry: PriceHistoryEntry = {
          id: crypto.randomUUID(),
          itemId: input.itemId,
          storeId: trip.storeId,
          tripItemId: tripItem.id,
          price: input.price,
          recordedAt: Date.now(),
        };
        await db.priceHistory.put(priceEntry);
      }

      // Recalculate trip subtotal
      await this.recalcTripSubtotal(input.tripId);
    });

    return tripItem;
  }

  async remove(id: string): Promise<void> {
    const tripItem = await db.tripItems.get(id);
    if (!tripItem) return;

    await db.transaction("rw", [db.tripItems, db.trips], async () => {
      await db.tripItems.delete(id);
      await this.recalcTripSubtotal(tripItem.tripId);
    });
  }

  async update(
    id: string,
    changes: Partial<Omit<TripItem, "id" | "lineTotal" | "addedAt">>
  ): Promise<void> {
    const existing = await db.tripItems.get(id);
    if (!existing) return;

    const updated = { ...existing, ...changes };
    const lineTotal = calculateLineTotal(
      updated.price,
      updated.quantity,
      updated.weightLbs
    );

    await db.transaction("rw", [db.tripItems, db.trips], async () => {
      await db.tripItems.update(id, { ...changes, lineTotal });
      await this.recalcTripSubtotal(existing.tripId);
    });
  }

  async getByTrip(tripId: string): Promise<TripItem[]> {
    return db.tripItems.where("tripId").equals(tripId).toArray();
  }

  private async recalcTripSubtotal(tripId: string): Promise<void> {
    const items = await db.tripItems.where("tripId").equals(tripId).toArray();
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    await db.trips.update(tripId, {
      scannedSubtotal: subtotal,
      updatedAt: Date.now(),
    });
  }
}
