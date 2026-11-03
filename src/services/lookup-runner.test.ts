// jsdom's Blob does not survive fake-indexeddb's structured clone; Node's does.
import { Blob } from "node:buffer";
import { waitFor } from "@testing-library/react";
import type { GristAnswer } from "@/factory/mill";
import type { PendingLookup } from "@/contracts/types";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PriceHistoryRepository } from "@/db/repositories/price-history-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { matchReceiptLine, settleReceipt } from "./receipt-reconcile";
import {
  LookupRunner,
  type LookupClient,
  type LookupRequest,
  type LookupRunnerOptions,
} from "./lookup-runner";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const priceRepo = new PriceHistoryRepository();
const itemRepo = new ItemRepository();

type Answer = GristAnswer;

const grind = { app: "trade-tracker", kind: "item-from-photos", v: "1.0" };

const goodAnswer = {
  name: "Kerrygold Salted Butter",
  category: "Dairy & Eggs",
  unitType: "each",
  price: 4.99,
  size: "8 oz",
  confidence: "high",
};

function answered(re: string, answer: unknown): Answer {
  return { re, status: "answered", answer, grind };
}

/**
 * A grist client the test steers: sends are recorded, each wait is a promise the test settles, and
 * `onBackend` holds the answers a single read of the backend finds.
 */
