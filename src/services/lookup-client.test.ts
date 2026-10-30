import { vault } from "bsv-kit/bsv";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { buildReceiptRequest, reconcileReceipt } from "./receipt-reconcile";
import { currentReceiptClient, makeLookupClient } from "./lookup-client";

describe("currentReceiptClient", () => {
  it("is null until the lookup queue has been given a key, then signs with that key", () => {
    expect(currentReceiptClient()).toBeNull();
    makeLookupClient("https://example.test", new Uint8Array(32).fill(1), () => "licensed");
    const client = currentReceiptClient();
    expect(client).not.toBeNull();
    expect(typeof client?.send).toBe("function");
    expect(typeof client?.awaitAnswer).toBe("function");
  });
});

const TJ_NAMES = [
  "Trader Joe's Organic Pomegranate Juice",
  "Mandarin Orange Chicken",
  "Unexpected Cheddar Cheese Slices",
  "Everything But The Bagel Seasoning",
  "Organic Baby Spinach Triple Washed",
  "Joe's Os Cereal Family Size Box",
  "Cauliflower Gnocchi Frozen Family",
  "Greek Style Nonfat Plain Yogurt Qt",
];

/**
 * A Trader Joe's trip of `count` lines, names up to 40 characters, UUID line ids. Seeding is CPU work
 * (about 9 to 12 s for 300 lines at host load 9 to 14), not a clock: these tests take the shared test
 * timeout from the preset (40 s) rather than a hand-set 20 s under it, and none is a timing test.
 */
async function seedTrip(count: number) {
  await Promise.all(db.tables.map((table) => table.clear()));
  const now = Date.now();
  await db.stores.put({ id: "s1", name: "Trader Joe's", createdAt: now, updatedAt: now });
  const trip = await new TripRepository().create({ storeId: "s1", startedAt: now });
  for (let i = 0; i < count; i++) {
    const item = await new ItemRepository().create({
      barcode: `0000${String(i).padStart(8, "0")}`,
      name: `${TJ_NAMES[i % TJ_NAMES.length]}`.slice(0, 40),
      currentPrice: 3.49 + i,
      unitType: i % 9 === 0 ? "per_lb" : "each",
    });
    await new TripItemRepository().addToTrip({
      tripId: trip.id,
      itemId: item.id,
      price: 3.49 + i,
      quantity: 1 + (i % 3),
      weightLbs: i % 9 === 0 ? 1.12 : undefined,
      onSale: i % 4 === 0,
      bottleDeposit: i % 5 === 0 ? 0.05 : undefined,
    });
  }
  return trip;
}

/** The backend as bsv-kit's door sees it: the paths a sendGrist touches, answered; records the posts. */
function stubBackend() {
  const millKey = vault.publicKeyHexFromKey(new Uint8Array(32).fill(7));
  const posted: string[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path.endsWith("/challenge")) return json({ nonce: "ab".repeat(16) });
    if (path.endsWith("/me")) return json({ mill: millKey });
    if (path.endsWith("/blobs")) return json({ hash: "c".repeat(64), size: 123 });
    if (path.endsWith("/messages")) {
      posted.push(String(init?.body));
      return json({ txid: "direct:tx1", seq: 1 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchStub);
  return { posted };
}

describe("the receipt-reconcile grist for a real-sized trip (mw-31qug1.7)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is accepted by bsv-kit's send for a trip of 40 lines with long Trader Joe's names", async () => {
    const trip = await seedTrip(40);
    const { posted } = stubBackend();
    makeLookupClient("https://example.test", new Uint8Array(32).fill(1), () => "licensed");
    const request = await buildReceiptRequest(trip.id);
    expect(request.lines).toHaveLength(40);

    const txid = await currentReceiptClient()!.send({
      input: request,
      photos: [{ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }],
      clientId: "client-1",
    });

    expect(txid).toBe("direct:tx1");
    expect(posted).toHaveLength(1);
  });

  it("says plainly how many lines a trip too large to send can take, never the byte count", async () => {
    const trip = await seedTrip(300);
    const { posted } = stubBackend();
    makeLookupClient("https://example.test", new Uint8Array(32).fill(1), () => "licensed");
    const request = await buildReceiptRequest(trip.id);

    const outcome = await reconcileReceipt(
      currentReceiptClient()!,
      request,
      [{ bytes: new Uint8Array([1]), mime: "image/jpeg" }],
    );

    expect(outcome.ok).toBe(false);
    const error = !outcome.ok ? outcome.error : "";
    expect(error).toMatch(/300 lines/);
    expect(error).toMatch(/can check \d+ lines/);
    expect(error).not.toMatch(/bytes|cap|payload|too large/i);
    expect(posted).toEqual([]);
  });

  it("measures a 40-line trip and one receipt photo under bsv-kit's 20480-byte cap (mw-31qug1.8)", async () => {
    const trip = await seedTrip(40);
    makeLookupClient("https://example.test", new Uint8Array(32).fill(1), () => "licensed");
    const request = await buildReceiptRequest(trip.id);

    const { bytes, cap } = currentReceiptClient()!.measure!(request, 1);

    expect(cap).toBe(20480);
    expect(bytes).toBeLessThan(20480);
  });

  it("sends an 80-line trip that the old 10240-byte cap refused (mw-31qug1.8)", async () => {
    const trip = await seedTrip(80);
    const { posted } = stubBackend();
    makeLookupClient("https://example.test", new Uint8Array(32).fill(1), () => "licensed");
    const request = await buildReceiptRequest(trip.id);
    const client = currentReceiptClient()!;
    const measured = client.measure!(request, 1);
    expect(measured.bytes).toBeGreaterThan(10240);
    expect(measured.bytes).toBeLessThan(20480);

    const txid = await client.send({
      input: request,
      photos: [{ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }],
      clientId: "client-2",
    });

    expect(txid).toBe("direct:tx1");
    expect(posted).toHaveLength(1);
  });
});
