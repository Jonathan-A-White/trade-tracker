// The Sort sheet's footer clears the phone's own navigation bar (mw-6ww.148.50). On an installed app with a bar drawn over the page the
// reported bottom inset is 0 and the 48 px floor (--tt-bar-floor) stands, so the footer's buttons must end at least 48 px above the foot of
// the screen, as the bottom nav does (tests/e2e/bottom-bar.spec.ts). The floor is set here as that spec sets it, with a style that wins.
import { expect, test, type Page, type Route } from "@playwright/test";
import { shot } from "./shot";

const BACKEND = "https://postern.allmymind.org";
const TOKEN = "good-token-123";

interface Alert {
  id: string;
  seq: number;
  kind: string;
  amount?: string;
  merchant?: string;
  last4?: string;
  when?: string;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept",
  "access-control-allow-methods": "GET, POST, PUT, DELETE",
};

function json(route: Route, status: number, body?: unknown) {
  return route.fulfill({ status, headers: cors, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
}

// The backend's challenge and the alerts routes of Postern's protocol.md 26, for any signed call.
async function stubBackend(page: Page, feed: Alert[]): Promise<void> {
  await page.route(`${BACKEND}/api/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    if (url.pathname === "/api/challenge") return json(route, 200, { nonce: "ab".repeat(16) });
    if (!request.headers()["authorization"]?.startsWith("Postern2 ")) return json(route, 401, { reason: "no_licence" });
    if (url.pathname === "/api/alerts/address" && request.method() === "POST") return json(route, 200, { address: "abcdefg234567@alerts.example.test" });
    if (url.pathname === "/api/alerts" && request.method() === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0");
      const alerts = feed.filter((a) => a.seq > since);
      return json(route, 200, { alerts, next: alerts.length > 0 ? alerts[alerts.length - 1]!.seq : since });
    }
    const claim = /^\/api\/alerts\/([0-9a-f]{16})$/.exec(url.pathname);
    if (claim && request.method() === "DELETE") {
      const at = feed.findIndex((a) => a.id === claim[1]);
      if (at < 0) return json(route, 404, { error: "no such alert" });
      feed.splice(at, 1);
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(route, 404, { error: "not found" });
  });
}

const category = (id: string, group: string, name: string, balance: number) => ({ id, category_group_id: group, name, hidden: false, deleted: false, balance });

async function stubYnab(page: Page, created: unknown[]): Promise<void> {
  await page.route("https://api.ynab.com/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) return json(route, 401, { error: { id: "401" } });
    const path = new URL(request.url()).pathname.replace(/^\/v1/, "");
    if (path === "/budgets") return json(route, 200, { data: { budgets: [{ id: "b1", name: "Our Budget" }] } });
    if (path.endsWith("/categories")) {
      return json(route, 200, {
        data: {
          category_groups: [
            { id: "g1", name: "Food", hidden: false, deleted: false, categories: [category("c1", "g1", "Groceries", 212_000), category("c2", "g1", "Eating Out", 8_000)] },
            { id: "g2", name: "Home", hidden: false, deleted: false, categories: [category("c3", "g2", "Household", 60_500), category("c4", "g2", "Kids", 31_250)] },
          ],
          server_knowledge: 10,
        },
      });
    }
    if (path.endsWith("/accounts")) {
      return json(route, 200, {
        data: {
          accounts: [
            { id: "a1", name: "Chase Freedom", type: "creditCard", on_budget: true, closed: false, deleted: false },
            { id: "a2", name: "Citi Double Cash", type: "creditCard", on_budget: true, closed: false, deleted: false },
          ],
          server_knowledge: 10,
        },
      });
    }
    if (path.endsWith("/payees")) return json(route, 200, { data: { payees: [], server_knowledge: 10 } });
    if (path.endsWith("/transactions") && request.method() === "POST") {
      created.push(request.postDataJSON());
      return json(route, 201, { data: { transaction: { id: `t${created.length}` } } });
    }
    if (path.endsWith("/transactions")) return json(route, 200, { data: { transactions: [] } });
    return json(route, 404, { error: { id: "404.2" } });
  });
}

async function virtualFingerprint(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true },
  });
}


/** The installed app's floor, which the display-mode: browser rule would take away in this headless browser tab. */
async function installedAppFloor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ":root { --tt-bar-floor: 48px !important; }";
      document.head.appendChild(style);
    });
  });
}

const FLOOR = 48;

test("the Sort sheet's footer buttons end at least 48 px above the foot of the screen at 390x844", async ({ page }) => {
  const size = { width: 390, height: 844 };
  const feed: Alert[] = [{ id: "00000000000000a2", seq: 2, kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234", when: new Date(Date.now() - 6 * 60_000).toISOString() }];
  await stubBackend(page, feed);
  await stubYnab(page, []);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("pwa-kit:tapSettleMs", "0"));
  await installedAppFloor(page);
  await virtualFingerprint(page);
  await page.setViewportSize(size);

  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
  await page.evaluate(() => {
    const publicKeyHex = localStorage.getItem("tradetracker-factory-public");
    localStorage.setItem("bsv-kit.licence", JSON.stringify({ publicKeyHex, at: Date.now() }));
    localStorage.setItem("tradetracker-family-me", "Jonathan");
  });
  await page.reload();
  await expect(page.getByText("Key unlocked for today.")).toBeVisible();

  const ynab = page.locator('[data-setting="ynab"]');
  await ynab.scrollIntoViewIfNeeded();
  await ynab.getByRole("switch", { name: "Connect YNAB" }).click();
  await ynab.getByLabel("Personal Access Token").fill(TOKEN);
  await ynab.getByRole("button", { name: "Check" }).click();
  await ynab.getByRole("list", { name: "Your budgets" }).getByRole("button", { name: "Our Budget" }).click();
  await expect(ynab.getByText("Connected as Our Budget")).toBeVisible();

  const family = page.locator('[data-setting="family"]');
  await family.scrollIntoViewIfNeeded();
  await family.getByRole("switch", { name: "Family alerts" }).click();
  await expect(family.getByText("abcdefg234567@alerts.example.test")).toBeVisible();
  await family.getByLabel("Last four").fill("1234");
  await family.getByLabel("Whose card").fill("Jonathan");
  await family.getByLabel("YNAB account").selectOption({ label: "Chase Freedom" });
  await family.getByRole("button", { name: "Add card" }).click();
  await expect(family.getByRole("list", { name: "Cards" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Waiting · 1" })).toBeVisible();
  await page.getByRole("list", { name: "Yours" }).getByRole("link").click();
  const sheet = page.getByRole("dialog", { name: "$43.12 at Trader Joe's" });
  await expect(sheet).toBeVisible();

  const gap = await sheet.evaluate((el) => {
    const buttons = [...el.querySelectorAll<HTMLElement>("button")].filter((b) => b.closest("[data-sheet-footer]") !== null);
    return { count: buttons.length, foot: Math.min(...buttons.map((b) => window.innerHeight - b.getBoundingClientRect().bottom)) };
  });
  expect(gap.count, "buttons in the sheet's footer").toBeGreaterThan(0);
  expect(gap.foot, "the footer buttons' lowest edge (px) from the foot of the screen").toBeGreaterThanOrEqual(FLOOR);
  await shot(page, "sort-sheet-footer-floor");
});
