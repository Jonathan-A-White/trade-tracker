// mw-31qug1.19: the mill answered three lookups in seconds on 10-31 and the phone never picked the answers up.
// The wait read the key's whole history from the start of the backend's index (since=0) each time it began: every
// record to or from the key came down, and every older answer was opened, before its own could be seen. His
// history had grown to 288 records (1.45 MB), so one read was slow, nine lookups made nine of them at once, and
// closing the app threw them away. The fake below is a backend whose reads take time in proportion to what they
// carry (a slow link), so a read of the whole history outlasts the door's 30 s limit, as his did.
import { fakePostern } from "bsv-kit/testing";
import { openMill } from "./mill";
import type { GristAnswer } from "./mill";

/** What one record costs to bring down and open on the phone, in this fake. */
const MS_PER_RECORD = 200;
/** How many answers to earlier lookups the key's history holds before the one waited for. */
const OLDER_ANSWERS = 200;
const GRIST = `direct:${"f".repeat(64)}`;
const grind = { app: "trade-tracker", kind: "item-from-photos", v: "1.0" };

/** Waits `ms` as a slow link would, and fails as a real fetch does when the call is aborted. */
function slowLink(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

interface Row {
  seq: number;
  txid: string;
}

/** A fake Postern holding the key's history, then the grist, then its answer; and the paths the phone asked for. */
function historyBackend() {
  const fake = fakePostern();
  // one sealed answer to an earlier grist, standing in for each of the older ones (opening it is the cost)
  const older = fake.reply({ re: `direct:${"0".repeat(64)}`, status: "answered", answer: {}, grind });
  fake.records.length = 0;
  for (let seq = 1; seq <= OLDER_ANSWERS; seq++) {
    fake.records.push({ ...older, seq, txid: `direct:${String(seq).padStart(64, "0")}` });
  }
  const gristSeq = OLDER_ANSWERS + 1;
  // the grist itself, from the app to the mill
  fake.records.push({ ...older, seq: gristSeq, txid: GRIST, from: older.to, to: older.from });
  fake.reply({ re: GRIST, status: "answered", answer: { name: "Fruit Sauce Crushers" }, grind });
  const paths: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input).replace(fake.base, "").replace(/^\/api/, "");
    paths.push(path);
    const byTxid = /^\/messages\?txid=(.+)$/.exec(path);
    if (byTxid) {
      const txid = decodeURIComponent(byTxid[1]);
      const records: Row[] = fake.records.filter((r) => r.txid === txid).map((r) => ({ seq: r.seq, txid: r.txid }));
      await slowLink(MS_PER_RECORD, init?.signal);
      return new Response(JSON.stringify({ records, next: fake.records.length, more: false }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const response = await fake.fetch(input, init);
    if (path.startsWith("/messages?since=")) {
      const since = Number(path.split("=")[1]);
      const carried = fake.records.filter((r) => r.seq > since).length;
      await slowLink(carried * MS_PER_RECORD, init?.signal);
    }
    return response;
  };
  return { fake, fetch, paths, gristSeq };
}

/**
 * The phone open for `ms`: the wait runs, and after a failure the runner tries again 5 s later, until the app is
 * closed (the wait aborted). The answer, or null when it was not picked up while the app was open.
 */
async function openFor(mill: ReturnType<typeof openMill>, ms: number): Promise<GristAnswer | null> {
  const controller = new AbortController();
  let found: GristAnswer | null = null;
  const closes = Date.now() + ms;
  const loop = (async () => {
    while (!found && !controller.signal.aborted) {
      try {
        found = await mill.awaitAnswer(GRIST, controller.signal);
      } catch {
        if (controller.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  })();
  while (!found && Date.now() < closes) await vi.advanceTimersByTimeAsync(1_000);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  await loop;
  return found;
}

describe("picking up an answer the mill has already sent (mw-31qug1.19)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("finds it on the next open, though the key's history is long and the link is slow", async () => {
    const backend = historyBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const mill = openMill(backend.fake.base, backend.fake.appKey, () => "licensed");

    // he opens the app for a minute, twice
    const first = await openFor(mill, 60_000);
    const second = first ?? (await openFor(mill, 60_000));

    expect(second?.re).toBe(GRIST);
    expect(second?.status).toBe("answered");
  }, 60_000);

  it("reads from the grist's own place in the index, never from the start of the key's history", async () => {
    const backend = historyBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const mill = openMill(backend.fake.base, backend.fake.appKey, () => "licensed");

    await openFor(mill, 60_000);

    const reads = backend.paths.filter((p) => p.startsWith("/messages?since="));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads).not.toContain("/messages?since=0");
    expect(reads[0]).toBe(`/messages?since=${backend.gristSeq}`);
  }, 60_000);
});