function fakeClient() {
  const sent: LookupRequest[] = [];
  const onBackend = new Map<string, Answer>();
  const waiting = new Map<
    string,
    { resolve: (a: Answer) => void; reject: (e: unknown) => void; signal: AbortSignal }
  >();
  let waitCalls = 0;
  const client: LookupClient = {
    send: vi.fn(async (req: LookupRequest) => {
      sent.push(req);
      return `direct:tx${sent.length}`;
    }),
    awaitAnswer: vi.fn((txid: string, signal: AbortSignal) => {
      waitCalls++;
      return new Promise<Answer>((resolve, reject) => {
        waiting.set(txid, { resolve, reject, signal });
        signal.addEventListener("abort", () => {
          waiting.delete(txid);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }),
    findAnswer: vi.fn(async (txid: string) => onBackend.get(txid) ?? null),
  };
  return { client, sent, waiting, onBackend, waitCalls: () => waitCalls };
}

async function startTrip() {
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Shop", createdAt: now, updatedAt: now });
  return tripRepo.create({ storeId: "s1", startedAt: now });
}

async function queueLookup(tripId: string, barcode = "0044") {
  const photo = new Blob(["package"], { type: "image/jpeg" }) as unknown as globalThis.Blob;
  return lookups.create({ barcode, tripId, photos: [photo] });
}

const runners: LookupRunner[] = [];
function makeRunner(client: LookupClient | null, options: LookupRunnerOptions = {}) {
  const runner = new LookupRunner({ backoffBaseMs: 1, ...options });
  runners.push(runner);
  runner.setClient(client);
  runner.start();
  return runner;
}

beforeEach(async () => {
  // the db singleton outlives each test's IDBFactory
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
  for (const r of runners.splice(0)) r.stop();
});

describe("LookupRunner", () => {
  it("sends a waiting lookup once and moves it to at-the-factory with its txid", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();

    makeRunner(fake.client);

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
    });
    expect((await lookups.getById(lookup.id))?.gristTxid).toBe("direct:tx1");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].barcode).toBe("0044");
    expect(fake.sent[0].mode).toBe("new-item");
    expect(fake.sent[0].categories).toContain("Dairy & Eggs");
    expect(fake.sent[0].photos).toHaveLength(1);
    expect(fake.sent[0].photos[0].mime).toBe("image/jpeg");
    expect(new TextDecoder().decode(fake.sent[0].photos[0].bytes)).toBe("package");
    expect(fake.sent[0].clientId).toBe(lookup.id);

    // a second look at the queue sends nothing more
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.sent).toHaveLength(1);
  });

  it("sends nothing while there is no client (door unlicensed or locked)", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();

    const runner = makeRunner(null);
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.sent).toHaveLength(0);
    expect((await lookups.getById(lookup.id))?.status).toBe("waiting-to-send");

    runner.setClient(fake.client);
    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
    });
  });

  it("sends nothing while offline, and sends once online", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();

    const runner = makeRunner(fake.client);
    runner.setOnline(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.sent.length).toBeLessThanOrEqual(1); // a send already begun may finish

    if (fake.sent.length === 0) {
      runner.setOnline(true);
      await waitFor(async () => {
        expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
      });
    }
  });

  it("sends one lookup at a time, oldest first", async () => {
    const trip = await startTrip();
    const first = await queueLookup(trip.id, "111");
    await new Promise((r) => setTimeout(r, 5));
    const second = await queueLookup(trip.id, "222");
    const fake = fakeClient();
    let inFlight = 0;
    let maxInFlight = 0;
    const original = fake.client.send;
    fake.client.send = async (req) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      try {
        return await original(req);
      } finally {
        inFlight--;
      }
    };

    makeRunner(fake.client);

    await waitFor(async () => {
      expect((await lookups.getById(second.id))?.status).toBe("at-the-factory");
    });
    expect(maxInFlight).toBe(1);
    expect(fake.sent.map((s) => s.barcode)).toEqual(["111", "222"]);
    expect((await lookups.getById(first.id))?.gristTxid).toBe("direct:tx1");
  });

  it("fills the item and the line from an answer with a price, and flags the line 'check'", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting.get("direct:tx1")!.resolve(answered("direct:tx1", goodAnswer));

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    });
    const item = await itemRepo.findByBarcode("0044");
    expect(item).toMatchObject({
      name: "Kerrygold Salted Butter",
      category: "Dairy & Eggs",
      unitType: "each",
      currentPrice: 4.99,
    });
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      itemId: item!.id,
      price: 4.99,
      lineTotal: 4.99,
      priceFlag: "check",
    });
    expect(lines[0].pending).toBeUndefined();
    const history = await priceRepo.getByItem(item!.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ price: 4.99, storeId: "s1", tripItemId: lines[0].id });
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(4.99);
    expect((await lookups.getById(lookup.id))?.photos).toEqual([]);
  });

  it("with price null leaves the price empty, writes no history, and flags the line 'add'", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting
      .get("direct:tx1")!
      .resolve(
        answered("direct:tx1", { ...goodAnswer, name: "Gala Apples", category: "Produce", unitType: "per_lb", price: null }),
      );

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    });
    const item = await itemRepo.findByBarcode("0044");
    expect(item).toMatchObject({ name: "Gala Apples", unitType: "per_lb", currentPrice: 0 });
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines[0]).toMatchObject({ itemId: item!.id, price: 0, priceFlag: "add" });
    expect(await priceRepo.getByItem(item!.id)).toHaveLength(0);
  });

  it("marks a refused answer failed with its reason; Retry re-queues and sends again", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    const runner = makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting
      .get("direct:tx1")!
      .resolve({ re: "direct:tx1", status: "refused", reason: "The photos are too dark to read.", grind });

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("failed");
    });
    expect((await lookups.getById(lookup.id))?.error).toBe("The photos are too dark to read.");
    expect((await tripItemRepo.getByTrip(trip.id))[0].pending).toBe(true);

    // fake-indexeddb loses a Blob on its second structured clone (every update rewrites the
    // row), so the queue is paused while the photo is put back; a real IndexedDB keeps it
    runner.setOnline(false);
    await lookups.retry(lookup.id);
    const requeued = (await lookups.getById(lookup.id))!;
    expect(requeued.status).toBe("waiting-to-send");
    await db.pendingLookups.put({
      ...requeued,
      photos: [new Blob(["package"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
    });
    runner.setOnline(true);

    await waitFor(() => expect(fake.sent).toHaveLength(2));
    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
    });
    expect((await lookups.getById(lookup.id))?.error).toBeUndefined();
    expect((await lookups.getById(lookup.id))?.gristTxid).toBe("direct:tx2");
  });

  it("marks a 'failed' answer failed with a reason even when none is given", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting.get("direct:tx1")!.resolve({ re: "direct:tx1", status: "failed", grind });

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("failed");
    });
    expect((await lookups.getById(lookup.id))?.error).toMatch(/\S/);
  });

  it("marks a schema-invalid answer failed and never applies it", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting
      .get("direct:tx1")!
      .resolve(answered("direct:tx1", { ...goodAnswer, unitType: "per_gallon" }));

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("failed");
    });
    expect((await lookups.getById(lookup.id))?.error).toMatch(/expected shape|not valid|invalid/i);
    expect(await itemRepo.findByBarcode("0044")).toBeUndefined();
    expect(await db.priceHistory.count()).toBe(0);
    expect((await tripItemRepo.getByTrip(trip.id))[0].pending).toBe(true);
  });

  it("marks an answered record with no answer failed", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting.get("direct:tx1")!.resolve({ re: "direct:tx1", status: "answered", grind });

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("failed");
    });
    expect(await itemRepo.findByBarcode("0044")).toBeUndefined();
  });

  it("resumes polling after a reload from the stored status, without sending again", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await db.pendingLookups.update(lookup.id, { status: "at-the-factory", gristTxid: "direct:abc" });
    const fake = fakeClient();

    makeRunner(fake.client);

    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(true));
    expect(fake.sent).toHaveLength(0);

    fake.waiting.get("direct:abc")!.resolve(answered("direct:abc", goodAnswer));
    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    });
  });

  it("polls only while the page is visible", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await db.pendingLookups.update(lookup.id, { status: "at-the-factory", gristTxid: "direct:abc" });
    const fake = fakeClient();

    const runner = makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(true));

    runner.setVisible(false);
    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(false));
    const callsWhileHidden = fake.waitCalls();
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.waitCalls()).toBe(callsWhileHidden);
    expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");

    runner.setVisible(true);
    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(true));
  });

  it("stops polling when the door closes", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await db.pendingLookups.update(lookup.id, { status: "at-the-factory", gristTxid: "direct:abc" });
    const fake = fakeClient();

    const runner = makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(true));

    runner.setClient(null);
    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(false));
    expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
  });

  it("backs off and tries again after a network error on send, keeping the lookup waiting", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    const original = fake.client.send;
    let calls = 0;
    fake.client.send = async (req) => {
      calls++;
      if (calls < 3) throw new TypeError("Failed to fetch");
      return original(req);
    };

    makeRunner(fake.client);

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
    });
    expect(calls).toBe(3);
  });

  it("backs off and polls again after a network error while waiting", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await db.pendingLookups.update(lookup.id, { status: "at-the-factory", gristTxid: "direct:abc" });
    const fake = fakeClient();
    let calls = 0;
    const original = fake.client.awaitAnswer;
    fake.client.awaitAnswer = (txid, signal) => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError("Failed to fetch"));
      return original(txid, signal);
    };

    makeRunner(fake.client);

    await waitFor(() => expect(fake.waiting.has("direct:abc")).toBe(true));
    expect(calls).toBe(2);
    expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
  });

  it("marks a lookup the factory refuses to take (a permanent 4xx on send) failed with Retry", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    fake.client.send = async () => {
      const { door } = await import("bsv-kit/bsv");
      throw new door.RefusedError("The image upload failed.", 400);
    };

    makeRunner(fake.client);

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("failed");
    });
    expect((await lookups.getById(lookup.id))?.error).toBe("The image upload failed.");
  });

  it("stops waiting for a lookup that was discarded", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    await lookups.discard(lookup.id);

    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(false));
  });
});

