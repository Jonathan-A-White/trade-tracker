import { Blob } from "node:buffer";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import ActiveTripPage from "./active-trip-page";
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
  const lookup = await lookups.create({
    barcode: "0099887766",
    tripId: trip.id,
    photos: [new Blob(["photo"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
  });
  return { trip, lookup };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/trips/active"]}>
      <ActiveTripPage />
    </MemoryRouter>,
  );
}

describe("ActiveTripPage pending lines", () => {
  beforeEach(async () => {
    // the db singleton outlives the per-test IDBFactory, so start each test empty
    await Promise.all(db.tables.map((table) => table.clear()));
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
  });

  it("renders a pending line with its barcode, thumbnail and 'Waiting on the factory'", async () => {
    await seedTripWithMilkAndPending();
    renderPage();

    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
    expect(screen.getByText("0099887766")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /photo of 0099887766/i })).toHaveAttribute(
      "src",
      "blob:thumb",
    );
  });

  it("leaves the pending line out of the trip total and the item count", async () => {
    await seedTripWithMilkAndPending();
    renderPage();

    await screen.findByText("Waiting on the factory");
    // the Milk row and the subtotal bar both read $3.00; the pending line adds nothing
    expect(screen.getAllByText("$3.00")).toHaveLength(2);
    expect(screen.getByText(/1 item\b/)).toBeInTheDocument();
  });

  it("fill by hand opens the item form and the line becomes an ordinary item row", async () => {
    const { trip, lookup } = await seedTripWithMilkAndPending();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /fill by hand/i }));

    const barcode = screen.getByPlaceholderText(/e\.g\. 94011/i);
    expect(barcode).toHaveValue("0099887766");
    await user.type(screen.getByLabelText(/^name/i), "Oat Bars");
    const price = screen.getByLabelText(/price/i);
    await user.clear(price);
    await user.type(price, "4.25");
    await user.click(screen.getByRole("button", { name: /save item/i }));

    await waitFor(() => {
      expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
    });
    const row = await screen.findByText("Oat Bars");
    expect(row).toBeInTheDocument();
    expect(within(row.closest("div.relative") as HTMLElement).getByText("$4.25", { selector: "p" })).toBeInTheDocument();
    expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(7.25);
  });

  it("discard removes the pending line", async () => {
    const { lookup } = await seedTripWithMilkAndPending();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /discard/i }));

    await waitFor(() => {
      expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
    });
    expect(await lookups.getById(lookup.id)).toBeUndefined();
  });
});
