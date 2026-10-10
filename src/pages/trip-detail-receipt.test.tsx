import { Blob } from "node:buffer";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { grist } from "bsv-kit/grist";
import TripDetailPage from "./trip-detail-page";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import type { ReceiptReconcileAnswer, ReceiptReconcileRequest } from "@/contracts/types";
import type { ReceiptClient } from "@/services/receipt-reconcile";

// the factory's door is not under test here: a flag and a fake client stand in for it
const factory = vi.hoisted(() => ({
  ready: true,
  client: null as unknown as ReceiptClient,
}));
vi.mock("@/hooks/use-receipt-client", () => ({
  useReceiptClient: () => ({ ready: factory.ready, getClient: () => (factory.ready ? factory.client : null) }),
}));

// jsdom has no canvas
vi.mock("@/scanner/capture-still", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/scanner/capture-still")>()),
  captureStill: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
  stillFromFile: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

const itemRepo = new ItemRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

const grind = { app: "trade-tracker", kind: "receipt-reconcile", v: "1.0" };

function fakeClient(record: () => grist.GristAnswer) {
  const sent: { input: ReceiptReconcileRequest; photos: grist.Photo[] }[] = [];
  const client: ReceiptClient = {
    send: vi.fn(async (call) => {
      sent.push({ input: call.input, photos: call.photos });
      return "direct:tx1";
    }),
    awaitAnswer: vi.fn(async () => record()),
  };
  return { client, sent };
}

function answered(answer: ReceiptReconcileAnswer): grist.GristAnswer {
  return { re: "direct:tx1", status: "answered", answer, grind };
}

function receipt(
  lines: { tripItemId: string | null; price: number; text?: string }[],
  total: number | null,
): ReceiptReconcileAnswer {
  return {
    store: "Trader Joe's",
    date: "2026-10-09",
    subtotal: null,
    tax: null,
    total,
    lines: lines.map((line) => ({
      text: line.text ?? "ITEM",
      price: line.price,
      quantity: 1,
      weightLbs: null,
      tripItemId: line.tripItemId,
      confidence: "high" as const,
    })),
    unreadable: null,
  };
}

/** A trip he already finished, with no receipt total. */
async function seedCompletedTrip(options: { actualTotal?: number } = {}) {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const lines: Record<string, string> = {};
  for (const [barcode, name, price] of [
    ["0001", "Milk", 3.99],
    ["0002", "Bread", 2.5],
  ] as const) {
    const item = await itemRepo.create({ barcode, name, currentPrice: price, unitType: "each" });
    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price,
      quantity: 1,
      onSale: false,
    });
    lines[name] = line.id;
  }
  await tripRepo.complete(trip.id, options.actualTotal);
  return { trip, lines };
}

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

async function takeOnePhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Photograph receipt" }));
  await user.click(await screen.findByRole("button", { name: "Take photo" }));
  await user.click(await screen.findByRole("button", { name: "Done" }));
}

function actualTotalText() {
  return screen.getByText("Actual Total").parentElement!;
}

