import { db } from "@/db/database";
import type { CreateItemInput, Item } from "@/contracts/types";

/** A fixed list of items the Settings screen can load into the library. */
export interface SeedList {
  id: string;
  title: string;
  items: readonly CreateItemInput[];
}

/**
 * Adds every item of the list whose barcode is not in the library yet;
 * items already there are left alone and counted as skipped.
 */
export async function seedItems(list: SeedList): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  const items: Item[] = [];
  const now = Date.now();

  for (const input of list.items) {
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
