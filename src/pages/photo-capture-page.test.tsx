import { Blob } from "node:buffer";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import PhotoCapturePage from "./photo-capture-page";
import { FactoryProvider } from "@/contexts/factory-context";
import { db } from "@/db/database";
import { TripRepository } from "@/db/repositories/trip-repository";

vi.mock("@/scanner/capture-still", () => ({
  captureStill: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

const tripRepo = new TripRepository();
const BARCODE = "0099887766";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderScreen(search = `barcode=${BARCODE}`) {
  return render(
    <MemoryRouter initialEntries={[`/trips/active/photo?${search}`]}>
      <FactoryProvider
        checkLicence={async () => ({ state: "none", checkedAt: "x" })}
        askDoor={async () => "unreachable"}
      >
        <Routes>
          <Route path="/trips/active/photo" element={<PhotoCapturePage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </FactoryProvider>
    </MemoryRouter>,
  );
}

describe("PhotoCapturePage", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
    await tripRepo.create({ storeId: "s1", startedAt: now });
    // jsdom has no media playback
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  it("asks for the package first, then the shelf tag", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByText("Package")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText("Shelf tag (optional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("Done with one photo creates a pending line and a waiting-to-send lookup with one photo", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active/scan"));
    const lookups = await db.pendingLookups.toArray();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].barcode).toBe(BARCODE);
    expect(lookups[0].status).toBe("waiting-to-send");
    expect(lookups[0].photos).toHaveLength(1);
    const lines = await db.tripItems.toArray();
    expect(lines).toHaveLength(1);
    expect(lines[0].pending).toBe(true);
    expect(lines[0].tripId).toBe(lookups[0].tripId);
  });

  it("Done with two photos stores two", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active/scan"));
    const lookups = await db.pendingLookups.toArray();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].photos).toHaveLength(2);
  });

  it("Skip on the tag leaves one photo and returns to the scanner", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Skip" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active/scan"));
    const lookups = await db.pendingLookups.toArray();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].photos).toHaveLength(1);
  });

  it("says the lookup waits for a licence when the factory door is not open", async () => {
    renderScreen();
    expect(await screen.findByText(/Waiting for a licence/)).toBeInTheDocument();
  });

  it("'Type it instead' goes to the manual add page with the barcode", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Type it instead" }));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        `/trips/active/add?barcode=${BARCODE}`,
      ),
    );
    expect(await db.pendingLookups.count()).toBe(0);
  });

  describe("tag only (a known item's price)", () => {
    async function seedItem() {
      const now = Date.now();
      await db.items.put({
        id: "i1",
        barcode: BARCODE,
        name: "Milk",
        currentPrice: 3,
        unitType: "each",
        createdAt: now,
        updatedAt: now,
      });
    }
    const search = `barcode=${BARCODE}&mode=price-only&itemId=i1`;

    it("asks for the shelf tag only: no Skip, Done or Type it instead", async () => {
      await seedItem();
      renderScreen(search);
      expect(screen.getByText("Shelf tag")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Type it instead" })).not.toBeInTheDocument();
    });

    it("one shot queues a price-only lookup with one photo and no pending line, then goes back to the trip", async () => {
      await seedItem();
      const user = userEvent.setup();
      renderScreen(search);
      await user.click(screen.getByRole("button", { name: "Take photo" }));

      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active"));
      const lookups = await db.pendingLookups.toArray();
      expect(lookups).toHaveLength(1);
      expect(lookups[0]).toMatchObject({
        barcode: BARCODE,
        mode: "price-only",
        itemId: "i1",
        status: "waiting-to-send",
      });
      expect(lookups[0].photos).toHaveLength(1);
      expect(await db.tripItems.count()).toBe(0);
    });

    it("goes back to where it came from", async () => {
      await seedItem();
      const user = userEvent.setup();
      renderScreen(`${search}&from=${encodeURIComponent("/items/i1")}`);
      await user.click(screen.getByRole("button", { name: "Take photo" }));
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/items/i1"));
    });

    it("Cancel queues nothing", async () => {
      await seedItem();
      const user = userEvent.setup();
      renderScreen(search);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active"));
      expect(await db.pendingLookups.count()).toBe(0);
    });
  });
});
