import { Blob } from "node:buffer";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import TripDetailPage from "./trip-detail-page";
import TripEditPage from "./trip-edit-page";
import EndTripPage from "./end-trip-page";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

async function seedTripWithMilkAndPending() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const milk = await itemRepo.create({
    barcode: "1",
    name: "Milk",
    currentPrice: 3,
    unitType: "each",
  });
  await tripItemRepo.addToTrip({
    tripId: trip.id,
    itemId: milk.id,
    price: 3,
    quantity: 1,
    onSale: false,
  });
  await lookups.create({
    barcode: "0099887766",
    tripId: trip.id,
    photos: [new Blob(["photo"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
  });
  return trip;
}

function expectPendingLineShown() {
  expect(screen.getByText("Waiting on the factory")).toBeInTheDocument();
  expect(screen.getByText("0099887766")).toBeInTheDocument();
  expect(screen.getByAltText("Photo of 0099887766")).toBeInTheDocument();
  expect(screen.queryByText("Unknown Item")).not.toBeInTheDocument();
  expect(screen.getByText("Milk")).toBeInTheDocument();
}

describe("a pending line on the other trip pages", () => {
  beforeEach(async () => {
    // the db singleton outlives the per-test IDBFactory, so start each test empty
    await Promise.all(db.tables.map((table) => table.clear()));
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows on the trip detail page as pending, not 'Unknown Item'", async () => {
    const trip = await seedTripWithMilkAndPending();
    render(
      <MemoryRouter initialEntries={[`/trips/${trip.id}`]}>
        <Routes>
          <Route path="/trips/:id" element={<TripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Waiting on the factory");
    await screen.findByAltText("Photo of 0099887766");
    await screen.findByText("Milk"); // the item names load after the lines
    expectPendingLineShown();
  });

  it("shows on the trip edit page as pending, not 'Unknown Item'", async () => {
    const trip = await seedTripWithMilkAndPending();
    render(
      <MemoryRouter initialEntries={[`/trips/${trip.id}/edit`]}>
        <Routes>
          <Route path="/trips/:id/edit" element={<TripEditPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Waiting on the factory");
    await screen.findByAltText("Photo of 0099887766");
    await screen.findByText("Milk"); // the item names load after the lines
    expectPendingLineShown();
  });

  it("shows on the end-trip page as pending, not 'Unknown Item'", async () => {
    await seedTripWithMilkAndPending();
    render(
      <MemoryRouter initialEntries={["/trips/end"]}>
        <Routes>
          <Route path="/trips/end" element={<EndTripPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Waiting on the factory");
    await screen.findByAltText("Photo of 0099887766");
    expect(screen.getByText("0099887766")).toBeInTheDocument();
    expect(screen.queryByText("Unknown Item")).not.toBeInTheDocument();
  });
});
