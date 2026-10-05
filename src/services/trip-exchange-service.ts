import { db } from "@/db/database";
import type {
  Store,
  Item,
  Trip,
  TripItem,
  PriceHistoryEntry,
  UnitType,
} from "@/contracts/types";
import { calculateLineTotal, countsTowardTotal } from "@/core/pricing";

// --- Export types ---

interface TripExportData {
  type: "trip-exchange";
  version: 1;
  exportedAt: number;
  instructions: string;
  example: {
    store: Pick<Store, "name" | "city" | "state">;
    trip: {
      startedAt: number;
      endedAt?: number;
      actualTotal?: number;
      budget?: number;
      note?: string;
    };
    items: Array<{
      name: string;
      barcode: string | null;
      currentPrice: number;
      unitType: UnitType;
      category?: string;
    }>;
    tripItems: Array<{
      itemIndex: number;
      price: number;
      quantity: number;
      weightLbs?: number;
      onSale: boolean;
      taxable?: boolean;
      bottleDeposit?: number;
    }>;
  };
}

// --- Import types ---

interface TripImportStore {
  name: string;
  city?: string;
  state?: string;
}

interface TripImportItem {
  name: string;
  barcode?: string | null;
  currentPrice: number;
  unitType: UnitType;
  category?: string;
}

interface TripImportTripItem {
  itemIndex: number;
  price: number;
  quantity: number;
  weightLbs?: number;
  onSale: boolean;
  /** Explicit taxable flag from the receipt. If omitted, the app's heuristic is used. */
  taxable?: boolean;
  /** Bottle/container deposit total for this line (e.g., CT $0.05/can × 12 = 0.60). */
  bottleDeposit?: number;
}

interface TripImportData {
  type: "trip-import";
  version: 1;
  store: TripImportStore;
  trip: {
    startedAt?: number | string;
    endedAt?: number | string;
    actualTotal?: number;
    budget?: number;
    note?: string;
  };
  items: TripImportItem[];
  tripItems: TripImportTripItem[];
}

interface TripImportResult {
  tripId: string;
  storeCreated: boolean;
  itemsCreated: number;
  itemsMatched: number;
  itemsMissingBarcode: number;
}

const MANUAL_BARCODE_PREFIX = "manual-";

const INSTRUCTIONS = `You are helping import a shopping trip into a grocery price tracking app.

Given a receipt (photo or text), generate a JSON object matching the "trip-import" format below.
Use the "example" field as a reference for the data structure.

IMPORT FORMAT:
{
  "type": "trip-import",
  "version": 1,
  "store": {
    "name": "Store Name",
    "city": "City (optional)",
    "state": "ST (optional)"
  },
  "trip": {
    "startedAt": "2025-01-15T10:30:00Z or epoch ms (optional, use receipt date)",
    "actualTotal": 45.67,
    "note": "Optional note about the trip"
  },
  "items": [
    {
      "name": "Clear, descriptive product name",
      "barcode": null,
      "currentPrice": 3.49,
      "unitType": "each or per_lb",
      "category": "Optional: produce, dairy, meat, bakery, frozen, pantry, beverage, snacks, household, other"
    }
  ],
  "tripItems": [
    {
      "itemIndex": 0,
      "price": 3.49,
      "quantity": 1,
      "onSale": false,
      "taxable": false,
      "bottleDeposit": 0.60
    }
  ]
}

RULES:
1. Each item in "items" is a unique product. Each entry in "tripItems" links to an item by its index in the "items" array.
2. If the same product appears multiple times on the receipt, create ONE item and ONE tripItem with the correct quantity.
3. Set "barcode" to null for all receipt items (barcodes aren't on receipts). The app will generate placeholder barcodes.
4. Use "per_lb" for unitType when the receipt shows a weight-based price (e.g., "1.5 lb @ $3.99/lb"). Set weightLbs on the tripItem.
5. For weight-based items: set tripItem.quantity to 1 and tripItem.weightLbs to the weight. Set tripItem.price to the per-lb price.
6. "currentPrice" on the item should match the tripItem price.
7. Write clear, full product names — expand abbreviations from the receipt (e.g., "ORG BANA" → "Organic Bananas").
8. If the receipt shows a total, set trip.actualTotal to that value.
9. If an item appears to be on sale or discounted, set onSale to true.
10. "startedAt" can be an ISO date string or epoch milliseconds. Use the receipt date if visible.
11. Assign reasonable categories when possible based on the product name.
12. TAX: If the receipt marks individual lines as taxable (e.g., with a "T" flag, or a "Taxable" column), set tripItem.taxable accordingly (true = taxed, false = exempt). Omit taxable if the receipt doesn't distinguish — the app will fall back to its own classification heuristic. Do NOT include a separate tax line as a tripItem.
13. BOTTLE DEPOSITS: If the receipt shows a per-container deposit (e.g., CT $0.05/can, "CT DEP"), attribute it to the beverage line it belongs to by setting tripItem.bottleDeposit to the total deposit for that line (e.g., 12 cans × $0.05 = 0.60). Do NOT create a separate tripItem for deposit lines, and do NOT include the deposit in tripItem.price or items.currentPrice.`;