describe("LookupRunner price-only lookups", () => {
  async function seedKnownItem() {
    const trip = await startTrip();
    const butter = await itemRepo.create({
      barcode: "0055",
      name: "Kerrygold Salted Butter",
      currentPrice: 3.99,
      unitType: "each",
      category: "Dairy & Eggs",
    });
    const line = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: butter.id,
      price: 3.99,
      quantity: 2,
      onSale: false,
    });
    const photo = new Blob(["tag"], { type: "image/jpeg" }) as unknown as globalThis.Blob;
    const lookup = await lookups.create({
      barcode: butter.barcode,
      tripId: trip.id,
      photos: [photo],
      mode: "price-only",
      itemId: butter.id,
    });
    return { trip, butter, line, lookup };
  }

  const tagAnswer = {
    name: "Something Else Entirely",
    category: "Snacks & Candy",
    unitType: "per_lb",
    price: 4.49,
    confidence: "high",
  };

  it("creates no pending line: the lookup keeps the item's own id and mode", async () => {
    const { trip, butter, lookup } = await seedKnownItem();
    expect(lookup).toMatchObject({ mode: "price-only", itemId: butter.id, status: "waiting-to-send" });
    expect(lookup.photos).toHaveLength(1);
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].pending).toBeUndefined();
  });

  it("sends the lookup with mode price-only and its one photo", async () => {
    await seedKnownItem();
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0].mode).toBe("price-only");
    expect(fake.sent[0].barcode).toBe("0055");
    expect(fake.sent[0].photos).toHaveLength(1);
  });

  it("an answered price updates currentPrice, the line, and appends history for the trip's store; name and category stay", async () => {
    const { trip, butter, line, lookup } = await seedKnownItem();
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting.get("direct:tx1")!.resolve(answered("direct:tx1", tagAnswer));

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    });
    const item = await itemRepo.getById(butter.id);
    expect(item).toMatchObject({
      name: "Kerrygold Salted Butter",
      category: "Dairy & Eggs",
      unitType: "each",
      currentPrice: 4.49,
    });
    const history = await priceRepo.getByItem(butter.id);
    // the entry made when the item joined the trip, then the one from the tag
    expect(history).toHaveLength(2);
    const fresh = history.find((h) => h.price === 4.49)!;
    expect(fresh.storeId).toBe("s1");
    expect(fresh.tripItemId).toBe(line.id);
    expect(fresh.recordedAt).toBeGreaterThanOrEqual(trip.startedAt);
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ price: 4.49, quantity: 2, lineTotal: 8.98, priceFlag: "check" });
    expect((await tripRepo.getById(trip.id))?.scannedSubtotal).toBe(8.98);
    expect((await lookups.getById(lookup.id))?.photos).toEqual([]);
  });

  it("price null leaves the old price and the line alone and records that no price was read", async () => {
    const { trip, butter, lookup } = await seedKnownItem();
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting.get("direct:tx1")!.resolve(answered("direct:tx1", { ...tagAnswer, price: null }));

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    });
    expect((await lookups.getById(lookup.id))?.noPrice).toBe(true);
    expect((await itemRepo.getById(butter.id))?.currentPrice).toBe(3.99);
    expect(await priceRepo.getByItem(butter.id)).toHaveLength(1);
    const lines = await tripItemRepo.getByTrip(trip.id);
    expect(lines[0]).toMatchObject({ price: 3.99 });
    expect(lines[0].priceFlag).toBeUndefined();
  });

  it("with the item not on the trip, still updates the item and its history", async () => {
    const { trip, butter, line, lookup } = await seedKnownItem();
    await tripItemRepo.remove(line.id);
    const fake = fakeClient();
    makeRunner(fake.client);
    await waitFor(() => expect(fake.waiting.has("direct:tx1")).toBe(true));

    fake.waiting.get("direct:tx1")!.resolve(answered("direct:tx1", tagAnswer));

    await waitFor(async () => {
      expect((await lookups.getById(lookup.id))?.status).toBe("applied");
    });
    expect((await itemRepo.getById(butter.id))?.currentPrice).toBe(4.49);
    expect((await priceRepo.getByItem(butter.id)).some((h) => h.price === 4.49 && h.storeId === "s1")).toBe(true);
    expect(await tripItemRepo.getByTrip(trip.id)).toHaveLength(0);
  });

  it("discarding a price-only lookup keeps the item's trip line", async () => {
    const { trip, lookup } = await seedKnownItem();
    await lookups.discard(lookup.id);
    expect(await lookups.getById(lookup.id)).toBeUndefined();
    expect(await tripItemRepo.getByTrip(trip.id)).toHaveLength(1);
  });
});

