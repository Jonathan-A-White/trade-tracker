import { render, screen, waitFor } from "@testing-library/react";
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
