import { db } from "./database";
import { tjReceiptSeedData } from "./tj-receipt-seed-data";
import type { Item } from "../contracts/types";

export async function seedTJReceipt(): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  const items: Item[] = [];
  const now = Date.now();

  for (const input of tjReceiptSeedData) {
    const existing = await db.items.where("barcode").equals(input.barcode).first();
    if (existing) {
      skipped++;
      continue;
    }
    items.push({
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    added++;
  }

  if (items.length > 0) {
    await db.items.bulkPut(items);
  }

  return { added, skipped };
}
