import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { YnabOutboxRepository } from "@/db/repositories/ynab-outbox-repository";
import type { YnabTransactionInput } from "@/contracts/types";
import type { OutboxPage, OutboxStatus } from "pwa-kit/outbox";
import { createYnabClient } from "./api";
import { accountOf, fakeYnab, groupOf, payeeOf, type FakeYnab } from "./fake-ynab";
import { YNAB_BUSY_KEY, busyLine, createYnabWriter, type YnabWriter } from "./writer";

const budget = {
  id: "b1",
  name: "Our Budget",
  categoryGroups: [groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Household"]])],
  accounts: [accountOf("a1", "Checking")],
  payees: [payeeOf("p1", "Trader Joe's")],
};

const entry: YnabTransactionInput = {
  accountId: "a1",
  date: "2026-10-30",
  amount: 42.37,
  payeeName: "Trader Joe's",
  categoryId: "c1",
  memo: "Weekly shop",
};

/** A page the test takes offline and online by hand. */
function makePage() {
  const wakes = new Set<() => void>();
  const page: OutboxPage & { online: boolean; set(online: boolean): void } = {
    online: true,
    isOnline: () => page.online,
    isVisible: () => true,
    subscribe: (wake: () => void) => {
      wakes.add(wake);
      return () => wakes.delete(wake);
    },
    set(online: boolean) {
      page.online = online;
      for (const wake of wakes) wake();
    },
  };
  return page;
}

let ynab: FakeYnab;
let page: ReturnType<typeof makePage>;
let writer: YnabWriter;
let stop: () => void;
let statuses: OutboxStatus[];

async function setup(options: { timeoutMs?: number; callTimeoutMs?: number } = {}) {
  ynab = fakeYnab("good", [budget]);
  page = makePage();
  statuses = [];
  await new YnabRepository().saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  const client = createYnabClient("good", ynab.fetch, { timeoutMs: options.callTimeoutMs });
  writer = createYnabWriter({
    getClient: async () => client,
    page,
    timeoutMs: options.timeoutMs,
    onStatus: (s) => statuses.push(s),
  });
  stop = writer.start();
}

const posts = () => ynab.requests.filter((r) => r.method === "POST");
const lastStatus = () => statuses.at(-1);

beforeEach(async () => {
  // the db singleton outlives the per-test IDBFactory, so start each test empty
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.removeItem(YNAB_BUSY_KEY);
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe("the YNAB writer: create", () => {
  it("sends an entered transaction in milliunits, outflow negative, with no import_id and the marker in the memo's tail", async () => {
    await setup();
    const localId = await writer.create(entry);
    await writer.settled();

    expect(posts()).toHaveLength(1);
    const sent = (posts()[0]?.body as { transaction: Record<string, unknown> }).transaction;
    expect(sent).toMatchObject({
      account_id: "a1",
      date: "2026-10-30",
      amount: -42370,
      payee_name: "Trader Joe's",
      category_id: "c1",
      memo: `Weekly shop TT:${localId}`,
      cleared: "uncleared",
      approved: true,
    });
    expect(sent).not.toHaveProperty("import_id");
    expect(ynab.transactions).toHaveLength(1);
  });

  it("sends a split as subtransactions that sum to the amount, with no category on the parent", async () => {
    await setup();
    await writer.create({
      ...entry,
      amount: 42.37,
      categoryId: undefined,
      splits: [
        { categoryId: "c1", amount: 30.1 },
        { categoryId: "c2", amount: 12.27, memo: "soap" },
      ],
    });
    await writer.settled();

    const sent = (posts()[0]?.body as { transaction: Record<string, unknown> & { subtransactions: { amount: number; category_id: string }[] } }).transaction;
    expect(sent.amount).toBe(-42370);
    expect(sent.category_id ?? null).toBeNull();
    expect(sent.subtransactions.map((s) => s.category_id)).toEqual(["c1", "c2"]);
    expect(sent.subtransactions.reduce((sum, s) => sum + s.amount, 0)).toBe(-42370);
    expect(sent.subtransactions.map((s) => s.amount)).toEqual([-30100, -12270]);
  });

  it("keeps the marker whole when the memo is long", async () => {
    await setup();
    const localId = await writer.create({ ...entry, memo: "x".repeat(300) });
    await writer.settled();
    const memo = (posts()[0]?.body as { transaction: { memo: string } }).transaction.memo;
    expect(memo.length).toBeLessThanOrEqual(200);
    expect(memo.endsWith(` TT:${localId}`)).toBe(true);
  });

  it("makes the marker the whole memo when there is none", async () => {
    await setup();
    const localId = await writer.create({ ...entry, memo: undefined });
    await writer.settled();
    expect((posts()[0]?.body as { transaction: { memo: string } }).transaction.memo).toBe(`TT:${localId}`);
  });

  it("refuses for good a split that does not add up to the amount", async () => {
    await setup();
    await writer.create({ ...entry, amount: 10, splits: [{ categoryId: "c1", amount: 4 }, { categoryId: "c2", amount: 3 }] });
    await writer.settled();
    expect(posts()).toHaveLength(0);
    expect(lastStatus()?.state).toBe("failed");
    expect(lastStatus()?.line).toContain("add up");
  });
});

describe("the YNAB writer: update and delete", () => {
  it("updates and deletes by the YNAB id the create's answer gave", async () => {
    await setup();
    const localId = await writer.create(entry);
    await writer.settled();
    const ynabId = ynab.transactions[0]!.id;

    await writer.update(localId, { ...entry, amount: 40, memo: "Corrected" });
    await writer.settled();
    const put = ynab.requests.find((r) => r.method === "PUT");
    expect(put?.path).toBe(`/v1/budgets/b1/transactions/${ynabId}`);
    expect((put?.body as { transaction: { amount: number; memo: string } }).transaction).toMatchObject({
      amount: -40000,
      memo: `Corrected TT:${localId}`,
    });
    expect(ynab.transactions[0]?.amount).toBe(-40000);

    await writer.remove(localId);
    await writer.settled();
    expect(ynab.requests.find((r) => r.method === "DELETE")?.path).toBe(`/v1/budgets/b1/transactions/${ynabId}`);
    expect(ynab.transactions).toEqual([]);
    expect(posts()).toHaveLength(1);
  });

  it("queued behind a create that has not gone yet, an update goes after it, to the new id", async () => {
    await setup();
    page.set(false);
    const localId = await writer.create(entry);
    await writer.update(localId, { ...entry, amount: 10 });
    await writer.remove(localId);
    expect(ynab.requests).toEqual([]);

    page.set(true);
    await writer.settled();
    expect(ynab.requests.map((r) => r.method)).toEqual(["POST", "PUT", "DELETE"]);
    expect(ynab.transactions).toEqual([]);
  });

  it("treats a delete of a transaction YNAB no longer has as done", async () => {
    await setup();
    const localId = await writer.create(entry);
    await writer.settled();
    ynab.transactions.length = 0;
    await writer.remove(localId);
    await writer.settled();
    expect(lastStatus()?.state).not.toBe("failed");
    expect(await new YnabOutboxRepository().pendingCount()).toBe(0);
  });

  it("refuses for good an update of a transaction that was never created", async () => {
    await setup();
    await writer.update("never-made", entry);
    await writer.settled();
    expect(ynab.requests).toEqual([]);
    expect(lastStatus()?.state).toBe("failed");
    expect(lastStatus()?.line).toContain("never reached YNAB");
  });
});

describe("the YNAB writer: a create whose answer is lost", () => {
  it("is found by its memo marker on retry and not created twice", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await setup();
    ynab.loseNextResponse = true;
    const localId = await writer.create(entry);
    await writer.settled();

    // the transaction landed, but the writer never heard
    expect(ynab.transactions).toHaveLength(1);
    expect(lastStatus()?.state).toBe("waiting");

    await vi.advanceTimersByTimeAsync(2_000);
    await writer.settled();

    expect(ynab.transactions).toHaveLength(1);
    expect(posts()).toHaveLength(1);
    const lookup = ynab.requests.find((r) => r.method === "GET");
    expect(lookup?.path).toBe("/v1/budgets/b1/transactions?since_date=2026-10-30");
    expect(await new YnabOutboxRepository().ynabIdOf(localId)).toBe(ynab.transactions[0]!.id);
    expect(lastStatus()?.state).toBe("sent");
  });

  it("is found after a page closed in the middle of the send, too", async () => {
    await setup();
    const repo = new YnabOutboxRepository();
    const localId = "closed-mid-send";
    // what the first page left behind: the create posted (and landed), the answer never seen
    await repo.markStarted(localId);
    ynab.transactions.push({
      id: "landed",
      account_id: "a1",
      date: "2026-10-30",
      amount: -42370,
      memo: `Weekly shop TT:${localId}`,
    });
    await writer.create(entry, { localId });
    await writer.settled();
    expect(posts()).toHaveLength(0);
    expect(ynab.transactions).toHaveLength(1);
    expect(await repo.ynabIdOf(localId)).toBe("landed");
  });

  it("posts when the recheck finds nothing (the first try never landed)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await setup();
    const real = ynab.fetch;
    let failedOnce = false;
    const flaky = createYnabClient("good", async (input, init) => {
      if (!failedOnce && init?.method === "POST") {
        failedOnce = true;
        throw new TypeError("network down");
      }
      return real(input, init);
    });
    stop();
    writer = createYnabWriter({ getClient: async () => flaky, page });
    stop = writer.start();

    await writer.create(entry);
    await writer.settled();
    expect(ynab.transactions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await writer.settled();
    expect(ynab.transactions).toHaveLength(1);
  });

  it("does not adopt a transaction with the same amount but another marker", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await setup();
    ynab.transactions.push({ id: "other", account_id: "a1", date: "2026-10-30", amount: -42370, memo: "Weekly shop TT:someone-else" });
    ynab.loseNextResponse = true;
    await writer.create(entry);
    await writer.settled();
    await vi.advanceTimersByTimeAsync(2_000);
    await writer.settled();
    expect(ynab.transactions.map((t) => t.id)).toContain("other");
    expect(ynab.transactions).toHaveLength(2);
    expect(posts()).toHaveLength(1);
  });
});

describe("the YNAB writer: the rate limit", () => {
  it("holds the queue on a 429 with the time it will wait until, and goes on when it is over", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 9, 30, 14, 0, 0));
    await setup();
    ynab.rateLimited = { retryAfterSeconds: 600 };
    const localId = await writer.create(entry);
    await writer.update(localId, { ...entry, amount: 10 });
    await writer.settled();

    const until = new Date(2026, 9, 30, 14, 10, 0);
    expect(lastStatus()?.line).toBe(`YNAB is busy, waiting until ${busyLine(until.getTime()).replace("YNAB is busy, waiting until ", "")}`);
    expect(lastStatus()?.line).toMatch(/^YNAB is busy, waiting until /);
    expect(lastStatus()?.state).toBe("waiting");
    expect(ynab.transactions).toEqual([]);

    // while it waits, nothing is asked of YNAB again
    const callsWhileBusy = ynab.requests.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await writer.settled();
    expect(ynab.requests.length).toBe(callsWhileBusy);

    // the hour's reset is past: the queue resumes without anyone tapping
    ynab.rateLimited = null;
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    await writer.settled();
    expect(ynab.requests.map((r) => r.method).slice(callsWhileBusy)).toEqual(["POST", "PUT"]);
    expect(ynab.transactions).toHaveLength(1);
    expect(ynab.transactions[0]?.amount).toBe(-10000);
    expect(localStorage.getItem(YNAB_BUSY_KEY)).toBeNull();
  });

  it("waits an hour when YNAB names no time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 9, 30, 14, 0, 0));
    await setup();
    ynab.rateLimited = {};
    await writer.create(entry);
    await writer.settled();
    expect(Number(localStorage.getItem(YNAB_BUSY_KEY))).toBe(new Date(2026, 9, 30, 15, 0, 0).getTime());
    expect(lastStatus()?.line).toBe(busyLine(new Date(2026, 9, 30, 15, 0, 0).getTime()));
  });

  it("remembers the wait across a restart of the page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 9, 30, 14, 0, 0));
    await setup();
    ynab.rateLimited = { retryAfterSeconds: 600 };
    await writer.create(entry);
    await writer.settled();
    stop();

    ynab.rateLimited = null;
    const before = ynab.requests.length;
    const again = createYnabWriter({ getClient: async () => createYnabClient("good", ynab.fetch), page });
    stop = again.start();
    await again.settled();
    expect(ynab.requests.length).toBe(before);

    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    await again.settled();
    expect(ynab.transactions).toHaveLength(1);
  });
});

