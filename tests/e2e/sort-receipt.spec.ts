// Photo the receipt on the Sort sheet (mw-mr4xgrw.16) against a stubbed backend, api.ynab.com and a fake mill with Chromium's fake camera:
// a $43.12 charge opens the sheet, Photo the receipt shoots the receipt, the mill's receipt grind reads the lines and its sort-charge grind
// groups them, the tax is spread over the categories and the total checks against the charge, and Done writes the split to YNAB. The mill is
// bsv-kit's fakePostern, answering sealed to the key the app just made (its recovery words give the key). Ends in a screenshot of the split.
import { expect, test, type Page, type Route } from "@playwright/test";
import { vault } from "bsv-kit/bsv";
import { fakePostern, type FakePostern } from "bsv-kit/testing";
import { shot } from "./shot";
import { browserEnv } from "../support/browser-env";

const BACKEND = "https://postern.allmymind.org";
const TOKEN = "good-token-123";
const ALERT_ID = "00000000000000a2";
const WHY = "Food went to Groceries, the paper towels and dish soap to Household.";
const RECEIPT_TXID = `direct:${"a".repeat(64)}`;
const GROUPING_TXID = `direct:${"b".repeat(64)}`;

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

/** The alerts routes of Postern's protocol for any signed call; the mill's routes (/me, /blobs, /messages) go to the fake mill. */
async function stubBackend(page: Page, feed: Alert[], mill: () => FakePostern | null): Promise<void> {
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
    const fake = mill();
    if (fake && ["/api/me", "/api/blobs", "/api/messages"].includes(url.pathname)) {
      const body = request.postDataBuffer();
      const response = await fake.fetch(`${url.origin}${url.pathname}${url.search}`, { method: request.method(), body: body ? new Uint8Array(body) : undefined });
      return route.fulfill({ status: response.status, headers: cors, contentType: "application/json", body: await response.text() });
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
        data: { accounts: [{ id: "a1", name: "Chase Freedom", type: "creditCard", on_budget: true, closed: false, deleted: false }], server_knowledge: 10 },
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


test.use({
  permissions: ["camera"],
  launchOptions: { env: browserEnv, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

test("a photographed receipt becomes a split with the tax spread, and Done writes it", async ({ page }) => {
  const feed: Alert[] = [{ id: ALERT_ID, seq: 1, kind: "charge", amount: "43.12", merchant: "Costco", last4: "1234", when: new Date(Date.now() - 6 * 60_000).toISOString() }];
  const created: unknown[] = [];
  let mill: FakePostern | null = null;
  await stubBackend(page, feed, () => mill);
  await stubYnab(page, created);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("pwa-kit:tapSettleMs", "0");
  });
  await virtualFingerprint(page);

  // the key, the licence, and the key unlocked by the fingerprint
  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
  const words = (await page.getByTestId("recovery-phrase").textContent()) ?? "";
  mill = fakePostern({ base: BACKEND, appKey: await vault.keyFromPhrase(words) });
  // the receipt grind answers the first grist (txid aaaa...); once that answer is read the next post is the sort-charge grist (bbbb...)
  const printed = (text: string, price: number) => ({ text, price, quantity: 1, weightLbs: null, tripItemId: null, confidence: "high" });
  mill.reply({
    re: RECEIPT_TXID,
    status: "answered",
    answer: {
      store: "Costco",
      date: "2026-10-31",
      subtotal: 40,
      tax: 3.12,
      total: 43.12,
      lines: [printed("KS ORG EGGS", 8), printed("ROTISSERIE CHICKEN", 5), printed("BANANAS", 12), printed("KS PAPER TOWEL", 9), printed("KS DISH SOAP", 6)],
      unreadable: null,
    },
    grind: { app: "trade-tracker", kind: "receipt-reconcile", v: "2.0" },
  });
  mill.onPoll = () => {
    mill!.postResult = { txid: GROUPING_TXID, seq: 2 };
  };
  mill.reply({
    re: GROUPING_TXID,
    status: "answered",
    answer: {
      split: [
        { category: "Groceries", amount: 25 },
        { category: "Household", amount: 15 },
      ],
      why: WHY,
    },
    grind: { app: "trade-tracker", kind: "sort-charge", v: "1.0" },
  });
  await page.evaluate(() => {
    const publicKeyHex = localStorage.getItem("tradetracker-factory-public");
    localStorage.setItem("bsv-kit.licence", JSON.stringify({ publicKeyHex, at: Date.now() }));
    localStorage.setItem("tradetracker-family-me", "Jonathan");
  });
  await page.reload();
  await page.getByRole("button", { name: "Unlock with fingerprint" }).click();
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

  // the charge opens the sheet; the receipt is photographed
  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await page.getByRole("list", { name: "Yours" }).getByRole("link").click();
  const sheet = page.getByRole("dialog", { name: "$43.12 at Costco" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Photo the receipt" }).click();
  await expect(page.getByRole("heading", { name: /RECEIPT/ })).toBeVisible();
  // the fake camera is playing
  await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0);
  await page.getByRole("button", { name: "Take photo" }).click();
  await page.getByRole("button", { name: "Use photo" }).click();
  await page.getByRole("button", { name: "Read the receipt" }).click();

  // back on the sheet: the split, with the tax spread in proportion (25 : 15 of 3.12 is 1.95 and 1.17)
  const back = page.getByRole("dialog", { name: "$43.12 at Costco" });
  await expect(back.getByText(WHY)).toBeVisible();
  await expect(back.getByLabel("Category for part 1")).toHaveValue("c1");
  await expect(back.getByLabel("Amount for part 1")).toHaveValue("26.95");
  await expect(back.getByLabel("Category for part 2")).toHaveValue("c3");
  await expect(back.getByLabel("Amount for part 2")).toHaveValue("16.17");
  await expect(back.getByText("Adds up to $43.12")).toBeVisible();
  await expect(back.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await back.getByText(WHY).scrollIntoViewIfNeeded();
  await shot(page, "sort-receipt-split");

  // Done writes the split
  await back.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => created.length).toBe(1);
  const sent = created[0] as { transaction: { amount: number; subtransactions: { category_id: string; amount: number }[] } };
  expect(sent.transaction.amount).toBe(-43120);
  expect(sent.transaction.subtransactions.map((s) => [s.category_id, s.amount])).toEqual([
    ["c1", -26950],
    ["c3", -16170],
  ]);
});
