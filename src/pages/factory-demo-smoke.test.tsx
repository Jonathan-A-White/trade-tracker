// The whole factory flow as the Governor walks it, with a fake grist client in place
// of bsv-kit: an unknown scan, two photos, the pending line, the answer filling it in,
// then a tag photo that updates a known item's price.
import { Blob } from "node:buffer";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { grist } from "bsv-kit/grist";
import ActiveTripPage from "./active-trip-page";
import PhotoCapturePage from "./photo-capture-page";
import ScannerPage from "./scanner-page";
import { FactoryProvider } from "@/contexts/factory-context";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { PriceHistoryRepository } from "@/db/repositories/price-history-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import {
  LookupRunner,
  type LookupClient,
  type LookupRequest,
} from "@/services/lookup-runner";

// the viewfinder owns the camera; here a button stands in for a barcode being read
vi.mock("@/components/scanner/scanner-viewfinder", () => ({
  ScannerViewfinder: ({
    onBarcodeDetected,
    isActive,
  }: {
    onBarcodeDetected: (barcode: string) => void;
    isActive: boolean;
  }) =>
    isActive ? (
      <button onClick={() => onBarcodeDetected("0099887766")}>read unknown</button>
    ) : null,
}));

// jsdom has no canvas
vi.mock("@/scanner/capture-still", () => ({
  captureStill: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

const itemRepo = new ItemRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const priceRepo = new PriceHistoryRepository();

type Answer = grist.GristAnswer;
const grind = { app: "trade-tracker", kind: "item-from-photos", v: "1.0" };

/** A grist client the test steers: sends are recorded, each answer is held until the test gives it. */
function fakeClient() {
  const sent: LookupRequest[] = [];
  const waiting = new Map<string, (answer: Answer) => void>();
  const client: LookupClient = {
    send: vi.fn(async (request: LookupRequest) => {
      sent.push(request);
      return `direct:tx${sent.length}`;
    }),
    awaitAnswer: vi.fn(
      (txid: string, signal: AbortSignal) =>
        new Promise<Answer>((resolve, reject) => {
          waiting.set(txid, resolve);
          signal.addEventListener("abort", () => {
            waiting.delete(txid);
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ),
  };
  const answer = (txid: string, body: unknown) =>
    waiting.get(txid)?.({ re: txid, status: "answered", answer: body, grind });
  const isWaiting = (txid: string) => waiting.has(txid);
  return { client, sent, answer, isWaiting };
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/trips/active"]}>
      <FactoryProvider
        checkLicence={async () => ({ state: "none", checkedAt: "x" })}
        askDoor={async () => "unreachable"}
      >
        <Routes>
          <Route path="/trips/active" element={<ActiveTripPage />}>
            <Route path="scan" element={<ScannerPage />} />
            <Route path="photo" element={<PhotoCapturePage />} />
          </Route>
        </Routes>
      </FactoryProvider>
    </MemoryRouter>,
  );
}

describe("the factory flow, start to finish", () => {
  let runner: LookupRunner | null = null;

  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  afterEach(() => runner?.stop());

  it("an unknown scan becomes a named item, then a tag photo updates a known item's price", async () => {
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
    const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
    const milk = await itemRepo.create({
      barcode: "111",
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
    const user = userEvent.setup();
    const factory = fakeClient();

    renderApp();
    await screen.findByText("Milk");

    // 1. an unknown scan opens the photo screen: Package, then Shelf tag, then Done
    await user.click(screen.getByRole("link", { name: "Scan" }));
    await user.click(await screen.findByText("read unknown"));
    expect(await screen.findByText("Package")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText("Shelf tag (optional)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    // 2. the pending line is in the trip at once and counts for nothing
    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
    expect(screen.getByText("0099887766")).toBeInTheDocument();
    expect(screen.getByText(/1 item\b/)).toBeInTheDocument();
    const [lookup] = await db.pendingLookups.toArray();
    expect(lookup.photos).toHaveLength(2);

    // 3. the door opens (licence held): the lookup goes out with both photos
    runner = new LookupRunner();
    runner.setClient(factory.client);
    runner.start();
    await waitFor(() => expect(factory.sent).toHaveLength(1));
    expect(factory.sent[0]).toMatchObject({
      barcode: "0099887766",
      mode: "new-item",
      clientId: lookup.id,
    });
    expect(factory.sent[0].photos).toHaveLength(2);
    expect(await screen.findByText("At the factory")).toBeInTheDocument();

    // 4. the answer fills the line in: name, price, 'Check price'
    await waitFor(() => expect(factory.isWaiting("direct:tx1")).toBe(true));
    factory.answer("direct:tx1", {
      name: "Oat Bars",
      category: "Snacks & Candy",
      unitType: "each",
      price: 4.25,
      size: "6 count",
      confidence: "high",
    });
    expect(await screen.findByText("Oat Bars")).toBeInTheDocument();
    expect(screen.queryByText("At the factory")).not.toBeInTheDocument();
    const badge = await screen.findByRole("button", { name: "Check price" });
    const oats = await itemRepo.findByBarcode("0099887766");
    expect(oats).toMatchObject({ name: "Oat Bars", category: "Snacks & Candy", currentPrice: 4.25 });
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(7.25);
    await user.click(badge);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Check price" })).not.toBeInTheDocument(),
    );

    // 5. 'Photo price' on the known item opens the tag-only screen; one shot goes back
    const milkRow = (await screen.findByText("Milk")).closest("div.relative") as HTMLElement;
    await user.click(await within(milkRow).findByRole("button", { name: "Photo price" }));
    expect(await screen.findByText("Shelf tag")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take photo" }));

    await waitFor(() => expect(factory.sent).toHaveLength(2));
    expect(factory.sent[1]).toMatchObject({ barcode: "111", mode: "price-only" });
    expect(factory.sent[1].photos).toHaveLength(1);
    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();

    // 6. the tag's price lands on the row, flagged 'Check price', with a history entry
    await waitFor(() => expect(factory.isWaiting("direct:tx2")).toBe(true));
    factory.answer("direct:tx2", {
      name: "Milk",
      category: "Dairy & Eggs",
      unitType: "each",
      price: 3.49,
      confidence: "high",
    });
    expect(await screen.findByText(/\$3\.49 \/ each/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Check price" })).toBeInTheDocument();
    expect(await itemRepo.getById(milk.id)).toMatchObject({ name: "Milk", currentPrice: 3.49 });
    const history = await priceRepo.getByItem(milk.id);
    expect(history.some((h) => h.price === 3.49 && h.storeId === "s1")).toBe(true);
  });
});