describe("the YNAB writer: offline and time limits", () => {
  it("waits for the network offline, and sends when it is back", async () => {
    await setup();
    page.set(false);
    await writer.create(entry);
    await writer.settled();

    expect(ynab.requests).toEqual([]);
    expect(lastStatus()?.state).toBe("waiting");
    expect(lastStatus()?.line).toBe("Waiting for the network");

    page.set(true);
    await writer.settled();
    expect(ynab.transactions).toHaveLength(1);
    expect(lastStatus()?.line).toBe("Sent");
  });

  it("gives up on a call YNAB does not answer, says why, and tries again later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    ynab = fakeYnab("good", [budget]);
    page = makePage();
    statuses = [];
    await new YnabRepository().saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    const hangs: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const client = createYnabClient("good", hangs, { timeoutMs: 1_000 });
    writer = createYnabWriter({ getClient: async () => client, page, onStatus: (s) => statuses.push(s) });
    stop = writer.start();

    await writer.create(entry);
    await vi.waitFor(() => expect(lastStatus()?.state).toBe("sending"));
    await vi.advanceTimersByTimeAsync(1_500);
    await writer.settled();
    expect(lastStatus()?.state).toBe("waiting");
    expect(lastStatus()?.line).toMatch(/^Will try again: Could not reach YNAB/);
  });

  it("waits when the key is locked and the token cannot be opened", async () => {
    await setup();
    stop();
    writer = createYnabWriter({ getClient: async () => null, page, onStatus: (s) => statuses.push(s) });
    stop = writer.start();
    await writer.create(entry);
    await writer.settled();
    expect(lastStatus()?.state).toBe("waiting");
    expect(lastStatus()?.line).toContain("key");
  });
});
