import { Blob as NodeBlob } from "node:buffer";
import { vault } from "bsv-kit/bsv";
import { db } from "@/db/database";
import { FACTORY_FINGERPRINT_CREDENTIAL_KEY, FACTORY_FINGERPRINT_VAULT_KEY } from "@/services/factory-service";
import { waitForDayKept } from "@/test/end-the-day";
import { PER_ADDRESS_KEYS } from "./keys";
import { packPhone, type Pack } from "./pack";
import { restoreFromPack } from "./unpack";

const photo = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });

const KEPT: Record<string, string> = {
  "tradetracker-factory-public": "02aabb",
  "tradetracker-ynab-token": '{"iv":"x","ciphertext":"y"}',
  "tradetracker-setting-ynab": "on",
  "tradetracker-family-me": "Sarah",
  "bsv-kit.licence": '{"state":"licensed"}',
};
const PER_ADDRESS: Record<string, string> = {
  [FACTORY_FINGERPRINT_VAULT_KEY]: '{"wrapped":"w"}',
  [FACTORY_FINGERPRINT_CREDENTIAL_KEY]: "Y3JlZA==",
};

const unsubscribe = vi.fn(async () => true);
let subscribed = true;

function stubWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => (subscribed ? { unsubscribe } : null) },
      }),
    },
  });
}

/** A pack made at the old address: two stores, one trip with two lines, one pending lookup with a photo. */
async function packedAtOldAddress(): Promise<Pack> {
  await db.stores.bulkAdd([
    { id: "s1", name: "Trader Joe's", createdAt: 1, updatedAt: 1 },
    { id: "s2", name: "Aldi", createdAt: 1, updatedAt: 1 },
  ] as never);
  await db.trips.add({ id: "t1", storeId: "s1", status: "completed", startedAt: 5, createdAt: 5, updatedAt: 5 } as never);
  await db.tripItems.bulkAdd([
    { id: "l1", tripId: "t1", itemId: "i1" },
    { id: "l2", tripId: "t1", itemId: "i2" },
  ] as never);
  await db.pendingLookups.add({ id: "p1", barcode: "9", tripId: "t1", itemId: "i2", photos: [photo([1, 2])], status: "waiting", createdAt: 7 } as never);
  await db.familyCards.add({ id: "c1", lastFour: "1234", owner: "anyone" } as never);
  for (const [k, v] of Object.entries({ ...KEPT, ...PER_ADDRESS })) localStorage.setItem(k, v);
  const pack = await packPhone({ origin: "http://old.example" });
  return JSON.parse(JSON.stringify(pack)) as Pack;
}

async function emptyPhone() {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
}

describe("restoreFromPack", () => {
  // fake-indexeddb copies a row with structuredClone, which keeps node's Blob and turns jsdom's into {}
  beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await emptyPhone();
    unsubscribe.mockClear();
    subscribed = true;
    stubWorker();
  });
  afterEach(() => Reflect.deleteProperty(navigator, "serviceWorker"));

  it("names the per-address keys in keys.ts: the fingerprint's wrapped copy and its credential id", () => {
    expect([...PER_ADDRESS_KEYS].sort()).toEqual([FACTORY_FINGERPRINT_CREDENTIAL_KEY, FACTORY_FINGERPRINT_VAULT_KEY].sort());
  });

  it("refuses a file whose app is not trade-tracker, and changes nothing", async () => {
    const pack = await packedAtOldAddress();
    await emptyPhone();
    await db.stores.add({ id: "mine", name: "Mine", createdAt: 1, updatedAt: 1 } as never);
    await expect(restoreFromPack({ ...pack, app: "lampas" })).rejects.toThrow("This file is not a Trade Tracker pack.");
    await expect(restoreFromPack({ hello: 1 })).rejects.toThrow("This file is not a Trade Tracker pack.");
    expect(await db.stores.count()).toBe(1);
  });

  it("refuses a pack whose version is above 1", async () => {
    const pack = await packedAtOldAddress();
    await emptyPhone();
    await expect(restoreFromPack({ ...pack, version: 2 })).rejects.toThrow(/version 2/);
    expect(await db.stores.count()).toBe(0);
  });

  it("refuses a pack made at this address, and changes nothing", async () => {
    const pack = await packedAtOldAddress();
    localStorage.setItem("tradetracker-theme", "dark");
    await expect(restoreFromPack({ ...pack, from: location.origin })).rejects.toThrow("This file was packed at this address");
    expect(await db.stores.count()).toBe(2);
    expect(localStorage.getItem("tradetracker-theme")).toBe("dark");
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("replaces the tables and the app's own keys with the pack's, and returns the counts", async () => {
    const pack = await packedAtOldAddress();
    await emptyPhone();
    await db.stores.add({ id: "old", name: "Old", createdAt: 1, updatedAt: 1 } as never);
    localStorage.setItem("tradetracker-theme", "dark");
    localStorage.setItem("tradetracker-setting-family", "on");
    localStorage.setItem("someone-elses-key", "stays");

    const counts = await restoreFromPack(pack);

    expect(counts).toEqual({ stores: 2, items: 0, trips: 1, priceHistory: 0, photos: 1 });
    expect((await db.stores.toArray()).map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(await db.tripItems.count()).toBe(2);
    expect(await db.familyCards.count()).toBe(1);
    const [lookup] = await db.pendingLookups.toArray();
    expect(lookup.photos[0]).toBeInstanceOf(Blob);
    // the pack's keys are written, the phone's own that the pack lacks are gone, a key the app does not own is left
    expect(localStorage.getItem("tradetracker-theme")).toBeNull();
    expect(localStorage.getItem("tradetracker-setting-family")).toBeNull();
    expect(localStorage.getItem("someone-elses-key")).toBe("stays");
    for (const [k, v] of Object.entries(KEPT)) expect(localStorage.getItem(k), k).toBe(v);
  });

  it("drops the fingerprint's keys, which are bound to the old hostname", async () => {
    const pack = await packedAtOldAddress();
    expect(Object.keys(pack.storage)).toEqual(expect.arrayContaining([...PER_ADDRESS_KEYS]));
    await emptyPhone();
    await restoreFromPack(pack);
    for (const key of PER_ADDRESS_KEYS) expect(localStorage.getItem(key), key).toBeNull();
    expect(localStorage.getItem("tradetracker-factory-public")).toBe("02aabb");
  });

  it("ends an unlock kept from before, which was the replaced key's", async () => {
    const pack = await packedAtOldAddress();
    await emptyPhone();
    await vault.createKeySession({}).setKey(new Uint8Array(32).fill(5));
    await waitForDayKept();
    await restoreFromPack(pack);
    expect(await vault.indexedDbSessionStore().get()).toBeNull();
  });

  it("turns this address's push subscription off, so Notify me is offered again", async () => {
    const pack = await packedAtOldAddress();
    await emptyPhone();
    await restoreFromPack(pack);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("still restores when the browser has no push subscription or will not unsubscribe", async () => {
    const pack = await packedAtOldAddress();
    await emptyPhone();
    subscribed = false;
    await restoreFromPack(pack);
    expect(await db.stores.count()).toBe(2);
    await emptyPhone();
    subscribed = true;
    unsubscribe.mockRejectedValueOnce(new Error("no"));
    await restoreFromPack(pack);
    expect(await db.stores.count()).toBe(2);
  });
});
