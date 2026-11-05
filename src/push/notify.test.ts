import { act, renderHook, waitFor } from "@testing-library/react";
import { db } from "@/db/database";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { useCardListSync, useNotify } from "@/push/notify";
import { writeMe } from "@/sort/waiting";

vi.mock("@/factory", () => {
  const key = new Uint8Array(32).fill(7);
  const factory = { door: "licensed", getKey: () => key, backendUrl: "https://backend.test", publicKeyHex: "02ab" };
  return { useFactory: () => factory };
});

function stubPhone(permission: string, standalone: boolean) {
  const fake = { permission };
  vi.stubGlobal("Notification", fake);
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
  });
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  localStorage.clear();
});

describe("the blocked-notifications words", () => {
  it("name the phone's App info route when the app runs installed", async () => {
    stubPhone("denied", true);
    const { result } = renderHook(() => useNotify(true));
    await waitFor(() => expect(result.current.status?.state).toBe("denied"));
    const line = result.current.status?.line ?? "";
    expect(line).toMatch(/TradeTracker/);
    expect(line).toMatch(/App info/);
    expect(line).toMatch(/Notifications/);
    expect(line).not.toMatch(/Chrome/);
  });

  it("name Chrome's site settings when the app runs in a tab", async () => {
    stubPhone("denied", false);
    const { result } = renderHook(() => useNotify(true));
    await waitFor(() => expect(result.current.status?.state).toBe("denied"));
    const line = result.current.status?.line ?? "";
    expect(line).toMatch(/Chrome/);
    expect(line).toMatch(/Site settings/);
    expect(line).toMatch(/Notifications/);
    expect(line).not.toMatch(/App info/);
  });
});

describe("coming back to the app", () => {
  it("reads the permission again when the page becomes visible", async () => {
    const fake = stubPhone("denied", true);
    const { result } = renderHook(() => useNotify(true));
    await waitFor(() => expect(result.current.status?.state).toBe("denied"));

    fake.permission = "default"; // allowed in App info; the app is still open
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(result.current.status?.state).toBe("off"));
  });

  it("reads the permission again when the window gets focus", async () => {
    const fake = stubPhone("denied", false);
    const { result } = renderHook(() => useNotify(true));
    await waitFor(() => expect(result.current.status?.state).toBe("denied"));

    fake.permission = "default";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.status?.state).toBe("off"));
  });
});

/** A phone whose push subscription is made by `turnOn` or already there, and a backend that records what is posted to /api/push/subscribe. */
function stubSubscribingPhone(alreadySubscribed: boolean) {
  const subscription = { endpoint: "https://push.test/e1", toJSON: () => ({ endpoint: "https://push.test/e1", keys: { p256dh: "p", auth: "a" } }), unsubscribe: async () => true };
  let current: typeof subscription | null = alreadySubscribed ? subscription : null;
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => current,
          subscribe: async () => {
            current = subscription;
            return subscription;
          },
        },
      }),
    },
  });
  const posts: { pubkey?: string; subscription?: unknown; last4s?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/challenge") return reply({ nonce: "ab".repeat(16) });
    if (url.pathname === "/api/push/vapid-public-key") return reply({ publicKey: "AQAB" });
    if (url.pathname === "/api/push/subscribe") {
      posts.push(JSON.parse(String(init?.body)) as (typeof posts)[number]);
      return reply({});
    }
    return new Response(null, { status: 404 });
  });
  return { posts };
}

async function addCards(cards: [string, string][]) {
  await db.familyCards.clear();
  const repo = new FamilyRepository();
  for (const [lastFour, owner] of cards) await repo.addCard({ lastFour, owner });
}

describe("telling the backend which cards are this phone's", () => {
  beforeEach(() => addCards([["1234", "Jonathan"], ["5678", "Sam"], ["9876", "shared"]]));

  it("Notify me posts the subscription with this phone's person's last fours and none of the other person's", async () => {
    const phone = stubSubscribingPhone(false);
    writeMe("Jonathan");
    const { result } = renderHook(() => useNotify(true));
    await waitFor(() => expect(result.current.status?.state).toBe("off"));
    await act(async () => {
      await result.current.turnOn();
    });
    const last = phone.posts.at(-1)!;
    expect(last.last4s).toEqual(["1234", "9876"]);
    expect(last.pubkey).toBe("02ab");
    expect(JSON.stringify(last)).not.toMatch(/Jonathan|Sam|5678/);
    await waitFor(() => expect(result.current.status?.state).toBe("on"));
  });

  it("Notify me on a phone with no person set sends no list", async () => {
    const phone = stubSubscribingPhone(false);
    const { result } = renderHook(() => useNotify(true));
    await waitFor(() => expect(result.current.status?.state).toBe("off"));
    await act(async () => {
      await result.current.turnOn();
    });
    expect(phone.posts.length).toBeGreaterThan(0);
    for (const post of phone.posts) expect(post).not.toHaveProperty("last4s");
  });

  it("re-subscribes with the new list when My cards changes, and again when the phone's person changes", async () => {
    const phone = stubSubscribingPhone(true);
    writeMe("Sam");
    renderHook(() => useCardListSync());
    await waitFor(() => expect(phone.posts.at(-1)?.last4s).toEqual(["5678", "9876"]));

    await act(async () => {
      await new FamilyRepository().addCard({ lastFour: "2468", owner: "Sam" });
    });
    await waitFor(() => expect(phone.posts.at(-1)?.last4s).toEqual(["2468", "5678", "9876"]));

    act(() => writeMe("Jonathan"));
    await waitFor(() => expect(phone.posts.at(-1)?.last4s).toEqual(["1234", "9876"]));
  });

  it("re-subscribes with no list when no person is set", async () => {
    const phone = stubSubscribingPhone(true);
    renderHook(() => useCardListSync());
    await waitFor(() => expect(phone.posts.length).toBeGreaterThan(0));
    for (const post of phone.posts) expect(post).not.toHaveProperty("last4s");
  });

  it("posts nothing when the phone has no push subscription", async () => {
    const phone = stubSubscribingPhone(false);
    writeMe("Sam");
    renderHook(() => useCardListSync());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(phone.posts).toEqual([]);
  });
});
