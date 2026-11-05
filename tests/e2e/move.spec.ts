// Moves a phone between two origins on one preview server (http://localhost:<port> and http://127.0.0.1:<port> are two origins to the browser,
// each with its own IndexedDB, localStorage and passkeys): at the old one the phone gets a key, two stores, one trip with two lines and a
// pending lookup with a photo, and packs itself; at the other, which has never seen it, Home offers 'Moving from the old address? Unpack',
// the file is unpacked, and the counts, the rows and the key equal the old ones while the old origin's data is untouched.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./shot";

interface Dump {
  /** every table's rows, a Blob as { type, bytes } */
  tables: Record<string, unknown[]>;
  keys: Record<string, string>;
}

/** Everything the phone holds at the page's origin, read straight from IndexedDB and localStorage (not through the app). */
async function dump(page: Page): Promise<Dump> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("TradeTrackerDB");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const plain = async (value: unknown): Promise<unknown> => {
      if (value instanceof Blob) return { type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())] };
      if (Array.isArray(value)) return Promise.all(value.map(plain));
      if (value && typeof value === "object") {
        return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await plain(v)])));
      }
      return value;
    };
    const tables: Record<string, unknown[]> = {};
    for (const name of [...db.objectStoreNames].sort()) {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      tables[name] = (await plain(rows)) as unknown[];
    }
    db.close();
    const keys: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys[key] = localStorage.getItem(key) ?? "";
    }
    return { tables, keys };
  });
}

/** Puts the rows into the app's own database (as the app wrote them), so the phone holds a month of use without a month of clicking. */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("TradeTrackerDB");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const now = 1_762_300_000_000;
    const photo = new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70])], { type: "image/jpeg" });
    const rows: Record<string, unknown[]> = {
      stores: [
        { id: "store-tj", name: "Trader Joe's", createdAt: now, updatedAt: now },
        { id: "store-aldi", name: "Aldi", createdAt: now, updatedAt: now },
      ],
      items: [
        { id: "item-milk", barcode: "0001", name: "Milk", currentPrice: 3.49, unitType: "each", createdAt: now, updatedAt: now },
        { id: "item-eggs", barcode: "0002", name: "Eggs", currentPrice: 4.29, unitType: "each", createdAt: now, updatedAt: now },
      ],
      trips: [
        { id: "trip-1", storeId: "store-tj", status: "completed", startedAt: now, endedAt: now + 1, scannedSubtotal: 7.78, actualTotal: 7.78, createdAt: now, updatedAt: now },
      ],
      tripItems: [
        { id: "line-1", tripId: "trip-1", itemId: "item-milk", price: 3.49, quantity: 1, lineTotal: 3.49, onSale: false, createdAt: now },
        { id: "line-2", tripId: "trip-1", itemId: "item-eggs", price: 4.29, quantity: 1, lineTotal: 4.29, onSale: false, createdAt: now },
      ],
      priceHistory: [
        { id: "price-1", itemId: "item-milk", storeId: "store-tj", price: 3.49, recordedAt: now },
        { id: "price-2", itemId: "item-eggs", storeId: "store-tj", price: 4.29, recordedAt: now },
      ],
      pendingLookups: [
        { id: "lookup-1", barcode: "0003", tripId: "trip-1", itemId: "pending-1", photos: [photo], status: "waiting-to-send", createdAt: now },
      ],
    };
    const names = Object.keys(rows);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(names, "readwrite");
      for (const name of names) for (const row of rows[name]) tx.objectStore(name).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

async function addVirtualFingerprint(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  });
}

