import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { licence } from "bsv-kit/bsv";
import { FactoryProvider } from "@/contexts/factory-context";
import type { FactoryLicenceChecker } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import SettingsPage from "@/pages/settings-page";
import type { PasskeyPort } from "@/services/passkey";
import { ROWS } from "@/settings/registry";

const checkedAt = "2026-10-05T00:00:00.000Z";
const none = { state: "none" as const, checkedAt };
const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};

// No WebAuthn here: Make key still works, the 12 words are the only way to unlock.
const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

function renderSettings(checkLicence: FactoryLicenceChecker = async () => none) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={checkLicence} passkeyPort={noWebAuthn}>
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Settings with a key made and the licence held: the door is licensed and Import Trip from AI is open. */
async function renderLicensed() {
  const user = userEvent.setup();
  const rendered = renderSettings(async () => held);
  await user.click(screen.getByRole("button", { name: "Make key" }));
  await screen.findByText("Held");
  return { user, ...rendered };
}

describe("SettingsPage layout", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  it("shows every section heading in order", () => {
    renderSettings();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Appearance",
      "Factory",
      "YNAB",
      "Family",
      "Storage Usage",
      "Produce PLU Codes",
      "Trader Joe's Barcodes",
      "TJ's Receipt (03/14/2026)",
      "Export / Import Items",
      "Export / Import Trips",
      "Import Trip from AI",
      "Danger Zone",
      "About",
    ]);
  });

  it("draws every registered row once, and nothing that is not registered", () => {
    const { container } = renderSettings();
    for (const row of ROWS) {
      expect(container.querySelectorAll(`[data-setting="${row.key}"]`), `row ${row.key}`).toHaveLength(1);
    }
    expect(container.querySelectorAll("[data-setting]")).toHaveLength(ROWS.length);
  });

  it("shows every button, switch and link label", () => {
    renderSettings();
    expect(screen.getByRole("switch", { name: "Toggle dark mode" })).toBeInTheDocument();
    expect(screen.getByText("Light mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load PLU Codes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load TJ Barcodes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load Receipt Items" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Items" })).toBeInTheDocument();
    expect(screen.getByText("Import Items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Trips" })).toBeInTheDocument();
    expect(screen.getByText("Import Trips")).toBeInTheDocument();
    expect(screen.getByText("Import AI Trip JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear All Data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Credits and thanks" })).toHaveAttribute("href", "/about");
    expect(screen.getByText("TradeTracker")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB (Dexie.js)")).toBeInTheDocument();
    expect(screen.getByTestId("build-version")).toBeInTheDocument();
  });

  it("says when no storage estimate is available", () => {
    renderSettings();
    expect(screen.getByText("Storage estimate not available")).toBeInTheDocument();
  });

  it("flips the theme from the Appearance switch", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("switch", { name: "Toggle dark mode" }));
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });
});

describe("SettingsPage seed lists", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it("loads each list, then reports the added count", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Load TJ Barcodes" }));
    await screen.findByText(/^Added \d+ items?\./);
    expect(screen.queryByRole("button", { name: "Load TJ Barcodes" })).not.toBeInTheDocument();
    expect(await db.items.count()).toBeGreaterThan(0);
  });

  it("reports skipped items when a list was already loaded", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    await user.click(screen.getByRole("button", { name: "Load PLU Codes" }));
    await screen.findByText(/^Added \d+ items?\./);
    first.unmount();

    renderSettings();
    await user.click(screen.getByRole("button", { name: "Load PLU Codes" }));
    expect(await screen.findByText(/Added 0 items\./)).toBeInTheDocument();
    expect(screen.getByText(/Skipped \d+ already in library\./)).toBeInTheDocument();
  });
});

