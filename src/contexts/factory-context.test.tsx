import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { vault } from "bsv-kit/bsv";
import type { licence } from "bsv-kit/bsv";
import { FactoryProvider, useFactory } from "@/contexts/factory-context";
import type { FactoryLicenceChecker } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import type { PasskeyPort } from "@/services/passkey";
import SettingsPage from "@/pages/settings-page";

const VAULT_KEY = "tradetracker-factory-key";
const PUBLIC_KEY = "tradetracker-factory-public";
const FINGERPRINT_KEY = "tradetracker-factory-fingerprint";
const BACKEND_KEY = "tradetracker-factory-backend";
const checkedAt = "2026-10-05T00:00:00.000Z";

const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};
const none: licence.LicenceStatus = { state: "none", checkedAt };

function DoorProbe() {
  const { door } = useFactory();
  return <p data-testid="door">{door}</p>;
}

// No WebAuthn here: the 12 words are the only way to unlock.
const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

function renderSettings(
  checkLicence: FactoryLicenceChecker = async () => none,
  port: PasskeyPort = noWebAuthn,
) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={checkLicence} passkeyPort={port}>
          <DoorProbe />
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Makes the key in Settings and returns the 12 words it showed. */
async function makeKey(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.click(screen.getByRole("button", { name: "Make key" }));
  await screen.findByText(/Key made/);
  return screen.getByTestId("recovery-phrase").textContent ?? "";
}

function storedStorage(): vault.Storage {
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
  };
}

/** A key stored the old way, wrapped by a passphrase; returns its 12 words. */
async function seedPassphraseKey(passphrase: string): Promise<string> {
  const made = await vault.generate();
  await vault.saveVault(storedStorage(), await vault.wrap(made.key, { passphrase }), VAULT_KEY);
  return made.phrase;
}

describe("Settings > Factory", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  it("with no key it offers Make key, reads no licence and shows door state 'no-key'", async () => {
    const checkLicence = vi.fn<FactoryLicenceChecker>(async () => none);
    renderSettings(checkLicence);

    expect(screen.getByRole("heading", { name: "Factory" })).toBeInTheDocument();
    // no passphrase anywhere for a new key
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make key" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
    // without WebAuthn the page says the 12 words are the only unlock
    expect(screen.getByText(/only way to unlock/)).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("no-key");
    // the rest of the settings page renders as before
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear All Data" })).toBeInTheDocument();
    expect(checkLicence).not.toHaveBeenCalled();
  });

  it("Make key without WebAuthn shows 12 words and the public key, and stores no wrapped copy", async () => {
    const user = userEvent.setup();
    renderSettings();
    const words = await makeKey(user);

    expect(words.split(" ")).toHaveLength(12);
    expect(vault.isValidMnemonic(words)).toBe(true);
    const publicKeyHex = localStorage.getItem(PUBLIC_KEY);
    expect(publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(vault.publicKeyHexFromKey(await vault.keyFromPhrase(words))).toBe(publicKeyHex);
    expect(localStorage.getItem(VAULT_KEY)).toBeNull();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();

    expect(screen.getByText("Public key")).toBeInTheDocument();
    expect(screen.getByText(publicKeyHex!)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make key" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("Copy puts the public key on the clipboard", async () => {
    const user = userEvent.setup();
    renderSettings();
    await makeKey(user);

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(localStorage.getItem(PUBLIC_KEY));
  });

  it("the right 12 words unlock a locked key and the door leaves 'locked'", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    const words = await makeKey(user);
    first.unmount();

    // a new launch: only the public key is in localStorage, nothing is in memory
    renderSettings();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    expect(screen.queryByRole("button", { name: "Make key" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock with fingerprint" })).not.toBeInTheDocument();

    // case, spacing and line breaks do not matter
    await user.type(screen.getByLabelText("12 words"), `  ${words.toUpperCase().replace(/ /g, "  ")}\n`);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("12 words of another key are refused with a plain message and nothing changes", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    await makeKey(user);
    first.unmount();
    const before = { ...localStorage };
    const other = (await vault.generate()).phrase;

    renderSettings();
    await user.type(screen.getByLabelText("12 words"), other);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Those 12 words are for a different key.")).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    expect({ ...localStorage }).toEqual(before);
  });

  it("words that are not a recovery phrase are refused and the door stays locked", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    await makeKey(user);
    first.unmount();

    renderSettings();
    await user.type(screen.getByLabelText("12 words"), "not twelve real words");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText(/not a valid 12-word recovery phrase/)).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
  });

  it("a key stored the old way, wrapped by a passphrase, still unlocks with that passphrase", async () => {
    const user = userEvent.setup();
    await seedPassphraseKey("correct horse");

    renderSettings();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    expect(screen.getByText(/passphrase you made it with also works/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("12 words"), "wrong one");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("That passphrase does not open the stored key.")).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");

    await user.clear(screen.getByLabelText("12 words"));
    await user.type(screen.getByLabelText("12 words"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
    expect(screen.queryByText("That passphrase does not open the stored key.")).not.toBeInTheDocument();
  });

  it("a key stored the old way also opens with its 12 words, and the passphrase line shows only for such a key", async () => {
    const user = userEvent.setup();
    const words = await seedPassphraseKey("correct horse");

    renderSettings();
    await user.type(screen.getByLabelText("12 words"), words);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("a new key never mentions a passphrase on the unlock screen", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    await makeKey(user);
    first.unmount();

    renderSettings();
    expect(await screen.findByText("None")).toBeInTheDocument();
    expect(screen.queryByText(/passphrase/i)).not.toBeInTheDocument();
  });

  it("shows Licence held for collection trade-tracker and door state 'licensed'", async () => {
    const user = userEvent.setup();
    const checkLicence = vi.fn<FactoryLicenceChecker>(async () => held);
    renderSettings(checkLicence);
    await makeKey(user);

    expect(await screen.findByText("Held")).toBeInTheDocument();
    expect(screen.getByText("Licence")).toBeInTheDocument();
    expect(checkLicence).toHaveBeenCalledWith(expect.stringMatching(/^0[23][0-9a-f]{64}$/), "trade-tracker");
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("licensed"));
  });

  it("shows Licence none when the key holds no licence", async () => {
    const user = userEvent.setup();
    renderSettings(async () => none);
    await makeKey(user);

    expect(await screen.findByText("None")).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("unlocked");
  });

  it("shows Licence checking while the reader has not answered", async () => {
    const user = userEvent.setup();
    renderSettings(() => new Promise<licence.LicenceStatus>(() => {}));
    await makeKey(user);

    expect(await screen.findByText("Checking")).toBeInTheDocument();
  });

  it("says the licence could not be checked when the reader fails, and does not break", async () => {
    const user = userEvent.setup();
    renderSettings(async () => {
      throw new Error("offline");
    });
    await makeKey(user);

    expect(await screen.findByText("Could not check")).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("unlocked");
  });

  it("Backend defaults to the postern URL and is kept on this device", async () => {
    const user = userEvent.setup();
    renderSettings();
    const backend = screen.getByLabelText("Backend");
    expect(backend).toHaveValue("https://postern.allmymind.org");

    await user.clear(backend);
    await user.type(backend, "https://example.test");
    expect(localStorage.getItem(BACKEND_KEY)).toBe("https://example.test");
  });
});
