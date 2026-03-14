import { db } from "../database";
import type { Store, CreateStoreInput } from "../../contracts/types";

export class StoreRepository {
  async create(input: CreateStoreInput): Promise<Store> {
    const now = Date.now();
    const store: Store = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    await db.stores.put(store);
    return store;
  }

  async getById(id: string): Promise<Store | undefined> {
    return db.stores.get(id);
  }

  async update(
    id: string,
    changes: Partial<Omit<Store, "id" | "createdAt">>
  ): Promise<void> {
    await db.stores.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
  }

  async delete(id: string): Promise<void> {
    await db.stores.delete(id);
  }

  async listAll(): Promise<Store[]> {
    return db.stores.orderBy("name").toArray();
  }
}
