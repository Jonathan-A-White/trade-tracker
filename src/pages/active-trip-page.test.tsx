import { Blob } from "node:buffer";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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

  it("+ on the pending line saves the quantity, and the filled-in item keeps it", async () => {
    const { trip, lookup } = await seedTripWithMilkAndPending();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Increase quantity" }));

    await waitFor(() => {
      expect(screen.getByTestId("pending-quantity")).toHaveTextContent("2");
    });
    const pendingLine = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.pending);
    expect(pendingLine?.quantity).toBe(2);

    await lookups.applyAnswer(lookup.id, {
      name: "Oat Bars",
      unitType: "each",
      category: "other",
      price: 4.25,
      confidence: "high",
    });
    expect(await screen.findByText(/x2/)).toBeInTheDocument();
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(11.5);
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

describe("ActiveTripPage factory answers", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows 'At the factory' once the lookup has been sent", async () => {
    const { lookup } = await seedTripWithMilkAndPending();
    await lookups.markSent(lookup.id, "direct:tx1");
    renderPage();

    expect(await screen.findByText("At the factory")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows why a lookup failed with Retry, and Retry puts it back in the queue", async () => {
    const { lookup } = await seedTripWithMilkAndPending();
    await lookups.markFailed(lookup.id, "The photos are too dark to read.");
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("The photos are too dark to read.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
    expect((await lookups.getById(lookup.id))?.status).toBe("waiting-to-send");
    expect(screen.queryByText("The photos are too dark to read.")).not.toBeInTheDocument();
  });

  it("marks a filled line 'Check price' until it is tapped", async () => {
    const { lookup, trip } = await seedTripWithMilkAndPending();
    await lookups.applyAnswer(lookup.id, {
      name: "Oat Bars",
      category: "Snacks & Candy",
      unitType: "each",
      price: 4.25,
      confidence: "high",
    });
    const user = userEvent.setup();
    renderPage();

    const badge = await screen.findByRole("button", { name: "Check price" });
    expect(await screen.findByText("Oat Bars")).toBeInTheDocument();
    await user.click(badge);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Check price" })).not.toBeInTheDocument();
    });
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines.find((l) => l.price === 4.25)?.priceFlag).toBeUndefined();
  });

  it("clears 'Check price' when the line is edited", async () => {
    const { lookup, trip } = await seedTripWithMilkAndPending();
    await lookups.applyAnswer(lookup.id, {
      name: "Oat Bars",
      category: "Snacks & Candy",
      unitType: "each",
      price: 4.25,
      confidence: "high",
    });
    const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.price === 4.25)!;
    expect(line.priceFlag).toBe("check");

    await tripItemRepo.update(line.id, { quantity: 2 });

    expect((await tripItemRepo.getByTrip(trip.id)).find((l) => l.id === line.id)?.priceFlag).toBeUndefined();
  });

  it("reads 'Add price' when the tag gave none, until a price is entered", async () => {
    const { lookup, trip } = await seedTripWithMilkAndPending();
    await lookups.applyAnswer(lookup.id, {
      name: "Gala Apples",
      category: "Produce",
      unitType: "per_lb",
      price: null,
      confidence: "medium",
    });
    renderPage();

    expect(await screen.findByRole("button", { name: "Add price" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check price" })).not.toBeInTheDocument();
    const line = (await tripItemRepo.getByTrip(trip.id)).find((l) => l.priceFlag === "add")!;

    await tripItemRepo.update(line.id, { quantity: 2 });
    expect((await tripItemRepo.getByTrip(trip.id)).find((l) => l.id === line.id)?.priceFlag).toBe("add");

    await tripItemRepo.update(line.id, { price: 1.5 });
    expect((await tripItemRepo.getByTrip(trip.id)).find((l) => l.id === line.id)?.priceFlag).toBeUndefined();
  });
});


function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

describe("ActiveTripPage Photo price", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
  });

  async function seedKnown() {
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
    const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
    const milk = await itemRepo.create({ barcode: "111", name: "Milk", currentPrice: 3, unitType: "each" });
    await tripItemRepo.addToTrip({ tripId: trip.id, itemId: milk.id, price: 3, quantity: 1, onSale: false });
    return { trip, milk };
  }

  function priceLookup(tripId: string, milkId: string) {
    return lookups.create({
      barcode: "111",
      tripId,
      photos: [new Blob(["tag"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
      mode: "price-only",
      itemId: milkId,
    });
  }

  it("Photo price on a known item opens the tag-only capture screen for it", async () => {
    const { milk } = await seedKnown();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/trips/active"]}>
        <Routes>
          <Route path="/trips/active" element={<ActiveTripPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Photo price" }));

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        `/trips/active/photo?barcode=111&mode=price-only&itemId=${milk.id}`,
      ),
    );
  });

  it("shows 'Waiting on the factory' beside the old price and hides Photo price until the answer lands", async () => {
    const { trip, milk } = await seedKnown();
    await priceLookup(trip.id, milk.id);
    renderPage();

    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
    expect(screen.getByText(/\$3\.00 \/ each/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Photo price" })).not.toBeInTheDocument();
    // it is still one ordinary row, not a pending line
    expect(screen.queryByRole("button", { name: /fill by hand/i })).not.toBeInTheDocument();
  });

  it("marks the row 'Check price' with the new price once the answer lands", async () => {
    const { trip, milk } = await seedKnown();
    const lookup = await priceLookup(trip.id, milk.id);
    renderPage();
    await screen.findByText("Waiting on the factory");

    await lookups.applyAnswer(lookup.id, {
      name: "Whatever",
      category: "other",
      unitType: "each",
      price: 3.49,
      confidence: "high",
    });

    expect(await screen.findByRole("button", { name: "Check price" })).toBeInTheDocument();
    expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
    expect(await screen.findByText(/\$3\.49 \/ each/)).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
  });

  it("says 'No price found on that photo' when the tag gave none, keeps the old price, and offers Retake price photo", async () => {
    const { trip, milk } = await seedKnown();
    const lookup = await priceLookup(trip.id, milk.id);
    await lookups.applyAnswer(lookup.id, {
      name: "Whatever",
      category: "other",
      unitType: "each",
      price: null,
      confidence: "low",
    });
    renderPage();

    expect(await screen.findByText("No price found on that photo")).toBeInTheDocument();
    expect(screen.getByText(/\$3\.00 \/ each/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retake price photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Photo price" })).not.toBeInTheDocument();
  });

  it("shows why a price lookup failed with Retry", async () => {
    const { trip, milk } = await seedKnown();
    const lookup = await priceLookup(trip.id, milk.id);
    await lookups.markFailed(lookup.id, "The tag is blurry.");
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("The tag is blurry.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
    expect((await lookups.getById(lookup.id))?.status).toBe("waiting-to-send");
  });

  it("shows 'Guess' and its basis on a line filled by an estimate, and counts it", async () => {
    const { lookup, trip } = await seedTripWithMilkAndPending();
    await lookups.applyAnswer(lookup.id, {
      name: "Oat Bars",
      category: "Snacks & Candy",
      unitType: "each",
      price: null,
      estimatedPrice: 3.49,
      estimateNote: "Typical price for a box of granola bars.",
      confidence: "medium",
    });
    renderPage();

    expect(await screen.findByText("Oat Bars")).toBeInTheDocument();
    expect(await screen.findByText("Guess")).toBeInTheDocument();
    expect(screen.getByText(/Typical price for a box of granola bars\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add price" })).not.toBeInTheDocument();
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBeCloseTo(6.49, 2);
  });

  it("tells the shopper how many prices are guesses, and goes quiet once none is", async () => {
    const { lookup } = await seedTripWithMilkAndPending();
    await lookups.applyAnswer(lookup.id, {
      name: "Oat Bars",
      category: "Snacks & Candy",
      unitType: "each",
      price: null,
      estimatedPrice: 3.49,
      estimateNote: "Typical price for a box of granola bars.",
      confidence: "medium",
    });
    renderPage();

    expect(await screen.findByText("1 price is a guess")).toBeInTheDocument();
    const oats = (await db.tripItems.toArray()).find((ti) => ti.guess);
    await tripItemRepo.update(oats!.id, { price: 3.99 });
    await waitFor(() =>
      expect(screen.queryByText(/guess(es)?$/)).not.toBeInTheDocument(),
    );
  });
});