export function isManualBarcode(barcode: string): boolean {
  return barcode.startsWith(MANUAL_BARCODE_PREFIX);
}

export async function exportTripForAI(tripId: string): Promise<string> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error("Trip not found");

  const store = await db.stores.get(trip.storeId);
  if (!store) throw new Error("Store not found");

  const tripItems = await db.tripItems
    .where("tripId")
    .equals(tripId)
    .filter(countsTowardTotal)
    .toArray();

  const itemIds = [...new Set(tripItems.map((ti) => ti.itemId))];
  const items = await db.items.where("id").anyOf(itemIds).toArray();
  const itemMap: Record<string, Item> = {};
  for (const item of items) {
    itemMap[item.id] = item;
  }

  const exportItems = tripItems.map((ti) => {
    const item = itemMap[ti.itemId];
    return {
      name: item?.name ?? "Unknown Item",
      barcode: item ? (isManualBarcode(item.barcode) ? null : item.barcode) : null,
      currentPrice: ti.price,
      unitType: (item?.unitType ?? "each") as UnitType,
      category: item?.category,
    };
  });

  const exportTripItems = tripItems.map((ti, index) => ({
    itemIndex: index,
    price: ti.price,
    quantity: ti.quantity,
    weightLbs: ti.weightLbs,
    onSale: ti.onSale,
    taxable: ti.taxOverride,
    bottleDeposit: ti.bottleDeposit,
  }));

  const data: TripExportData = {
    type: "trip-exchange",
    version: 1,
    exportedAt: Date.now(),
    instructions: INSTRUCTIONS,
    example: {
      store: {
        name: store.name,
        city: store.city,
        state: store.state,
      },
      trip: {
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        actualTotal: trip.actualTotal,
        budget: trip.budget,
        note: trip.note,
      },
      items: exportItems,
      tripItems: exportTripItems,
    },
  };

  return JSON.stringify(data, null, 2);
}