test("a phone packed at one origin is unpacked at another: the counts, the rows and the key equal, the old origin untouched", async ({ page, context, baseURL }) => {
  const oldOrigin = new URL(baseURL!);
  const newOrigin = new URL(oldOrigin);
  newOrigin.hostname = "127.0.0.1";
  expect(newOrigin.origin).not.toBe(oldOrigin.origin);

  // ---- the old address: a key, two stores, one trip with two lines, a pending lookup with its photo
  await addVirtualFingerprint(page);
  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  const words = (await page.getByTestId("recovery-phrase").textContent())!;
  const publicKey = (await page.locator("p.slashed-zero").textContent())!;
  expect(publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  await expect(page.getByRole("button", { name: "Remove fingerprint" })).toBeVisible();
  await seed(page);

  // ---- pack it
  await page.goto("settings");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Pack up this phone" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^tradetracker-move-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText("Packed: 2 stores, 2 items, 1 trips, 2 prices, 1 photos.")).toBeVisible();
  const file = await download.path();
  const pack = JSON.parse(readFileSync(file, "utf8")) as { app: string; from: string; storage: Record<string, string> };
  expect(pack.app).toBe("trade-tracker");
  expect(pack.from).toBe(oldOrigin.origin);
  expect(pack.storage["tradetracker-factory-public"]).toBe(publicKey);
  const before = await dump(page);
  expect(before.tables.stores).toHaveLength(2);
  expect(before.tables.tripItems).toHaveLength(2);

  // ---- the new address: a phone that has never seen the app
  const other = await context.newPage();
  await other.goto(newOrigin.origin + "/");
  const line = other.getByRole("button", { name: "Moving from the old address? Unpack" });
  await expect(line).toBeVisible();
  expect((await line.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await dump(other)).tables.stores ?? []).toHaveLength(0);

  // the file is refused at the address it was packed at, with a plain sentence, and nothing changes
  await page.goto("settings");
  await page.getByLabel("Pack file").setInputFiles(file);
  await expect(page.getByRole("alert")).toHaveText(/This file was packed at this address/);
  expect((await dump(page)).tables).toEqual(before.tables);

  // at the new one it is taken: the app reloads itself and says what it brought
  await other.getByLabel("Pack file").setInputFiles(file);
  await expect(other.getByText("Unpacked: 2 stores, 2 items, 1 trips, 2 prices, 1 photos.")).toBeVisible();
  await expect(other.getByRole("button", { name: "Moving from the old address? Unpack" })).toHaveCount(0);
  await expect(other.getByText("Items Tracked")).toBeVisible();
  await shot(other, "move-unpacked");

  // the rows, the photo's bytes and the key equal what the old address held
  const after = await dump(other);
  expect(after.tables).toEqual(before.tables);
  expect(after.keys["tradetracker-factory-public"]).toBe(publicKey);
  // the fingerprint was made for the old hostname and is not carried: the new address enrols again
  expect(after.keys["tradetracker-factory-fingerprint"]).toBeUndefined();
  expect(after.keys["tradetracker-factory-fingerprint-credential"]).toBeUndefined();

  // Settings > Factory shows the same public key, locked until the 12 words open it
  await other.goto(newOrigin.origin + "/settings");
  await expect(other.locator("p.slashed-zero")).toHaveText(publicKey);
  await expect(other.getByRole("button", { name: "Unlock with fingerprint" })).toHaveCount(0);
  await other.getByLabel("12 words").fill(words);
  await other.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(other.getByText("Key unlocked for today.")).toBeVisible();
  // the door offers to enrol the fingerprint again (not asked here: a browser gives no passkey to an IP address, and the second origin is one)
  await expect(other.getByRole("button", { name: "Use fingerprint" })).toBeVisible();
  await expect(other.getByRole("button", { name: "Remove fingerprint" })).toHaveCount(0);

  // the old origin is untouched by all of it
  await page.goto("settings");
  const still = await dump(page);
  expect(still.tables).toEqual(before.tables);
  expect(still.keys["tradetracker-factory-fingerprint"]).toBe(before.keys["tradetracker-factory-fingerprint"]);
  expect(still.keys["tradetracker-factory-public"]).toBe(publicKey);
});
