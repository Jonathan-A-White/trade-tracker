import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "qrcode";
import { MemoryRouter } from "react-router";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { FactorySettings } from "@/components/factory/factory-settings";
import type { PasskeyPort } from "@/services/passkey";

const PUBLIC_KEY = "tradetracker-factory-public";

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

function renderFactorySettings() {
  localStorage.setItem("tradetracker-theme", "light");
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider
          checkLicence={async () => ({ state: "none", checkedAt: "2026-10-10T00:00:00.000Z" })}
          passkeyPort={noWebAuthn}
          askDoor={async () => "unreachable"}
          licenceRetryMs={[1, 1]}
        >
          <FactorySettings />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** The dark modules of an SVG path made of one `M<col> <row>h1v1h-1z` square per module. */
function modulesFromPath(path: string, size: number): boolean[] {
  const dark = new Array<boolean>(size * size).fill(false);
  for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    dark[Number(m[2]) * size + Number(m[1])] = true;
  }
  return dark;
}

describe("FactorySettings public key", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function makeKeyAndGetHex(user: ReturnType<typeof userEvent.setup>): Promise<string> {
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText(/Key made/);
    return localStorage.getItem(PUBLIC_KEY)!;
  }

  it("shows the key as a QR code labelled for a screen reader, above the key text and Copy", async () => {
    const user = userEvent.setup();
    renderFactorySettings();
    const hex = await makeKeyAndGetHex(user);

    const qr = await screen.findByRole("img", { name: "This phone's key as a QR code" });
    const text = screen.getByText(hex);
    const copy = screen.getByRole("button", { name: "Copy" });
    expect(qr.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(qr.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Licence")).toBeInTheDocument();
  });

  it("draws exactly the modules of the key, with a quiet zone of 4 and at least 192 px", async () => {
    const user = userEvent.setup();
    renderFactorySettings();
    const hex = await makeKeyAndGetHex(user);

    const qr = await screen.findByRole("img", { name: "This phone's key as a QR code" });
    const expected = create(hex, { errorCorrectionLevel: "M" }).modules;
    const path = qr.querySelector("path")!.getAttribute("d")!;
    expect(modulesFromPath(path, expected.size)).toEqual(Array.from(expected.data, Boolean));

    const extent = expected.size + 8;
    expect(qr.getAttribute("viewBox")).toBe(`-4 -4 ${extent} ${extent}`);
    expect(Number(qr.getAttribute("width"))).toBeGreaterThanOrEqual(192);
    expect(Number(qr.getAttribute("height"))).toBeGreaterThanOrEqual(192);
  });

  it("keeps the key text in a monospace font with slashed zeros", async () => {
    const user = userEvent.setup();
    renderFactorySettings();
    const hex = await makeKeyAndGetHex(user);

    const text = screen.getByText(hex);
    expect(text).toHaveClass("font-mono");
    expect(text).toHaveClass("slashed-zero");
    expect(within(text.parentElement!).getByText("Public key")).toBeInTheDocument();
  });

  it("shows no QR before there is a key", () => {
    renderFactorySettings();
    expect(screen.queryByRole("img", { name: "This phone's key as a QR code" })).toBeNull();
  });
});
