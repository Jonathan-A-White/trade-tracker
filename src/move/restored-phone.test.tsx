import { Blob as NodeBlob } from "node:buffer";
import type { ReactNode } from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { licence } from "bsv-kit/bsv";
import { db } from "@/db/database";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { FactoryProvider, useFactory } from "@/factory";
import { addFingerprint, browserStorage, makeKey, FACTORY_COLLECTION } from "@/services/factory-service";
import type { PasskeyPort } from "@/services/passkey";
import { YnabSection } from "@/settings/sections/ynab-section";
import { ME_KEY } from "@/sort/waiting";
import { endTheDay, waitForDayKept } from "@/test/end-the-day";
import { openToken, sealToken } from "@/ynab/token";
import { packPhone, type Pack } from "./pack";
import { restoreFromPack } from "./unpack";

// What the Governor checks after an Unpack (mw-hmnm2xi.2's acceptance 3), on a phone that was packed at http://old.example and is restored
// at this address: the same public key, the licence read for it with nothing new issued, YNAB connected from the carried token, My cards and
// 'This phone is' as packed, and the fingerprint enrolled again at first use.

const TOKEN = "good-token-123";
const storage = browserStorage();

/** A passkey that works at one hostname only: a credential made at another is not found, as a browser's is not. */
function passkeysAt(hostname: string): PasskeyPort & { hostnames: Map<string, string> } {
  const secrets = new Map<string, ArrayBuffer>();
  const hostnames = new Map<string, string>();
  let n = 0;
  return {
    hostnames,
    isAvailable: () => true,
    create: async () => {
      const id = new Uint8Array([++n, 7, 7, 7]).buffer;
      secrets.set(String(n), new Uint8Array(32).fill(n).buffer);
      hostnames.set(String(n), hostname);
      return { credentialId: id, prfSupported: true };
    },
    getPrfSecret: async (id) => secrets.get(String(new Uint8Array(id)[0])) ?? null,
  };
}

async function emptyPhone() {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
}

describe("a phone after restoreFromPack", () => {
  let publicKeyHex: string;
  let words: string;
  let pack: Pack;
  let key: Uint8Array;

  // fake-indexeddb copies a row with structuredClone, which keeps node's Blob and turns jsdom's into {}
  beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await emptyPhone();
    // the old address: a key with its fingerprint, a YNAB token sealed under it, YNAB connected, cards, whose phone this is
    const made = await makeKey(storage);
    key = made.key;
    publicKeyHex = made.publicKeyHex;
    words = made.phrase;
    await addFingerprint(storage, passkeysAt("old.example"), made.key);
    await sealToken(storage, made.key, TOKEN);
    localStorage.setItem("tradetracker-setting-ynab", "on");
    localStorage.setItem(ME_KEY, "Sarah");
    localStorage.setItem("bsv-kit.licence", JSON.stringify({ state: "licensed" }));
    await db.ynabConnection.add({
      id: "connection",
      budgetId: "b1",
      budgetName: "Our Budget",
      connectedAt: 1,
      categoriesKnowledge: 1,
      accountsKnowledge: 1,
      payeesKnowledge: 1,
    } as never);
    await new FamilyRepository().addCard({ lastFour: "1234", owner: "Sarah" });
    pack = JSON.parse(JSON.stringify(await packPhone({ origin: "http://old.example" }))) as Pack;
    await emptyPhone();
    await restoreFromPack(pack);
  });

  afterEach(async () => {
    await endTheDay();
  });

  const held: licence.LicenceStatus = {
    state: "held",
    outpoint: { txid: "ab".repeat(32), vout: 0 },
    collection: "trade-tracker",
    checkedAt: "2026-11-05T00:00:00.000Z",
  };

  it("holds the same public key, and the licence is read for that key and found held, with nothing newly issued", async () => {
    const check = vi.fn(async (hex: string, collection: string): Promise<licence.LicenceStatus> => {
      void hex;
      void collection;
      return held;
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FactoryProvider checkLicence={check} passkeyPort={passkeysAt("new.example")}>
        {children}
      </FactoryProvider>
    );
    const { result } = renderHook(() => useFactory(), { wrapper });
    expect(result.current.publicKeyHex).toBe(publicKeyHex);
    expect(result.current.door).toBe("locked");
    await waitFor(() => expect(result.current.licence).toBe("licensed"));
    expect(check).toHaveBeenCalledWith(publicKeyHex, FACTORY_COLLECTION);
    expect(check.mock.calls.every(([hex]) => hex === publicKeyHex)).toBe(true);
    expect(localStorage.getItem("tradetracker-factory-public")).toBe(publicKeyHex);
  });

  it("opens with the 12 words, then enrols the fingerprint again, and the fingerprint unlocks afterwards", async () => {
    const passkeys = passkeysAt("new.example");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FactoryProvider checkLicence={async () => held} passkeyPort={passkeys}>
        {children}
      </FactoryProvider>
    );
    const { result, unmount } = renderHook(() => useFactory(), { wrapper });
    // the old address's passkey does not come over: no fingerprint copy, so the door offers the words only
    expect(result.current.hasFingerprint).toBe(false);
    await expect(result.current.unlockWithFingerprint()).rejects.toThrow(/No fingerprint is set up/);

    await act(async () => result.current.unlockWithWords(words));
    expect(result.current.getKey()).toEqual(key);
    expect(result.current.hasFingerprint).toBe(false);

    await act(async () => result.current.enableFingerprint());
    expect(result.current.hasFingerprint).toBe(true);
    expect([...passkeys.hostnames.values()]).toEqual(["new.example"]);

    // a day later: the app opens with the key locked, and the new fingerprint opens it
    await waitForDayKept();
    unmount();
    await endTheDay();
    const again = renderHook(() => useFactory(), { wrapper });
    expect(again.result.current.door).toBe("locked");
    expect(again.result.current.hasFingerprint).toBe(true);
    await act(async () => again.result.current.unlockWithFingerprint());
    expect(again.result.current.getKey()).toEqual(key);
  });

  it("opens the carried YNAB token under the restored key, and Settings > YNAB says Connected as the budget", async () => {
    expect(await openToken(storage, key)).toBe(TOKEN);
    expect(await openToken(storage, new Uint8Array(32).fill(1))).toBeNull();
    render(
      <MemoryRouter>
        <FactoryProvider checkLicence={async () => held} passkeyPort={passkeysAt("new.example")}>
          <YnabSection />
        </FactoryProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Connected as Our Budget")).toBeInTheDocument();
  });

  it("keeps My cards and whose phone this is as packed", async () => {
    const cards = await new FamilyRepository().listCards();
    expect(cards.map((c) => [c.lastFour, c.owner])).toEqual([["1234", "Sarah"]]);
    expect(localStorage.getItem(ME_KEY)).toBe("Sarah");
  });
});
