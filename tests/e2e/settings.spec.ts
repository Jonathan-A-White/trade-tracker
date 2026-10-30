// Walks Settings at the phone's size (390x844): the groups in order, the search finding Backend, the Needs a licence link on Import Trip
// from AI opening the Factory row, and ends in a screenshot.
import { expect, test } from "@playwright/test";
import { shot } from "./shot";

test("Settings: groups in order, search finds Backend, Needs a licence leads to Factory", async ({ page }) => {
  await page.goto("settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings).toEqual([
    "Appearance",
    "Factory",
    "YNAB",
    "Storage Usage",
    "Produce PLU Codes",
    "Trader Joe's Barcodes",
    "TJ's Receipt (03/14/2026)",
    "Export / Import Items",
    "Export / Import Trips",
    "Import Trip from AI",
    "Danger Zone",
    "About",
  ]);

  // the search finds Backend, says which group it is in, and a tap opens the row
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("backend");
  const found = page.getByRole("list", { name: "Matching settings" });
  await expect(found.getByRole("button", { name: /Backend/ })).toContainText("in Factory");
  await shot(page, "settings-search");
  await found.getByRole("button", { name: /Backend/ }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator('[data-setting="backend"]')).toHaveAttribute("aria-current", "location");
  await expect(page.getByLabel("Backend")).toBeInViewport();

  // with no licence, Import Trip from AI is off and says why; its link opens the Factory row
  const aiRow = page.locator('[data-setting="ai-trip"]');
  await aiRow.scrollIntoViewIfNeeded();
  await expect(aiRow.locator('input[type="file"]')).toBeDisabled();
  await aiRow.getByRole("link", { name: "Needs a licence" }).click();
  await expect(page.locator('[data-setting="factory"]')).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("heading", { name: "Factory" })).toBeInViewport();

  await shot(page, "settings-walk");
});