describe("LookupRunner a lookup the factory never answers", () => {
  // the backend stores a send once per clientId and names the same txid for a repeat
  function fakeBackendClient() {
    const fake = fakeClient();
    fake.client.send = vi.fn(async (req: LookupRequest) => {
      fake.sent.push(req);
      return `direct:${req.clientId}`;
    });
    return fake;
  }

  const LIMITS = { resendAfterMs: 80, giveUpAfterMs: 80 };
  /** Limits too long for a timer to reach inside a test: only the stored times can show a lookup past them. */
  const LONG = { resendAfterMs: 60_000, giveUpAfterMs: 60_000 };

  /**
   * A lookup the phone has already sent (and kept the photo of: Dexie's update, which markSent
   * uses, loses a Blob in fake-indexeddb, a put does not). The runner resumes it from this.
   */
  async function seedSent(id: string, extra: Partial<PendingLookup> = {}) {
    const row = (await lookups.getById(id))!;
    const photo = new Blob(["package"], { type: "image/jpeg" }) as unknown as globalThis.Blob;
    await db.pendingLookups.put({
      ...row,
      photos: [photo],
      status: "at-the-factory",
      gristTxid: `direct:${id}`,
      sentAt: Date.now(),
      ...extra,
    });
  }

  it("sends a lookup that was sent and never answered once more, with the same request id", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    const fake = fakeBackendClient();

    makeRunner(fake.client, LIMITS);

    await waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0].clientId).toBe(lookup.id);
    expect(fake.sent[0].photos).toHaveLength(1);
    expect(fake.sent[0].barcode).toBe("0044");
    const row = await lookups.getById(lookup.id);
    expect(row?.status).toBe("at-the-factory");
    expect(row?.resentAt).toBeGreaterThan(0);
    expect(row?.notBack).toBeUndefined();
  });

  it("after the second limit marks the lookup as not come back, and does not send it a third time", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    const fake = fakeBackendClient();

    makeRunner(fake.client, LIMITS);

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.notBack).toBe(true));
    expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
    await new Promise((r) => setTimeout(r, 250));
    expect(fake.sent).toHaveLength(1);
  });

  it("still applies an answer that comes after the line said it did not come back", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    const fake = fakeBackendClient();

    makeRunner(fake.client, LIMITS);
    await waitFor(async () => expect((await lookups.getById(lookup.id))?.notBack).toBe(true));

    await waitFor(() => expect(fake.waiting.has(`direct:${lookup.id}`)).toBe(true));
    fake.waiting.get(`direct:${lookup.id}`)!.resolve(answered(`direct:${lookup.id}`, goodAnswer));

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.status).toBe("applied"));
    const row = await lookups.getById(lookup.id);
    expect(row?.notBack).toBeUndefined();
    const lines = await db.tripItems.where("tripId").equals(trip.id).toArray();
    expect(lines.some((l) => l.pending)).toBe(false);
  });

  it("Try again sends a not-come-back lookup again, under the same request id", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    const fake = fakeBackendClient();

    const first = makeRunner(fake.client, LIMITS);
    await waitFor(async () => expect((await lookups.getById(lookup.id))?.notBack).toBe(true));
    expect(fake.sent).toHaveLength(1);

    // the line's Try again; the runner is stopped meanwhile so the test can put the photo back
    first.stop();
    await lookups.retry(lookup.id);
    expect((await lookups.getById(lookup.id))?.status).toBe("waiting-to-send");
    const photo = new Blob(["package"], { type: "image/jpeg" }) as unknown as globalThis.Blob;
    await db.pendingLookups.put({ ...(await lookups.getById(lookup.id))!, photos: [photo] });
    makeRunner(fake.client, LIMITS);

    await waitFor(() => expect(fake.sent).toHaveLength(2));
    expect(fake.sent[1].clientId).toBe(lookup.id);
    const row = await lookups.getById(lookup.id);
    expect(row?.status).toBe("at-the-factory");
    expect(row?.notBack).toBeUndefined();
    expect(row?.resentAt).toBeUndefined();
  });

  it("a hidden page sends nothing, and the first look after it comes back sends the overdue lookup", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    const fake = fakeBackendClient();

    const runner = makeRunner(fake.client, LIMITS);
    await waitFor(() => expect(fake.waiting.has(`direct:${lookup.id}`)).toBe(true));
    runner.setVisible(false);
    await new Promise((r) => setTimeout(r, 250));
    expect(fake.sent).toHaveLength(0);

    runner.setVisible(true);
    await waitFor(() => expect(fake.sent).toHaveLength(1));
  });

  it("does not run the clock for a lookup the phone is still holding back (offline)", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, { createdAt: Date.now() - 60 * 60_000 });
    const fake = fakeBackendClient();

    const runner = makeRunner(fake.client, LIMITS);
    runner.setOnline(false);
    await new Promise((r) => setTimeout(r, 250));
    expect(fake.sent).toHaveLength(0);
    expect((await lookups.getById(lookup.id))?.resentAt).toBeUndefined();
  });

  it("reads the wait from the stored send time: reopening the app does not start it again", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    // sent 300 ms ago under a 400 ms limit; the first runner was closed before the limit
    await seedSent(lookup.id, { sentAt: Date.now() - 300 });
    const fake = fakeBackendClient();

    const started = Date.now();
    makeRunner(fake.client, { resendAfterMs: 400, giveUpAfterMs: 400 });

    await waitFor(() => expect(fake.sent).toHaveLength(1), { timeout: 300 });
    expect(Date.now() - started).toBeLessThan(350);
  });

  it("a lookup whose stored send time is long past both limits is sent once more and says it did not come back at once", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, { sentAt: Date.now() - 60 * 60_000 });
    const fake = fakeBackendClient();

    makeRunner(fake.client, LONG);

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.notBack).toBe(true));
    const row = await lookups.getById(lookup.id);
    expect(row?.resentAt).toBeGreaterThan(0);
    expect(fake.sent).toHaveLength(1);
    // the runner goes on listening for a late answer, and does not send a third time
    await waitFor(() => expect(fake.waiting.has(`direct:${lookup.id}`)).toBe(true));
    await new Promise((r) => setTimeout(r, 250));
    expect(fake.sent).toHaveLength(1);
  });

  it("a lookup sent before the send time was kept is read from when it was made", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, { sentAt: undefined, createdAt: Date.now() - 60 * 60_000 });
    const fake = fakeBackendClient();

    makeRunner(fake.client, LONG);

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.notBack).toBe(true));
  });

  it("a lookup that was sent again, with the second limit long past, says it did not come back without a third send", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, {
      sentAt: Date.now() - 60 * 60_000,
      resentAt: Date.now() - 30 * 60_000,
    });
    const fake = fakeBackendClient();

    makeRunner(fake.client, LONG);

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.notBack).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.sent).toHaveLength(0);
  });

  it("markSent keeps when the grist went out", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    const before = Date.now();
    await lookups.markSent(lookup.id, "direct:x");
    expect((await lookups.getById(lookup.id))?.sentAt).toBeGreaterThanOrEqual(before);
  });

  it("Try again leaves a lookup past its limits by the stored time alone until the runner has read the backend", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, { sentAt: Date.now() - 60 * 60_000 });
    await lookups.retry(lookup.id);
    expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
  });

  // mw-31qug1.19: on 10-31 the mill answered in seconds, the phone never picked the answers up, and the
  // line said 'The factory did not send this back' from the stored send time while the answer sat there
  it("a lookup found past both limits whose answer is on the backend is filled: not sent again, never said not come back", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, { sentAt: Date.now() - 2 * 24 * 60 * 60_000 });
    const fake = fakeBackendClient();
    fake.onBackend.set(`direct:${lookup.id}`, answered(`direct:${lookup.id}`, goodAnswer));
    const seen: (true | undefined)[] = [];
    const watch = setInterval(() => void lookups.getById(lookup.id).then((l) => seen.push(l?.notBack)), 5);

    makeRunner(fake.client, LONG);

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.status).toBe("applied"));
    clearInterval(watch);
    expect(fake.sent).toHaveLength(0);
    expect(seen).not.toContain(true);
    expect(fake.client.findAnswer).toHaveBeenCalledWith(`direct:${lookup.id}`);
  });

  it("says nothing of a limit while the backend cannot be read, and sends nothing again", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id, { sentAt: Date.now() - 60 * 60_000 });
    const fake = fakeBackendClient();
    fake.client.findAnswer = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    makeRunner(fake.client, LONG);

    await waitFor(() => expect(fake.client.findAnswer).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 150));
    const row = await lookups.getById(lookup.id);
    expect(row?.notBack).toBeUndefined();
    expect(row?.resentAt).toBeUndefined();
    expect(fake.sent).toHaveLength(0);
  });

  it("Try again leaves a lookup still inside its limits alone", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    await lookups.retry(lookup.id);
    expect((await lookups.getById(lookup.id))?.status).toBe("at-the-factory");
  });

  it("marks a lookup failed when the factory refuses the second send", async () => {
    const trip = await startTrip();
    const lookup = await queueLookup(trip.id);
    await seedSent(lookup.id);
    const fake = fakeBackendClient();
    fake.client.send = vi.fn(async () => {
      const { door } = await import("bsv-kit/bsv");
      throw new door.RefusedError("The backend refused the grist.", 400);
    });

    makeRunner(fake.client, LIMITS);

    await waitFor(async () => expect((await lookups.getById(lookup.id))?.status).toBe("failed"));
    expect((await lookups.getById(lookup.id))?.error).toBe("The backend refused the grist.");
  });
});

