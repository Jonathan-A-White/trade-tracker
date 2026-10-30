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
const PUBLIC_KEY = "tradetracker-factory-public";
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

/** Clicks Make key and returns the 12 words shown. */
async function makeKey(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.click(screen.getByRole("button", { name: "Make key" }));
  await screen.findByText(/Key made/);
  return screen.getByTestId("recovery-phrase").textContent ?? "";
}

const storage: vault.Storage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
};

/** A key stored the old way, wrapped by a passphrase; returns its 12 words and key. */
async function seedPassphraseKey(passphrase: string) {
  const made = await vault.generate();
  await vault.saveVault(storage, await vault.wrap(made.key, { passphrase }), VAULT_KEY);
  return made;
}

async function typeWordsAndUnlock(user: ReturnType<typeof userEvent.setup>, words: string) {
  await user.type(screen.getByLabelText("12 words"), words);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
}

describe("Settings > Factory > fingerprint", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  it("Make key with WebAuthn asks for the fingerprint at once, shows 12 words and stores a fingerprint copy of the same key", async () => {
    const user = userEvent.setup();
    const create = vi.fn(async () => ({ credentialId: new Uint8Array([1, 2, 3, 4]).buffer, prfSupported: true }));
    const getPrfSecret = vi.fn(async () => PRF_SECRET.buffer.slice(0));
    renderSettings(fakePort({ create, getPrfSecret }));
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
    const words = await makeKey(user);

    expect(create).toHaveBeenCalledTimes(1);
    expect(getPrfSecret).toHaveBeenCalledTimes(1);
    expect(words.split(" ")).toHaveLength(12);
    const second = await vault.loadVault(storage, FINGERPRINT_KEY);
    expect(second?.mode).toBe("prf");
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeTruthy();
    const fromSecond = await vault.unwrap(second!, { prfSecret: PRF_SECRET });
    expect(Array.from(fromSecond)).toEqual(Array.from(await vault.keyFromPhrase(words)));
    // the public key sits beside it in the clear; no passphrase copy exists
    expect(localStorage.getItem(PUBLIC_KEY)).toBe(vault.publicKeyHexFromKey(fromSecond));
    expect(localStorage.getItem(VAULT_KEY)).toBeNull();

    expect(screen.queryByRole("button", { name: "Use fingerprint" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove fingerprint" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("locked, Unlock with fingerprint opens the key and the door leaves 'locked'; the 12 words stay as the fallback", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort());
    await makeKey(user);
    first.unmount();

    const getPrfSecret = vi.fn(async () => PRF_SECRET.buffer.slice(0));
    renderSettings(fakePort({ getPrfSecret }));
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    // fingerprint comes first, the 12 words stay as the fallback
    const fingerprint = screen.getByRole("button", { name: "Unlock with fingerprint" });
    const wordsButton = screen.getByRole("button", { name: "Unlock" });
    expect(
      fingerprint.compareDocumentPosition(wordsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByLabelText("12 words")).toBeInTheDocument();
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();

    await user.click(fingerprint);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
    expect(getPrfSecret).toHaveBeenCalledTimes(1);
  });

  it("a fingerprint that gives no PRF secret still makes the key, shows the 12 words, says why and offers Use fingerprint", async () => {
    const user = userEvent.setup();
    renderSettings(fakePort({ getPrfSecret: async () => null }));
    const words = await makeKey(user);

    expect(vault.isValidMnemonic(words)).toBe(true);
    expect(await screen.findByText(/cannot unlock with a fingerprint here/)).toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull();
    expect(localStorage.getItem(PUBLIC_KEY)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use fingerprint" })).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("unlocked");
  });

  it("a cancelled fingerprint prompt at Make key shows a plain message, not the browser's text, and the key is still made", async () => {
    const user = userEvent.setup();
    renderSettings(
      fakePort({
        create: async () => {
          throw new DOMException("The operation either timed out. See: https://www.w3.org/x", "NotAllowedError");
        },
      }),
    );
    const words = await makeKey(user);

    expect(words.split(" ")).toHaveLength(12);
    expect(await screen.findByText(/Fingerprint cancelled\. Tap the button to try again\./)).toBeInTheDocument();
    expect(screen.queryByText(/w3\.org/)).not.toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Use fingerprint" })).toBeInTheDocument();
  });

  it("a cancelled prompt at Unlock with fingerprint leaves the door locked and the 12 words still work", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort());
    const words = await makeKey(user);
    first.unmount();

    renderSettings(
      fakePort({
        getPrfSecret: async () => {
          throw new DOMException("The operation either timed out. See: https://www.w3.org/x", "NotAllowedError");
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Unlock with fingerprint" }));
    expect(await screen.findByText("Fingerprint cancelled. Tap the button to try again.")).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");

    await typeWordsAndUnlock(user, words);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("with WebAuthn unavailable Make key works and the 12 words unlock; no fingerprint button shows", async () => {
    const user = userEvent.setup();
    const port = fakePort({ isAvailable: () => false });
    const first = renderSettings(port);
    const words = await makeKey(user);
    expect(screen.queryByRole("button", { name: "Use fingerprint" })).not.toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();
    first.unmount();

    renderSettings(port);
    expect(screen.queryByRole("button", { name: "Unlock with fingerprint" })).not.toBeInTheDocument();
    await typeWordsAndUnlock(user, words);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("the 12 words unlock a key that has a fingerprint copy, and the fingerprint copy is left alone", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort());
    const words = await makeKey(user);
    const copy = localStorage.getItem(FINGERPRINT_KEY);
    first.unmount();

    renderSettings(fakePort());
    await typeWordsAndUnlock(user, words);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBe(copy);
  });

  it("12 words unlock a key that has no fingerprint copy, then Use fingerprint is offered again", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort({ isAvailable: () => false }));
    const words = await makeKey(user);
    first.unmount();

    renderSettings(fakePort());
    expect(screen.queryByRole("button", { name: "Unlock with fingerprint" })).not.toBeInTheDocument();
    await typeWordsAndUnlock(user, words);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));

    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    expect(await screen.findByRole("button", { name: "Remove fingerprint" })).toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).not.toBeNull();
  });

  it("Remove fingerprint deletes only the fingerprint copy and the 12 words still unlock", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort());
    const words = await makeKey(user);
    const publicKey = localStorage.getItem(PUBLIC_KEY);

    await user.click(await screen.findByRole("button", { name: "Remove fingerprint" }));
    await waitFor(() => expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull());
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull();
    expect(localStorage.getItem(PUBLIC_KEY)).toBe(publicKey);
    expect(await screen.findByRole("button", { name: "Use fingerprint" })).toBeInTheDocument();
    first.unmount();

    renderSettings(fakePort());
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    expect(screen.queryByRole("button", { name: "Unlock with fingerprint" })).not.toBeInTheDocument();
    await typeWordsAndUnlock(user, words);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("a key made with a passphrase: the passphrase unlocks it, Use fingerprint is then offered, and the 12 words work from then on", async () => {
    const user = userEvent.setup();
    const made = await seedPassphraseKey("correct horse");
    const oldCopy = localStorage.getItem(VAULT_KEY);

    const first = renderSettings(fakePort());
    await typeWordsAndUnlock(user, "correct horse");
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));

    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    await screen.findByRole("button", { name: "Remove fingerprint" });
    const second = await vault.loadVault(storage, FINGERPRINT_KEY);
    const fromSecond = await vault.unwrap(second!, { prfSecret: PRF_SECRET });
    expect(Array.from(fromSecond)).toEqual(Array.from(made.key));
    expect(localStorage.getItem(VAULT_KEY)).toBe(oldCopy);
    first.unmount();

    // a new launch: the fingerprint opens it, and so do the 12 words
    const again = renderSettings(fakePort());
    await user.click(screen.getByRole("button", { name: "Unlock with fingerprint" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
    again.unmount();

    renderSettings(fakePort());
    await typeWordsAndUnlock(user, made.phrase);
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("a key made with a passphrase, with a fingerprint copy, still opens with its passphrase", async () => {
    const user = userEvent.setup();
    await seedPassphraseKey("correct horse");
    const first = renderSettings(fakePort());
    await typeWordsAndUnlock(user, "correct horse");
    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    await screen.findByRole("button", { name: "Remove fingerprint" });
    first.unmount();

    renderSettings(fakePort());
    await typeWordsAndUnlock(user, "correct horse");
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("Use fingerprint with a PRF that returns nothing says why in plain words and stores nothing", async () => {
    const user = userEvent.setup();
    const first = renderSettings(fakePort({ isAvailable: () => false }));
    const words = await makeKey(user);
    first.unmount();

    renderSettings(fakePort({ getPrfSecret: async () => null }));
    await typeWordsAndUnlock(user, words);
    await user.click(await screen.findByRole("button", { name: "Use fingerprint" }));
    expect(await screen.findByText(/cannot unlock with a fingerprint here/)).toBeInTheDocument();
    expect(localStorage.getItem(FINGERPRINT_KEY)).toBeNull();
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull();
  });
});