export function validateTripImportData(data: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push("Import data must be a JSON object");
    return { valid: false, errors };
  }

  const record = data as Record<string, unknown>;

  if (record.type !== "trip-import") {
    errors.push('Field "type" must be "trip-import"');
  }

  if (!record.store || typeof record.store !== "object") {
    errors.push('Missing or invalid "store" object');
  } else {
    const store = record.store as Record<string, unknown>;
    if (typeof store.name !== "string" || store.name.trim() === "") {
      errors.push("Store must have a non-empty name");
    }
  }

  if (!record.trip || typeof record.trip !== "object") {
    errors.push('Missing or invalid "trip" object');
  }

  if (!Array.isArray(record.items)) {
    errors.push('"items" must be an array');
  } else {
    for (let i = 0; i < record.items.length; i++) {
      const item = record.items[i] as Record<string, unknown>;
      if (typeof item.name !== "string" || item.name.trim() === "") {
        errors.push(`items[${i}]: must have a non-empty name`);
      }
      if (typeof item.currentPrice !== "number" || item.currentPrice < 0) {
        errors.push(`items[${i}]: currentPrice must be a non-negative number`);
      }
      if (item.unitType !== "each" && item.unitType !== "per_lb") {
        errors.push(`items[${i}]: unitType must be "each" or "per_lb"`);
      }
    }
  }

  if (!Array.isArray(record.tripItems)) {
    errors.push('"tripItems" must be an array');
  } else {
    const itemCount = Array.isArray(record.items) ? record.items.length : 0;
    for (let i = 0; i < record.tripItems.length; i++) {
      const ti = record.tripItems[i] as Record<string, unknown>;
      if (typeof ti.itemIndex !== "number" || ti.itemIndex < 0 || ti.itemIndex >= itemCount) {
        errors.push(`tripItems[${i}]: itemIndex must reference a valid item (0-${itemCount - 1})`);
      }
      if (typeof ti.price !== "number" || ti.price < 0) {
        errors.push(`tripItems[${i}]: price must be a non-negative number`);
      }
      if (typeof ti.quantity !== "number" || ti.quantity < 1) {
        errors.push(`tripItems[${i}]: quantity must be at least 1`);
      }
      if (ti.taxable !== undefined && typeof ti.taxable !== "boolean") {
        errors.push(`tripItems[${i}]: taxable must be a boolean when provided`);
      }
      if (
        ti.bottleDeposit !== undefined &&
        (typeof ti.bottleDeposit !== "number" || ti.bottleDeposit < 0)
      ) {
        errors.push(`tripItems[${i}]: bottleDeposit must be a non-negative number`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  return Date.now();
}

/** Prices that round to the same cent are treated as equal. */
const PRICE_MATCH_EPSILON = 0.005;

/**
 * Minimum token-overlap score (shared tokens / smaller token set) for two
 * product names to be considered the same product. Combined with an exact
 * price match, this tolerates extra words (e.g. sizes) while rejecting
 * genuinely different products.
 */
const NAME_MATCH_THRESHOLD = 0.6;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeName(name: string): Set<string> {
  const normalized = normalizeName(name);
  return new Set(normalized.length === 0 ? [] : normalized.split(" "));
}

/**
 * Fuzzy similarity between two product names in [0, 1]. Identical normalized
 * names score 1; otherwise the score is the fraction of the smaller name's
 * tokens that also appear in the larger name (containment), so "Almond Milk"
 * matches "Almond Milk 64oz" but not "Almond Butter".
 */
export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (normA.length === 0 || normB.length === 0) return 0;
  if (normA === normB) return 1;

  const tokensA = tokenizeName(a);
  const tokensB = tokenizeName(b);
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared++;
  }
  return shared / Math.min(tokensA.size, tokensB.size);
}

/**
 * Finds an existing item whose price matches (within a cent) and whose name is
 * fuzzily similar to the given description. Used to reuse an existing item —
 * and its barcode — for an imported line that has no barcode of its own,
 * instead of minting a duplicate placeholder item. When several items qualify,
 * the closest name wins, with a real (non-placeholder) barcode breaking ties.
 */
export async function findItemByDescriptionAndPrice(
  name: string,
  price: number,
): Promise<Item | undefined> {
  const candidates = await db.items
    .filter((item) => Math.abs(item.currentPrice - price) < PRICE_MATCH_EPSILON)
    .toArray();

  let best: Item | undefined;
  let bestScore = 0;
  for (const item of candidates) {
    const score = nameSimilarity(name, item.name);
    if (score < NAME_MATCH_THRESHOLD) continue;

    const beatsBest = best === undefined || score > bestScore;
    const tieButRealBarcode =
      best !== undefined &&
      score === bestScore &&
      isManualBarcode(best.barcode) &&
      !isManualBarcode(item.barcode);
    if (beatsBest || tieButRealBarcode) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

interface ResolvedImportItem {
  itemId: string;
  matched: boolean;
  created: boolean;
  missingBarcode: boolean;
}

/**
 * Resolves an imported line to an item id, matching an existing item where
 * possible and creating one otherwise. Resolution order:
 *   1. Exact barcode match (when the import carries a real barcode).
 *   2. Fuzzy description + price match — reuses the existing item and, when the
 *      import supplies a real barcode the match is missing, adopts that barcode.
 *   3. Otherwise create a new item, generating a placeholder barcode if none
 *      was supplied.
 * Must be called inside a read/write transaction covering db.items.
 */
async function resolveImportItem(
  importItem: TripImportItem,
  now: number,
): Promise<ResolvedImportItem> {
  const importBarcode =
    importItem.barcode && importItem.barcode.trim() !== ""
      ? importItem.barcode.trim()
      : undefined;

  // 1. Match by exact barcode.
  if (importBarcode) {
    const existingByBarcode = await db.items
      .where("barcode")
      .equals(importBarcode)
      .first();
    if (existingByBarcode) {
      await db.items.update(existingByBarcode.id, {
        currentPrice: importItem.currentPrice,
        updatedAt: now,
      });
      return {
        itemId: existingByBarcode.id,
        matched: true,
        created: false,
        missingBarcode: false,
      };
    }
  }

  // 2. Match by description + price, reusing the existing item (and barcode).
  const descMatch = await findItemByDescriptionAndPrice(
    importItem.name,
    importItem.currentPrice,
  );
  if (descMatch) {
    const changes: Partial<Item> = {
      currentPrice: importItem.currentPrice,
      updatedAt: now,
    };
    // Adopt a real barcode from the import when the match only has a placeholder.
    if (importBarcode && isManualBarcode(descMatch.barcode)) {
      changes.barcode = importBarcode;
    }
    // Backfill a category when the existing item is missing one.
    if (importItem.category && !descMatch.category) {
      changes.category = importItem.category;
    }
    await db.items.update(descMatch.id, changes);
    return {
      itemId: descMatch.id,
      matched: true,
      created: false,
      missingBarcode: false,
    };
  }

  // 3. No match — create a new item, generating a placeholder barcode if needed.
  const itemId = crypto.randomUUID();
  const barcode = importBarcode ?? `${MANUAL_BARCODE_PREFIX}${crypto.randomUUID()}`;
  const item: Item = {
    id: itemId,
    barcode,
    name: importItem.name,
    currentPrice: importItem.currentPrice,
    unitType: importItem.unitType,
    category: importItem.category,
    createdAt: now,
    updatedAt: now,
  };
  await db.items.put(item);
  return {
    itemId,
    matched: false,
    created: true,
    missingBarcode: isManualBarcode(barcode),
  };
}

export async function reimportTripFromAI(
  existingTripId: string,
  jsonString: string,
): Promise<TripImportResult> {
  const parsed: unknown = JSON.parse(jsonString);
  const validation = validateTripImportData(parsed);

  if (!validation.valid) {
    throw new Error(`Invalid trip import data: ${validation.errors.join("; ")}`);
  }

  const data = parsed as TripImportData;
  const now = Date.now();

  const existingTrip = await db.trips.get(existingTripId);
  if (!existingTrip) throw new Error("Trip not found");

  let itemsCreated = 0;
  let itemsMatched = 0;
  let itemsMissingBarcode = 0;

  const itemIdMap: string[] = [];

  await db.transaction(
    "rw",
    [db.items, db.trips, db.tripItems, db.priceHistory, db.pendingLookups],
    async () => {
      // Delete existing trip items and their price history
      const existingTripItems = await db.tripItems
        .where("tripId")
        .equals(existingTripId)
        .toArray();
      const existingTripItemIds = existingTripItems.map((ti) => ti.id);

      await db.tripItems.where("tripId").equals(existingTripId).delete();
      // their pending lines are gone, so the lookups waiting to fill them go too
      await db.pendingLookups.where("tripId").equals(existingTripId).delete();
      if (existingTripItemIds.length > 0) {
        await db.priceHistory
          .where("tripItemId")
          .anyOf(existingTripItemIds)
          .delete();
      }

      // Create or match items
      for (const importItem of data.items) {
        const resolved = await resolveImportItem(importItem, now);
        if (resolved.matched) itemsMatched++;
        if (resolved.created) itemsCreated++;
        if (resolved.missingBarcode) itemsMissingBarcode++;
        itemIdMap.push(resolved.itemId);
      }

      // Build new trip items
      let scannedSubtotal = 0;
      const tripItemRecords: TripItem[] = [];
      const priceHistoryRecords: PriceHistoryEntry[] = [];

      for (const importTripItem of data.tripItems) {
        const itemId = itemIdMap[importTripItem.itemIndex];
        const lineTotal = calculateLineTotal(
          importTripItem.price,
          importTripItem.quantity,
          importTripItem.weightLbs,
        );
        scannedSubtotal += lineTotal;

        const tripItemId = crypto.randomUUID();
        const record: TripItem = {
          id: tripItemId,
          tripId: existingTripId,
          itemId,
          price: importTripItem.price,
          quantity: importTripItem.quantity,
          weightLbs: importTripItem.weightLbs,
          lineTotal,
          onSale: importTripItem.onSale ?? false,
          addedAt: now,
        };
        if (importTripItem.taxable !== undefined) {
          record.taxOverride = importTripItem.taxable;
        }
        if (importTripItem.bottleDeposit !== undefined && importTripItem.bottleDeposit > 0) {
          record.bottleDeposit = importTripItem.bottleDeposit;
        }
        tripItemRecords.push(record);

        priceHistoryRecords.push({
          id: crypto.randomUUID(),
          itemId,
          storeId: existingTrip.storeId,
          tripItemId,
          price: importTripItem.price,
          recordedAt: existingTrip.startedAt,
        });
      }

      // Update trip
      await db.trips.update(existingTripId, {
        scannedSubtotal,
        actualTotal: data.trip.actualTotal ?? existingTrip.actualTotal,
        note: data.trip.note ?? existingTrip.note,
        updatedAt: now,
      });

      await db.tripItems.bulkPut(tripItemRecords);
      await db.priceHistory.bulkPut(priceHistoryRecords);
    },
  );

  return {
    tripId: existingTripId,
    storeCreated: false,
    itemsCreated,
    itemsMatched,
    itemsMissingBarcode,
  };
}

export async function importTripFromAI(jsonString: string): Promise<TripImportResult> {
  const parsed: unknown = JSON.parse(jsonString);
  const validation = validateTripImportData(parsed);

  if (!validation.valid) {
    throw new Error(`Invalid trip import data: ${validation.errors.join("; ")}`);
  }

  const data = parsed as TripImportData;
  const now = Date.now();

  let storeCreated = false;
  let itemsCreated = 0;
  let itemsMatched = 0;
  let itemsMissingBarcode = 0;

  // Find or create store
  const existingStores = await db.stores
    .filter((s) => s.name.toLowerCase() === data.store.name.toLowerCase())
    .toArray();

  let storeId: string;
  if (existingStores.length > 0) {
    storeId = existingStores[0].id;
  } else {
    storeId = crypto.randomUUID();
    storeCreated = true;
  }

  const startedAt = parseTimestamp(data.trip.startedAt);
  const endedAt = data.trip.endedAt ? parseTimestamp(data.trip.endedAt) : now;

  const tripId = crypto.randomUUID();

  // Map item indices to created/matched item IDs
  const itemIdMap: string[] = [];

  await db.transaction(
    "rw",
    [db.stores, db.items, db.trips, db.tripItems, db.priceHistory],
    async () => {
      // Create store if needed
      if (storeCreated) {
        const store: Store = {
          id: storeId,
          name: data.store.name,
          city: data.store.city,
          state: data.store.state,
          createdAt: now,
          updatedAt: now,
        };
        await db.stores.put(store);
      }

      // Create or match items
      for (const importItem of data.items) {
        const resolved = await resolveImportItem(importItem, now);
        if (resolved.matched) itemsMatched++;
        if (resolved.created) itemsCreated++;
        if (resolved.missingBarcode) itemsMissingBarcode++;
        itemIdMap.push(resolved.itemId);
      }

      // Calculate subtotal from trip items
      let scannedSubtotal = 0;
      const tripItemRecords: TripItem[] = [];
      const priceHistoryRecords: PriceHistoryEntry[] = [];

      for (const importTripItem of data.tripItems) {
        const itemId = itemIdMap[importTripItem.itemIndex];
        const lineTotal = calculateLineTotal(
          importTripItem.price,
          importTripItem.quantity,
          importTripItem.weightLbs,
        );
        scannedSubtotal += lineTotal;

        const tripItemId = crypto.randomUUID();
        const record: TripItem = {
          id: tripItemId,
          tripId,
          itemId,
          price: importTripItem.price,
          quantity: importTripItem.quantity,
          weightLbs: importTripItem.weightLbs,
          lineTotal,
          onSale: importTripItem.onSale ?? false,
          addedAt: now,
        };
        if (importTripItem.taxable !== undefined) {
          record.taxOverride = importTripItem.taxable;
        }
        if (importTripItem.bottleDeposit !== undefined && importTripItem.bottleDeposit > 0) {
          record.bottleDeposit = importTripItem.bottleDeposit;
        }
        tripItemRecords.push(record);

        priceHistoryRecords.push({
          id: crypto.randomUUID(),
          itemId,
          storeId,
          tripItemId,
          price: importTripItem.price,
          recordedAt: startedAt,
        });
      }

      // Create trip
      const trip: Trip = {
        id: tripId,
        storeId,
        status: "completed",
        startedAt,
        endedAt,
        scannedSubtotal,
        actualTotal: data.trip.actualTotal,
        budget: data.trip.budget,
        note: data.trip.note,
        createdAt: now,
        updatedAt: now,
      };
      await db.trips.put(trip);

      // Create trip items and price history
      await db.tripItems.bulkPut(tripItemRecords);
      await db.priceHistory.bulkPut(priceHistoryRecords);
    },
  );

  return {
    tripId,
    storeCreated,
    itemsCreated,
    itemsMatched,
    itemsMissingBarcode,
  };
}