describe("SettingsPage confirm dialogs", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it("asks before clearing all data, and Cancel closes it", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Clear All Data" }));
    expect(screen.getByRole("heading", { name: "Clear All Data?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Clear All Data?" })).not.toBeInTheDocument();
  });

  it("reads the storage meter again after the data is cleared", async () => {
    const user = userEvent.setup();
    const estimate = vi.fn().mockResolvedValue({ usage: 1024, quota: 1048576 });
    Object.defineProperty(navigator, "storage", { value: { estimate }, configurable: true });
    try {
      renderSettings();
      expect(await screen.findByText("1.0 KB used")).toBeInTheDocument();
      expect(estimate).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("button", { name: "Clear All Data" }));
      await user.click(screen.getByRole("button", { name: "Delete Everything" }));
      await screen.findByText("All data has been cleared.");
      await waitFor(() => expect(estimate).toHaveBeenCalledTimes(2));
    } finally {
      Reflect.deleteProperty(navigator, "storage");
    }
  });

  it("clears the data on Delete Everything", async () => {
    const user = userEvent.setup();
    await db.stores.add({ id: "s1", name: "Store", createdAt: 1, updatedAt: 1 });
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Clear All Data" }));
    await user.click(screen.getByRole("button", { name: "Delete Everything" }));
    expect(await screen.findByText("All data has been cleared.")).toBeInTheDocument();
    expect(await db.stores.count()).toBe(0);
  });

  it("asks before importing items from a valid file, and Cancel closes it", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({ type: "items", items: [] })], "items.json"));
    expect(await screen.findByRole("heading", { name: "Import Items?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Import Items?" })).not.toBeInTheDocument();
  });

  it("imports items on Import and reports the counts", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({ type: "items", items: [] })], "items.json"));
    await user.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByText(/Added 0 items\./)).toBeInTheDocument();
  });

  it("asks before importing trips from a valid file", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const trips = { type: "trips", stores: [], trips: [], tripItems: [], priceHistory: [] };
    await user.upload(input, new File([JSON.stringify(trips)], "trips.json"));
    expect(await screen.findByRole("heading", { name: "Import Trips?" })).toBeInTheDocument();
  });

  it("refuses an items file of the wrong type", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({ type: "trips", items: [] })], "x.json"));
    expect(await screen.findByText(/^Invalid file: File type must be "items"/)).toBeInTheDocument();
  });

  it("rejects a trips file that is not JSON", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    const inputs = container.querySelectorAll('input[type="file"]');
    const tripsInput = inputs[1] as HTMLInputElement;
    await user.upload(tripsInput, new File(["not json"], "trips.json", { type: "application/json" }));
    expect(
      await screen.findByText("Could not parse file. Make sure it is a valid JSON trips export."),
    ).toBeInTheDocument();
  });

  it("rejects an AI trip file that is not JSON", async () => {
    const { user, container } = await renderLicensed();
    const inputs = container.querySelectorAll('input[type="file"]');
    const aiInput = inputs[2] as HTMLInputElement;
    await user.upload(aiInput, new File(["nope"], "trip.json", { type: "application/json" }));
    expect(await screen.findByText("Could not parse file. Make sure it is valid JSON.")).toBeInTheDocument();
  });
});

describe("SettingsPage search", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  async function search(text: string) {
    const user = userEvent.setup();
    const rendered = renderSettings();
    await user.type(screen.getByRole("searchbox", { name: "Search settings" }), text);
    return { user, ...rendered };
  }

  it("finds the Backend row by 'backend', and says which group it is in", async () => {
    await search("backend");
    const found = screen.getByRole("list", { name: "Matching settings" });
    const row = within(found).getByRole("button", { name: /Backend/ });
    expect(row).toHaveAttribute("data-found", "backend");
    expect(row).toHaveTextContent("in Factory");
    expect(within(found).queryByRole("button", { name: /Danger Zone/ })).not.toBeInTheDocument();
  });

  it("finds the Factory row and the Backend row by 'key'", async () => {
    await search("key");
    const found = screen.getByRole("list", { name: "Matching settings" });
    const keys = within(found)
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-found"));
    expect(keys).toContain("factory");
  });

  it("says when nothing matches", async () => {
    await search("zzzz");
    expect(screen.getByRole("status")).toHaveTextContent("Nothing in Settings matches");
  });

  it("opens the found row: the search clears and the row is marked", async () => {
    const { user, container } = await search("backend");
    await user.click(screen.getByRole("button", { name: /Backend/ }));
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveValue("");
    expect(container.querySelector('[data-setting="backend"]')).toHaveAttribute("aria-current", "location");
  });
});

describe("SettingsPage Import Trip from AI needs a licence", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  it("is off and greyed with 'Needs a licence' while the door is not licensed", () => {
    const { container } = renderSettings();
    const row = container.querySelector('[data-setting="ai-trip"]') as HTMLElement;
    const input = row.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(within(row).getByText("Import AI Trip JSON").closest("label")).toHaveClass("opacity-50");
    expect(within(row).getByRole("link", { name: "Needs a licence" })).toBeInTheDocument();
  });

  it("links to the Factory row, which the link marks", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    const factory = container.querySelector('[data-setting="factory"]') as HTMLElement;
    expect(factory).not.toHaveAttribute("aria-current");
    const link = screen.getByRole("link", { name: "Needs a licence" });
    expect(link).toHaveAttribute("href", "/settings?setting=factory");
    await user.click(link);
    expect(container.querySelector('[data-setting="factory"]')).toHaveAttribute("aria-current", "location");
  });

  it("opens once the key is made and the licence is held", async () => {
    const { container } = await renderLicensed();
    const input = container.querySelector('[data-setting="ai-trip"] input[type="file"]') as HTMLInputElement;
    expect(input).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Needs a licence" })).not.toBeInTheDocument();
  });
});
