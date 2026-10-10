import { act, renderHook, waitFor } from "@testing-library/react";
import { licence } from "bsv-kit/bsv";
import { browserStorage } from "@/services/factory-service";
import type { DoorLicenceAsker } from "@/services/door-licence";
import type { PasskeyPort } from "@/services/passkey";
import { FactoryProvider, useFactory } from "@/factory";
import { useKeySession } from "@/factory/key-session";
import { useFactoryLicence } from "@/factory/licence";
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

describe("useFactoryLicence", () => {
  it("is null with no key and the chain's answer once a key exists", async () => {
    const { result, rerender } = renderHook(
      (props: { publicKeyHex: string | null }) =>
        useFactoryLicence({
          publicKeyHex: props.publicKeyHex,
          key: null,
          backendUrl: "http://x",
          collection: "trade-tracker",
          checkLicence: async () => held,
        }),
      { initialProps: { publicKeyHex: null as string | null } },
    );
    expect(result.current).toBeNull();
    rerender({ publicKeyHex: "aa" });
    expect(result.current?.licence).toBe("checking");
    await waitFor(() => expect(result.current?.licence).toBe("held"));
  });

  it("asks the door when the key is given, and the door's word wins", async () => {
    const askDoor = vi.fn<DoorLicenceAsker>(async () => "none");
    const key = new Uint8Array([1, 2, 3]);
    const { result } = renderHook(() =>
      useFactoryLicence({
        publicKeyHex: "aa",
        key,
        backendUrl: "http://x",
        collection: "trade-tracker",
        checkLicence: async () => held,
        askDoor,
      }),
    );
    await waitFor(() => expect(result.current?.licence).toBe("none"));
    expect(askDoor).toHaveBeenCalledTimes(1);
  });
});
