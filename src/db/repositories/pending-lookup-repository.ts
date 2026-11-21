import { db } from "../database";
import type {
  Item,
  ItemFromPhotosAnswer,
  PendingLookup,
  CreatePendingLookupInput,
  TripItem,
} from "../../contracts/types";
import { lookupNotBack } from "../../core/lookup-wait";
import { TripItemRepository } from "./trip-item-repository";
import { pastPriceGuess } from "./price-guess";

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
 * The best guess for a line whose tag gave no price: what the shopper already paid (see
 * pastPriceGuess), else the factory's estimate; null when there is none. A guess is never
 * written to the item.
 */
async function bestGuess(
  item: Item,
  storeId: string | undefined,
  storeName: string | undefined,
  answer: ItemFromPhotosAnswer,
): Promise<{ price: number; basis: string } | null> {
  const past = await pastPriceGuess(item, storeId, storeName);
  if (past) return past;
  if (answer.estimatedPrice !== undefined && answer.estimatedPrice > 0) {
    return {
      price: answer.estimatedPrice,
      basis: answer.estimateNote?.trim() || "The factory's estimate.",
    };
  }
  return null;
}

/**
 * The price read off the tag, or null when there is none. The factory answers
 * 0 for "could not read a price", so 0 counts as unknown, never as $0.00.
 */
function tagPrice(answer: ItemFromPhotosAnswer): number | null {
  return answer.price === null || answer.price === 0 ? null : answer.price;
}

/** A price-only or estimate lookup has no pending line of its own: the item's line stays. */
function hasNoLineOfItsOwn(lookup: PendingLookup): boolean {
  return lookup.mode === "price-only" || lookup.mode === "estimate";
}

/** A lookup thrown away and the pending line it had (none for a price-only lookup), kept so Discard can be undone. */
export interface DiscardedLookup {
  lookup: PendingLookup;
  line?: TripItem;
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

  /** The lookups a known item's line can be waiting on, price-only and estimate, oldest first. */
  async listLineLookupsByTrip(tripId: string): Promise<PendingLookup[]> {
    return (await this.listByTrip(tripId)).filter(hasNoLineOfItsOwn);
  }

  /**
   * 'Use an estimate': drops the price of a trip line (its item's stored price stays) and queues an
   * estimate lookup of the item for the factory. The line counts $0 until the answer; an earlier
   * answered or failed estimate for the same item on the trip is replaced. Undefined when there is no
   * such line or item.
   */
  async askForEstimate(tripItemId: string): Promise<PendingLookup | undefined> {
    const line = await db.tripItems.get(tripItemId);
    const item = line ? await db.items.get(line.itemId) : undefined;
    if (!line || !item) return undefined;
    const lookup: PendingLookup = {
      id: crypto.randomUUID(),
      barcode: item.barcode,
      tripId: line.tripId,
      itemId: item.id,
      mode: "estimate",
      photos: [],
      status: "waiting-to-send",
      createdAt: Date.now(),
    };
    await db.transaction("rw", [db.pendingLookups, db.tripItems, db.trips], async () => {
      for (const old of await this.listByTrip(line.tripId)) {
        if (old.mode === "estimate" && old.itemId === item.id) await db.pendingLookups.delete(old.id);
      }
      await db.pendingLookups.put(lookup);
      await tripItemRepo.update(line.id, { price: 0, guess: undefined, priceFlag: undefined });
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
        await db.pendingLookups.update(id, { status: "applied", photos: [], notBack: undefined });
      },
    );
  }

