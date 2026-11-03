import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { FactoryProvider } from "@/factory";
import { useKeySession } from "@/factory/key-session";
import { FactorySettings } from "@/components/factory/factory-settings";
import { ThemeProvider } from "@/contexts/theme-context";
import { browserStorage } from "@/services/factory-service";
import type { PasskeyPort } from "@/services/passkey";

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};
const storage = browserStorage();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("tradetracker-theme", "light");
});

function launch(clock: { now: number }) {
  return renderHook(() => useKeySession({ storage, passkeyPort: noWebAuthn, now: () => clock.now }));
}

describe("the key session across a relaunch (the app closed and opened again)", () => {
  it("is unlocked without asking within the day, with the same expiry", async () => {
    const clock = { now: 1_800_000_000_000 };
    const first = launch(clock);
    await act(async () => {
      await first.result.current.makeKey();
    });
    const expiry = first.result.current.expiresAt();
    expect(expiry).toBe(clock.now + DAY_MS);
    first.unmount();

    clock.now += DAY_MS - 60_000;
    const second = launch(clock);
    await waitFor(() => expect(second.result.current.state).toBe("unlocked"));
    expect(second.result.current.getKey()).not.toBeNull();
    expect(second.result.current.expiresAt()).toBe(expiry);
  });

  it("asks again after the day", async () => {
    const clock = { now: 1_800_000_000_000 };
    const first = launch(clock);
    await act(async () => {
      await first.result.current.makeKey();
    });
    first.unmount();

    clock.now += DAY_MS;
    const second = launch(clock);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(second.result.current.state).toBe("locked");
    expect(second.result.current.getKey()).toBeNull();
  });

  it("asks again after Lock", async () => {
    const clock = { now: 1_800_000_000_000 };
    const first = launch(clock);
    await act(async () => {
      await first.result.current.makeKey();
    });
    await act(async () => {
      await first.result.current.lock();
    });
    expect(first.result.current.state).toBe("locked");
    first.unmount();

    const second = launch(clock);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(second.result.current.state).toBe("locked");
    expect(second.result.current.getKey()).toBeNull();
  });
});

describe("Settings, Factory, after a relaunch", () => {
  function settings() {
    return (
      <MemoryRouter>
        <ThemeProvider>
          <FactoryProvider
            checkLicence={async () => ({ state: "none", checkedAt: "2026-10-10T00:00:00.000Z" })}
            passkeyPort={noWebAuthn}
          >
            <FactorySettings />
          </FactoryProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }

  it("says 'Key unlocked for today.' without an unlock", async () => {
    const { unmount } = render(settings());
    await userEvent.setup().click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText("Key unlocked for today.");
    unmount();

    render(settings());
    await screen.findByText("Key unlocked for today.");
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
  });
});
