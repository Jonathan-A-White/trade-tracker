import { db } from "@/db/database";
import type {
  Store,
  Item,
  Trip,
  TripItem,
  PriceHistoryEntry,
} from "@/contracts/types";

interface ImportData {
  stores: Store[];
  items: Item[];
  trips: Trip[];
  tripItems: TripItem[];
  priceHistory: PriceHistoryEntry[];
}

interface ImportItemsData {
  type: "items";
  items: Item[];
}

interface ImportTripsData {
  type: "trips";
  stores: Store[];
  trips: Trip[];
  tripItems: TripItem[];
  priceHistory: PriceHistoryEntry[];
}

export function validateImportData(data: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push("Import data must be a JSON object");
    return { valid: false, errors };
  }

  const record = data as Record<string, unknown>;
  const requiredKeys: (keyof ImportData)[] = [
    "stores",
    "items",
    "trips",
    "tripItems",
    "priceHistory",
  ];

  for (const key of requiredKeys) {
    if (!(key in record)) {
      errors.push(`Missing required key: "${key}"`);
    } else if (!Array.isArray(record[key])) {
      errors.push(`"${key}" must be an array`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function importAllData(jsonString: string): Promise<void> {
  const parsed: unknown = JSON.parse(jsonString);
  const validation = validateImportData(parsed);

  if (!validation.valid) {
    throw new Error(
      `Invalid import data: ${validation.errors.join("; ")}`,
    );
  }

  const data = parsed as ImportData;

  await db.transaction(
    "rw",
    [db.stores, db.items, db.trips, db.tripItems, db.priceHistory],
    async () => {
      await db.stores.clear();
      await db.items.clear();
      await db.trips.clear();
      await db.tripItems.clear();
      await db.priceHistory.clear();

      await db.stores.bulkAdd(data.stores);
      await db.items.bulkAdd(data.items);
      await db.trips.bulkAdd(data.trips);
      await db.tripItems.bulkAdd(data.tripItems);
      await db.priceHistory.bulkAdd(data.priceHistory);
    },
  );
}

export function validateItemsImportData(data: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push("Import data must be a JSON object");
    return { valid: false, errors };
  }

  const record = data as Record<string, unknown>;

  if (record.type !== "items") {
    errors.push('File type must be "items". Did you select the wrong file?');
  }

  if (!("items" in record)) {
    errors.push('Missing required key: "items"');
  } else if (!Array.isArray(record.items)) {
    errors.push('"items" must be an array');
  }

  return { valid: errors.length === 0, errors };
}

export function validateTripsImportData(data: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push("Import data must be a JSON object");
    return { valid: false, errors };
  }

  const record = data as Record<string, unknown>;

  if (record.type !== "trips") {
    errors.push('File type must be "trips". Did you select the wrong file?');
  }

  const requiredKeys: (keyof ImportTripsData)[] = [
    "stores",
    "trips",
    "tripItems",
    "priceHistory",
  ];

  for (const key of requiredKeys) {
    if (!(key in record)) {
      errors.push(`Missing required key: "${key}"`);
    } else if (!Array.isArray(record[key])) {
      errors.push(`"${key}" must be an array`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function importItemsData(jsonString: string): Promise<{ added: number; skipped: number }> {
  const parsed: unknown = JSON.parse(jsonString);
  const validation = validateItemsImportData(parsed);

  if (!validation.valid) {
    throw new Error(`Invalid import data: ${validation.errors.join("; ")}`);
  }

  const data = parsed as ImportItemsData;
  let added = 0;
  let skipped = 0;

  await db.transaction("rw", [db.items], async () => {
    for (const item of data.items) {
      const existing = await db.items.get(item.id);
      if (existing) {
        skipped++;
      } else {
        await db.items.add(item);
        added++;
      }
    }
  });

  return { added, skipped };
}

export async function importTripsData(jsonString: string): Promise<{ added: number; skipped: number }> {
  const parsed: unknown = JSON.parse(jsonString);
  const validation = validateTripsImportData(parsed);

  if (!validation.valid) {
    throw new Error(`Invalid import data: ${validation.errors.join("; ")}`);
  }

  const data = parsed as ImportTripsData;
  let added = 0;
  let skipped = 0;

  await db.transaction(
    "rw",
    [db.stores, db.trips, db.tripItems, db.priceHistory],
    async () => {
      // Import stores (skip existing)
      for (const store of data.stores) {
        const existing = await db.stores.get(store.id);
        if (!existing) {
          await db.stores.add(store);
        }
      }

      // Import trips (skip existing)
      for (const trip of data.trips) {
        const existing = await db.trips.get(trip.id);
        if (existing) {
          skipped++;
        } else {
          await db.trips.add(trip);
          added++;
        }
      }

      // Import trip items (skip existing)
      for (const tripItem of data.tripItems) {
        const existing = await db.tripItems.get(tripItem.id);
        if (!existing) {
          await db.tripItems.add(tripItem);
        }
      }

      // Import price history (skip existing)
      for (const entry of data.priceHistory) {
        const existing = await db.priceHistory.get(entry.id);
        if (!existing) {
          await db.priceHistory.add(entry);
        }
      }
    },
  );

  return { added, skipped };
}
