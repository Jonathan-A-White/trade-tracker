import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import TripDetailPage from "./trip-detail-page";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";

// the factory's door is not under test here
vi.mock("@/hooks/use-receipt-client", () => ({
  useReceiptClient: () => ({ ready: false, door: "no-key", licence: null, unlock: async () => {}, getClient: () => null }),
}));

const itemRepo = new ItemRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

async function seedTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const item = await itemRepo.create({ barcode: "0001", name: "Milk", currentPrice: 3.99, unitType: "each" });
  await tripItemRepo.addToTrip({ tripId: trip.id, itemId: item.id, price: 3.99, quantity: 1, onSale: false });
  await tripRepo.complete(trip.id);
  return trip;
}

const aiFile = JSON.stringify({
  type: "trip-import",
  store: { name: "Trader Joe's" },
  trip: { startedAt: Date.now() },
  items: [{ name: "Eggs", barcode: "0099", currentPrice: 5.5, unitType: "each" }],
  tripItems: [{ itemIndex: 0, price: 5.5, quantity: 1, onSale: false }],
});

async function renderPage(tripId: string) {
  render(
    <MemoryRouter initialEntries={[`/trips/${tripId}`]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Milk");
}

async function pickFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByText("Import from AI").querySelector("input[type=file]") as HTMLInputElement;
  await user.upload(input, new File([aiFile], "trip.json", { type: "application/json" }));
}

async function tripItemNames(tripId: string) {
  const lines = await db.tripItems.where("tripId").equals(tripId).toArray();
  return (await Promise.all(lines.map((l) => db.items.get(l.itemId)))).map((i) => i?.name).sort();
}

describe("Trip detail: Import from AI", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
  });

  it("asks before replacing the trip's items, and Cancel leaves them unchanged", async () => {
    const trip = await seedTrip();
    const user = userEvent.setup();
    await renderPage(trip.id);

    await pickFile(user);

    expect(await screen.findByRole("heading", { name: "Replace this trip's items?" })).toBeInTheDocument();
    expect(await tripItemNames(trip.id)).toEqual(["Milk"]);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Replace this trip's items?" })).not.toBeInTheDocument();
    expect(await tripItemNames(trip.id)).toEqual(["Milk"]);
    expect(screen.queryByText(/Trip reimported/)).not.toBeInTheDocument();
  });

  it("Replace swaps the trip's items for the file's", async () => {
    const trip = await seedTrip();
    const user = userEvent.setup();
    await renderPage(trip.id);

    await pickFile(user);
    await user.click(await screen.findByRole("button", { name: "Replace" }));

    expect(await screen.findByText(/Trip reimported/)).toBeInTheDocument();
    await waitFor(async () => expect(await tripItemNames(trip.id)).toEqual(["Eggs"]));
  });
});

describe("Trip detail: Undo after Import from AI", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
  });

  async function tripRows(tripId: string) {
    const tripItems = await db.tripItems.where("tripId").equals(tripId).toArray();
    const ids = tripItems.map((t) => t.id);
    return {
      trip: await db.trips.get(tripId),
      tripItems: tripItems.sort((a, b) => a.id.localeCompare(b.id)),
      pendingLookups: (await db.pendingLookups.where("tripId").equals(tripId).toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      priceHistory: (await db.priceHistory.where("tripItemId").anyOf(ids).toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  async function seedWithPending() {
    const trip = await seedTrip();
    const line = (await db.tripItems.where("tripId").equals(trip.id).toArray())[0];
    await db.priceHistory.put({ id: "ph1", itemId: line.itemId, storeId: "s1", tripItemId: line.id, price: 3.99, recordedAt: Date.now() });
    await db.pendingLookups.put({
      id: "pl1",
      barcode: "0555",
      tripId: trip.id,
      itemId: "pending:pl1",
      photos: [],
      status: "waiting-to-send",
      createdAt: Date.now(),
    });
    return trip;
  }

  it("shows Undo beside 'Trip reimported!' and puts the trip back as it was", async () => {
    const trip = await seedWithPending();
    const before = await tripRows(trip.id);
    expect(before.tripItems).toHaveLength(1);
    expect(before.pendingLookups).toHaveLength(1);
    expect(before.priceHistory.length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await renderPage(trip.id);
    await pickFile(user);
    await user.click(await screen.findByRole("button", { name: "Replace" }));
    expect(await screen.findByText(/Trip reimported!/)).toBeInTheDocument();
    await waitFor(async () => expect(await tripItemNames(trip.id)).toEqual(["Eggs"]));

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Trip put back as it was.")).toBeInTheDocument();
    await waitFor(async () => expect(await tripItemNames(trip.id)).toEqual(["Milk"]));
    expect(await tripRows(trip.id)).toEqual(before);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("shows no Undo before a Replace, and none after leaving the page and coming back", async () => {
    const trip = await seedWithPending();
    const user = userEvent.setup();
    await renderPage(trip.id);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();

    await pickFile(user);
    await user.click(await screen.findByRole("button", { name: "Replace" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();

    cleanup();
    render(
      <MemoryRouter initialEntries={[`/trips/${trip.id}`]}>
        <Routes>
          <Route path="/trips/:id" element={<TripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Eggs");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Trip reimported/)).not.toBeInTheDocument();
  });

  it("the confirm box no longer says it cannot be undone", async () => {
    const trip = await seedTrip();
    const user = userEvent.setup();
    await renderPage(trip.id);
    await pickFile(user);
    await screen.findByRole("heading", { name: "Replace this trip's items?" });
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();
  });
});