  /**
   * Sets the quantity of a lookup's pending line (never below 1). The factory's
   * answer, or Fill by hand, turns the line into an ordinary one with it.
   */
  async setQuantity(id: string, quantity: number): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || hasNoLineOfItsOwn(lookup)) return;
    const line = await db.tripItems
      .where("[tripId+itemId]")
      .equals([lookup.tripId, lookup.itemId])
      .first();
    if (!line) return;
    await tripItemRepo.update(line.id, { quantity: Math.max(1, Math.floor(quantity)) });
  }

  /**
   * Throws a pending lookup away together with its pending line, and returns both as they were (for
   * Undo), or undefined when there was no such lookup.
   */
  async discard(id: string): Promise<DiscardedLookup | undefined> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup) return undefined;
    // a price-only or estimate lookup has no line of its own: the item's line stays
    if (hasNoLineOfItsOwn(lookup)) {
      await db.pendingLookups.delete(id);
      return { lookup };
    }

    return db.transaction("rw", [db.pendingLookups, db.tripItems, db.trips], async () => {
      const pendingLine = await db.tripItems
        .where("[tripId+itemId]")
        .equals([lookup.tripId, lookup.itemId])
        .first();
      if (pendingLine) await tripItemRepo.remove(pendingLine.id);
      await db.pendingLookups.delete(id);
      return { lookup, line: pendingLine };
    });
  }

  /** Puts a discarded lookup back as it was, with its photos and its pending line (Undo of discard). */
  async restoreDiscarded(discarded: DiscardedLookup): Promise<void> {
    await db.transaction("rw", [db.pendingLookups, db.tripItems, db.trips], async () => {
      await db.pendingLookups.put(discarded.lookup);
      if (discarded.line) await tripItemRepo.restore(discarded.line);
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
    await db.pendingLookups.update(id, {
      status: "at-the-factory",
      gristTxid,
      sentAt: Date.now(),
      resentAt: undefined,
      notBack: undefined,
      error: undefined,
    });
  }

  /**
   * Nothing came back, so the grist went out a second time (the backend names the same txid for the
   * same request id). When both limits had already run out by the stored send time, the line says
   * it did not come back in the same write, so it never goes back to waiting.
   */
  async markResent(id: string, gristTxid: string, notBack = false): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || lookup.status !== "at-the-factory") return;
    await db.pendingLookups.update(id, {
      gristTxid,
      resentAt: Date.now(),
      ...(notBack ? { notBack: true as const } : {}),
    });
  }

  /** Sent twice and still no answer: the line says so and offers Try again. */
  async markNotBack(id: string): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup || lookup.status !== "at-the-factory") return;
    await db.pendingLookups.update(id, { notBack: true });
  }

  /** The lookup will not be answered as it stands; the reason is shown with Retry. */
  async markFailed(id: string, error: string): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    await db.pendingLookups.update(id, { status: "failed", error });
    if (lookup?.mode === "estimate") await this.flagUnpriced(lookup);
  }

  /** An estimate that did not come: the line, still without a price, asks for one ('Add price'). */
  private async flagUnpriced(lookup: PendingLookup): Promise<void> {
    const line = await db.tripItems
      .where("[tripId+itemId]")
      .equals([lookup.tripId, lookup.itemId])
      .first();
    if (line && line.price === 0 && !line.guess) await tripItemRepo.update(line.id, { priceFlag: "add" });
  }

  /**
   * Puts a failed lookup, or one that did not come back, in the queue to be sent afresh (Retry,
   * Try again). It goes under the same request id, so the factory does not grind it twice.
   */
  async retry(id: string): Promise<void> {
    const lookup = await db.pendingLookups.get(id);
    if (!lookup) return;
    if (lookup.status !== "failed" && !lookupNotBack(lookup)) return;
    await db.pendingLookups.update(id, {
      status: "waiting-to-send",
      gristTxid: undefined,
      sentAt: undefined,
      resentAt: undefined,
      notBack: undefined,
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
    if (lookup.mode === "estimate") return this.applyEstimateAnswer(lookup, answer);

    await db.transaction(
      "rw",
      [db.pendingLookups, db.items, db.tripItems, db.priceHistory, db.trips, db.stores],
      async () => {
        const price = tagPrice(answer);
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
        await db.pendingLookups.update(id, {
          status: "applied",
          photos: [],
          error: undefined,
          notBack: undefined,
        });
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
        const price = tagPrice(answer);
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
          notBack: undefined,
          noPrice: price === null || !item ? true : undefined,
        });
      },
    );
  }

  /**
   * Fills an estimate lookup from a checked answer: the line of the item on the trip takes the
   * factory's estimatedPrice as a Guess with its note, while it is still waiting (price 0, no guess:
   * a price he typed meanwhile stays). Nothing is written to the item or the price history. An answer
   * with no estimate, or one for another unit, fails the lookup with a reason.
   */
  private async applyEstimateAnswer(
    lookup: PendingLookup,
    answer: ItemFromPhotosAnswer,
  ): Promise<void> {
    const item = await db.items.get(lookup.itemId);
    const estimate = answer.estimatedPrice;
    const usable =
      item !== undefined &&
      estimate !== undefined &&
      estimate > 0 &&
      answer.unitType === item.unitType;
    if (!usable) {
      await this.markFailed(
        lookup.id,
        estimate !== undefined && estimate > 0
          ? "The factory's estimate was for a different unit, so it was not used."
          : "The factory could not estimate this one.",
      );
      return;
    }
    await db.transaction("rw", [db.pendingLookups, db.tripItems, db.trips], async () => {
      const line = await db.tripItems
        .where("[tripId+itemId]")
        .equals([lookup.tripId, lookup.itemId])
        .first();
      if (line && line.price === 0 && !line.guess) {
        await tripItemRepo.update(line.id, {
          price: estimate,
          priceFlag: undefined,
          guess: { basis: answer.estimateNote?.trim() || "The factory's estimate." },
        });
      }
      await db.pendingLookups.update(lookup.id, { status: "applied", error: undefined, notBack: undefined });
    });
  }
}
