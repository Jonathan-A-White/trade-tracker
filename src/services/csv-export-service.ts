import { db } from "@/db/database";

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function arrayToCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCsvField).join(",");
  const dataLines = rows.map((row) =>
    row.map(escapeCsvField).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

export async function exportItemsAsCsv(): Promise<string> {
  const items = await db.items.toArray();

  const headers = [
    "ID",
    "Barcode",
    "Name",
    "Current Price",
    "Unit Type",
    "Category",
    "Created At",
    "Updated At",
  ];

  const rows = items.map((item) => [
    item.id,
    item.barcode,
    item.name,
    item.currentPrice.toFixed(2),
    item.unitType,
    item.category ?? "",
    new Date(item.createdAt).toISOString(),
    new Date(item.updatedAt).toISOString(),
  ]);

  return arrayToCsv(headers, rows);
}

export async function exportTripsAsCsv(): Promise<string> {
  const trips = await db.trips.toArray();
  const tripItems = await db.tripItems.toArray();
  const items = await db.items.toArray();
  const stores = await db.stores.toArray();

  const itemMap = new Map(items.map((i) => [i.id, i]));
  const storeMap = new Map(stores.map((s) => [s.id, s]));

  const headers = [
    "Date",
    "Store",
    "Item",
    "Barcode",
    "Quantity",
    "Unit",
    "Price",
    "Line Total",
  ];

  const rows: string[][] = [];

  for (const trip of trips) {
    const store = storeMap.get(trip.storeId);
    const storeName = store?.name ?? "Unknown Store";
    const date = new Date(trip.startedAt).toISOString().split("T")[0];
    const relatedItems = tripItems.filter((ti) => ti.tripId === trip.id);

    for (const ti of relatedItems) {
      const item = itemMap.get(ti.itemId);
      rows.push([
        date,
        storeName,
        item?.name ?? "Unknown Item",
        item?.barcode ?? "",
        ti.quantity.toString(),
        item?.unitType ?? "each",
        ti.price.toFixed(2),
        ti.lineTotal.toFixed(2),
      ]);
    }
  }

  return arrayToCsv(headers, rows);
}
