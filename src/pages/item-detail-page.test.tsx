import { Blob } from "node:buffer";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ItemDetailPage } from "./item-detail-page";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";

const itemRepo = new ItemRepository();
const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/items/${id}`]}>
      <ThemeProvider>
        <Routes>
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function seedItem() {
  return itemRepo.create({ barcode: "111", name: "Milk", currentPrice: 3, unitType: "each" });
}

async function startTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
  return tripRepo.create({ storeId: "s1", startedAt: now });
}

describe("ItemDetailPage Photo price", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  it("offers no Photo price without an active trip", async () => {
    const milk = await seedItem();
    renderPage(milk.id);
    expect(await screen.findByText("Barcode")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Photo price" })).not.toBeInTheDocument();
  });

  it("Photo price opens the tag-only capture screen and comes back to the item", async () => {
    const milk = await seedItem();
    await startTrip();
    const user = userEvent.setup();
    renderPage(milk.id);

    await user.click(await screen.findByRole("button", { name: "Photo price" }));

    await waitFor(() => {
      const where = screen.getByTestId("where").textContent ?? "";
      expect(where).toContain("/trips/active/photo?barcode=111&mode=price-only&itemId=" + milk.id);
      expect(where).toContain("from=" + encodeURIComponent(`/items/${milk.id}`));
    });
  });

  it("shows 'Waiting on the factory' while the price lookup is out, and hides the button", async () => {
    const milk = await seedItem();
    const trip = await startTrip();
    await lookups.create({
      barcode: "111",
      tripId: trip.id,
      photos: [new Blob(["tag"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
      mode: "price-only",
      itemId: milk.id,
    });
    renderPage(milk.id);

    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Photo price" })).not.toBeInTheDocument();
  });

  it("says 'No price found on that photo' and offers Retake price photo when the tag gave no price", async () => {
    const milk = await seedItem();
    const trip = await startTrip();
    const lookup = await lookups.create({
      barcode: "111",
      tripId: trip.id,
      photos: [new Blob(["tag"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
      mode: "price-only",
      itemId: milk.id,
    });
    await lookups.applyAnswer(lookup.id, {
      name: "x",
      category: "other",
      unitType: "each",
      price: null,
      confidence: "low",
    });
    renderPage(milk.id);

    expect(await screen.findByText("No price found on that photo")).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retake price photo" })).toBeInTheDocument();
  });
});
