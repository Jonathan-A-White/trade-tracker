import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import SettingsPage from "@/pages/settings-page";

const none = { state: "none" as const, checkedAt: "2026-10-05T00:00:00.000Z" };

function renderSettings() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={async () => none}>
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
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
    const user = userEvent.setup();
    const { container } = renderSettings();
    const inputs = container.querySelectorAll('input[type="file"]');
    const aiInput = inputs[2] as HTMLInputElement;
    await user.upload(aiInput, new File(["nope"], "trip.json", { type: "application/json" }));
    expect(await screen.findByText("Could not parse file. Make sure it is valid JSON.")).toBeInTheDocument();
  });
});
