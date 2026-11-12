// Home's Budget ideas card at 390x844 (mw-6ww.148.27): what keeps landing in Stuff I Forgot to Budget For is proposed as a category.
// Against a stubbed api.ynab.com: make the key, unlock it, connect YNAB; Home then shows the ideas, and Add / Not now / Never act.
import { expect, test, type Page, type Route } from "@playwright/test";
import { shot } from "./shot";

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

async function stubYnab(page: Page, created: unknown[]): Promise<void> {
  await page.route("https://api.ynab.com/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) return json(route, 401, { error: { id: "401" } });
    const path = new URL(request.url()).pathname.replace(/^\/v1/, "");
    if (path === "/budgets") return json(route, 200, { data: { budgets: [{ id: "b1", name: "Our Budget" }] } });
    if (path.endsWith("/categories") && request.method() === "POST") {
      created.push(request.postDataJSON());
      return json(route, 201, { data: { category: { id: `new${created.length}`, name: "made" }, server_knowledge: 11 } });
    }
    if (path.endsWith("/categories")) {
      return json(route, 200, {
        data: {
          category_groups: [
            {
              id: "g1",
              name: "Everyday",
              hidden: false,
              deleted: false,
              categories: [category("f1", "g1", "Stuff I Forgot to Budget For"), category("c1", "g1", "Groceries")],
            },
          ],
          server_knowledge: 10,
        },
      });
    }
    if (path.endsWith("/accounts")) return json(route, 200, { data: { accounts: [], server_knowledge: 10 } });
    if (path.endsWith("/payees")) return json(route, 200, { data: { payees: [], server_knowledge: 10 } });
    if (path.endsWith("/transactions")) {
      const charge = (id: string, payee: string, months: number, dollars: number) => ({
        id,
        account_id: "a1",
        date: monthsBack(months),
        amount: -dollars * 1000,
        payee_name: payee,
        category_id: "f1",
        category_name: "Stuff I Forgot to Budget For",
        deleted: false,
      });
      return json(route, 200, {
        data: {
          transactions: [
            charge("t1", "Hardware Hank", 1, 60),
            charge("t2", "Hardware Hank", 2, 60),
            charge("t3", "Hardware Hank", 3, 60),
            charge("t4", "Chewy", 1, 30),
            charge("t5", "Chewy", 2, 30),
            charge("t6", "Chewy", 3, 30),
            charge("t7", "Ferris Landscape Supply", 5, 591.97),
            { ...charge("t8", "Costco", 1, 90), category_id: "c1", category_name: "Groceries" },
          ],
        },
      });
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

async function connectYnab(page: Page): Promise<void> {
  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
  await page.reload();
  // dispatched, not clicked: the button re-renders under a pointer click on a base without mw-bfrti4c's fix, and a dispatched click lands on both
  await page.getByRole("button", { name: "Unlock with fingerprint" }).dispatchEvent("click");
  await expect(page.getByText("Key unlocked for today.")).toBeVisible();
  const ynab = page.locator('[data-setting="ynab"]');
  await ynab.scrollIntoViewIfNeeded();
  await ynab.getByRole("switch", { name: "Connect YNAB" }).click();
  await ynab.getByLabel("Personal Access Token").fill(TOKEN);
  await ynab.getByRole("button", { name: "Check" }).click();
  await ynab.getByRole("list", { name: "Your budgets" }).getByRole("button", { name: "Our Budget" }).click();
  await expect(ynab.getByText("Connected as Our Budget")).toBeVisible();
}

test("Budget ideas proposes categories, and Add, Not now and Never act on them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created: unknown[] = [];
  await stubYnab(page, created);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("pwa-kit:tapSettleMs", "0"));
  await virtualFingerprint(page);
  await connectYnab(page);

  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  const card = page.getByRole("region", { name: "Budget ideas" });
  await expect(card).toBeVisible();
  // the biggest first: the once-a-year mulch (a yearly target), then Hardware Hank and Chewy by the month
  const ideas = card.getByRole("list", { name: "Budget ideas" }).getByRole("listitem", { includeHidden: false });
  await expect(card.getByRole("listitem", { name: "Ferris Landscape Supply" })).toContainText("$595 a year, due");
  await expect(card.getByRole("listitem", { name: "Hardware Hank" })).toContainText("$45 a month");
  await expect(card.getByRole("listitem", { name: "Chewy" })).toContainText("$25 a month");
  await expect(card.getByRole("listitem", { name: "Hardware Hank" })).toContainText("To add in YNAB: a category named Hardware Hank in the group Everyday, with a target of $45 a month.");
  expect(await ideas.count()).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await shot(page, "budget-ideas");

  // Add: the category and its target are created in YNAB, and the app says so
  await card.getByRole("listitem", { name: "Hardware Hank" }).getByRole("button", { name: "Add" }).click();
  await expect(card.getByRole("status")).toContainText("Added Hardware Hank to YNAB in the group Everyday, with a target of $45 a month.");
  expect(created).toEqual([{ category: { name: "Hardware Hank", category_group_id: "g1", goal_target: 45_000, goal_frequency: "monthly" } }]);
  await expect(card.getByRole("listitem", { name: "Hardware Hank" })).toHaveCount(0);

  // Not now and Never hide the others, and they stay hidden after a reload
  await card.getByRole("listitem", { name: "Chewy" }).getByRole("button", { name: "Not now" }).click();
  await expect(card.getByRole("listitem", { name: "Chewy" })).toHaveCount(0);
  await card.getByRole("listitem", { name: "Ferris Landscape Supply" }).getByRole("button", { name: "Never" }).click();
  await expect(page.getByRole("region", { name: "Budget ideas" })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText("Start New Trip")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Chewy" })).toHaveCount(0);
  await expect(page.getByRole("listitem", { name: "Ferris Landscape Supply" })).toHaveCount(0);
  await expect(page.getByRole("listitem", { name: "Hardware Hank" })).toHaveCount(0);
});
