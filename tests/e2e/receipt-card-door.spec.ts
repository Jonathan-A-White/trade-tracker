// "Check against the receipt" says which way the factory's door is shut: no key yet, or locked (with an Unlock button right
// on the card; mw-iy99ci.26). The unlock itself needs a fingerprint reader, so the unit tests cover it; here a locked key with
// no fingerprint copy shows the plain error and the link to Settings.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./shot";

// A completed trip with no lines: enough for its page to show the receipt card.
async function seedCompletedTrip(page: Page): Promise<void> {
  // the app creates the database when a page first reads it
  await page.goto("trips/history");
  await expect.poll(async () => (await page.evaluate(() => indexedDB.databases())).map((d) => d.name)).toContain("TradeTrackerDB");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("TradeTrackerDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["stores", "trips"], "readwrite");
          const now = Date.now();
          tx.objectStore("stores").put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
          tx.objectStore("trips").put({
            id: "t1",
            storeId: "s1",
            status: "completed",
            startedAt: now - 3_600_000,
            endedAt: now,
            scannedSubtotal: 0,
            createdAt: now,
            updatedAt: now,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("no key yet: the card says to set up the factory in Settings", async ({ page }) => {
  await seedCompletedTrip(page);
  await page.goto("trips/t1");
  const card = page.locator("div", { has: page.getByRole("heading", { name: "Check against the receipt" }) }).last();
  await expect(card.getByText("Set up the factory in Settings")).toBeVisible();
  await expect(card.getByRole("link", { name: "Open Settings" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Unlock" })).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await shot(page, "receipt-card-no-key");
});

test("locked key: the card says Locked with an Unlock button; with no fingerprint copy the error and a Settings link show", async ({ page }) => {
  await seedCompletedTrip(page);
  await page.evaluate(() => localStorage.setItem("tradetracker-factory-public", "ab".repeat(33)));
  await page.goto("trips/t1");
  const card = page.locator("div", { has: page.getByRole("heading", { name: "Check against the receipt" }) }).last();
  await expect(card.getByText("Locked. Unlock with your fingerprint to read a receipt.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Photograph receipt" })).toBeDisabled();
  await card.scrollIntoViewIfNeeded();
  await shot(page, "receipt-card-locked");

  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(card.getByRole("alert")).toContainText("No fingerprint is set up on this device.");
  await expect(card.getByRole("link", { name: "Unlock in Settings" })).toBeVisible();
  await shot(page, "receipt-card-locked-no-fingerprint");
});
