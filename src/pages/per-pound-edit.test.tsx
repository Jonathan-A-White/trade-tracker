import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import ActiveTripPage from "./active-trip-page";
import TripEditPage from "./trip-edit-page";
import { db } from "@/db/database";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

async function seed() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const milk = await itemRepo.create({ barcode: "1", name: "Milk", currentPrice: 3, unitType: "each" });
  const chicken = await itemRepo.create({
    barcode: "2",
    name: "Chicken Thighs",
    currentPrice: 4.99,
    unitType: "per_lb",
  });
  await tripItemRepo.addToTrip({ tripId: trip.id, itemId: milk.id, price: 3, quantity: 1, onSale: false });
  await tripItemRepo.addToTrip({ tripId: trip.id, itemId: chicken.id, price: 4.99, quantity: 1, onSale: false });
  return { trip, milk, chicken };
}

async function openMenu(name: string, entry: string) {
  const label = await screen.findByText(name);
  fireEvent.touchStart(label, { touches: [{ clientX: 0, clientY: 0 }] });
  return screen.findByRole("button", { name: entry }, { timeout: 2000 });
}

describe.each(["ActiveTripPage", "TripEditPage"])("%s per-pound quantity", (pageName) => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  function renderPage(tripId: string) {
    if (pageName === "ActiveTripPage") {
      return render(
        <MemoryRouter initialEntries={["/trips/active"]}>
          <ActiveTripPage />
        </MemoryRouter>,
      );
    }
    return render(
      <MemoryRouter initialEntries={[`/trips/${tripId}/edit`]}>
        <Routes>
          <Route path="/trips/:id/edit" element={<TripEditPage />} />
          <Route path="*" element={<div />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("edits a per_lb line's weight as a decimal, saves it as weightLbs and totals price x weight", async () => {
    const { trip, chicken } = await seed();
    const user = userEvent.setup();
    renderPage(trip.id);

    await user.click(await openMenu("Chicken Thighs", "Edit Weight"));
    const input = await screen.findByRole("spinbutton");
    expect(input).toHaveAttribute("step", "0.01");
    await user.clear(input);
    await user.type(input, "2.03");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.itemId === chicken.id)!;
      expect(line.weightLbs).toBe(2.03);
      expect(line.quantity).toBe(1);
      expect(line.lineTotal).toBeCloseTo(10.13, 2);
    });
    expect(await screen.findByText(/2\.03 lbs/)).toBeInTheDocument();
    expect(screen.getByText("$10.13")).toBeInTheDocument();
  });

  it("keeps 1.5 typed on a per_lb line", async () => {
    const { trip, chicken } = await seed();
    const user = userEvent.setup();
    renderPage(trip.id);

    await user.click(await openMenu("Chicken Thighs", "Edit Weight"));
    const input = await screen.findByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "1.5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.itemId === chicken.id)!;
      expect(line.weightLbs).toBe(1.5);
    });
  });

  it("keeps a whole-number quantity on an each line", async () => {
    const { trip, milk } = await seed();
    const user = userEvent.setup();
    renderPage(trip.id);

    await user.click(await openMenu("Milk", "Edit Quantity"));
    const input = await screen.findByRole("spinbutton");
    expect(input).toHaveAttribute("step", "1");
    await user.clear(input);
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.itemId === milk.id)!;
      expect(line.quantity).toBe(3);
      expect(line.weightLbs).toBeUndefined();
      expect(line.lineTotal).toBe(9);
    });
  });

  it("a per_lb line with no weight still totals price x quantity, with no NaN", async () => {
    const { trip, chicken } = await seed();
    renderPage(trip.id);

    await screen.findByText("Chicken Thighs");
    const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.itemId === chicken.id)!;
    expect(line.weightLbs).toBeUndefined();
    expect(line.lineTotal).toBe(4.99);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
