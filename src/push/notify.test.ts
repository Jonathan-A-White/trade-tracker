import { act, renderHook, waitFor } from "@testing-library/react";
import { useNotify } from "@/push/notify";

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
