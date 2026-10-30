// The Sort sheet at two phone sizes (390x844 and 360x740) against a stubbed backend and api.ynab.com: make the key and hold the
// licence, connect YNAB, turn Family on and name two cards, then Home shows Waiting · 2, a charge opens the sheet (a dialog,
// every control at least 48 px), a split shows what is left, and Done sorts it. Ends in screenshots of Home, the sheet and a split.
import { expect, test, type Page, type Route } from "@playwright/test";
import { shot } from "./shot";

const BACKEND = "https://postern.allmymind.org";
const TOKEN = "good-token-123";
const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
];

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

/** Every button, radio, select and text field in `scope` is at least 48 px tall (and every button 48 px wide). */
async function expectTargets(page: Page): Promise<void> {
  const small = await page.getByRole("dialog").evaluate((sheet) =>
    [...sheet.querySelectorAll<HTMLElement>("button, select, input")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ what: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 47.5)
      .map(({ what, box }) => `${what}: ${box.width}x${box.height}`),
  );
  expect(small).toEqual([]);
}

test("Home's Waiting, the Sort sheet and a split at 390x844 and 360x740", async ({ page }) => {
  const now = new Date();
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const feed: Alert[] = [
    { id: "00000000000000a1", seq: 1, kind: "charge", amount: "12.40", merchant: "Shell", last4: "5678", when: at(95) },
    { id: "00000000000000a2", seq: 2, kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234", when: at(6) },
  ];
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

  // Family on, two cards with their accounts
  const family = page.locator('[data-setting="family"]');
  await family.scrollIntoViewIfNeeded();
  await family.getByRole("switch", { name: "Family alerts" }).click();
  await expect(family.getByText("abcdefg234567@alerts.example.test")).toBeVisible();
  const cards = family.getByRole("list", { name: "Cards" }).getByRole("listitem");
  let added = 0;
  for (const [lastFour, owner, account] of [["1234", "Jonathan", "Chase Freedom"], ["5678", "Sarah", "Citi Double Cash"]] as const) {
    await family.getByLabel("Last four").fill(lastFour);
    await family.getByLabel("Whose card").fill(owner);
    await family.getByLabel("YNAB account").selectOption({ label: account });
    await family.getByRole("button", { name: "Add card" }).click();
    await expect(cards).toHaveCount(++added);
  }

  for (const [index, size] of SIZES.entries()) {
    const tag = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
    await expect(page.getByRole("heading", { name: "Waiting · 2" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Yours" }).getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Sarah's" }).getByRole("link")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `sort-home-${tag}`);

    // the sheet: a dialog with the charge's facts and the categories with their balances
    await page.getByRole("list", { name: "Yours" }).getByRole("link").click();
    const sheet = page.getByRole("dialog", { name: "$43.12 at Trader Joe's" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("•••• 1234 · Jonathan")).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Groceries · $212 left" })).toBeVisible();
    await expect(sheet.getByText("short by $35.12")).toBeVisible();
    await expectTargets(page);
    await shot(page, `sort-sheet-${tag}`);

    // a split that does not add up yet: what is left is said, and Done waits
    await sheet.getByRole("button", { name: "Split" }).click();
    await sheet.getByLabel("Category for part 1").selectOption("c1");
    await sheet.getByLabel("Amount for part 1").fill("30");
    await sheet.getByLabel("Category for part 2").selectOption("c3");
    await sheet.getByLabel("Amount for part 2").fill("10");
    await expect(sheet.getByText("$3.12 left to place")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Done" })).toBeDisabled();
    await expectTargets(page);
    await sheet.getByText("$3.12 left to place").scrollIntoViewIfNeeded();
    await shot(page, `sort-split-${tag}`);

    if (index < SIZES.length - 1) {
      await sheet.getByRole("button", { name: "Later" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      continue;
    }

    // at 200 % text the sheet still fits the width and Done can be reached
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));

    await sheet.getByLabel("Amount for part 2").fill("13.12");
    await expect(sheet.getByText("Adds up to $43.12")).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Waiting · 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sorted today · 1" })).toBeVisible();
    await expect.poll(() => feed.map((a) => a.id)).toEqual(["00000000000000a1"]);
    await expect.poll(() => created.length).toBe(1);
    const sent = created[0] as { transaction: { amount: number; subtransactions: unknown[] } };
    expect(sent.transaction.amount).toBe(-43120);
    expect(sent.transaction.subtransactions).toHaveLength(2);
    await shot(page, `sort-sorted-${tag}`);
  }
});