describe("A completed trip: Photograph receipt", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    factory.ready = true;
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  it("a receipt on a completed trip updates the prices, the Receipt Total and the Actual Total", async () => {
    const { trip, lines } = await seedCompletedTrip();
    const { client, sent } = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 4.29, text: "MILK" },
            { tripItemId: lines.Bread, price: 2.5, text: "BREAD" },
          ],
          6.79,
        ),
      ),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage(trip.id);
    expect(actualTotalText()).toHaveTextContent("--");

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].input.lines.map((l) => l.name).sort()).toEqual(["Bread", "Milk"]);
    expect(sent[0].photos).toHaveLength(1);

    const changed = await screen.findByRole("heading", { name: "What changed" });
    const rows = within(within(changed.parentElement!).getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("$3.99 → $4.29");
    expect(screen.getByRole("heading", { name: "Not matched: 0" })).toBeInTheDocument();

    await waitFor(() => expect(actualTotalText()).toHaveTextContent("$6.79"));
    const saved = await db.trips.get(trip.id);
    expect(saved?.actualTotal).toBe(6.79);
    expect(saved?.receiptReconcile?.total).toBe(6.79);
    expect(saved?.status).toBe("completed");
    expect((await db.tripItems.get(lines.Milk))?.price).toBe(4.29);
    expect(saved?.scannedSubtotal).toBeCloseTo(4.29 + 2.5);
  });

  it("a receipt replaces an Actual Total he typed before", async () => {
    const { trip, lines } = await seedCompletedTrip({ actualTotal: 9.99 });
    factory.client = fakeClient(() =>
      answered(receipt([{ tripItemId: lines.Milk, price: 3.99, text: "MILK" }], 6.49)),
    ).client;
    const user = userEvent.setup();
    await renderPage(trip.id);
    expect(actualTotalText()).toHaveTextContent("$9.99");

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    await waitFor(() => expect(actualTotalText()).toHaveTextContent("$6.49"));
    expect((await db.trips.get(trip.id))?.actualTotal).toBe(6.49);
  });

  it("a receipt that shows no total leaves the Actual Total as it was", async () => {
    const { trip, lines } = await seedCompletedTrip({ actualTotal: 9.99 });
    factory.client = fakeClient(() =>
      answered(receipt([{ tripItemId: lines.Milk, price: 4.29, text: "MILK" }], null)),
    ).client;
    const user = userEvent.setup();
    await renderPage(trip.id);

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    await screen.findByRole("heading", { name: "What changed" });
    expect(actualTotalText()).toHaveTextContent("$9.99");
    expect((await db.trips.get(trip.id))?.actualTotal).toBe(9.99);
  });

  it("a receipt line with no trip line shows 'Not matched: 1' and can be added as a new item", async () => {
    const { trip, lines } = await seedCompletedTrip();
    factory.client = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 3.99, text: "MILK" },
            { tripItemId: lines.Bread, price: 2.5, text: "BREAD" },
            { tripItemId: null, price: 3.29, text: "TJ SNACK MIX" },
          ],
          9.78,
        ),
      ),
    ).client;
    const user = userEvent.setup();
    await renderPage(trip.id);

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("heading", { name: "Not matched: 1" })).toBeInTheDocument();
    expect(screen.getByText("TJ SNACK MIX")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add as new item" }));

    expect(await screen.findByRole("heading", { name: "Not matched: 0" })).toBeInTheDocument();
    const item = (await db.items.toArray()).find((i) => i.name === "TJ SNACK MIX");
    expect(item?.currentPrice).toBe(3.29);
    expect((await db.trips.get(trip.id))?.scannedSubtotal).toBeCloseTo(3.99 + 2.5 + 3.29);
  });

  it("a refused grist leaves the trip as it was and says why", async () => {
    const { trip, lines } = await seedCompletedTrip();
    factory.client = fakeClient(() => ({
      re: "direct:tx1",
      status: "refused",
      reason: "The photo is too dark.",
      grind,
    })).client;
    const user = userEvent.setup();
    await renderPage(trip.id);

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The photo is too dark.");
    expect(actualTotalText()).toHaveTextContent("--");
    expect((await db.tripItems.get(lines.Milk))?.price).toBe(3.99);
  });

  it("an active trip's page does not offer a receipt (End Trip is the road for it)", async () => {
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
    const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
    const item = await itemRepo.create({ barcode: "0001", name: "Milk", currentPrice: 3.99, unitType: "each" });
    await tripItemRepo.addToTrip({ tripId: trip.id, itemId: item.id, price: 3.99, quantity: 1, onSale: false });
    factory.client = fakeClient(() => answered(receipt([], null))).client;
    await renderPage(trip.id);

    expect(screen.queryByRole("button", { name: "Photograph receipt" })).not.toBeInTheDocument();
  });
});
