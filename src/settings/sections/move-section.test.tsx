import { Blob as NodeBlob } from "node:buffer";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "@/db/database";
import { reloadPage } from "@/move/reload";
import { MoveSection } from "./move-section";

vi.mock("@/move/reload", () => ({ reloadPage: vi.fn() }));

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

  describe("Unpack from a file", () => {
    const packFile = (over: Record<string, unknown> = {}) =>
      new File(
        [
          JSON.stringify({
            version: 1,
            app: "trade-tracker",
            from: "http://old.example",
            when: "2026-11-05T20:00:00.000Z",
            db: { schema: db.verno, tables: { stores: [{ id: "n1", name: "New", createdAt: 1, updatedAt: 1 }] } },
            storage: { "tradetracker-factory-public": "02aabb" },
            ...over,
          }),
        ],
        "tradetracker-move-2026-11-05.json",
        { type: "application/json" },
      );
    const picker = () => screen.getByLabelText("Pack file") as HTMLInputElement;

    beforeEach(() => {
      vi.mocked(reloadPage).mockClear();
      sessionStorage.clear();
    });

    it("offers a button and a .json picker", () => {
      render(<MoveSection />);
      const button = screen.getByRole("button", { name: "Unpack from a file" });
      expect(button.className).toMatch(/min-h-\[44px\]/);
      expect(picker().type).toBe("file");
      expect(picker().accept).toBe(".json");
    });

    it("asks before it replaces a phone that holds something, then restores, remembers the counts and reloads", async () => {
      await db.stores.add({ id: "old", name: "Old", createdAt: 1, updatedAt: 1 } as never);
      render(<MoveSection />);
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.upload(picker(), packFile());

      expect(await screen.findByText("Replace everything on this phone?")).toBeInTheDocument();
      expect(reloadPage).not.toHaveBeenCalled();
      expect((await db.stores.toArray()).map((s) => s.id)).toEqual(["old"]);
      await user.click(screen.getByRole("button", { name: "Unpack" }));

      await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
      expect((await db.stores.toArray()).map((s) => s.id)).toEqual(["n1"]);
      expect(localStorage.getItem("tradetracker-factory-public")).toBe("02aabb");
      expect(sessionStorage.getItem("unpacked-counts")).toBe(
        JSON.stringify({ stores: 1, items: 0, trips: 0, priceHistory: 0, photos: 0 }),
      );
    });

    it("leaves the phone as it was when the person says Cancel", async () => {
      await db.stores.add({ id: "old", name: "Old", createdAt: 1, updatedAt: 1 } as never);
      render(<MoveSection />);
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.upload(picker(), packFile());
      await user.click(await screen.findByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Replace everything on this phone?")).not.toBeInTheDocument();
      expect((await db.stores.toArray()).map((s) => s.id)).toEqual(["old"]);
      expect(reloadPage).not.toHaveBeenCalled();
    });

    it("says in a plain sentence that a file packed at this address, a file of another app and a damaged file cannot be unpacked", async () => {
      render(<MoveSection />);
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.upload(picker(), packFile({ from: location.origin }));
      expect(await screen.findByRole("alert")).toHaveTextContent("This file was packed at this address");
      await user.upload(picker(), packFile({ app: "lampas" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This file is not a Trade Tracker pack."));
      await user.upload(picker(), new File(["{nope"], "x.json", { type: "application/json" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This file is not a Trade Tracker pack."));
      expect(reloadPage).not.toHaveBeenCalled();
      expect(await db.stores.count()).toBe(0);
    });

    it("shows what the last unpack brought, once", async () => {
      sessionStorage.setItem("unpacked-counts", JSON.stringify({ stores: 2, items: 3, trips: 1, priceHistory: 4, photos: 1 }));
      const first = render(<MoveSection />);
      expect(screen.getByText(/Unpacked: 2 stores, 3 items, 1 trips, 4 prices, 1 photos\./)).toBeInTheDocument();
      first.unmount();
      render(<MoveSection />);
      expect(screen.queryByText(/Unpacked:/)).not.toBeInTheDocument();
    });
  });
});
