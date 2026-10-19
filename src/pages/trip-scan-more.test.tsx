import { Blob } from "node:buffer";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useRoutes } from "react-router";
import { appRoutes } from "@/routes";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";

// the viewfinder owns the camera; here buttons stand in for a barcode being read and the X
vi.mock("@/components/scanner/scanner-viewfinder", () => ({
  ScannerViewfinder: ({
    onBarcodeDetected,
    onClose,
    isActive,
  }: {
    onBarcodeDetected: (barcode: string) => void;
    onClose: () => void;
    isActive: boolean;
  }) => (
    <>
      <button onClick={onClose}>close viewfinder</button>
      {isActive && (
        <>
          <button onClick={() => onBarcodeDetected("111")}>read known</button>
          <button onClick={() => onBarcodeDetected("0099887766")}>read unknown</button>
        </>
      )}
    </>
  ),
}));

// jsdom has no canvas
vi.mock("@/scanner/capture-still", () => ({
  captureStill: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

// jsdom has no PointerEvent; a MouseEvent with a pointerId is enough for React's handlers
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
Object.defineProperty(window, "PointerEvent", { configurable: true, value: FakePointerEvent });

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();
const lookups = new PendingLookupRepository();

async function seed() {
  const now = Date.now();
  await db.stores.put({ id: "tj", name: "Trader Joe's", createdAt: now, updatedAt: now });
  await db.stores.put({ id: "cs", name: "Corner Shop", createdAt: now, updatedAt: now });
  const eggs = await itemRepo.create({
    barcode: "222",
    name: "Eggs",
    currentPrice: 5,
    unitType: "each",
  });
  await itemRepo.create({ barcode: "111", name: "Milk", currentPrice: 3, unitType: "each" });
  const ended = await tripRepo.create({ storeId: "tj", startedAt: now - 3_600_000 });
  await tripItemRepo.addToTrip({
    tripId: ended.id,
    itemId: eggs.id,
    price: 5,
    quantity: 1,
    onSale: false,
  });
  await tripRepo.complete(ended.id, 5.4);
  return { ended };
}

async function seedActive() {
  return tripRepo.create({ storeId: "cs", startedAt: Date.now() });
}

// the real route tree, without the app shell; a data router cannot navigate under jsdom's fetch
function Routed() {
  const location = useLocation();
  const routes = useRoutes(appRoutes[0].children ?? []);
  return (
    <>
      <p data-testid="where" hidden>
        {location.pathname + location.search}
      </p>
      {routes}
    </>
  );
}

/** Where the app is now, read from the screen. */
const here = {
  get pathname() {
    return (screen.getByTestId("where").textContent ?? "").split("?")[0];
  },
  get search() {
    const full = screen.getByTestId("where").textContent ?? "";
    return full.includes("?") ? full.slice(full.indexOf("?")) : "";
  },
};

function renderAt(path: string) {
  render(
    <ThemeProvider>
      <FactoryProvider
        checkLicence={async () => ({ state: "none", checkedAt: "x" })}
        askDoor={async () => "unreachable"}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routed />
        </MemoryRouter>
      </FactoryProvider>
    </ThemeProvider>,
  );
  return { state: { location: here } };
}

describe("the Trips list and an ended trip's Edit page", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    vi.stubGlobal(
      "matchMedia",
      (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    );
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("the live trip in Trips", () => {
    it("is marked In progress and opens the live trip, with Scan and End Trip", async () => {
      await seed();
      await seedActive();
      const user = userEvent.setup();
      const router = renderAt("/trips/history");

      const row = await screen.findByRole("button", { name: /Corner Shop/ });
      expect(within(row).getByText("In progress")).toBeInTheDocument();
      await user.click(row);

      await waitFor(() => expect(router.state.location.pathname).toBe("/trips/active"));
      expect(await screen.findByRole("link", { name: "Scan" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /end trip/i })).toBeInTheDocument();
    });

    it("an ended trip still opens its summary", async () => {
      const { ended } = await seed();
      await seedActive();
      const user = userEvent.setup();
      const router = renderAt("/trips/history");

      const row = await screen.findByRole("button", { name: /Trader Joe's/ });
      expect(within(row).queryByText("In progress")).not.toBeInTheDocument();
      await user.click(row);

      await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${ended.id}`));
      expect(await screen.findByText("Scanned Subtotal")).toBeInTheDocument();
    });

    it("the summary address of the live trip says In progress and leads back to the trip", async () => {
      await seed();
      const active = await seedActive();
      const user = userEvent.setup();
      const router = renderAt(`/trips/${active.id}`);
      expect(await screen.findByText(/In progress/)).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "Back to the trip" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/trips/active"));
      expect(await screen.findByRole("link", { name: "Scan" })).toBeInTheDocument();
    });

    it("an ended trip's summary carries no In progress banner", async () => {
      const { ended } = await seed();
      renderAt(`/trips/${ended.id}`);
      await screen.findByText("Scanned Subtotal");
      expect(screen.queryByText(/In progress/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Back to the trip" })).not.toBeInTheDocument();
    });
  });

  describe("Scan on an ended trip's Edit page", () => {
    it("a known barcode adds a line to that trip, never to the live trip, and the subtotal grows", async () => {
      const { ended } = await seed();
      const active = await seedActive();
      const user = userEvent.setup();
      const router = renderAt(`/trips/${ended.id}/edit`);

      await user.click(await screen.findByRole("button", { name: "Scan" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${ended.id}/edit/scan`));
      await user.click(await screen.findByText("read known"));
      await user.click(await screen.findByRole("button", { name: "Add to Trip" }));

      await waitFor(async () =>
        expect((await tripRepo.getById(ended.id))?.scannedSubtotal).toBe(8),
      );
      const milk = await itemRepo.findByBarcode("111");
      const endedLines = await tripItemRepo.getByTrip(ended.id);
      expect(endedLines.map((l) => l.itemId)).toContain(milk?.id);
      expect(await tripItemRepo.getByTrip(active.id)).toHaveLength(0);
      expect((await tripRepo.getById(active.id))?.scannedSubtotal).toBe(0);

      // closing the scanner comes back to the Edit page, which shows the new line
      await user.click(screen.getByText("close viewfinder"));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${ended.id}/edit`));
      expect(await screen.findByText("Milk")).toBeInTheDocument();

      // Save Changes keeps its meaning: back to the summary, with the new subtotal
      await user.click(screen.getByRole("button", { name: "Save Changes" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${ended.id}`));
      expect(await screen.findByText("$8.00", { selector: "p" })).toBeInTheDocument();
    });

    it("an unknown barcode goes to photo capture and makes a pending lookup for that trip; its answer fills the line", async () => {
      const { ended } = await seed();
      const active = await seedActive();
      const user = userEvent.setup();
      const router = renderAt(`/trips/${ended.id}/edit`);

      await user.click(await screen.findByRole("button", { name: "Scan" }));
      await user.click(await screen.findByText("read unknown"));
      await waitFor(() =>
        expect(router.state.location.pathname + router.state.location.search).toBe(
          `/trips/${ended.id}/edit/photo?barcode=0099887766`,
        ),
      );

      await user.click(await screen.findByRole("button", { name: "Take photo" }));
      await user.click(await screen.findByRole("button", { name: "Use photo" }));
      await user.click(await screen.findByRole("button", { name: "Skip" }));
      // Skipping the tag after a photo of the package comes back to the scanner of the same trip
      await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${ended.id}/edit/scan`));

      const [lookup] = await db.pendingLookups.toArray();
      expect(lookup.tripId).toBe(ended.id);
      expect(lookup.barcode).toBe("0099887766");
      expect(await tripItemRepo.getByTrip(active.id)).toHaveLength(0);

      await user.click(screen.getByText("close viewfinder"));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${ended.id}/edit`));
      expect(await screen.findByText("0099887766")).toBeInTheDocument();
      expect(screen.getByAltText("Photo of 0099887766")).toBeInTheDocument();

      await lookups.applyAnswer(lookup.id, {
        name: "Oat Bars",
        unitType: "each",
        category: "other",
        price: 4.25,
        confidence: "high",
      });
      expect(await screen.findByText("Oat Bars")).toBeInTheDocument();
      expect((await tripRepo.getById(ended.id))?.scannedSubtotal).toBe(9.25);
      expect((await tripRepo.getById(active.id))?.scannedSubtotal).toBe(0);
    });

    it("Type it instead on the photo screen adds by hand to the same trip", async () => {
      const { ended } = await seed();
      const router = renderAt(`/trips/${ended.id}/edit/photo?barcode=0099887766`);
      fireEvent.click(await screen.findByRole("button", { name: "Type it instead" }));
      await waitFor(() =>
        expect(router.state.location.pathname + router.state.location.search).toBe(
          `/trips/${ended.id}/edit/add?barcode=0099887766`,
        ),
      );
    });

    it("the live trip's own Scan still goes to the live trip's scanner", async () => {
      await seed();
      await seedActive();
      const user = userEvent.setup();
      const router = renderAt("/trips/active");
      await user.click(await screen.findByRole("link", { name: "Scan" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/trips/active/scan"));
      await user.click(await screen.findByText("read unknown"));
      await waitFor(() => expect(router.state.location.pathname).toBe("/trips/active/photo"));
    });
  });
});
