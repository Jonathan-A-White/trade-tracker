// Connects YNAB at the phone's size (390x844) against a stubbed api.ynab.com: make the key, turn the switch on, paste a token, Check,
// choose a budget, 'Connected as <budget>'; a wrong token is refused and the switch stays Off. Ends in a screenshot.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./shot";

const TOKEN = "good-token-123";

async function stubYnab(page: Page): Promise<void> {
  await page.route("https://api.ynab.com/v1/**", async (route) => {
    const request = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, accept",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) {
      return json(401, { error: { id: "401", name: "unauthorized", detail: "Unauthorized" } });
    }
    const path = new URL(request.url()).pathname.replace(/^\/v1/, "");
    if (path === "/budgets") {
      return json(200, { data: { budgets: [{ id: "b1", name: "Our Budget" }, { id: "b2", name: "Side Budget" }] } });
    }
    if (path.endsWith("/categories")) {
      return json(200, {
        data: {
          category_groups: [
            {
              id: "g1",
              name: "Food",
              hidden: false,
              deleted: false,
              categories: [{ id: "c1", category_group_id: "g1", name: "Groceries", hidden: false, deleted: false }],
            },
          ],
          server_knowledge: 10,
        },
      });
    }
    if (path.endsWith("/accounts")) {
      return json(200, {
        data: { accounts: [{ id: "a1", name: "Checking", type: "checking", on_budget: true, closed: false, deleted: false }], server_knowledge: 10 },
      });
    }
    if (path.endsWith("/payees")) {
      return json(200, { data: { payees: [{ id: "p1", name: "Trader Joe's", deleted: false }], server_knowledge: 10 } });
    }
    return json(404, { error: { id: "404.2", name: "resource_not_found" } });
  });
}

// A virtual authenticator with the PRF extension stands in for the phone's fingerprint reader, so Make key finishes (key-qr.spec.ts).
async function makeKey(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  });
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
}

test("Settings > YNAB: a wrong token is refused, a good one connects the chosen budget", async ({ page }) => {
  await stubYnab(page);
  await page.goto("settings");
  const row = page.locator('[data-setting="ynab"]');
  const toggle = row.getByRole("switch", { name: "Connect YNAB" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(row.getByLabel("Personal Access Token")).toHaveCount(0);

  await makeKey(page);
  await row.scrollIntoViewIfNeeded();

  // a wrong token: the refusal line, and the switch is Off again
  await toggle.click();
  await row.getByLabel("Personal Access Token").fill("wrong-token");
  await row.getByRole("button", { name: "Check" }).click();
  await expect(row.getByText("YNAB did not accept this token.")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(row.getByLabel("Personal Access Token")).toHaveCount(0);

  // the right token: the budgets are listed, the chosen one is connected
  await toggle.click();
  await expect(row.getByText(/app\.ynab\.com > Account Settings > Developer Settings > New Token/)).toBeVisible();
  await row.getByLabel("Personal Access Token").fill(TOKEN);
  await row.getByRole("button", { name: "Check" }).click();
  const budgets = row.getByRole("list", { name: "Your budgets" });
  await expect(budgets.getByRole("button")).toHaveText(["Our Budget", "Side Budget"]);
  await shot(page, "ynab-budgets");
  await budgets.getByRole("button", { name: "Our Budget" }).click();
  await expect(row.getByText("Connected as Our Budget")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // the lists are cached in Dexie, the token is in no clear storage
  const cached = await page.evaluate(
    () =>
      new Promise<{ categories: number; accounts: number; payees: number; token: string | null }>((resolve, reject) => {
        const open = indexedDB.open("TradeTrackerDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["ynabCategories", "ynabAccounts", "ynabPayees"], "readonly");
          const counts = [
            tx.objectStore("ynabCategories").count(),
            tx.objectStore("ynabAccounts").count(),
            tx.objectStore("ynabPayees").count(),
          ];
          tx.oncomplete = () => {
            db.close();
            resolve({
              categories: counts[0].result,
              accounts: counts[1].result,
              payees: counts[2].result,
              token: Object.values(localStorage).find((v) => v.includes("good-token-123")) ?? null,
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(cached).toEqual({ categories: 1, accounts: 1, payees: 1, token: null });

  await page.reload();
  await expect(page.locator('[data-setting="ynab"]').getByText("Connected as Our Budget")).toBeVisible();
  await page.locator('[data-setting="ynab"]').scrollIntoViewIfNeeded();
  await shot(page, "ynab-connected");
});

test("YNAB Off: Home says nothing of YNAB", async ({ page }) => {
  await page.goto("");
  await expect(page.getByRole("link").first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/ynab/i);
});
