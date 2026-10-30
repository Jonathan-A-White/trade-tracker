import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { settleAfterTeardown } from "pwa-kit/test-preset";
import PhotoCapturePage from "@/pages/photo-capture-page";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/contexts/toast-context";
import { useToast } from "@/hooks/use-toast";
import { FactorySettings } from "@/components/factory/factory-settings";
import { TripItemRow } from "@/components/data-display/trip-item-row";
import { StorageSection } from "@/settings/sections/storage-section";
import { SeedListCard } from "@/settings/seed-list-card";
import { seedItems } from "@/settings/seed-lists";
import { captureStill } from "@/scanner/capture-still";
import { db } from "@/db/database";
import type { PasskeyPort } from "@/services/passkey";

// A screen that has closed must not set state when a read it started answers later. vitest removes jsdom's `window`
// at the end of a test file, and a React setState that runs then throws 'window is not defined'; settleAfterTeardown
// takes `window` away the same way, runs the answer, and returns what that raised. Each test mounts a screen with
// the awaited call held, unmounts, answers it, and expects nothing raised. The two timer tests do the same with a
// timer that is still pending when the screen goes (fake setTimeout; the real clock proves nothing here).

vi.mock("@/scanner/capture-still", () => ({
  captureStill: vi.fn(),
}));
vi.mock("@/settings/seed-lists", () => ({
  seedItems: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Runs `settle` after teardown; what it raised, whether thrown at once or reported later, comes back. */
async function raisedAfterTeardown(settle: () => void): Promise<unknown[]> {
  const thrown: unknown[] = [];
  const reported = await settleAfterTeardown(() => {
    try {
      settle();
    } catch (err) {
      thrown.push(err);
    }
  });
  return [...thrown, ...reported];
}

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

describe("a closed screen sets no state when an awaited call answers", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "storage");
  });

  it("Storage Usage: the storage estimate", async () => {
    const estimate = deferred<{ usage: number; quota: number }>();
    Object.defineProperty(navigator, "storage", {
      value: { estimate: () => estimate.promise },
      configurable: true,
    });
    const { unmount } = render(<StorageSection />);
    unmount();

    const raised = await raisedAfterTeardown(() => estimate.resolve({ usage: 1024, quota: 1048576 }));
    expect(raised).toEqual([]);
  });

  it("Factory: the copy of the public key", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <ThemeProvider>
          <FactoryProvider
            checkLicence={async () => ({ state: "none", checkedAt: "2026-10-10T00:00:00.000Z" })}
            passkeyPort={noWebAuthn}
          >
            <FactorySettings />
          </FactoryProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText(/Key made/);
    const written = deferred<void>();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => written.promise },
      configurable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    unmount();

    const raised = await raisedAfterTeardown(() => written.resolve());
    expect(raised).toEqual([]);
  });

  it("Factory: a copy that fails", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <ThemeProvider>
          <FactoryProvider
            checkLicence={async () => ({ state: "none", checkedAt: "2026-10-10T00:00:00.000Z" })}
            passkeyPort={noWebAuthn}
          >
            <FactorySettings />
          </FactoryProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText(/Key made/);
    const written = deferred<void>();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => written.promise },
      configurable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    unmount();

    const raised = await raisedAfterTeardown(() => written.reject(new Error("denied")));
    expect(raised).toEqual([]);
  });

  it("a seed list card: the load of the list", async () => {
    const seeding = deferred<{ added: number; skipped: number }>();
    vi.mocked(seedItems).mockReturnValue(seeding.promise);
    const { unmount } = render(
      <SeedListCard
        list={{ id: "x", title: "Some List", items: [] }}
        description="A list."
        buttonLabel="Load Some"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load Some" }));
    unmount();

    const raised = await raisedAfterTeardown(() => seeding.resolve({ added: 1, skipped: 0 }));
    expect(raised).toEqual([]);
  });

  describe("the photo screen", () => {
    beforeEach(async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
      // jsdom has no media playback
      HTMLMediaElement.prototype.play = vi.fn(async () => {});
      URL.createObjectURL = vi.fn(() => "blob:preview");
      URL.revokeObjectURL = vi.fn();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      });
    });

    function renderPhotoScreen() {
      return render(
        <MemoryRouter initialEntries={["/trips/active/photo?barcode=0099887766"]}>
          <FactoryProvider
            checkLicence={async () => ({ state: "none", checkedAt: "x" })}
          >
            <Routes>
              <Route path="/trips/active/photo" element={<PhotoCapturePage />} />
            </Routes>
          </FactoryProvider>
        </MemoryRouter>,
      );
    }

    it("the shot taken", async () => {
      const shot = deferred<Blob>();
      vi.mocked(captureStill).mockReturnValue(shot.promise);
      const { unmount } = renderPhotoScreen();
      fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
      unmount();

      const raised = await raisedAfterTeardown(() => shot.resolve(new Blob(["jpeg"], { type: "image/jpeg" })));
      expect(raised).toEqual([]);
    });

    it("a shot that fails", async () => {
      const shot = deferred<Blob>();
      vi.mocked(captureStill).mockReturnValue(shot.promise);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { unmount } = renderPhotoScreen();
      fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
      unmount();

      const raised = await raisedAfterTeardown(() => shot.reject(new Error("no camera")));
      errors.mockRestore();
      expect(raised).toEqual([]);
    });
  });
});

describe("a timer still pending when the screen goes", () => {
  beforeEach(() => {
    // setTimeout only: settleAfterTeardown waits on setImmediate, which must stay real
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function ShowOne() {
    const { showToast } = useToast();
    return (
      <button type="button" onClick={() => showToast("Saved", "success")}>
        show
      </button>
    );
  }

  it("a toast's 3 s dismissal does not set state once the provider is gone", async () => {
    const { unmount } = render(
      <ToastProvider>
        <ShowOne />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "show" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Saved");
    unmount();

    const raised = await raisedAfterTeardown(() => vi.advanceTimersByTime(3000));
    expect(raised).toEqual([]);
  });

  it("a row's long-press timer does not set state once the row is gone", async () => {
    const { unmount } = render(
      <TripItemRow
        tripItem={{ id: "t1", price: 2, quantity: 1, lineTotal: 2, onSale: false }}
        itemName="Milk"
        unitType="each"
        editable
      />,
    );
    fireEvent.touchStart(screen.getByText("Milk"), { touches: [{ clientX: 0, clientY: 0 }] });
    unmount();

    const raised = await raisedAfterTeardown(() => vi.advanceTimersByTime(500));
    expect(raised).toEqual([]);
  });
});
