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
