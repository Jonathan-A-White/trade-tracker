import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useRoutes } from "react-router";
import { ActiveTripProvider } from "@/contexts/active-trip-context";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/contexts/toast-context";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { appRoutes } from "@/routes";

// With YNAB Off (what every stranger has) no screen of the app says the word, but the Settings row that turns it on.

function Routed() {
  return useRoutes(appRoutes);
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <ActiveTripProvider>
        <ToastProvider>
          <FactoryProvider checkLicence={async () => ({ state: "none", checkedAt: "x" })}>
            <MemoryRouter initialEntries={[path]}>
              <Routed />
            </MemoryRouter>
          </FactoryProvider>
        </ToastProvider>
      </ActiveTripProvider>
    </ThemeProvider>,
  );
}

async function seed() {
  const now = Date.now();
  await db.stores.put({ id: "tj", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const milk = await new ItemRepository().create({ barcode: "111", name: "Milk", currentPrice: 3, unitType: "each" });
  const trips = new TripRepository();
  const items = new TripItemRepository();
  const done = await trips.create({ storeId: "tj", startedAt: now - 3_600_000 });
  await items.addToTrip({ tripId: done.id, itemId: milk.id, price: 3, quantity: 1, onSale: false });
  await trips.complete(done.id, 3.2);
  const active = await trips.create({ storeId: "tj", startedAt: now });
  await items.addToTrip({ tripId: active.id, itemId: milk.id, price: 3, quantity: 2, onSale: false });
  return { done, active };
}

describe("YNAB Off", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  it("says nothing of YNAB on Home, the trip pages, the lists and the reports", async () => {
    const { done } = await seed();
    const paths = ["/", "/trips/new", "/trips/active", "/trips/history", `/trips/${done.id}`, `/trips/${done.id}/edit`, "/items", "/stores", "/reports", "/export", "/about"];
    for (const path of paths) {
      const { container, unmount } = renderAt(path);
      await waitFor(() => expect(container.textContent?.length ?? 0).toBeGreaterThan(20));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(container.textContent, path).not.toMatch(/ynab/i);
      unmount();
    }
  });

  it("shows on Settings only the YNAB row with its one switch: no token field, no Check, no budget", async () => {
    renderAt("/settings");
    const toggle = await screen.findByRole("switch", { name: "Connect YNAB" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("Personal Access Token")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Developer Settings/)).not.toBeInTheDocument();
  });
});
