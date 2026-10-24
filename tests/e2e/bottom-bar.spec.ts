// The bottom nav stays above the phone's own navigation bar (mw-umpkr9; Legend's mw-jpxyd3 is the same fault). His phone: Android, Chrome,
// three-button navigation, 412x915. Headless Chromium has no system bar, so the test models the one thing the page can see of it: with
// viewport-fit=cover the page's window is the whole screen and the 48 px Back/Home/Recents bar is drawn over its foot with no inset reported
// (env(safe-area-inset-bottom) is 0 on his phone); without it the window is the screen less that bar. The viewport meta is read from the
// served page, so changing it changes what the test models. The nav's box must end at or above the system bar's top edge, and the bars
// that sit on top of the nav (the trip's subtotal bar, the edit page's Save bar) must clear the nav itself.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { shot } from "./shot";

const SCREEN = { width: 412, height: 915 };
const SYSTEM_BAR = 48;
const VISIBLE_BOTTOM = SCREEN.height - SYSTEM_BAR;

/** The window the page gets: the whole screen when its viewport meta says cover, else the screen less the system bar. */
async function windowFor(page: Page): Promise<void> {
  const html = await (await page.request.get("/")).text();
  const cover = /<meta[^>]+name="viewport"[^>]+viewport-fit=cover/.test(html);
  await page.setViewportSize({ width: SCREEN.width, height: cover ? SCREEN.height : VISIBLE_BOTTOM });
}

/** The page is told about the system bar through the safe-area inset (what Chrome does when it does report it). */
async function reportInset(page: Page, bottom: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom, left: 0, right: 0 } });
}

// A store, an item, a completed trip and an active one: enough for every screen that shows the nav to render its real layout.
async function seed(page: Page): Promise<void> {
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
          const tx = db.transaction(["stores", "items", "trips"], "readwrite");
          const now = Date.now();
          tx.objectStore("stores").put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
          tx.objectStore("items").put({ id: "i1", barcode: "0123456789012", name: "Oat milk", currentPrice: 3.49, unitType: "each", createdAt: now, updatedAt: now });
          tx.objectStore("trips").put({
            id: "t1", storeId: "s1", status: "completed", startedAt: now - 3_600_000, endedAt: now, scannedSubtotal: 0, createdAt: now, updatedAt: now,
          });
          tx.objectStore("trips").put({
            id: "t2", storeId: "s1", status: "active", startedAt: now - 600_000, scannedSubtotal: 0, budget: 100, createdAt: now, updatedAt: now,
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

const SCREENS: Array<[string, string]> = [
  ["Home", ""],
  ["Trips", "trips/history"],
  ["Items", "items"],
  ["an item", "items/i1"],
  ["Reports", "reports"],
  ["Stores", "stores"],
  ["Settings", "settings"],
  ["About", "about"],
  ["New trip", "trips/new"],
  ["a finished trip", "trips/t1"],
  ["editing a trip", "trips/t1/edit"],
  ["the active trip", "trips/active"],
  ["End trip", "trips/active/end"],
];

async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box!.y + box!.height;
}

// An inset he is told about (what a phone with a gesture bar reports) is a second run: the nav must still clear the system bar.
for (const reported of [0, 34]) {
  test(`the nav is wholly above the phone navigation bar on every screen that shows it, with ${reported} px of bottom inset reported`, async ({ page }) => {
    await windowFor(page);
    if (reported > 0) await reportInset(page, reported);
    await seed(page);
    const nav = page.getByRole("navigation");
    for (const [name, path] of SCREENS) {
      await page.goto(path);
      await expect(nav).toBeVisible();
      expect(await bottomOf(nav), `${name}: the nav's foot (px) against the system bar's top edge`).toBeLessThanOrEqual(VISIBLE_BOTTOM);
    }
    await page.goto("trips/active");
    await expect(page.getByRole("button", { name: "End Trip" })).toBeVisible();
    const navTop = (await nav.boundingBox())!.y;
    expect(await bottomOf(page.getByRole("button", { name: "End Trip" })), "the active trip's subtotal bar against the nav's top edge").toBeLessThanOrEqual(navTop);
    if (reported === 0) await shot(page, "bottom-bar-active-trip");
    await page.goto("trips/t1/edit");
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
    expect(await bottomOf(page.getByRole("button", { name: "Save Changes" })), "the edit page's Save button against the nav's top edge").toBeLessThanOrEqual(
      (await nav.boundingBox())!.y,
    );
    if (reported === 0) await shot(page, "bottom-bar-edit-trip");
  });
}
