import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import type { Item, PendingLookup, Store, Trip, TripItem } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const pendingLookupRepo = new PendingLookupRepository();

export interface TripLines {
  trip: Trip | undefined;
  store: Store | undefined;
  lines: TripItem[];
  itemsById: Record<string, Item>;
  /** Open pending-line lookups, keyed by the itemId their pending line carries. */
  pendingByItemId: Record<string, PendingLookup>;
  /** Latest price-only lookup of each known item on the trip. */
  priceLookupsByItemId: Record<string, PendingLookup>;
  /** True until the trip, its store, its lines, their items and its lookups have all been read. */
  loading: boolean;
}

/**
 * The open pending-line lookups of a trip, keyed by the itemId their pending
 * line carries. Price-only lookups have no line of their own and applied ones
 * are filled, so neither is here.
 */
export async function loadPendingByItemId(
  tripId: string,
): Promise<Record<string, PendingLookup>> {
  const map: Record<string, PendingLookup> = {};
  for (const lookup of await pendingLookupRepo.listByTrip(tripId)) {
    if (lookup.mode !== "price-only" && lookup.status !== "applied") {
      map[lookup.itemId] = lookup;
    }
  }
  return map;
}

/** The items with these ids, keyed by id. Ids with no item are left out. */
export async function loadItemsById(
  itemIds: readonly string[],
): Promise<Record<string, Item>> {
  const map: Record<string, Item> = {};
  if (itemIds.length === 0) return map;
  for (const item of await db.items.where("id").anyOf([...new Set(itemIds)]).toArray()) {
    map[item.id] = item;
  }
  return map;
}

/**
 * A trip with its store, lines, the items on them and its open lookups, live.
 * Each part is read on its own, so `loading` stays true until every one has
 * answered: until then `itemsById` is empty and a line's item looks unknown.
 */
export function useTripLines(tripId: string | undefined): TripLines {
  // Each result is wrapped so "not read yet" (undefined) differs from "read: nothing there".
  const tripRead = useLiveQuery(
    async () => ({ trip: tripId ? await tripRepo.getById(tripId) : undefined }),
    [tripId],
  );
  const trip = tripRead?.trip;

  const storeRead = useLiveQuery(
    async () => ({ store: trip ? await db.stores.get(trip.storeId) : undefined }),
    [trip?.storeId],
  );

  const lines = useLiveQuery(
    () => (tripId ? tripItemRepo.getByTrip(tripId) : []),
    [tripId],
  );

  const itemsRead = useLiveQuery(async () => {
    if (!lines) return undefined;
    return { itemsById: await loadItemsById(lines.map((ti) => ti.itemId)) };
  }, [lines]);

  const pendingRead = useLiveQuery(
    async () => ({ pendingByItemId: tripId ? await loadPendingByItemId(tripId) : {} }),
    [tripId],
  );

  const priceRead = useLiveQuery(async () => {
    const map: Record<string, PendingLookup> = {};
    if (tripId) {
      for (const lookup of await pendingLookupRepo.listPriceOnlyByTrip(tripId)) {
        map[lookup.itemId] = lookup;
      }
    }
    return { priceLookupsByItemId: map };
  }, [tripId]);

  const loading =
    tripId !== undefined &&
    (tripRead === undefined ||
    (trip !== undefined && storeRead === undefined) ||
    lines === undefined ||
    itemsRead === undefined ||
    pendingRead === undefined ||
    priceRead === undefined);

  return {
    trip,
    store: storeRead?.store,
    lines: lines ?? [],
    itemsById: itemsRead?.itemsById ?? {},
    pendingByItemId: pendingRead?.pendingByItemId ?? {},
    priceLookupsByItemId: priceRead?.priceLookupsByItemId ?? {},
    loading,
  };
}
