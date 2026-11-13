// Every tab's scroll content ends above the bottom nav (mw-6ww.148.45). His report: Home's Budget ideas card's action row (Add, Not now,
// Never, Reply) ran under the nav bar. At 390x844 each tab is scrolled to the foot, and the last thing it draws must end above the nav's
// top edge with a small gap (GAP px, mw-6ww.148.46), so a card's bottom border is not cut at the nav's edge; Home's Budget ideas buttons must also stay clear of the nav when
// they are scrolled into view (what a tap on them does) and be the topmost element at their centre. Against a stubbed api.ynab.com.
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { shot } from "./shot";

const TOKEN = "good-token-123";
const GAP = 8; // the least space (px) between the last thing a tab draws and the nav's top edge
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
    if (path.endsWith("/accounts")) {
      return json(route, 200, { data: { accounts: [{ id: "a1", name: "Checking", type: "checking", on_budget: true, closed: false, deleted: false }], server_knowledge: 10 } });
    }
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
            ...Array.from({ length: 25 }, (_, n) => ({
              id: `u${n}`,
              account_id: "a1",
              date: `2026-10-${String((n % 28) + 1).padStart(2, "0")}`,
              amount: -(10 + n) * 1000,
              payee_name: `Payee ${n}`,
              category_id: null,
              category_name: null,
              approved: false,
              cleared: "cleared",
              deleted: false,
            })),
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


// A store, an item and a completed trip so Trips and Items have rows to end on.
async function seedRows(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("TradeTrackerDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["stores", "items", "trips"], "readwrite");
          const now = Date.now();
          tx.objectStore("stores").put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
          for (let n = 0; n < 12; n++) {
            tx.objectStore("items").put({ id: `i${n}`, barcode: `01234567890${String(n).padStart(2, "0")}`, name: `Oat milk ${n}`, currentPrice: 3.49, unitType: "each", createdAt: now, updatedAt: now });
            tx.objectStore("trips").put({
              id: `t${n}`, storeId: "s1", status: "completed", startedAt: now - (n + 1) * 3_600_000, endedAt: now - n * 3_600_000, scannedSubtotal: 10, createdAt: now, updatedAt: now,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

const scrollToFoot = (page: Page) => page.evaluate(() => { const root = document.getElementById("root")!; root.scrollTop = root.scrollHeight; });

/** The lowest edge (px) of anything the page draws in the scroll area, leaving out what is fixed to the screen (nav, toasts). */
function lowestEdge(page: Page): Promise<number> {
  return page.evaluate(() => {
    let lowest = 0;
    const walk = (el: Element) => {
      if (getComputedStyle(el).position === "fixed") return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") lowest = Math.max(lowest, r.bottom);
      for (const child of Array.from(el.children)) walk(child);
    };
    // the shell's page area is the root's first div's second child (after the update banner)
    const shell = document.getElementById("root")!.firstElementChild!;
    for (const child of Array.from(shell.children)) if (child.tagName !== "NAV") walk(child.firstElementChild ?? child);
    return lowest;
  });
}

/** True when the element is what a tap at its centre would hit. */
async function isClickable(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top !== null && el.contains(top);
  });
}

test("every tab's scroll content ends above the nav, and Home's Budget ideas buttons clear it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubYnab(page, []);
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("pwa-kit:tapSettleMs", "0"));
  await virtualFingerprint(page);
  await connectYnab(page);
  await seedRows(page);

  const nav = page.getByRole("navigation");
  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  const card = page.getByRole("region", { name: "Budget ideas" });
  await expect(card).toBeVisible();
  const ideas = card.getByRole("listitem", { name: /Hardware Hank|Chewy|Ferris Landscape Supply/ });
  expect(await ideas.count()).toBeGreaterThanOrEqual(3);

  // each idea's action row, brought into view the way a tap or a keyboard focus does (the nearest edge): the scroll area's own edge is the
  // screen's, so without a scroll padding a button that is only partly under the nav is counted as already in view and left there
  for (let n = 0; n < (await ideas.count()); n++) {
    const idea = ideas.nth(n);
    for (const name of ["Add", "Not now", "Never", "Reply"]) {
      const button = idea.getByRole("button", { name, exact: true });
      await button.evaluate((el) => el.scrollIntoView({ block: "nearest", behavior: "instant" }));
      const navTop = (await nav.boundingBox())!.y;
      const box = (await button.boundingBox())!;
      expect(box.y + box.height, `idea ${n}, ${name} button's foot (px) against the nav's top edge`).toBeLessThanOrEqual(navTop);
      expect(await isClickable(button), `idea ${n}, ${name} button is the topmost element at its centre`).toBe(true);
    }
  }
  // and the card's own foot, with the whole Home page scrolled to the end
  await scrollToFoot(page);
  expect(await lowestEdge(page), "Home, scrolled to the foot: the lowest edge (px) against the nav's top edge").toBeLessThanOrEqual((await nav.boundingBox())!.y - GAP);
  await shot(page, "tab-ends-above-nav-home");

  const tabs: Array<[string, string]> = [
    ["Trips", "trips/history"],
    ["Items", "items"],
    ["Reports", "reports"],
    ["Settings", "settings"],
    ["Clean up", "cleanup"],
  ];
  for (const [name, path] of tabs) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    if (name === "Clean up") await expect(page.getByRole("button", { name: /^Approve \d+$/ })).toBeVisible();
    await page.waitForTimeout(500);
    await scrollToFoot(page);
    const navTop = (await nav.boundingBox())!.y;
    expect(await lowestEdge(page), `${name}, scrolled to the foot: the lowest edge (px) against the nav's top edge less the gap`).toBeLessThanOrEqual(navTop - GAP);
    await shot(page, `tab-ends-above-nav-${name.toLowerCase().replace(" ", "-")}`);
  }
});
