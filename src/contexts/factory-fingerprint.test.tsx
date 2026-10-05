import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { vault } from "bsv-kit/bsv";
import type { licence } from "bsv-kit/bsv";
import { FactoryProvider, useFactory } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import type { PasskeyPort } from "@/services/passkey";
import SettingsPage from "@/pages/settings-page";

const VAULT_KEY = "tradetracker-factory-key";
const FINGERPRINT_KEY = "tradetracker-factory-fingerprint";
const CREDENTIAL_KEY = "tradetracker-factory-fingerprint-credential";
const none: licence.LicenceStatus = { state: "none", checkedAt: "2026-10-05T00:00:00.000Z" };

const PRF_SECRET = new Uint8Array(32).fill(7);

function fakePort(overrides: Partial<PasskeyPort> = {}): PasskeyPort {
  return {
    isAvailable: () => true,
    create: async () => ({ credentialId: new Uint8Array([1, 2, 3, 4]).buffer, prfSupported: true }),
    getPrfSecret: async () => PRF_SECRET.buffer.slice(0),
    ...overrides,
  };
}

function DoorProbe() {
  const { door } = useFactory();
  return <p data-testid="door">{door}</p>;
}

function renderSettings(port: PasskeyPort) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={async () => none} passkeyPort={port}>
          <DoorProbe />
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function makeKey(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Passphrase"), "correct horse");
  await user.click(screen.getByRole("button", { name: "Make key" }));
  await screen.findByText(/Key made/);
}

function storedKeyPublicHex(): string {
  return JSON.parse(localStorage.getItem(VAULT_KEY) ?? "null").publicKeyHex;
}

describe("Settings > Factory > fingerprint", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  it("Use fingerprint stores a second wrapped copy that unwraps with the PRF secret to the same key", async () => {
    const user = userEvent.setup();
    renderSettings(fakePort());
    await makeKey(user);

    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    await waitFor(() => expect(localStorage.getItem(FINGERPRINT_KEY)).not.toBeNull());

    const storage: vault.Storage = {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => localStorage.setItem(k, v),
      remove: (k) => localStorage.removeItem(k),
    };
    const second = await vault.loadVault(storage, FINGERPRINT_KEY);
    const first = await vault.loadVault(storage, VAULT_KEY);
    expect(second?.mode).toBe("prf");
    expect(first?.mode).toBe("phrase");
    const fromSecond = await vault.unwrap(second!, { prfSecret: PRF_SECRET });
    const fromFirst = await vault.unwrap(first!, { passphrase: "correct horse" });
    expect(Array.from(fromSecond)).toEqual(Array.from(fromFirst));
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeTruthy();

    // the button gives way to Remove fingerprint
    expect(screen.queryByRole("button", { name: "Use fingerprint" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove fingerprint" })).toBeInTheDocument();
  });

  it("locked, Unlock with fingerprint opens the key and the door leaves 'locked'", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort());
    await makeKey(user);
    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    await screen.findByRole("button", { name: "Remove fingerprint" });
    first.unmount();

    const getPrfSecret = vi.fn(async () => PRF_SECRET.buffer.slice(0));
    renderSettings(fakePort({ getPrfSecret }));
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    // fingerprint comes first, the passphrase stays as the fallback
    const fingerprint = screen.getByRole("button", { name: "Unlock with fingerprint" });
    const passphraseButton = screen.getByRole("button", { name: "Unlock" });
    expect(
      fingerprint.compareDocumentPosition(passphraseButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByLabelText("Passphrase")).toBeInTheDocument();

    await user.click(fingerprint);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
    expect(getPrfSecret).toHaveBeenCalledTimes(1);
  });

  it("a PRF that returns nothing says why in plain words and stores nothing", async () => {
    const user = userEvent.setup();
    renderSettings(fakePort({ getPrfSecret: async () => null }));
    await makeKey(user);

    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    expect(
      await screen.findByText(/cannot unlock with a fingerprint here/),
    ).toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Use fingerprint" })).toBeInTheDocument();
  });

  it("a cancelled fingerprint prompt shows a plain message, not the browser's text", async () => {
    const user = userEvent.setup();
    renderSettings(
      fakePort({
        getPrfSecret: async () => {
          throw new DOMException("The operation either timed out. See: https://www.w3.org/x", "NotAllowedError");
        },
      }),
    );
    await makeKey(user);

    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    expect(await screen.findByText("Fingerprint cancelled. Tap the button to try again.")).toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();
  });

  it("with WebAuthn unavailable no fingerprint button shows and the passphrase works as before", async () => {
    const user = userEvent.setup();
    const port = fakePort({ isAvailable: () => false });
    const first = renderSettings(port);
    await makeKey(user);
    expect(screen.queryByRole("button", { name: "Use fingerprint" })).not.toBeInTheDocument();
    first.unmount();

    renderSettings(port);
    expect(screen.queryByRole("button", { name: "Unlock with fingerprint" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Passphrase"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("the passphrase still unlocks a key that also has a fingerprint copy", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort());
    await makeKey(user);
    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    await screen.findByRole("button", { name: "Remove fingerprint" });
    first.unmount();

    renderSettings(fakePort());
    await user.type(screen.getByLabelText("Passphrase"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("Remove fingerprint deletes only the second copy", async () => {
    const user = userEvent.setup();
    renderSettings(fakePort());
    await makeKey(user);
    const before = localStorage.getItem(VAULT_KEY);
    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    await user.click(await screen.findByRole("button", { name: "Remove fingerprint" }));

    await waitFor(() => expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull());
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull();
    expect(localStorage.getItem(VAULT_KEY)).toBe(before);
    expect(storedKeyPublicHex()).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(await screen.findByRole("button", { name: "Use fingerprint" })).toBeInTheDocument();
  });
});
