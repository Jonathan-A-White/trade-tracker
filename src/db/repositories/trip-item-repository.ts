import { db } from "../database";
import type {
  TripItem,
  CreateTripItemInput,
  PriceHistoryEntry,
} from "../../contracts/types";
import { calculateLineTotal } from "../../core/pricing";
import { tripTotals } from "../../core/trip-totals";
import { pastPriceGuess } from "./price-guess";

export class TripItemRepository {
  /**
   * Adds a line, or merges into the trip's line for the same item. A price of 0 is not a price:
   * a new line then takes the best guess from what was paid before, marked as a Guess (counted in
   * the totals), or is flagged 'Add price' when nothing is known; a merge keeps the price the line
   * already has. No history entry is written for a price that was not given.
   */
  async addToTrip(input: CreateTripItemInput): Promise<TripItem> {
    const priceGiven = input.price > 0 && Number.isFinite(input.price);
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
      const newPrice = priceGiven ? input.price : existing.price; // Use the latest price, when there is one
      const lineTotal = calculateLineTotal(newPrice, newQuantity, newWeight);

      await db.transaction("rw", [db.tripItems, db.priceHistory, db.trips], async () => {
        await db.tripItems.update(existing.id, {
          quantity: newQuantity,
          weightLbs: newWeight,
          price: newPrice,
          lineTotal,
          onSale: input.onSale,
          // a price from a fresh scan is not a guess
          ...(priceGiven ? { guess: undefined } : {}),
        });

        const trip = await db.trips.get(input.tripId);
        if (trip && priceGiven) {
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

      return {
        ...existing,
        quantity: newQuantity,
        weightLbs: newWeight,
        price: newPrice,
        lineTotal,
        onSale: input.onSale,
        ...(priceGiven ? { guess: undefined } : {}),
      };
    }

    let price = input.price;
    let guess = input.guess;
    let priceFlag = input.priceFlag;
    if (!priceGiven) {
      const item = await db.items.get(input.itemId);
      const trip = await db.trips.get(input.tripId);
      const store = trip ? await db.stores.get(trip.storeId) : undefined;
      const found = item ? await pastPriceGuess(item, trip?.storeId, store?.name) : null;
      price = found?.price ?? 0;
      if (found) guess = { basis: found.basis };
      else priceFlag = priceFlag ?? "add";
    }

    const lineTotal = calculateLineTotal(price, input.quantity, input.weightLbs);

    const tripItem: TripItem = {
      id: crypto.randomUUID(),
      ...input,
      price,
      guess,
      priceFlag,
      lineTotal,
      addedAt: Date.now(),
    };

    await db.transaction("rw", [db.tripItems, db.priceHistory, db.trips], async () => {
      await db.tripItems.put(tripItem);

      // Look up the trip to get the storeId for the price history entry
      const trip = await db.trips.get(input.tripId);
      if (trip && priceGiven) {
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

  /** Removes a line and returns it as it was (for Undo), or undefined when there was none. */
  async remove(id: string): Promise<TripItem | undefined> {
    const tripItem = await db.tripItems.get(id);
    if (!tripItem) return undefined;

    await db.transaction("rw", [db.tripItems, db.trips], async () => {
      await db.tripItems.delete(id);
      await this.recalcTripSubtotal(tripItem.tripId);
    });
    return tripItem;
  }

  /** Puts a removed line back as it was (Undo of remove); its price history was never removed. */
  async restore(tripItem: TripItem): Promise<void> {
    await db.transaction("rw", [db.tripItems, db.trips], async () => {
      await db.tripItems.put(tripItem);
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

    // An edit settles a price flag: a 'check' flag at once, an 'add' flag once there is a price.
    const clearsFlag =
      !("priceFlag" in changes) &&
      (existing.priceFlag === "check" ||
        (existing.priceFlag === "add" && updated.price > 0));

    // A hand-set price is no longer a guess (a count or weight edit leaves the guess in place).
    const clearsGuess = !("guess" in changes) && "price" in changes && existing.guess !== undefined;

    await db.transaction("rw", [db.tripItems, db.trips], async () => {
      await db.tripItems.update(id, {
        ...changes,
        ...(clearsFlag ? { priceFlag: undefined } : {}),
        ...(clearsGuess ? { guess: undefined } : {}),
        lineTotal,
      });
      await this.recalcTripSubtotal(existing.tripId);
    });
  }

  /** Settles a 'check' flag the shopper has looked at (an 'add' flag clears when a price is entered). */
  async clearPriceFlag(id: string): Promise<void> {
    await db.tripItems.update(id, { priceFlag: undefined });
  }

  async getByTrip(tripId: string): Promise<TripItem[]> {
    const items = await db.tripItems.where("tripId").equals(tripId).toArray();
    return items.sort((a, b) => a.addedAt - b.addedAt);
  }

  private async recalcTripSubtotal(tripId: string): Promise<void> {
    const items = await db.tripItems.where("tripId").equals(tripId).toArray();
    await db.trips.update(tripId, {
      scannedSubtotal: tripTotals(items).subtotal,
      updatedAt: Date.now(),
    });
  }
}
