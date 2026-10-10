// The page title bar sticks flush at the top of the screen, directly under the update banner while one shows, and
// nothing of the page shows above it while scrolling (mw-iy99ci.25: with the status bar's safe-area padding on the scroll
// container itself, Chrome stuck the bar that far below the top and the page scrolled through the gap).
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./shot";

// A phone's status bar, in CSS px: Chromium reports env(safe-area-inset-top) as this through the DevTools override below.
const STATUS_BAR = 38;

async function setSafeAreaTop(page: Page, top: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, left: 0, bottom: 0, right: 0 } });
}

// A service worker waiting behind the one in control: what a new deploy looks like to the page, so the real banner shows.
async function fakeWaitingWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const waiting = {
      state: "installed",
      scriptURL: new URL("sw.js", document.baseURI).href,
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
    };
    const registration = {
      scope: new URL("./", document.baseURI).href,
      active: null,
      installing: null,
      waiting,
      update: () => Promise.resolve(),
      addEventListener() {},
      removeEventListener() {},
    };
    const container = {
      controller: { state: "activated" },
      ready: Promise.resolve(registration),
      register: () => Promise.resolve(registration),
      getRegistration: () => Promise.resolve(registration),
      getRegistrations: () => Promise.resolve([registration]),
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  });
}

interface Layout {
  headerTop: number;
  headerBottom: number;
  bannerBottom: number | null;
  /** Elements of the page itself (inside #root) at the row just above the title bar. */
  aboveHeader: string[];
}

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const header = document.querySelector("header")!.getBoundingClientRect();
    const banner = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Update ready"));
    const root = document.getElementById("root")!;
    const y = header.top - 1;
    const above = y < 0 ? [] : document.elementsFromPoint(200, y).filter((el) => root.contains(el) && el !== root);
    return {
      headerTop: header.top,
      headerBottom: header.bottom,
      bannerBottom: banner ? banner.getBoundingClientRect().bottom : null,
      aboveHeader: above.map((el) => el.tagName.toLowerCase()),
    };
  });
}

async function scrollSettings(page: Page): Promise<void> {
  await page.goto("settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.evaluate(() => {
    document.getElementById("root")!.scrollTop = 600;
  });
}

for (const inset of [0, STATUS_BAR]) {
  test(`Settings scrolled, no update banner, status bar ${inset}px: the title bar sits at the top and nothing shows above it`, async ({ page }) => {
    await setSafeAreaTop(page, inset);
    await scrollSettings(page);
    const l = await layout(page);
    expect(await page.evaluate(() => document.getElementById("root")!.scrollTop)).toBeGreaterThan(100);
    expect(l.bannerBottom).toBeNull();
    expect(l.headerTop).toBe(inset);
    expect(l.aboveHeader).toEqual([]);
    await shot(page, `settings-scrolled-no-banner-inset-${inset}`);
  });
}

test("Settings with the update banner: the title bar sits directly under it, then flush at the top once scrolled", async ({ page }) => {
  await fakeWaitingWorker(page);
  await setSafeAreaTop(page, STATUS_BAR);
  await page.goto("settings");
  await expect(page.getByRole("button", { name: "Update ready, tap to reload" })).toBeVisible();
  const atTop = await layout(page);
  expect(atTop.bannerBottom).not.toBeNull();
  expect(atTop.headerTop).toBe(atTop.bannerBottom);
  await shot(page, "settings-banner-top");

  await page.evaluate(() => {
    document.getElementById("root")!.scrollTop = 600;
  });
  const scrolled = await layout(page);
  expect(scrolled.headerTop).toBe(STATUS_BAR);
  expect(scrolled.aboveHeader).toEqual([]);
  await shot(page, "settings-banner-scrolled");
});
