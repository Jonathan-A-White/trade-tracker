import { db } from "@/db/database";

export async function exportAllData(): Promise<string> {
  const [stores, items, trips, tripItems, priceHistory] = await Promise.all([
    db.stores.toArray(),
    db.items.toArray(),
    db.trips.toArray(),
    db.tripItems.toArray(),
    db.priceHistory.toArray(),
  ]);

  return JSON.stringify(
    { stores, items, trips, tripItems, priceHistory },
    null,
    2,
  );
}

export function downloadAsFile(
  data: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
