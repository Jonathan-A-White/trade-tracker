import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { licence } from "bsv-kit/bsv";
import { FactoryProvider, useFactory } from "@/contexts/factory-context";
import type { FactoryLicenceChecker } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import SettingsPage from "@/pages/settings-page";

const VAULT_KEY = "tradetracker-factory-key";
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

function renderSettings(checkLicence: FactoryLicenceChecker = async () => none) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={checkLicence}>
          <DoorProbe />
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function makeKey(user: ReturnType<typeof userEvent.setup>, passphrase = "correct horse") {
  await user.type(screen.getByLabelText("Passphrase"), passphrase);
  await user.click(screen.getByRole("button", { name: "Make key" }));
  await screen.findByText(/Key made/);
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
    expect(screen.getByLabelText("Passphrase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make key" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("no-key");
    // the rest of the settings page renders as before
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear All Data" })).toBeInTheDocument();
    expect(checkLicence).not.toHaveBeenCalled();
  });

  it("Make key stores a wrapped key and shows the public key", async () => {
    const user = userEvent.setup();
    renderSettings();
    await makeKey(user);

    const stored = JSON.parse(localStorage.getItem(VAULT_KEY) ?? "null");
    expect(stored).toMatchObject({ mode: "phrase" });
    expect(stored.ciphertextHex).toMatch(/^[0-9a-f]+$/);
    expect(stored.publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/);

    expect(screen.getByText("Public key")).toBeInTheDocument();
    expect(screen.getByText(stored.publicKeyHex)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make key" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
  });

  it("Copy puts the public key on the clipboard", async () => {
    const user = userEvent.setup();
    renderSettings();
    await makeKey(user);
    const stored = JSON.parse(localStorage.getItem(VAULT_KEY) ?? "null");

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(stored.publicKeyHex);
  });

  it("Unlock with the wrong passphrase says so, the right one unlocks", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    await makeKey(user);
    first.unmount();

    // a new launch: the wrapped key is in localStorage, nothing is in memory
    renderSettings();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");
    expect(screen.queryByRole("button", { name: "Make key" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Passphrase"), "wrong one");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("That passphrase does not open the stored key.")).toBeInTheDocument();
    expect(screen.getByTestId("door")).toHaveTextContent("locked");

    await user.clear(screen.getByLabelText("Passphrase"));
    await user.type(screen.getByLabelText("Passphrase"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("door")).toHaveTextContent("unlocked"));
    expect(screen.queryByText("That passphrase does not open the stored key.")).not.toBeInTheDocument();
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
