// One full-page screenshot per call, taken at whatever viewport the running Playwright project sets
// (the 'shots' project uses 390x844), written to shots/<name>.png.
import type { Page } from "@playwright/test";

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `shots/${name}.png` });
}
