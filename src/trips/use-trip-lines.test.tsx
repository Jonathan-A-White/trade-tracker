import { renderHook, waitFor } from "@testing-library/react";
import { db } from "@/db/database";
import {
  PendingLookupRepository,
  TripRepository,
  TripItemRepository,
  ItemRepository,
  StoreRepository,
} from "@/db/repositories";
import { useTripLines } from "./use-trip-lines";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();
const storeRepo = new StoreRepository();
const lookupRepo = new PendingLookupRepository();

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("useTripLines", () => {
  it("is not loading and empty with no trip id", async () => {
    const { result } = renderHook(() => useTripLines(undefined));
    expect(result.current.trip).toBeUndefined();
    expect(result.current.lines).toEqual([]);
    expect(result.current.itemsById).toEqual({});
    expect(result.current.loading).toBe(false);
  });

  it("loads the trip, its store, lines and items, then stops loading", async () => {
    const store = await storeRepo.create({ name: "Corner Market", state: "MA" });
    const trip = await tripRepo.create({ storeId: store.id, startedAt: 1 });
    const item = await itemRepo.create({
      barcode: "0001",
      name: "Milk",
      currentPrice: 3,
      unitType: "each",
    });
    await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 3,
      quantity: 2,
      onSale: false,
    });

    const { result } = renderHook(() => useTripLines(trip.id));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.trip?.id).toBe(trip.id);
    expect(result.current.store?.name).toBe("Corner Market");
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.itemsById[item.id].name).toBe("Milk");
  });

  it("stops loading for a trip id that is not there", async () => {
    const { result } = renderHook(() => useTripLines("nope"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.trip).toBeUndefined();
    expect(result.current.lines).toEqual([]);
  });

  it("keys open pending-line lookups and latest price-only lookups by item id", async () => {
    const store = await storeRepo.create({ name: "Corner Market", state: "MA" });
    const trip = await tripRepo.create({ storeId: store.id, startedAt: 1 });
    const pending = await lookupRepo.create({
      tripId: trip.id,
      barcode: "9999",
      photos: [],
    });
    const item = await itemRepo.create({
      barcode: "0002",
      name: "Eggs",
      currentPrice: 4,
      unitType: "each",
    });
    const priceOnly = await lookupRepo.create({
      tripId: trip.id,
      barcode: "0002",
      photos: [],
      mode: "price-only",
      itemId: item.id,
    });

    const { result } = renderHook(() => useTripLines(trip.id));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pendingByItemId[pending.itemId].id).toBe(pending.id);
    expect(Object.keys(result.current.pendingByItemId)).toEqual([pending.itemId]);
    expect(result.current.priceLookupsByItemId[item.id].id).toBe(priceOnly.id);
  });
});
