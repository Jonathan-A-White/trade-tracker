import { db } from "@/db/database";
import { seedItems } from "./seed-lists";
import type { SeedList } from "./seed-lists";

const list: SeedList = {
  id: "test-list",
  title: "Test list",
  items: [
    { barcode: "111", name: "One", currentPrice: 1, unitType: "each", category: "Other" },
    { barcode: "222", name: "Two", currentPrice: 2, unitType: "each", category: "Other" },
  ],
};

describe("seedItems", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it("adds every item of a new list", async () => {
    expect(await seedItems(list)).toEqual({ added: 2, skipped: 0 });
    const stored = await db.items.orderBy("barcode").toArray();
    expect(stored.map((i) => [i.barcode, i.name])).toEqual([
      ["111", "One"],
      ["222", "Two"],
    ]);
    expect(stored[0].id).toBeTruthy();
  });

  it("skips barcodes already in the library and leaves them untouched", async () => {
    await db.items.add({
      id: "mine",
      barcode: "111",
      name: "My own name",
      currentPrice: 9,
      unitType: "each",
      category: "Other",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await seedItems(list)).toEqual({ added: 1, skipped: 1 });
    expect((await db.items.get("mine"))?.name).toBe("My own name");
    expect(await db.items.count()).toBe(2);
  });

  it("reports everything skipped when run twice", async () => {
    await seedItems(list);
    expect(await seedItems(list)).toEqual({ added: 0, skipped: 2 });
    expect(await db.items.count()).toBe(2);
  });
});
