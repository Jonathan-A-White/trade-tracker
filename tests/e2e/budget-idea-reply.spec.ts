// A Reply on a Budget idea (mw-6ww.148.32) at 390x844: his words go to the budget-idea-reply grind through a fake mill, and a retire answer
// takes the card away, shows his reason once and keeps it (Settings lists it with Remove). The mill is bsv-kit's fakePostern, answering a
// grist sealed to the key the app just made (its recovery words give the key), as sort-ai.spec.ts does.
import { expect, test, type Page, type Route } from "@playwright/test";
import { vault } from "bsv-kit/bsv";
import { fakePostern, type FakePostern } from "bsv-kit/testing";
import { shot } from "./shot";

const BACKEND = "https://postern.allmymind.org";
const TOKEN = "good-token-123";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
};

function json(route: Route, status: number, body?: unknown) {
  return route.fulfill({ status, headers: cors, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
}

/** A day `months` months back, YYYY-MM-DD, mid-month so the month is the same whatever today's date. */
function monthsBack(months: number): string {
  const d = new Date();
  const back = new Date(d.getFullYear(), d.getMonth() - months, 10);
  return `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}-10`;
}

const category = (id: string, group: string, name: string) => ({ id, category_group_id: group, name, hidden: false, deleted: false });

async function stubBackend(page: Page, mill: () => FakePostern | null): Promise<void> {
  await page.route(`${BACKEND}/api/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    if (url.pathname === "/api/challenge") return json(route, 200, { nonce: "ab".repeat(16) });
    if (!request.headers()["authorization"]?.startsWith("Postern2 ")) return json(route, 401, { reason: "no_licence" });
    const fake = mill();
    if (fake && ["/api/me", "/api/blobs", "/api/messages"].includes(url.pathname)) {
      const body = request.postDataBuffer();
      const response = await fake.fetch(`${url.origin}${url.pathname}${url.search}`, { method: request.method(), body: body ? new Uint8Array(body) : undefined });
      return route.fulfill({ status: response.status, headers: cors, contentType: "application/json", body: await response.text() });
    }
    return json(route, 404, { error: "not found" });
  });
}

async function stubYnab(page: Page): Promise<void> {
  await page.route("https://api.ynab.com/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) return json(route, 401, { error: { id: "401" } });
    const path = new URL(request.url()).pathname.replace(/^\/v1/, "");
    if (path === "/budgets") return json(route, 200, { data: { budgets: [{ id: "b1", name: "Our Budget" }] } });
    if (path.endsWith("/categories")) {
      return json(route, 200, {
        data: {
          category_groups: [{ id: "g1", name: "Discretionary Spending", hidden: false, deleted: false, categories: [category("f1", "g1", "Stuff I Forgot to Budget For"), category("c1", "g1", "Groceries")] }],
          server_knowledge: 10,
        },
      });
    }
    if (path.endsWith("/accounts")) return json(route, 200, { data: { accounts: [], server_knowledge: 10 } });
    if (path.endsWith("/payees")) return json(route, 200, { data: { payees: [], server_knowledge: 10 } });
    if (path.endsWith("/transactions")) {
      const charge = (id: string, months: number) => ({
        id,
        account_id: "a1",
        date: monthsBack(months),
        amount: -1_112_500,
        payee_name: "New Apostolic Church",
        category_id: "f1",
        category_name: "Stuff I Forgot to Budget For",
        deleted: false,
      });
      return json(route, 200, { data: { transactions: [charge("t1", 1), charge("t2", 2), charge("t3", 3)] } });
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

test("a Reply on a Budget idea retires it, shows his reason once, and keeps the reason in Settings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let mill: FakePostern | null = null;
  await stubBackend(page, () => mill);
  await stubYnab(page);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("pwa-kit:tapSettleMs", "0");
    // the payee's kind is already known, so the only grist is the reply
    if (!localStorage.getItem("tradetracker-budget-ideas-kinds")) localStorage.setItem("tradetracker-budget-ideas-kinds", JSON.stringify({ "new apostolic church": "Other" }));
  });
  await virtualFingerprint(page);

  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
  const words = (await page.getByTestId("recovery-phrase").textContent()) ?? "";
  mill = fakePostern({ base: BACKEND, appKey: await vault.keyFromPhrase(words) });
  mill.reply({
    re: `direct:${"a".repeat(64)}`,
    status: "answered",
    answer: {
      outcome: "retire",
      say: "Understood: no more ideas for New Apostolic Church.",
      rulesOut: ["New Apostolic Church"],
      remember: "We moved our tithe fully to Brookfield First.",
    },
    grind: { app: "trade-tracker", kind: "budget-idea-reply", v: "1.0" },
  });
  await page.evaluate(() => {
    const publicKeyHex = localStorage.getItem("tradetracker-factory-public");
    localStorage.setItem("bsv-kit.licence", JSON.stringify({ publicKeyHex, at: Date.now() }));
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

  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  const card = page.getByRole("region", { name: "Budget ideas" });
  const idea = card.getByRole("listitem", { name: "New Apostolic Church" });
  await expect(idea).toContainText("$835 a month");
  await idea.getByRole("button", { name: "Reply" }).click();
  await idea.getByLabel("Your reply to New Apostolic Church").fill("We won't be donating there anymore as we have shifted churches and our tithe fully to Brookfield First.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await idea.scrollIntoViewIfNeeded();
  await shot(page, "budget-idea-reply");
  await idea.getByRole("button", { name: "Send" }).click();

  // the card goes and his reason is shown once
  await expect(card.getByRole("status")).toContainText('Understood: no more ideas for New Apostolic Church. Your reason, kept for later ideas: "We moved our tithe fully to Brookfield First."');
  await expect(card.getByRole("listitem", { name: "New Apostolic Church" })).toHaveCount(0);
  expect(mill.seen.some((r) => r.method === "POST" && r.path === "/messages")).toBe(true);

  // after a reload the idea stays gone, the reason is gone from the card, and Settings keeps it until he removes it
  await page.reload();
  await expect(page.getByText("Start New Trip")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "New Apostolic Church" })).toHaveCount(0);
  await page.goto("settings");
  const reasons = page.getByRole("list", { name: "Your reasons" });
  await reasons.scrollIntoViewIfNeeded();
  await expect(reasons).toContainText("We moved our tithe fully to Brookfield First.");
  await expect(reasons).toContainText("Not proposed again: New Apostolic Church");
  await reasons.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("list", { name: "Your reasons" })).toHaveCount(0);
});
