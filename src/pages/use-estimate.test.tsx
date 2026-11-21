import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import ActiveTripPage from "./active-trip-page";
import { db } from "@/db/database";
import { SendHoldContext, type SendHold } from "@/factory/send-hold";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { ASYNC_WAIT_MS } from "pwa-kit/test-preset";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

/** His trip: a dressing whose price the Photo price read as $0.00, the item's own price 2.99. */
async function seed() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const item = await itemRepo.create({
    barcode: "0123",
    name: "Reduced Sodium Italian Dressing",
    currentPrice: 2.99,
    unitType: "each",
  });
  const line = await tripItemRepo.addToTrip({
    tripId: trip.id,
    itemId: item.id,
    price: 0.01,
    quantity: 1,
    onSale: false,
  });
  await tripItemRepo.update(line.id, { price: 0 });
  return { trip, item, line };
}

function renderPage(hold: SendHold | null = null) {
  return render(
    <SendHoldContext value={{ lookup: hold, receipt: null }}>
      <MemoryRouter initialEntries={["/trips/active"]}>
        <ActiveTripPage />
      </MemoryRouter>
    </SendHoldContext>,
  );
}

async function openPriceEditor() {
  const label = await screen.findByText("Reduced Sodium Italian Dressing");
  fireEvent.touchStart(label, { touches: [{ clientX: 0, clientY: 0 }] });
  const edit = await screen.findByRole("button", { name: "Edit Price" }, { timeout: ASYNC_WAIT_MS });
  await userEvent.setup().click(edit);
}

describe("Use an estimate on the active trip", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("clears the price, waits on the factory, then shows its price as a Guess with its note; the total counts it and the item's price stays", async () => {
    const { trip, item, line } = await seed();
    const user = userEvent.setup();
    renderPage();

    await openPriceEditor();
    await user.click(await screen.findByRole("button", { name: "Use an estimate" }));

    // the editor closes, the line shows $0.00 and says it is waiting
    expect(await screen.findByText("Sending to the factory")).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00 \/ each/)).toBeInTheDocument();
    const [lookup] = await db.pendingLookups.toArray();
    expect(lookup).toMatchObject({ mode: "estimate", itemId: item.id, status: "waiting-to-send" });

    // the factory answers
    await lookups.applyAnswer(lookup.id, {
      name: "Reduced Sodium Italian Dressing",
      category: "Condiments & Sauces",
      unitType: "each",
      price: null,
      estimatedPrice: 3.49,
      estimateNote: "Typical price for a bottle of dressing.",
      confidence: "medium",
    });

    expect(await screen.findByText(/\$3\.49 \/ each/)).toBeInTheDocument();
    expect(screen.getByText("Guess")).toBeInTheDocument();
    expect(screen.getByText(/Typical price for a bottle of dressing\./)).toBeInTheDocument();
    expect(screen.queryByText("Sending to the factory")).not.toBeInTheDocument();
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(3.49);
    expect((await itemRepo.getById(item.id))?.currentPrice).toBe(2.99);
    expect((await db.tripItems.get(line.id))?.guess).toBeDefined();
  });

  it.each<[SendHold, RegExp]>([
    ["offline", /Can't ask the factory while offline/],
    ["no-licence", /Can't ask the factory: no licence/],
    ["no-key", /no factory key/],
    ["locked", /key is locked/],
  ])("says why it cannot ask now (%s) and leaves the line as it was", async (hold, words) => {
    const { line } = await seed();
    await tripItemRepo.update(line.id, { price: 7.77 });
    const user = userEvent.setup();
    renderPage(hold);

    await openPriceEditor();
    await user.click(await screen.findByRole("button", { name: "Use an estimate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(words);
    expect(screen.getByRole("alert")).toHaveTextContent("The price is unchanged.");
    expect(await db.pendingLookups.count()).toBe(0);
    const saved = await db.tripItems.get(line.id);
    expect(saved?.price).toBe(7.77);
    // the editor is still open: he can type a price instead
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("a failed estimate says why, offers Retry, and the line asks for a price", async () => {
    const { line } = await seed();
    const user = userEvent.setup();
    renderPage();
    await openPriceEditor();
    await user.click(await screen.findByRole("button", { name: "Use an estimate" }));
    const [lookup] = await db.pendingLookups.toArray();

    await lookups.markFailed(lookup.id, "The factory could not estimate this one.");

    expect(await screen.findByText("The factory could not estimate this one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Add price" })).toBeInTheDocument();
    expect((await db.tripItems.get(line.id))?.price).toBe(0);
  });

  it("is not offered when he is editing a quantity", async () => {
    await seed();
    renderPage();
    const label = await screen.findByText("Reduced Sodium Italian Dressing");
    fireEvent.touchStart(label, { touches: [{ clientX: 0, clientY: 0 }] });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Edit Quantity" }, { timeout: ASYNC_WAIT_MS }));
    await screen.findByRole("button", { name: "Save" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Use an estimate" })).not.toBeInTheDocument());
  });
});
