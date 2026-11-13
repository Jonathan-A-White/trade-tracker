// Clean up's action bar (Approve N / Skip this page) stays wholly above the bottom nav (mw-6ww.148.25). His phone is 1080x2340; the nav is
// fixed and --tt-nav-h tall, so a sticky bar must sit at that offset, not a smaller one. Against a stubbed api.ynab.com: make the key,
// unlock it, connect YNAB, open Clean up with 25 unapproved transactions (a page of 20 and a Skip this page button), and check the bar's box
// against the nav's top at the top of the list and at the bottom, and that the last card can be scrolled clear of the bar.
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

const category = (id: string, group: string, name: string) => ({ id, category_group_id: group, name, hidden: false, deleted: false });

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
          category_groups: [
            { id: "g1", name: "Everyday", hidden: false, deleted: false, categories: [category("f1", "g1", "Stuff I Forgot to Budget For"), category("c1", "g1", "Groceries")] },
          ],
          server_knowledge: 10,
        },
      });
    }
    if (path.endsWith("/accounts")) {
      return json(route, 200, { data: { accounts: [{ id: "a1", name: "Checking", type: "checking", on_budget: true, closed: false, deleted: false }], server_knowledge: 10 } });
    }
    if (path.endsWith("/payees")) return json(route, 200, { data: { payees: [], server_knowledge: 10 } });
    if (path.endsWith("/transactions")) {
      const transactions = Array.from({ length: 25 }, (_, n) => ({
        id: `t${n}`,
        account_id: "a1",
        date: `2026-10-${String((n % 28) + 1).padStart(2, "0")}`,
        amount: -(10 + n) * 1000,
        payee_name: `Payee ${n}`,
        category_id: null,
        category_name: null,
        approved: false,
        cleared: "cleared",
        deleted: false,
      }));
      return json(route, 200, { data: { transactions } });
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
  // making the key unlocked it and the day's unlock is kept on the device (mw-bfrti4c), so the reload resumes it: no fingerprint is asked for
  await expect(page.getByText("Key unlocked for today.")).toBeVisible();
  const ynab = page.locator('[data-setting="ynab"]');
  await ynab.scrollIntoViewIfNeeded();
  await ynab.getByRole("switch", { name: "Connect YNAB" }).click();
  await ynab.getByLabel("Personal Access Token").fill(TOKEN);
  await ynab.getByRole("button", { name: "Check" }).click();
  await ynab.getByRole("list", { name: "Your budgets" }).getByRole("button", { name: "Our Budget" }).click();
  await expect(ynab.getByText("Connected as Our Budget")).toBeVisible();
}

test("Clean up: the Approve / Skip bar is wholly above the nav, at the top and the bottom of the list", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 2340 });
  await stubYnab(page);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("pwa-kit:tapSettleMs", "0"));
  await virtualFingerprint(page);
  await connectYnab(page);

  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await page.goto("cleanup");
  const nav = page.getByRole("navigation");
  const approve = page.getByRole("button", { name: /^Approve \d+$/ });
  const skip = page.getByRole("button", { name: "Skip this page" });
  await expect(approve).toBeVisible();
  await expect(skip).toBeVisible();

  // a short viewport as well: the list must overflow it, so the bar is stuck rather than at the foot of the list
  const heights = [2340, 800];
  for (const height of heights) {
    await page.setViewportSize({ width: 1080, height });
    await page.evaluate(() => { document.getElementById("root")!.scrollTop = 0; });
    const navTop = (await nav.boundingBox())!.y;
    for (const [name, button] of [["Approve", approve], ["Skip this page", skip]] as const) {
      const box = (await button.boundingBox())!;
      expect(box.y + box.height, `${height}px tall, top of the list: ${name} button's foot (px) against the nav's top edge`).toBeLessThanOrEqual(navTop);
    }
    if (height === 800) await shot(page, "cleanup-bar-top");

    await page.evaluate(() => { const root = document.getElementById("root")!; root.scrollTop = root.scrollHeight; });
    const navTopEnd = (await nav.boundingBox())!.y;
    for (const [name, button] of [["Approve", approve], ["Skip this page", skip]] as const) {
      const box = (await button.boundingBox())!;
      expect(box.y + box.height, `${height}px tall, foot of the list: ${name} button's foot (px) against the nav's top edge`).toBeLessThanOrEqual(navTopEnd);
    }
    // the last card ends above the bar's top edge once scrolled to the end
    const cardFoot = await approve.evaluate((button) => {
      const card = button.parentElement!.previousElementSibling!;
      const r = card.getBoundingClientRect();
      return r.y + r.height;
    });
    expect(cardFoot, `${height}px tall: the last card's foot against the action bar's top`).toBeLessThanOrEqual((await approve.boundingBox())!.y);
    if (height === 800) await shot(page, "cleanup-bar-bottom");
  }
});
