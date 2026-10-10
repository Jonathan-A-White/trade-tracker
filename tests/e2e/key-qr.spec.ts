// Settings shows this phone's public key as a QR code (for Postern's Issue a licence scanner), with the key text and Copy
// under it, all in one 390x844 screen (mw-iy99ci.29). A virtual authenticator with the PRF extension stands in for the
// phone's fingerprint reader so Make key can finish.
import { expect, test } from "@playwright/test";
import { shot } from "./shot";

test("Settings shows the key as a QR code with the key text and Copy in the same screen", async ({ page }) => {
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

  await page.goto("settings");
  await page.getByRole("button", { name: "Make key" }).click();
  await expect(page.getByTestId("recovery-phrase")).toBeVisible();

  const qr = page.getByRole("img", { name: "This phone's key as a QR code" });
  await expect(qr).toBeVisible();
  const box = (await qr.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(192);
  expect(box.height).toBeGreaterThanOrEqual(192);

  const keyText = page.locator("p.slashed-zero");
  await expect(keyText).toHaveText(/^0[23][0-9a-f]{64}$/);
  const copy = page.getByRole("button", { name: "Copy", exact: true });
  await copy.scrollIntoViewIfNeeded();

  // the QR, the key text and Copy are all inside the 844 px screen at once
  const viewport = page.viewportSize()!;
  for (const target of [qr, keyText, copy]) {
    const b = (await target.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
  }
  await shot(page, "settings-key-qr");
});