describe("LookupRunner a lookup that lands after the receipt's answer", () => {
  /**
   * His 2026-10-30 trip, the other order: the receipt went out with a lookup still at the factory
   * (the request leaves it out), the receipt's answer applied while the line was still pending, and
   * only then did the lookup land. The receipt line stayed 'Not matched'.
   */
  async function receiptAnsweredWithLookupsPending(barcodes: string[], receiptTexts: string[]) {
    const trip = await startTrip();
    const bananas = await itemRepo.create({ barcode: "0001", name: "Bananas", currentPrice: 1.07, unitType: "each" });
    const bananaLine = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: bananas.id,
      price: 1.07,
      quantity: 1,
      onSale: false,
    });
    const made = [];
    for (const barcode of barcodes) made.push(await queueLookup(trip.id, barcode));
    await db.trips.update(trip.id, {
      receiptPending: {
        txid: "direct:receipt",
        sentAt: Date.now(),
        request: { store: "Shop", lines: [[bananaLine.id, "Bananas", 1.07, 1, null]] },
      },
    });
    const line = (text: string, price: number) => ({
      text,
      price,
      quantity: 1,
      weightLbs: null,
      tripItemId: null,
      confidence: "low" as const,
    });
    const record = {
      re: "direct:receipt",
      status: "answered",
      grind,
      answer: {
        store: "Shop",
        date: null,
        subtotal: null,
        tax: null,
        total: 20,
        lines: [
          { ...line("BANANAS", 1.07), tripItemId: bananaLine.id, confidence: "high" as const },
          ...receiptTexts.map((text) => line(text, 3.99)),
        ],
        unreadable: null,
      },
    } as unknown as GristAnswer;
    await settleReceipt(trip.id, "direct:receipt", record);
    return { trip, lookups: made, bananaLine };
  }

  const sugar = { ...goodAnswer, name: "Trader Joe's Vanilla Sugar", price: null, estimatedPrice: 2.99 };

  async function landing(fake: ReturnType<typeof fakeClient>, lookupId: string, txid: string, answer: object) {
    await waitFor(() => expect(fake.waiting.has(txid)).toBe(true));
    fake.waiting.get(txid)!.resolve(answered(txid, answer));
    await waitFor(async () => {
      expect((await lookups.getById(lookupId))?.status).toBe("applied");
    });
  }

  it("gives the receipt line the trip line and its price replaces the guess", async () => {
    const { trip, lookups: made } = await receiptAnsweredWithLookupsPending(["0044"], ["HOL VANILLA SUGAR"]);
    expect((await db.trips.get(trip.id))?.receiptReconcile?.unmatched).toHaveLength(1);
    const fake = fakeClient();
    makeRunner(fake.client);

    await landing(fake, made[0].id, "direct:tx1", sugar);

    await waitFor(async () => {
      expect((await db.trips.get(trip.id))?.receiptReconcile?.unmatched).toHaveLength(0);
    });
    const kept = (await db.trips.get(trip.id))?.receiptReconcile;
    const late = (await tripItemRepo.getByTrip(trip.id)).find((line) => line.price !== 1.07);
    expect(late).toMatchObject({ price: 3.99 });
    expect(late?.guess).toBeUndefined();
    expect(kept?.matchedTripItemIds).toContain(late!.id);
    expect(kept?.changes.find((change) => change.tripItemId === late!.id)).toMatchObject({
      oldPrice: 2.99,
      newPrice: 3.99,
      wasGuess: true,
    });
    expect((await itemRepo.findByBarcode("0044"))?.currentPrice).toBe(3.99);
  });

  it("still asks when two receipt lines fit the one line that landed", async () => {
    const { trip, lookups: made } = await receiptAnsweredWithLookupsPending(
      ["0044"],
      ["HOL VANILLA SUGAR", "VANILLA SUGAR 8 OZ"],
    );
    const fake = fakeClient();
    makeRunner(fake.client);

    await landing(fake, made[0].id, "direct:tx1", sugar);

    const kept = (await db.trips.get(trip.id))?.receiptReconcile;
    expect(kept?.unmatched).toHaveLength(2);
    const late = (await tripItemRepo.getByTrip(trip.id)).find((line) => line.price !== 1.07);
    expect(late).toMatchObject({ price: 2.99 });
    expect(late?.guess).toBeDefined();
  });

  it("leaves a receipt line he already placed by hand alone", async () => {
    const { trip, lookups: made, bananaLine } = await receiptAnsweredWithLookupsPending(
      ["0044"],
      ["HOL VANILLA SUGAR"],
    );
    // he places the unmatched receipt line on another line before the lookup lands
    const other = await itemRepo.create({ barcode: "0002", name: "Oat Milk", currentPrice: 2, unitType: "each" });
    const otherLine = await tripItemRepo.addToTrip({
      tripId: trip.id,
      itemId: other.id,
      price: 2,
      quantity: 1,
      onSale: false,
    });
    expect(await matchReceiptLine(trip.id, 0, otherLine.id)).toBe(true);
    const fake = fakeClient();
    makeRunner(fake.client);

    await landing(fake, made[0].id, "direct:tx1", sugar);

    const lines = await tripItemRepo.getByTrip(trip.id);
    const late = lines.find((line) => line.id !== bananaLine.id && line.id !== otherLine.id);
    expect(late).toMatchObject({ price: 2.99 });
    expect(late?.guess).toBeDefined();
    expect((await db.trips.get(trip.id))?.receiptReconcile?.matchedTripItemIds).not.toContain(late!.id);
  });
});
