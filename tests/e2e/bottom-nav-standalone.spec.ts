// The installed app's bottom nav (mw-6ww.148.49). His report after 0.1.116: "Still thicker bottom bar than I'd expect" (about 104 CSS px of nav,
// labels in its top third). mw-6ww.148.46 dropped the 48 px floor (--tt-bar-floor) only in a browser tab, so the installed app (display-mode
// standalone) still stood on it. The floor is for a phone whose own Back/Home/Recents bar is drawn OVER the page with no inset reported
// (Legend's fault, mw-umpkr9). The page can tell that case from the others by three things it can read: the display mode (fullscreen hides the
// bar), the inset the phone reports (any inset above 0 is the phone's own word and is used as it is), and whether the window is shorter than
// the screen (then the bar sits outside the page and nothing is drawn over its foot). This spec emulates the display mode and the screen
// through the DevTools protocol, which headless Chromium does allow here.
import { expect, test, type Page } from "@playwright/test";

const WINDOW = { width: 390, height: 844 };
const NAV_BOX = 56; // h-14

interface Phone {
  displayMode: "standalone" | "fullscreen" | "browser";
  /** The screen's height; the window is 844 high, so a taller screen is a bar outside the page. */
  screenHeight: number;
  inset: number;
}

async function phone(page: Page, p: Phone): Promise<void> {
  await page.setViewportSize(WINDOW);
  const cdp = await page.context().newCDPSession(page);
  // Chromium has no display-mode emulation (setEmulatedMedia ignores it), so the page's matchMedia answers for it, as the page's own code asks it.
  await page.addInitScript((mode) => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const m = /\(display-mode:\s*([a-z-]+)\)/.exec(query);
      if (!m) return real(query);
      const noop = () => undefined;
      return { matches: m[1] === mode, media: query, onchange: null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: () => false } as unknown as MediaQueryList;
    };
  }, p.displayMode);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: p.inset, left: 0, right: 0 } });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WINDOW.width, height: WINDOW.height, deviceScaleFactor: 1, mobile: false,
    screenWidth: WINDOW.width, screenHeight: p.screenHeight,
  });
}

/** The nav's whole height: its box plus the strip painted under it down to the foot of the window. */
async function navHeight(page: Page): Promise<{ whole: number; box: number; emptyUnderLabel: number }> {
  await page.goto("");
  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible();
  const box = (await nav.boundingBox())!;
  const label = (await nav.getByRole("link", { name: "Home" }).locator("span").boundingBox())!;
  return { whole: WINDOW.height - box.y, box: box.height, emptyUnderLabel: WINDOW.height - (label.y + label.height) };
}

test("standalone, no bar over the page (window shorter than the screen): the nav is 56 px, no empty band under its labels", async ({ page }) => {
  await phone(page, { displayMode: "standalone", screenHeight: 892, inset: 0 });
  const h = await navHeight(page);
  expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches), "the emulation took").toBe(true);
  expect(await page.evaluate(() => screen.height - innerHeight), "the screen is a bar taller than the window").toBe(48);
  expect(h.box).toBeCloseTo(NAV_BOX, 0);
  expect(h.whole, "the nav's whole height (px)").toBeGreaterThanOrEqual(NAV_BOX - 2);
  expect(h.whole, "the nav's whole height (px)").toBeLessThanOrEqual(NAV_BOX + 2);
  expect(h.emptyUnderLabel, "empty bar (px) under the Home label").toBeLessThanOrEqual(24);
});

test("standalone with a real inset reported (34 px): the nav is 56 px plus that inset", async ({ page }) => {
  await phone(page, { displayMode: "standalone", screenHeight: 844, inset: 34 });
  const h = await navHeight(page);
  expect(h.whole, "the nav's whole height (px)").toBeCloseTo(NAV_BOX + 34, 0);
});

test("fullscreen (the system bars are hidden): the nav is 56 px", async ({ page }) => {
  await phone(page, { displayMode: "fullscreen", screenHeight: 844, inset: 0 });
  const h = await navHeight(page);
  expect(h.whole, "the nav's whole height (px)").toBeCloseTo(NAV_BOX, 0);
});

test("standalone, the window is the whole screen and no inset is reported (a bar drawn over the page, Legend's case): the labels stay clear of 48 px", async ({ page }) => {
  await phone(page, { displayMode: "standalone", screenHeight: 844, inset: 0 });
  const h = await navHeight(page);
  const systemBarTop = WINDOW.height - 48;
  const nav = (await page.getByRole("navigation").boundingBox())!;
  expect(nav.y + nav.height, "the nav's box ends at or above the system bar's top edge").toBeLessThanOrEqual(systemBarTop + 1);
  expect(h.emptyUnderLabel, "the Home label ends at or above the system bar").toBeGreaterThanOrEqual(48);
});
