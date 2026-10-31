// The badges on a trip line at 360x740 (mw-31qug1.15): the amber one on a line whose price the factory read says so ("Price read") and
// its first tap shows what to do; "Guess" and "Add price" sit beside it. No badge's text is cut off, and the "Price read" badge is no
// wider than the "Check price" it replaced, so an item name has no less room than before. Ends in a screenshot.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./shot";

async function seed(page: Page): Promise<void> {
  await page.goto("trips/history");
  await expect.poll(async () => (await page.evaluate(() => indexedDB.databases())).map((d) => d.name)).toContain("TradeTrackerDB");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("TradeTrackerDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["stores", "items", "trips", "tripItems"], "readwrite");
          const now = Date.now();
          tx.objectStore("stores").put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
          const names = ["Oat bars", "Gala apples", "Sourdough loaf"];
          names.forEach((name, i) =>
            tx.objectStore("items").put({ id: `i${i}`, barcode: `01234567890${i}0`, name, currentPrice: 4.25, unitType: "each", createdAt: now, updatedAt: now }),
          );
          tx.objectStore("trips").put({ id: "t1", storeId: "s1", status: "active", startedAt: now - 600_000, scannedSubtotal: 0, budget: 100, createdAt: now, updatedAt: now });
          const line = { tripId: "t1", quantity: 1, onSale: false, addedAt: now };
          tx.objectStore("tripItems").put({ ...line, id: "l0", itemId: "i0", price: 4.25, lineTotal: 4.25, priceFlag: "check" });
          tx.objectStore("tripItems").put({ ...line, id: "l1", itemId: "i1", price: 3.1, lineTotal: 3.1, guess: { basis: "Last paid $3.10 here." }, addedAt: now + 1 });
          tx.objectStore("tripItems").put({ ...line, id: "l2", itemId: "i2", price: 0, lineTotal: 0, priceFlag: "add", addedAt: now + 2 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("a 'Price read' line explains itself at 360x740, and no badge is cut off", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seed(page);
  await page.goto("trips/active");

  const read = page.getByRole("button", { name: /^Price read by the factory/ });
  await expect(read).toHaveText("Price read");
  await expect(page.getByText("Guess", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add price" })).toBeVisible();

  // every badge shows all of its text, and the new one is no wider than the old "Check price" at the same type size
  for (const badge of [read, page.getByText("Guess", { exact: true }), page.getByRole("button", { name: "Add price" })]) {
    const fits = await badge.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, "a badge's text is cut off").toBe(true);
  }
  const widths = await read.evaluate((el) => {
    const now = el.getBoundingClientRect().width;
    const was = el.textContent;
    el.textContent = "Check price";
    const before = el.getBoundingClientRect().width;
    el.textContent = was;
    return { now, before };
  });
  expect(widths.now, "the badge's width (px) against the old 'Check price' badge").toBeLessThanOrEqual(widths.before);

  // the item names keep their room: none is cut off
  for (const name of ["Oat bars", "Gala apples", "Sourdough loaf"]) {
    const cut = await page.getByText(name, { exact: true }).evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(cut, `${name} is cut off`).toBe(false);
  }

  // the first tap says what to do and leaves the flag; the row's name is still whole
  const note = page.getByText("The factory read this price. Tap the badge if it matches the tag, or press and hold the line to fix the price.");
  await expect(note).toHaveCount(0);
  await read.click();
  await expect(note).toBeVisible();
  await shot(page, "price-badges");

  // the second tap clears it
  await page.getByRole("button", { name: /^Price read by the factory/ }).click();
  await expect(page.getByRole("button", { name: /^Price read by the factory/ })).toHaveCount(0);
  await expect(note).toHaveCount(0);
});
