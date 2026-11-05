// The suggestion on the Sort sheet at 390x844 (mw-mr4xgrw.47): a merchant YNAB's tally sends to one category opens the sheet with that
// category already chosen, and the suggestion says what is available in it, in the words of the category row, with no tap. Against a
// stubbed backend and api.ynab.com: make the key and hold the licence, connect YNAB, turn Family on and name a card, then the charge opens.
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
    // three past charges at the merchant, all to Eating Out: YNAB's tally makes that the usual, so it is suggested with no grist
    if (path.endsWith("/transactions")) {
      const past = [1, 2, 3].map((n) => ({ id: `p${n}`, account_id: "a1", date: "2026-10-01", amount: -9_000, payee_name: "Dunkin' Donuts", category_id: "c2", category_name: "Eating Out", deleted: false }));
      return json(route, 200, { data: { transactions: past } });
    }
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

test("the suggested category is already chosen and says how much is available in it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const feed: Alert[] = [{ id: "00000000000000a2", seq: 1, kind: "charge", amount: "43.12", merchant: "DUNKIN' DONUTS 3321", last4: "1234", when: new Date(Date.now() - 6 * 60_000).toISOString() }];
  const created: unknown[] = [];
  await stubBackend(page, feed);
  await stubYnab(page, created);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("pwa-kit:tapSettleMs", "0"));
  await virtualFingerprint(page);

  // the key, the licence, and the key unlocked by the fingerprint
  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
  await page.evaluate(() => {
    const publicKeyHex = localStorage.getItem("tradetracker-factory-public");
    localStorage.setItem("bsv-kit.licence", JSON.stringify({ publicKeyHex, at: Date.now() }));
    localStorage.setItem("tradetracker-family-me", "Jonathan");
  });
  await page.reload();
  // dispatched, not clicked: the button re-renders under a pointer click on a base without mw-bfrti4c's fix, and a dispatched click lands on both
  await page.getByRole("button", { name: "Unlock with fingerprint" }).dispatchEvent("click");
  await expect(page.getByText("Key unlocked for today.")).toBeVisible();

  // YNAB connected
  const ynab = page.locator('[data-setting="ynab"]');
  await ynab.scrollIntoViewIfNeeded();
  await ynab.getByRole("switch", { name: "Connect YNAB" }).click();
  await ynab.getByLabel("Personal Access Token").fill(TOKEN);
  await ynab.getByRole("button", { name: "Check" }).click();
  await ynab.getByRole("list", { name: "Your budgets" }).getByRole("button", { name: "Our Budget" }).click();
  await expect(ynab.getByText("Connected as Our Budget")).toBeVisible();

  // Family on, one card with its account
  const family = page.locator('[data-setting="family"]');
  await family.scrollIntoViewIfNeeded();
  await family.getByRole("switch", { name: "Family alerts" }).click();
  await expect(family.getByText("abcdefg234567@alerts.example.test")).toBeVisible();
  await family.getByLabel("Last four").fill("1234");
  await family.getByLabel("Whose card").fill("Jonathan");
  await family.getByLabel("YNAB account").selectOption({ label: "Chase Freedom" });
  await family.getByRole("button", { name: "Add card" }).click();
  await expect(family.getByRole("list", { name: "Cards" }).getByRole("listitem")).toHaveCount(1);

  // the charge opens the sheet: no tap has chosen anything, yet Eating Out is chosen and the suggestion says what is available in it
  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await page.getByRole("list", { name: "Yours" }).getByRole("link").click();
  const sheet = page.getByRole("dialog", { name: "$43.12 at DUNKIN' DONUTS 3321" });
  await expect(sheet).toBeVisible();
  const banner = sheet.getByRole("status").filter({ hasText: "Suggested" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Eating Out · $8 left · short by $35.12");
  await expect(sheet.getByRole("radio", { name: "Eating Out · $8 left · short by $35.12" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await banner.scrollIntoViewIfNeeded();
  await shot(page, "sort-suggestion-available");

  // one tap finishes it
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => created.length).toBe(1);
  const sent = created[0] as { transaction: { amount: number; category_id: string } };
  expect(sent.transaction.amount).toBe(-43120);
  expect(sent.transaction.category_id).toBe("c2");
});
