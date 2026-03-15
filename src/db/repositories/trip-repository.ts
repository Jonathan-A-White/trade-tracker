import { db } from "../database";
import type { Trip, CreateTripInput } from "../../contracts/types";

export interface TripListFilters {
  storeId?: string;
  status?: "active" | "completed";
  startAfter?: number;
  startBefore?: number;
}

export class TripRepository {
  async create(input: CreateTripInput): Promise<Trip> {
    const now = Date.now();
    const trip: Trip = {
      id: crypto.randomUUID(),
      ...input,
      status: "active",
      scannedSubtotal: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.trips.put(trip);
    return trip;
  }

  async getById(id: string): Promise<Trip | undefined> {
    return db.trips.get(id);
  }

  async complete(id: string, actualTotal?: number): Promise<void> {
    const now = Date.now();
    const updates: Partial<Trip> = {
      status: "completed",
      endedAt: now,
      updatedAt: now,
    };
    if (actualTotal !== undefined) {
      updates.actualTotal = actualTotal;
    }
    await db.transaction("rw", db.trips, () => db.trips.update(id, updates));
  }

  async getActive(): Promise<Trip | undefined> {
    return db.trips.where("status").equals("active").first();
  }

  async list(filters?: TripListFilters): Promise<Trip[]> {
    const collection = db.trips.orderBy("startedAt");

    const results = await collection.reverse().toArray();

    return results.filter((trip) => {
      if (filters?.storeId && trip.storeId !== filters.storeId) return false;
      if (filters?.status && trip.status !== filters.status) return false;
      if (filters?.startAfter && trip.startedAt < filters.startAfter)
        return false;
      if (filters?.startBefore && trip.startedAt > filters.startBefore)
        return false;
      return true;
    });
  }

  async updateBudget(id: string, budget: number | undefined): Promise<void> {
    await db.trips.update(id, {
      budget,
      updatedAt: Date.now(),
    });
  }

  async updateSubtotal(id: string, subtotal: number): Promise<void> {
    await db.trips.update(id, {
      scannedSubtotal: subtotal,
      updatedAt: Date.now(),
    });
  }

  async delete(id: string): Promise<void> {
    await db.transaction(
      "rw",
      [db.trips, db.tripItems, db.priceHistory],
      async () => {
        const tripItems = await db.tripItems
          .where("tripId")
          .equals(id)
          .toArray();
        const tripItemIds = new Set(tripItems.map((ti) => ti.id));
        await db.priceHistory
          .filter((entry) => tripItemIds.has(entry.tripItemId))
          .delete();
        await db.tripItems.where("tripId").equals(id).delete();
        await db.trips.delete(id);
      },
    );
  }
}
