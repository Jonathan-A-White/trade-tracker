import { Blob as NodeBlob } from "node:buffer";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "@/db/database";
import { MoveSection } from "./move-section";

const unsubscribe = vi.fn(async () => true);
let subscribed = true;
let download: { name: string; blob: Blob } | null = null;

function stubWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => (subscribed ? { unsubscribe } : null) },
      }),
    },
  });
}

describe("MoveSection", () => {
  // fake-indexeddb copies a row with structuredClone, which keeps node's Blob and turns jsdom's into {}
  beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    localStorage.clear();
    unsubscribe.mockClear();
    subscribed = true;
    download = null;
    stubWorker();
    URL.createObjectURL = vi.fn((blob: Blob) => {
      download = { name: "", blob };
      return "blob:pack";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      if (download) download.name = this.download;
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T20:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("packs the phone into a dated file, says what it holds, and unsubscribes this origin's push", async () => {
    await db.stores.add({ id: "s1", name: "TJ", createdAt: 1, updatedAt: 1 } as never);
    await db.items.bulkAdd([
      { id: "i1", barcode: "1", name: "A", category: "x", createdAt: 1, updatedAt: 1 },
      { id: "i2", barcode: "2", name: "B", category: "x", createdAt: 1, updatedAt: 1 },
    ] as never);
    await db.pendingLookups.add({
      id: "l1",
      barcode: "3",
      tripId: "t",
      itemId: "p",
      photos: [new Blob([new Uint8Array([1])], { type: "image/jpeg" })],
      status: "waiting",
      createdAt: 1,
    } as never);
    localStorage.setItem("tradetracker-theme", "dark");

    render(<MoveSection />);
    const button = screen.getByRole("button", { name: "Pack up this phone" });
    expect(button.className).toMatch(/min-h-\[44px\]/);
    await userEvent.setup({ advanceTimers: () => {} }).click(button);

    expect(
      await screen.findByText(
        "Packed: 1 stores, 2 items, 0 trips, 0 prices, 1 photos. Open https://trade.allmymind.org and Unpack.",
      ),
    ).toBeInTheDocument();
    expect(download?.name).toBe("tradetracker-move-2026-11-05.json");
    expect(download?.blob.type).toBe("application/json");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // nothing on the phone is deleted
    expect(await db.stores.count()).toBe(1);
    expect(localStorage.getItem("tradetracker-theme")).toBe("dark");
  });

  it("still packs when this phone has no push subscription", async () => {
    subscribed = false;
    render(<MoveSection />);
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Pack up this phone" }));
    expect(await screen.findByText(/^Packed: 0 stores/)).toBeInTheDocument();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("still says it packed when the browser will not unsubscribe", async () => {
    unsubscribe.mockRejectedValueOnce(new Error("no"));
    render(<MoveSection />);
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Pack up this phone" }));
    await waitFor(() => expect(screen.getByText(/^Packed: 0 stores/)).toBeInTheDocument());
    expect(screen.getByText(/could not turn notifications off/i)).toBeInTheDocument();
  });
});
