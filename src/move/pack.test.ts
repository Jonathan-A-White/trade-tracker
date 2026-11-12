import { Blob as NodeBlob } from "node:buffer";
import { db, TradeTrackerDB } from "@/db/database";
import { ownsKey } from "./keys";
import { packCounts, packPhone, type Pack } from "./pack";
import { unpackPhone } from "./unpack";

const photo = (bytes: number[], type = "image/jpeg") => new Blob([new Uint8Array(bytes)], { type });

const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];

async function fill() {
  await db.stores.add({ id: "s1", name: "Trader Joe's", createdAt: 1, updatedAt: 1 } as never);
  await db.items.add({ id: "i1", barcode: "0001", name: "Milk", category: "dairy", createdAt: 1, updatedAt: 1 } as never);
  await db.trips.add({ id: "t1", storeId: "s1", status: "completed", startedAt: 5, createdAt: 5, updatedAt: 5 } as never);
  await db.priceHistory.add({ id: "p1", itemId: "i1", storeId: "s1", recordedAt: 6 } as never);
  await db.pendingLookups.add({
    id: "l1",
    barcode: "0002",
    tripId: "t1",
    itemId: "pending-1",
    photos: [photo([1, 2, 3]), photo([255, 0, 128, 7], "image/png")],
    status: "waiting",
    createdAt: 7,
  } as never);
  await db.familyCards.add({ id: "c1", lastFour: "1234", owner: "anyone" } as never);
  await db.ynabOutbox.add({ clientId: "o1", queuedAt: 9 } as never);
}

const KEYS: Record<string, string> = {
  "tradetracker-factory-key": '{"sealed":"abc"}',
  "tradetracker-factory-public": "02aabb",
  "tradetracker-ynab-token": '{"iv":"x","ciphertext":"y"}',
  "tradetracker-setting-ynab": "on",
  "tradetracker-theme": "dark",
  "bsv-kit.licence": '{"state":"licensed"}',
};

// fake-indexeddb copies a row with structuredClone, which keeps node's Blob and turns jsdom's into {}: the tests use node's.
describe("packPhone", () => {
  beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    localStorage.clear();
    for (const [k, v] of Object.entries(KEYS)) localStorage.setItem(k, v);
  });

  it("carries every table the database has, read from db.tables", async () => {
    await fill();
    const pack = await packPhone();
    expect(Object.keys(pack.db.tables).sort()).toEqual(db.tables.map((t) => t.name).sort());
    expect(pack.db.schema).toBe(13);
    expect(pack.version).toBe(1);
    expect(pack.app).toBe("trade-tracker");
    expect(pack.from).toBe(location.origin);
    expect(new Date(pack.when).toISOString()).toBe(pack.when);
  });

  it("carries every owned key it finds, as it is, and nothing else", async () => {
    localStorage.setItem("someone-elses-key", "no");
    const pack = await packPhone();
    expect(pack.storage).toEqual(KEYS);
    for (const key of Object.keys(pack.storage)) expect(ownsKey(key)).toBe(true);
  });

  it("carries a photo as base64 and its type", async () => {
    await fill();
    const pack = await packPhone();
    const [row] = pack.db.tables.pendingLookups as { photos: { blob: string; type: string }[] }[];
    expect(row.photos).toEqual([
      { blob: btoa(String.fromCharCode(1, 2, 3)), type: "image/jpeg" },
      { blob: btoa(String.fromCharCode(255, 0, 128, 7)), type: "image/png" },
    ]);
    expect(JSON.parse(JSON.stringify(pack))).toEqual(pack);
  });

  it("counts the stores, items, trips, prices and photos it carries", async () => {
    await fill();
    expect(packCounts(await packPhone())).toEqual({ stores: 1, items: 1, trips: 1, priceHistory: 1, photos: 2 });
  });

  it("round-trips: unpacked into a fresh database and fresh storage, the rows and keys are equal", async () => {
    await fill();
    const pack = await packPhone();
    const before = Object.fromEntries(
      await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()] as const)),
    );
    const sentOver = JSON.parse(JSON.stringify(pack)) as Pack;

    await db.delete();
    await db.open();
    localStorage.clear();
    for (const t of db.tables) expect(await t.count(), t.name).toBe(0);

    await unpackPhone(sentOver);

    expect(new Set(db.tables.map((t) => t.name))).toEqual(new Set(Object.keys(before)));
    for (const t of db.tables) {
      const after = await t.toArray();
      const rows = before[t.name];
      expect(after.length, t.name).toBe(rows.length);
      if (t.name === "pendingLookups") continue;
      expect(after, t.name).toEqual(rows);
    }
    const [lookup] = await db.pendingLookups.toArray();
    const [original] = before.pendingLookups as { photos: Blob[] }[];
    expect(lookup.photos.every((p) => p instanceof Blob)).toBe(true);
    expect(lookup.photos.map((p) => p.type)).toEqual(original.photos.map((p) => p.type));
    expect(await Promise.all(lookup.photos.map(bytesOf))).toEqual(await Promise.all(original.photos.map(bytesOf)));
    expect({ ...lookup, photos: [] }).toEqual({ ...(original as object), photos: [] });
    expect(Object.fromEntries(Object.entries(localStorage))).toEqual(KEYS);
  });

  it("refuses a file that is not a pack, and one from a newer schema, and leaves the phone as it was", async () => {
    await fill();
    await expect(unpackPhone({ hello: 1 })).rejects.toThrow(/not a Trade Tracker pack/i);
    const pack = await packPhone();
    await expect(unpackPhone({ ...pack, version: 2 })).rejects.toThrow(/version/i);
    await expect(unpackPhone({ ...pack, db: { ...pack.db, schema: 99 } })).rejects.toThrow(/newer/i);
    await expect(unpackPhone({ ...pack, db: { ...pack.db, tables: { ...pack.db.tables, nope: [] } } })).rejects.toThrow(/nope/);
    expect(await db.stores.count()).toBe(1);
  });

  it("is the same database class the app opens", () => {
    expect(db).toBeInstanceOf(TradeTrackerDB);
  });
});
