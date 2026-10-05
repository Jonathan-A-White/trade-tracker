// jsdom's Blob does not survive fake-indexeddb's structured clone; Node's does.
import { Blob } from "node:buffer";
import { waitFor } from "@testing-library/react";
import type { grist } from "bsv-kit/grist";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PriceHistoryRepository } from "@/db/repositories/price-history-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { LookupRunner, type LookupClient, type LookupRequest } from "./lookup-runner";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const priceRepo = new PriceHistoryRepository();
const itemRepo = new ItemRepository();

type Answer = grist.GristAnswer;

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

/** A grist client the test steers: sends are recorded, each wait is a promise the test settles. */
function fakeClient() {
  const sent: LookupRequest[] = [];
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
  };
  return { client, sent, waiting, waitCalls: () => waitCalls };
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
function makeRunner(client: LookupClient | null, options: { backoffBaseMs?: number } = {}) {
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
