import { Blob } from "node:buffer";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { grist } from "bsv-kit/grist";
import EndTripPage from "./end-trip-page";
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
  useReceiptClient: () => ({ ready: factory.ready, door: "no-key", licence: null, unlock: async () => {}, getClient: () => (factory.ready ? factory.client : null) }),
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

/** A grist client the test steers: sends are recorded, and the answer is what the test set. */
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
  lines: { tripItemId: string | null; price: number; text?: string; quantity?: number }[],
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
      quantity: line.quantity ?? 1,
      weightLbs: null,
      tripItemId: line.tripItemId,
      confidence: "high" as const,
    })),
    unreadable: null,
  };
}

async function seedTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
  const lines: Record<string, string> = {};
  for (const [barcode, name, price] of [
    ["0001", "Milk", 3.99],
    ["0002", "Bread", 2.5],
    ["0003", "Eggs", 4.99],
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
  return { trip, lines };
}

async function renderPage() {
  render(
    <MemoryRouter>
      <EndTripPage />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Photograph receipt" });
}

async function takeOnePhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Photograph receipt" }));
  await user.click(await screen.findByRole("button", { name: "Take photo" }));
  await user.click(await screen.findByRole("button", { name: "Done" }));
}

describe("End Trip: Photograph receipt", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    factory.ready = true;
    // jsdom has no media playback
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  it("a receipt with two changed prices updates those two lines, the items, the history and the total", async () => {
    const { trip, lines } = await seedTrip();
    const barcodesBefore = (await db.items.toArray()).map((i) => [i.id, i.barcode]).sort();
    const { client, sent } = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 4.29, text: "MILK" },
            { tripItemId: lines.Bread, price: 2.5, text: "BREAD" },
            { tripItemId: lines.Eggs, price: 5.49, text: "EGGS" },
          ],
          14.78,
        ),
      ),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await takeOnePhoto(user);
    expect(screen.getByText("1 photo ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    // the request carries the trip's lines and the photo
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].input.store).toBe("Trader Joe's");
    expect(sent[0].input.lines.map((l) => l[1]).sort()).toEqual(["Bread", "Eggs", "Milk"]);
    expect(sent[0].photos).toHaveLength(1);
    expect(sent[0].photos[0].mime).toBe("image/jpeg");

    const changed = await screen.findByRole("heading", { name: "What changed" });
    const list = within(changed.parentElement!).getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Milk");
    expect(rows[0]).toHaveTextContent("$3.99 → $4.29");
    expect(rows[1]).toHaveTextContent("Eggs");
    expect(rows[1]).toHaveTextContent("$4.99 → $5.49");
    expect(screen.getByRole("heading", { name: "Not matched: 0" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toHaveValue(14.78);

    expect((await db.tripItems.get(lines.Milk))?.price).toBe(4.29);
    expect((await db.tripItems.get(lines.Eggs))?.price).toBe(5.49);
    expect((await db.tripItems.get(lines.Bread))?.price).toBe(2.5);
    const items = await db.items.toArray();
    expect(items.find((i) => i.name === "Milk")?.currentPrice).toBe(4.29);
    expect(items.find((i) => i.name === "Eggs")?.currentPrice).toBe(5.49);
    const milkHistory = await db.priceHistory
      .where("itemId")
      .equals(items.find((i) => i.name === "Milk")!.id)
      .toArray();
    expect(milkHistory.map((h) => h.price)).toContain(4.29);
    // barcodes are kept
    expect((await db.items.toArray()).map((i) => [i.id, i.barcode]).sort()).toEqual(barcodesBefore);
    expect((await tripRepo.getActive())?.id).toBe(trip.id);
  });

  it("a receipt replaces a guessed price and lists it as 'Guess $3.99 → $4.29'", async () => {
    const { lines } = await seedTrip();
    await tripItemRepo.update(lines.Milk, { guess: { basis: "Typical price." } });
    const { client } = fakeClient(() =>
      answered(receipt([{ tripItemId: lines.Milk, price: 4.29, text: "MILK" }], 4.29)),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    const changed = await screen.findByRole("heading", { name: "What changed" });
    const rows = within(within(changed.parentElement!).getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Guess $3.99 → $4.29");
    const milk = await db.tripItems.get(lines.Milk);
    expect(milk?.price).toBe(4.29);
    expect(milk?.guess).toBeUndefined();
  });

  it("a receipt line with no trip line shows 'Not matched: 1'", async () => {
    const { lines } = await seedTrip();
    const { client } = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 3.99, text: "MILK" },
            { tripItemId: null, price: 7.25, text: "MYSTERY" },
          ],
          11.24,
        ),
      ),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("heading", { name: "Not matched: 1" })).toBeInTheDocument();
    expect(screen.getByText("MYSTERY")).toBeInTheDocument();
    expect(screen.getByText("$7.25")).toBeInTheDocument();
    expect((await db.tripItems.get(lines.Milk))?.price).toBe(3.99);
  });

  it("a refused grist leaves every price as it was and says why", async () => {
    const { lines } = await seedTrip();
    const { client } = fakeClient(() => ({
      re: "direct:tx1",
      status: "refused",
      reason: "The photo is too dark.",
      grind,
    }));
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The photo is too dark.");
    expect(screen.queryByRole("heading", { name: "What changed" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toHaveValue(null);
    expect((await db.tripItems.get(lines.Milk))?.price).toBe(3.99);
    expect((await db.tripItems.get(lines.Eggs))?.price).toBe(4.99);
    // the photo is kept, so he can send it again
    expect(screen.getByText("1 photo ready")).toBeInTheDocument();
  });

  it("says in words when the factory cannot be reached, and leaves the trip as it was", async () => {
    const { lines } = await seedTrip();
    const client: ReceiptClient = {
      send: vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
      awaitAnswer: vi.fn(),
    };
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect((await db.tripItems.get(lines.Milk))?.price).toBe(3.99);
  });

  it("says it is waiting while the factory reads the receipt", async () => {
    await seedTrip();
    let release: (record: grist.GristAnswer) => void = () => {};
    const client: ReceiptClient = {
      send: vi.fn(async () => "direct:tx1"),
      awaitAnswer: vi.fn(() => new Promise<grist.GristAnswer>((resolve) => (release = resolve))),
    };
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Waiting for the factory");
    expect(screen.getByRole("button", { name: "Send receipt" })).toBeDisabled();
    // the status shows before the page starts waiting on the answer; release only once it does
    await waitFor(() => expect(client.awaitAnswer).toHaveBeenCalled());
    release(answered(receipt([], 5)));
    expect(await screen.findByRole("heading", { name: "What changed" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("takes a photo chosen from the gallery", async () => {
    await seedTrip();
    factory.client = fakeClient(() => answered(receipt([], null))).client;
    const user = userEvent.setup();
    await renderPage();

    await user.upload(
      screen.getByTestId("receipt-file-input"),
      new File(["x"], "receipt.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByText("1 photo ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add another photo" })).toBeEnabled();
  });

  it("takes up to three photos for a long receipt", async () => {
    await seedTrip();
    const { client, sent } = fakeClient(() => answered(receipt([], null)));
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: "Photograph receipt" }));
    await user.click(await screen.findByRole("button", { name: "Take photo" }));
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(screen.getByRole("button", { name: "Take photo" }));

    // the camera closes by itself at the third photo
    expect(await screen.findByText("3 photos ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add another photo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose a photo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Send receipt" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].photos).toHaveLength(3);
  });

  it("'Match to a line' on a not-matched line updates that trip line and moves it to What changed", async () => {
    const { lines } = await seedTrip();
    const { client } = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 3.99, text: "MILK" },
            { tripItemId: lines.Eggs, price: 4.99, text: "EGGS" },
            { tripItemId: null, price: 4.49, text: "ORG WHL WHT LOAF" },
          ],
          13.47,
        ),
      ),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();
    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    expect(await screen.findByRole("heading", { name: "Not matched: 1" })).toBeInTheDocument();
    expect(screen.getByText("ORG WHL WHT LOAF")).toBeInTheDocument();
    // Bread is the one trip line no receipt line matched
    const notOnReceipt = screen.getByRole("heading", { name: "Trip lines not on the receipt" });
    expect(within(notOnReceipt.parentElement!).getByText("Bread")).toBeInTheDocument();
    expect(within(notOnReceipt.parentElement!).getByText("Not on receipt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Match to a line" }));
    // only the lines the receipt has not matched are offered
    expect(screen.queryByRole("button", { name: /Milk/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eggs/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Bread/ }));

    expect(await screen.findByRole("heading", { name: "Not matched: 0" })).toBeInTheDocument();
    const changed = screen.getByRole("heading", { name: "What changed" });
    const rows = within(within(changed.parentElement!).getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Bread");
    expect(rows[0]).toHaveTextContent("$2.50 → $4.49");
    expect(screen.queryByText("Not on receipt")).not.toBeInTheDocument();

    expect((await db.tripItems.get(lines.Bread))?.price).toBe(4.49);
    const bread = (await db.items.toArray()).find((i) => i.name === "Bread")!;
    expect(bread.currentPrice).toBe(4.49);
    expect(bread.barcode).toBe("0002");
    expect((await db.priceHistory.where("itemId").equals(bread.id).toArray()).map((h) => h.price)).toContain(4.49);
    expect((await tripRepo.getActive())?.scannedSubtotal).toBeCloseTo(3.99 + 4.49 + 4.99);
  });

  it("'Add as new item' adds a trip line and an item with no barcode", async () => {
    const { trip, lines } = await seedTrip();
    const { client } = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 3.99, text: "MILK" },
            { tripItemId: lines.Bread, price: 2.5, text: "BREAD" },
            { tripItemId: lines.Eggs, price: 4.99, text: "EGGS" },
            { tripItemId: null, price: 3.29, text: "TJ SNACK MIX" },
          ],
          14.77,
        ),
      ),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();
    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));
    expect(await screen.findByRole("heading", { name: "Not matched: 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add as new item" }));

    expect(await screen.findByRole("heading", { name: "Not matched: 0" })).toBeInTheDocument();
    const item = (await db.items.toArray()).find((i) => i.name === "TJ SNACK MIX");
    expect(item).toBeDefined();
    expect(item!.barcode).toMatch(/^manual-/);
    expect(item!.currentPrice).toBe(3.29);
    const added = (await db.tripItems.where("tripId").equals(trip.id).toArray()).find(
      (l) => l.itemId === item!.id,
    );
    expect(added?.price).toBe(3.29);
    expect(added?.quantity).toBe(1);
    expect((await tripRepo.getActive())?.scannedSubtotal).toBeCloseTo(3.99 + 2.5 + 4.99 + 3.29);
    // the receipt has it, so it is not 'Not on receipt'
    expect(screen.queryByText("Not on receipt")).not.toBeInTheDocument();
  });

  it("a trip line no receipt line matched shows 'Not on receipt'", async () => {
    const { lines } = await seedTrip();
    const { client } = fakeClient(() =>
      answered(receipt([{ tripItemId: lines.Milk, price: 3.99, text: "MILK" }], 3.99)),
    );
    factory.client = client;
    const user = userEvent.setup();
    await renderPage();
    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));

    const heading = await screen.findByRole("heading", { name: "Trip lines not on the receipt" });
    const rows = within(heading.parentElement!).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Bread"),
      expect.stringContaining("Eggs"),
    ]);
    expect(screen.getAllByText("Not on receipt")).toHaveLength(2);
  });

  it("leaving End Trip and coming back shows the same lists", async () => {
    const { lines } = await seedTrip();
    const { client } = fakeClient(() =>
      answered(
        receipt(
          [
            { tripItemId: lines.Milk, price: 4.29, text: "MILK" },
            { tripItemId: lines.Eggs, price: 4.99, text: "EGGS" },
            { tripItemId: null, price: 7.25, text: "MYSTERY" },
          ],
          16.53,
        ),
      ),
    );
    factory.client = client;
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <EndTripPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Photograph receipt" });
    await takeOnePhoto(user);
    await user.click(screen.getByRole("button", { name: "Send receipt" }));
    expect(await screen.findByRole("heading", { name: "Not matched: 1" })).toBeInTheDocument();
    unmount();

    await renderPage();

    expect(await screen.findByRole("heading", { name: "Not matched: 1" })).toBeInTheDocument();
    expect(screen.getByText("MYSTERY")).toBeInTheDocument();
    const changed = screen.getByRole("heading", { name: "What changed" });
    const rows = within(within(changed.parentElement!).getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Milk");
    const notOnReceipt = await screen.findByRole("heading", { name: "Trip lines not on the receipt" });
    expect(within(notOnReceipt.parentElement!).getByText("Bread")).toBeInTheDocument();
    // the receipt total comes back too
    expect(screen.getByPlaceholderText("0.00")).toHaveValue(16.53);
  });

  it("offers no photo while the factory is not licensed", async () => {
    await seedTrip();
    factory.ready = false;
    await renderPage();

    expect(screen.getByText("Set up the factory in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photograph receipt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose a photo" })).toBeDisabled();
  });
});
