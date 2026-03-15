import { createContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { Trip, TripItem } from "@/contracts/types";
import { db } from "@/db/database";
import { useLiveQuery } from "dexie-react-hooks";
import {
  TripRepository,
  TripItemRepository,
} from "@/db/repositories";

interface ActiveTripContextValue {
  activeTrip: Trip | undefined;
  activeTripItems: TripItem[];
  subtotal: number;
  itemCount: number;
  lastScannedBarcode: string | null;
  setLastScannedBarcode: (barcode: string | null) => void;
  startTrip: (storeId: string, note?: string) => Promise<Trip>;
  addItemToTrip: (
    input: Omit<TripItem, "id" | "lineTotal" | "addedAt">,
  ) => Promise<TripItem>;
  updateTripItem: (
    id: string,
    changes: Partial<Omit<TripItem, "id" | "lineTotal" | "addedAt">>,
  ) => Promise<void>;
  removeTripItem: (id: string) => Promise<void>;
  endTrip: (actualTotal?: number) => Promise<void>;
}

export const ActiveTripContext = createContext<ActiveTripContextValue | null>(
  null,
);

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

export function ActiveTripProvider({ children }: { children: ReactNode }) {
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(
    null,
  );

  const activeTrip = useLiveQuery(
    () => db.trips.where("status").equals("active").first(),
    [],
  );

  const activeTripItems = useLiveQuery(
    () =>
      activeTrip?.id
        ? db.tripItems.where("tripId").equals(activeTrip.id).toArray()
        : [],
    [activeTrip?.id],
  );

  const subtotal = useMemo(() => {
    if (!activeTripItems || activeTripItems.length === 0) return 0;
    return activeTripItems.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [activeTripItems]);

  const itemCount = useMemo(() => {
    if (!activeTripItems || activeTripItems.length === 0) return 0;
    return activeTripItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [activeTripItems]);

  const startTrip = useCallback(
    async (storeId: string, note?: string): Promise<Trip> => {
      const trip = await tripRepo.create({
        storeId,
        startedAt: Date.now(),
        note,
      });
      return trip;
    },
    [],
  );

  const addItemToTrip = useCallback(
    async (
      input: Omit<TripItem, "id" | "lineTotal" | "addedAt">,
    ): Promise<TripItem> => {
      return tripItemRepo.addToTrip(input);
    },
    [],
  );

  const updateTripItem = useCallback(
    async (
      id: string,
      changes: Partial<Omit<TripItem, "id" | "lineTotal" | "addedAt">>,
    ): Promise<void> => {
      await tripItemRepo.update(id, changes);
    },
    [],
  );

  const removeTripItem = useCallback(async (id: string): Promise<void> => {
    await tripItemRepo.remove(id);
  }, []);

  const endTrip = useCallback(
    async (actualTotal?: number): Promise<void> => {
      if (!activeTrip) {
        throw new Error("No active trip to end");
      }
      await tripRepo.complete(activeTrip.id, actualTotal);
    },
    [activeTrip],
  );

  const value = useMemo<ActiveTripContextValue>(
    () => ({
      activeTrip,
      activeTripItems: activeTripItems ?? [],
      subtotal,
      itemCount,
      lastScannedBarcode,
      setLastScannedBarcode,
      startTrip,
      addItemToTrip,
      updateTripItem,
      removeTripItem,
      endTrip,
    }),
    [
      activeTrip,
      activeTripItems,
      subtotal,
      itemCount,
      lastScannedBarcode,
      startTrip,
      addItemToTrip,
      updateTripItem,
      removeTripItem,
      endTrip,
    ],
  );

  return (
    <ActiveTripContext value={value}>
      {children}
    </ActiveTripContext>
  );
}
