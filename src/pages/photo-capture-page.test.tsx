import { Blob } from "node:buffer";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import PhotoCapturePage from "./photo-capture-page";
import { FactoryProvider } from "@/contexts/factory-context";
import { db } from "@/db/database";
import { TripRepository } from "@/db/repositories/trip-repository";
import { captureStill } from "@/scanner/capture-still";

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
const BARCODE = "0099887766";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function NextItem() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/trips/active/photo?barcode=NEXT")}>
      next item
    </button>
  );
}

function renderScreen(search = `barcode=${BARCODE}`) {
  return render(
    <MemoryRouter initialEntries={[`/trips/active/photo?${search}`]}>
      <FactoryProvider
        checkLicence={async () => ({ state: "none", checkedAt: "x" })}
        askDoor={async () => "unreachable"}
      >
        <Routes>
          <Route
            path="/trips/active/photo"
            element={
              <>
                <PhotoCapturePage />
                <NextItem />
              </>
            }
          />
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
    // jsdom cannot make a URL for a picture
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  /** Takes a shot and keeps it from the preview. */
  async function takeAndUse(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Use photo" }));
  }

  it("asks for the package first, then the shelf tag", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByText("Photo of the PACKAGE (front, name showing)")).toBeInTheDocument();
    await takeAndUse(user);
    expect(await screen.findByText("Photo of the PRICE TAG (on the shelf)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("Done with one photo creates a pending line and a waiting-to-send lookup with one photo", async () => {
    const user = userEvent.setup();
    renderScreen();
    await takeAndUse(user);
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
    await takeAndUse(user);
    await takeAndUse(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active/scan"));
    const lookups = await db.pendingLookups.toArray();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].photos).toHaveLength(2);
  });

  it("Skip on the tag leaves one photo and returns to the scanner", async () => {
    const user = userEvent.setup();
    renderScreen();
    await takeAndUse(user);
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
      expect(screen.getByText("Photo of the PRICE TAG (on the shelf)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Type it instead" })).not.toBeInTheDocument();
    });

    it("one shot queues a price-only lookup with one photo and no pending line, then goes back to the trip", async () => {
      await seedItem();
      const user = userEvent.setup();
      renderScreen(search);
      await takeAndUse(user);

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
      await takeAndUse(user);
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

  describe("preview before a shot is kept", () => {
    const seedItem = async () => {
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
    };
    const priceOnlySearch = `barcode=${BARCODE}&mode=price-only&itemId=i1`;

    it("shows the still full screen with Retake and Use photo, and sends nothing yet", async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(screen.getByRole("button", { name: "Take photo" }));

      expect(await screen.findByRole("img", { name: "The photo you just took" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retake" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use photo" })).toBeInTheDocument();
      expect(await db.pendingLookups.count()).toBe(0);
    });

    it("Retake throws the still away and goes back to the live camera", async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(screen.getByRole("button", { name: "Take photo" }));
      await user.click(await screen.findByRole("button", { name: "Retake" }));

      expect(screen.queryByRole("img", { name: "The photo you just took" })).not.toBeInTheDocument();
      // still asking for the package: the shot was not kept
      expect(screen.getByText("Photo of the PACKAGE (front, name showing)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
      expect(await db.pendingLookups.count()).toBe(0);
    });

    it("a retaken package shot is not counted: Use photo on the second try keeps exactly one", async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(screen.getByRole("button", { name: "Take photo" }));
      await user.click(await screen.findByRole("button", { name: "Retake" }));
      await takeAndUse(user);
      await user.click(await screen.findByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active/scan"));
      const lookups = await db.pendingLookups.toArray();
      expect(lookups[0].photos).toHaveLength(1);
    });

    it("a price-tag shot is previewed too: nothing is queued until Use photo", async () => {
      await seedItem();
      const user = userEvent.setup();
      renderScreen(priceOnlySearch);
      await user.click(screen.getByRole("button", { name: "Take photo" }));

      expect(await screen.findByRole("button", { name: "Use photo" })).toBeInTheDocument();
      expect(await db.pendingLookups.count()).toBe(0);
      expect(screen.queryByTestId("where")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Retake" }));
      expect(await db.pendingLookups.count()).toBe(0);
      expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Take photo" }));
      await user.click(await screen.findByRole("button", { name: "Use photo" }));
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/trips/active"));
      const lookups = await db.pendingLookups.toArray();
      expect(lookups).toHaveLength(1);
      expect(lookups[0].mode).toBe("price-only");
      expect(lookups[0].photos).toHaveLength(1);
    });
  });

  describe("package or price tag, unmistakably", () => {
    it("the package camera has a tall frame and a blue button", async () => {
      renderScreen();
      expect(
        screen.getByRole("heading", { name: "Photo of the PACKAGE (front, name showing)" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("photo-frame")).toHaveAttribute("data-frame", "tall");
      expect(screen.getByRole("button", { name: "Take photo" })).toHaveClass("bg-blue-600");
    });

    it("the price-tag camera has a wide short frame and a different button colour", async () => {
      renderScreen(`barcode=${BARCODE}&mode=price-only&itemId=i1`);
      expect(
        screen.getByRole("heading", { name: "Photo of the PRICE TAG (on the shelf)" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("photo-frame")).toHaveAttribute("data-frame", "wide");
      const take = screen.getByRole("button", { name: "Take photo" });
      expect(take).not.toHaveClass("bg-blue-600");
      expect(take).toHaveClass("bg-amber-600");
    });

    it("after the package, the optional tag step switches to the price-tag look", async () => {
      const user = userEvent.setup();
      renderScreen();
      await takeAndUse(user);
      expect(
        await screen.findByRole("heading", { name: "Photo of the PRICE TAG (on the shelf)" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("photo-frame")).toHaveAttribute("data-frame", "wide");
      expect(screen.getByRole("button", { name: "Take photo" })).toHaveClass("bg-amber-600");
    });
  });

  describe("camera quality, zoom and focus", () => {
    const get = (id: string) => screen.getByTestId(id);

    function openWith(capabilities: Record<string, unknown> | undefined, settings = {}) {
      const applyConstraints = vi.fn(async (constraints: unknown) => {
        void constraints;
      });
      const track = {
        kind: "video",
        stop: vi.fn(),
        getCapabilities: capabilities ? () => capabilities : undefined,
        getSettings: () => settings,
        applyConstraints,
      };
      const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
      return { applyConstraints, getUserMedia };
    }

    function pinch(el: Element, from: number, to: number) {
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 200 - from / 2, clientY: 400 });
      fireEvent.pointerDown(el, { pointerId: 2, clientX: 200 + from / 2, clientY: 400 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 - to / 2, clientY: 400 });
      fireEvent.pointerMove(el, { pointerId: 2, clientX: 200 + to / 2, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 - to / 2, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 2, clientX: 200 + to / 2, clientY: 400 });
    }

    beforeEach(() => {
      vi.mocked(captureStill).mockClear();
      Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 1920 });
      Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 1080 });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0,
        toJSON: () => ({}),
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("asks for the rear camera at 1920x1080 as ideals, not a minimum", async () => {
      const { getUserMedia } = openWith({});
      renderScreen();
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    });

    it("asks for continuous focus once open where the track supports it", async () => {
      const { applyConstraints } = openWith({ focusMode: ["manual", "continuous"] });
      renderScreen();
      await waitFor(() =>
        expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] }),
      );
    });

    it("opens fine on a track that reports no capabilities at all", async () => {
      const { applyConstraints } = openWith(undefined);
      renderScreen();
      await screen.findByRole("button", { name: "Take photo" });
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      expect(applyConstraints).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("pinching out zooms the camera itself where the track has zoom", async () => {
      const { applyConstraints } = openWith({ zoom: { min: 1, max: 8, step: 0.1 } });
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      pinch(get("photo-camera"), 100, 300);
      const zooms = applyConstraints.mock.calls.map(
        ([c]) => (c as { advanced: { zoom?: number }[] }).advanced[0].zoom,
      );
      expect(zooms.at(-1)).toBeCloseTo(3);
      expect(Math.max(...zooms.filter((z): z is number => z !== undefined))).toBeLessThanOrEqual(8);
      // the camera does the zooming, so the picture is not scaled again
      expect(get("photo-camera").querySelector("video")).not.toHaveStyle({ transform: "scale(3)" });
    });

    it("pinching in goes back down, and stops at the camera's minimum", async () => {
      const { applyConstraints } = openWith({ zoom: { min: 1, max: 8, step: 0.1 } });
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      pinch(get("photo-camera"), 100, 400);
      pinch(get("photo-camera"), 400, 40);
      const last = applyConstraints.mock.calls.at(-1)?.[0] as { advanced: { zoom: number }[] };
      expect(last.advanced[0].zoom).toBe(1);
    });

    it("pinching crops the picture digitally where the track cannot zoom, and the still is that crop", async () => {
      const user = userEvent.setup();
      const { applyConstraints } = openWith({});
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      pinch(get("photo-camera"), 100, 200);
      const video = get("photo-camera").querySelector("video");
      expect(video).toHaveStyle({ transform: "scale(2)" });
      expect(applyConstraints).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Take photo" }));
      expect(captureStill).toHaveBeenCalledWith(expect.anything(), { zoom: 2 });
    });

    it("a digital zoom stops at the cap", async () => {
      openWith({});
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      pinch(get("photo-camera"), 50, 800);
      expect(get("photo-camera").querySelector("video")).toHaveStyle({ transform: "scale(4)" });
    });

    it("an unzoomed still is asked for with no crop", async () => {
      const user = userEvent.setup();
      openWith({});
      renderScreen();
      await user.click(screen.getByRole("button", { name: "Take photo" }));
      expect(captureStill).toHaveBeenCalledWith(expect.anything(), { zoom: 1 });
    });

    it("zoom goes back to the start on the next item", async () => {
      const user = userEvent.setup();
      const { getUserMedia } = openWith({});
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      pinch(get("photo-camera"), 100, 300);
      expect(get("photo-camera").querySelector("video")).toHaveStyle({ transform: "scale(3)" });
      await user.click(screen.getByRole("button", { name: "next item" }));
      expect(getUserMedia).toHaveBeenCalledTimes(1); // the camera is not reopened for a new item
      expect(get("photo-camera").querySelector("video")).not.toHaveStyle({ transform: "scale(3)" });
      expect(screen.getByText("Barcode NEXT")).toBeInTheDocument();
    });

    it("the camera's own zoom goes back to its minimum on the next item", async () => {
      const user = userEvent.setup();
      const { applyConstraints } = openWith({ zoom: { min: 1, max: 8, step: 0.1 } });
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      pinch(get("photo-camera"), 100, 300);
      applyConstraints.mockClear();
      await user.click(screen.getByRole("button", { name: "next item" }));
      await waitFor(() =>
        expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1 }] }),
      );
    });

    it("tapping the picture focuses there, and shows a ring", async () => {
      const { applyConstraints } = openWith({ focusMode: ["continuous"] });
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      applyConstraints.mockClear();
      const surface = get("photo-camera");
      fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 400 });
      fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200, clientY: 400 });
      await waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(1));
      const [[constraints]] = applyConstraints.mock.calls as unknown as [
        [{ advanced: { pointsOfInterest: { x: number; y: number }[]; focusMode: string }[] }],
      ];
      expect(constraints.advanced[0].focusMode).toBe("continuous");
      expect(constraints.advanced[0].pointsOfInterest[0].x).toBeCloseTo(0.5);
      expect(constraints.advanced[0].pointsOfInterest[0].y).toBeCloseTo(0.5);
      expect(await screen.findByTestId("focus-ring")).toBeInTheDocument();
    });

    it("tapping where the track cannot focus does nothing and breaks nothing", async () => {
      const { applyConstraints } = openWith({});
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      const surface = get("photo-camera");
      fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 400 });
      fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200, clientY: 400 });
      expect(applyConstraints).not.toHaveBeenCalled();
      expect(screen.queryByTestId("focus-ring")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("a pinch is not also a tap to focus", async () => {
      const { applyConstraints } = openWith({ focusMode: ["continuous"] });
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      applyConstraints.mockClear();
      pinch(get("photo-camera"), 100, 200);
      expect(applyConstraints).not.toHaveBeenCalled();
    });

    it("a touch on a button is not a tap on the picture", async () => {
      const { applyConstraints } = openWith({ focusMode: ["continuous"] });
      renderScreen();
      await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
      applyConstraints.mockClear();
      const button = screen.getByRole("button", { name: "Type it instead" });
      fireEvent.pointerDown(button, { pointerId: 1, clientX: 200, clientY: 700 });
      fireEvent.pointerUp(button, { pointerId: 1, clientX: 200, clientY: 700 });
      expect(applyConstraints).not.toHaveBeenCalled();
    });
  });
});
