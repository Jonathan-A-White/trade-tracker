import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { licence } from "bsv-kit/bsv";
import { browserStorage } from "@/services/factory-service";
import type { PasskeyPort } from "@/services/passkey";
import { FactoryProvider, useAiAllowed, useFactory } from "@/factory";
import { useKeySession } from "@/factory/key-session";
import * as oldPath from "@/contexts/factory-context";

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};
const storage = browserStorage();
const checkedAt = "2026-10-05T00:00:00.000Z";
const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};

beforeEach(() => localStorage.clear());

describe("the factory facade", () => {
  it("exports the provider and hook, and the old path re-exports them", () => {
    expect(FactoryProvider).toBe(oldPath.FactoryProvider);
    expect(useFactory).toBe(oldPath.useFactory);
  });
});

describe("useKeySession", () => {
  it("starts with no key, then unlocked after makeKey, and exposes the key", async () => {
    const { result } = renderHook(() => useKeySession({ storage, passkeyPort: noWebAuthn }));
    expect(result.current.state).toBe("no-key");
    expect(result.current.publicKeyHex).toBeNull();
    expect(result.current.getKey()).toBeNull();
    await act(async () => {
      await result.current.makeKey();
    });
    expect(result.current.state).toBe("unlocked");
    expect(result.current.publicKeyHex).toMatch(/^[0-9a-f]+$/);
    expect(result.current.getKey()).not.toBeNull();
  });
});

describe("the licence on the kit", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <FactoryProvider checkLicence={async () => held} passkeyPort={noWebAuthn}>
        {children}
      </FactoryProvider>
    );
  }

  it("is null and not allowed with no key, then checking, then licensed once the chain says held", async () => {
    const { result } = renderHook(() => ({ factory: useFactory(), allowed: useAiAllowed() }), { wrapper });
    expect(result.current.factory.licence).toBeNull();
    expect(result.current.allowed).toBe(false);
    await act(async () => {
      await result.current.factory.makeKey();
    });
    await waitFor(() => expect(result.current.factory.licence).toBe("licensed"));
    expect(result.current.allowed).toBe(true);
    expect(result.current.factory.door).toBe("licensed");
  });

  it("does not allow the AI while the chain has not answered ('checking' is no)", async () => {
    const never = () => new Promise<licence.LicenceStatus>(() => {});
    const { result } = renderHook(() => ({ factory: useFactory(), allowed: useAiAllowed() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <FactoryProvider checkLicence={never} passkeyPort={noWebAuthn}>
          {children}
        </FactoryProvider>
      ),
    });
    await act(async () => {
      await result.current.factory.makeKey();
    });
    expect(result.current.factory.licence).toBe("checking");
    expect(result.current.allowed).toBe(false);
    expect(result.current.factory.door).toBe("unlocked");
  });
});
