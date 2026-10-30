// Settings > Family at the phone's size (390x844) against a stubbed backend: make the key and hold the licence, turn Family on, see the
// family's address and the Gmail recipe, wait for Gmail's confirmation, see the code when its mail lands, add two cards. Ends in a screenshot.
import { expect, test, type Page, type Route } from "@playwright/test";
import { shot } from "./shot";

const BACKEND = "https://postern.allmymind.org";
const ADDRESS = "abcdefg234567@alerts.example.test";

interface Alert {
  id: string;
  seq: number;
  kind: string;
  code?: string;
}

// The backend's challenge and its three alerts routes, as docs/protocol.md 26 of Postern has them, for any signed call.
async function stubBackend(page: Page, feed: Alert[]): Promise<void> {
  await page.route(`${BACKEND}/api/**`, async (route: Route) => {
    const request = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, DELETE",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    const url = new URL(request.url());
    if (url.pathname === "/api/challenge") return json(200, { nonce: "ab".repeat(16) });
    if (!request.headers()["authorization"]?.startsWith("Postern2 ")) return json(401, { reason: "no_licence" });
    if (url.pathname === "/api/alerts/address" && request.method() === "POST") return json(200, { address: ADDRESS });
    if (url.pathname === "/api/alerts" && request.method() === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0");
      const alerts = feed.filter((a) => a.seq > since);
      return json(200, { alerts, next: alerts.length > 0 ? alerts[alerts.length - 1]!.seq : since });
    }
    return json(404, { error: "not found" });
  });
}

// A virtual authenticator with the PRF extension stands in for the phone's fingerprint reader (key-qr.spec.ts).
async function virtualFingerprint(page: Page): Promise<void> {
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
}

test("Settings > Family: the address, the recipe, Gmail's code and two cards", async ({ page }) => {
  const feed: Alert[] = [];
  await stubBackend(page, feed);
  // The chain cannot be reached, so the licence stands on the 24 h grace a held answer leaves (bsv-kit.licence).
  await page.route("https://api.whatsonchain.com/**", (route) => route.abort());
  await virtualFingerprint(page);

  await page.goto("settings");
  const row = page.locator('[data-setting="family"]');
  const toggle = row.getByRole("switch", { name: "Family alerts" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(row.getByText("My cards")).toHaveCount(0);
  expect(await row.innerText()).not.toContain(ADDRESS);

  // make the key, hold the licence for it, and come back to it unlocked by the fingerprint
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();
  await page.evaluate(() => {
    const publicKeyHex = localStorage.getItem("tradetracker-factory-public");
    localStorage.setItem("bsv-kit.licence", JSON.stringify({ publicKeyHex, at: Date.now() }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Unlock with fingerprint" }).click();
  await expect(page.getByText("Key unlocked for today.")).toBeVisible();

  await row.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(row.getByText(ADDRESS)).toBeVisible();
  await expect(row.getByRole("list", { name: "Gmail filter recipe" }).getByRole("listitem")).toHaveCount(5);
  await expect(row.getByText("Waiting for Gmail's confirmation")).toBeVisible();

  // Gmail's mail lands at the family's address: the code appears within one poll
  feed.push({ id: "0000000000000001", seq: 1, kind: "forward-confirm", code: "493827" });
  await expect(row.getByText("493827")).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(row.getByText("Waiting for Gmail's confirmation")).toHaveCount(0);

  // two cards
  const cards = row.getByRole("list", { name: "Cards" }).getByRole("listitem");
  let added = 0;
  for (const [lastFour, owner] of [["1234", "Jonathan"], ["9876", "shared"]] as const) {
    await row.getByLabel("Last four").fill(lastFour);
    await row.getByLabel("Whose card").fill(owner);
    await row.getByRole("button", { name: "Add card" }).click();
    // the form empties once the card is kept
    await expect(cards).toHaveCount(++added);
  }

  await row.scrollIntoViewIfNeeded();
  await shot(page, "family");
});
