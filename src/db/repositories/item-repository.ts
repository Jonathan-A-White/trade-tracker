import { db } from "../database";
import type { Item, CreateItemInput } from "../../contracts/types";

export class ItemRepository {
  async create(input: CreateItemInput): Promise<Item> {
    const now = Date.now();
    const item: Item = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    await db.items.put(item);
    return item;
  }

  async getById(id: string): Promise<Item | undefined> {
    return db.items.get(id);
  }

  async update(
    id: string,
    changes: Partial<Omit<Item, "id" | "createdAt">>
  ): Promise<void> {
    await db.items.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
  }

  async delete(id: string): Promise<void> {
    await db.items.delete(id);
  }

  async searchByName(query: string): Promise<Item[]> {
    const lowerQuery = query.toLowerCase();
    return db.items
      .filter((item) => item.name.toLowerCase().includes(lowerQuery))
      .toArray();
  }

  async findByBarcode(barcode: string): Promise<Item | undefined> {
    return db.items.where("barcode").equals(barcode).first();
  }

  async listByCategory(category: string): Promise<Item[]> {
    return db.items.where("category").equals(category).toArray();
  }

  async listAll(): Promise<Item[]> {
    return db.items.orderBy("name").toArray();
  }
}
