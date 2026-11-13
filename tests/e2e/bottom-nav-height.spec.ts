// The bottom nav is as tall as its icons and labels plus the inset the phone reports, no more (mw-6ww.148.46). His report: on his phone
// (Chrome, 1080x2340) the nav was about 105 CSS px tall, with ~140 px of empty bar under its labels, because the nav stood on a fixed
// 48 px floor (--tt-bar-floor) meant for a phone whose own Back/Home/Recents bar overlays the page and reports no inset. In a browser
// tab Chrome's own bars sit outside the page, so there the floor is 0 and the nav is h-14 (56 px) plus env(safe-area-inset-bottom).
// Headless Chromium cannot emulate display-mode, so the installed app (where the floor stays) is modelled by setting the floor itself:
// see bottom-bar.spec.ts. This spec is the browser-tab case at 390x844, with 0 and with 34 px of inset reported.
import { expect, test, type Page } from "@playwright/test";

const SCREEN = { width: 390, height: 844 };
const NAV_BOX = 56; // h-14

async function reportInset(page: Page, bottom: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom, left: 0, right: 0 } });
}

for (const reported of [0, 34]) {
  test(`the nav is h-14 plus the real inset (${reported} px), with no 48 px floor under its labels`, async ({ page }) => {
    await page.setViewportSize(SCREEN);
    if (reported > 0) await reportInset(page, reported);
    await page.goto("");
    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();
    const box = (await nav.boundingBox())!;
    expect(box.height, "the nav box's own height (px)").toBeCloseTo(NAV_BOX, 0);
    // the nav's whole height: its box, plus the strip painted under it down to the screen's foot, which is the inset and nothing more
    expect(SCREEN.height - box.y, `the nav's whole height (px) with ${reported} px of inset reported`).toBeCloseTo(NAV_BOX + reported, 0);
    // the label sits within the box, so no empty bar is drawn under the labels beyond the inset
    const label = (await nav.getByRole("link", { name: "Home" }).locator("span").boundingBox())!;
    expect(SCREEN.height - (label.y + label.height) - reported, "empty bar (px) under the Home label, beyond the inset").toBeLessThanOrEqual(24);
  });
}
