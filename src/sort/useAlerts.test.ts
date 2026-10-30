import { act, renderHook, waitFor } from "@testing-library/react";
import { makeAlertsClient, type AlertsClient } from "@/family/alerts-client";
import { cardBook } from "@/family/cards";
import { fakeAlerts, type FakeAlerts } from "@/family/fake-alerts";
import type { FamilyCard } from "@/contracts/types";
import { KEPT_FEED_KEY, PENDING_CLAIMS_KEY, useAlerts } from "./useAlerts";
import { waitingCharges } from "./waiting";

const BACKEND = "https://backend.example.test";
// two phones of one family: two keys on one licence, one backend
const hisKey = new Uint8Array(32).fill(7);
const herKey = new Uint8Array(32).fill(9);

const card = (lastFour: string, owner: string): FamilyCard => ({ id: lastFour, lastFour, owner, createdAt: 0 });
const book = cardBook([card("1234", "Jonathan"), card("5678", "Sarah"), card("9876", "shared")]);

let backend: FakeAlerts;
let his: AlertsClient;
let hers: AlertsClient;

beforeEach(() => {
  localStorage.clear();
  backend = fakeAlerts();
  his = makeAlertsClient(BACKEND, hisKey, backend.fetch);
  hers = makeAlertsClient(BACKEND, herKey, backend.fetch);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAlerts: the family's feed on two phones", () => {
  it("a shared card's charge shows on both as theirs; the first Done claims it and the other phone drops it on its next poll", async () => {
    backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "9876", when: "2026-10-30T18:14:00Z" });
    const gone = vi.fn();
    const phoneA = renderHook(() => useAlerts(his, { pollMs: 60_000 }));
    const phoneB = renderHook(() => useAlerts(hers, { pollMs: 60_000, onGone: gone }));
    await waitFor(() => expect(phoneA.result.current.phase).toBe("ready"));
    await waitFor(() => expect(phoneB.result.current.phase).toBe("ready"));

    const onHis = waitingCharges(phoneA.result.current.alerts ?? [], book, "Jonathan", new Set());
    const onHers = waitingCharges(phoneB.result.current.alerts ?? [], book, "Sarah", new Set());
    expect(onHis.map((c) => [c.merchant, c.mine])).toEqual([["Trader Joe's", true]]);
    expect(onHers.map((c) => [c.merchant, c.mine])).toEqual([["Trader Joe's", true]]);
    const id = onHis[0]!.alert.id;

    // his Done claims it: gone from his list at once, and from the backend
    await act(() => phoneA.result.current.claim(id));
    expect(phoneA.result.current.alerts).toEqual([]);
    expect(backend.requests.some((r) => r.method === "DELETE" && r.path === `/api/alerts/${id}`)).toBe(true);
    expect(backend.feed).toEqual([]);

    // her phone still shows it until its next poll; that poll drops it and says it was claimed elsewhere
    expect(phoneB.result.current.alerts?.map((a) => a.id)).toEqual([id]);
    act(() => phoneB.result.current.refresh());
    await waitFor(() => expect(phoneB.result.current.alerts).toEqual([]));
    expect(gone).toHaveBeenCalledWith([expect.objectContaining({ id, merchant: "Trader Joe's" })]);
  });

  it("his card's charge is his first on his phone and hers after hers on her phone", async () => {
    backend.receive({ kind: "charge", amount: "12.00", merchant: "Shell", last4: "5678" });
    backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    backend.receive({ kind: "forward-confirm", code: "493827" });
    const { result } = renderHook(() => useAlerts(his, { pollMs: 60_000 }));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const alerts = result.current.alerts ?? [];
    expect(waitingCharges(alerts, book, "Jonathan", new Set()).map((c) => [c.merchant, c.mine])).toEqual([
      ["Trader Joe's", true],
      ["Shell", false],
    ]);
    expect(waitingCharges(alerts, book, "Sarah", new Set()).map((c) => [c.merchant, c.mine])).toEqual([
      ["Shell", true],
      ["Trader Joe's", false],
    ]);
    // handed to her: on his phone it leaves his own part
    const handed = new Set([alerts.find((a) => a.merchant === "Trader Joe's")!.id]);
    expect(waitingCharges(alerts, book, "Jonathan", handed).map((c) => [c.merchant, c.mine, c.handed])).toEqual([
      ["Trader Joe's", false, true],
      ["Shell", false, false],
    ]);
  });

  it("polls on its own, and keeps the last list for a start without the network", async () => {
    const { result, unmount } = renderHook(() => useAlerts(his, { pollMs: 100 }));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.alerts).toEqual([]);
    backend.receive({ kind: "charge", amount: "5.00", merchant: "Dunkin'", last4: "1234" });
    await waitFor(() => expect(result.current.alerts?.map((a) => a.merchant)).toEqual(["Dunkin'"]));
    unmount();
    expect(JSON.parse(localStorage.getItem(KEPT_FEED_KEY) ?? "[]")).toHaveLength(1);

    // the backend cannot be reached: the kept list shows, with the reason and nothing lost
    backend.refuse = { status: 503 };
    const offline = renderHook(() => useAlerts(his, { pollMs: 60_000 }));
    expect(offline.result.current.alerts?.map((a) => a.merchant)).toEqual(["Dunkin'"]);
    await waitFor(() => expect(offline.result.current.phase).toBe("failed"));
    expect(offline.result.current.error).toBe("The backend could not answer (503).");
    expect(offline.result.current.alerts?.map((a) => a.merchant)).toEqual(["Dunkin'"]);
  });

  it("a claim the backend did not take is kept and sent again before the next read", async () => {
    const alert = backend.receive({ kind: "charge", amount: "5.00", merchant: "Dunkin'", last4: "1234" });
    const { result } = renderHook(() => useAlerts(his, { pollMs: 60_000 }));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    backend.refuse = { status: 503 };
    await act(() => result.current.claim(alert.id));
    expect(result.current.alerts).toEqual([]);
    expect(JSON.parse(localStorage.getItem(PENDING_CLAIMS_KEY) ?? "[]")).toEqual([alert.id]);

    backend.refuse = null;
    act(() => result.current.refresh());
    await waitFor(() => expect(localStorage.getItem(PENDING_CLAIMS_KEY)).toBeNull());
    expect(backend.feed).toEqual([]);
    expect(result.current.alerts).toEqual([]);
  });

  it("a read that outruns its deadline gives up with the reason, and Try again reads again", async () => {
    let answer = false;
    const slow: AlertsClient = {
      ...his,
      list: (since) => (answer ? his.list(since) : new Promise(() => {})),
    };
    const { result } = renderHook(() => useAlerts(slow, { pollMs: 60_000, timing: { slowAfterMs: 400, tryAgainAfterMs: 1_000, timeoutMs: 1_400 } }));
    await waitFor(() => expect(result.current.phase).toBe("slow"));
    await waitFor(() => expect(result.current.phase).toBe("retryable"), { timeout: 2_000 });
    await waitFor(() => expect(result.current.phase).toBe("failed"), { timeout: 2_000 });
    expect(result.current.error).toBe("The backend did not answer in 1 second.");
    answer = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });
});
