import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { licence, vault } from "bsv-kit/bsv";
import type { FactoryDoorState, FactoryLicence } from "@/contracts/types";
import {
  FACTORY_COLLECTION,
  browserStorage,
  makeKey as makeStoredKey,
  readBackendUrl,
  storedPublicKeyHex,
  unlockKey as unlockStoredKey,
  writeBackendUrl,
} from "@/services/factory-service";
import { makeLookupClient } from "@/services/lookup-client";
import { LookupRunner } from "@/services/lookup-runner";

/** Reads a key's licence in a collection; the chain by default, a fake in tests. */
export type FactoryLicenceChecker = (
  publicKeyHex: string,
  collection: string,
) => Promise<licence.LicenceStatus>;

interface FactoryContextValue {
  door: FactoryDoorState;
  /** The public key, once a key exists (known while locked too); null before. */
  publicKeyHex: string | null;
  /** Licence in the collection trade-tracker; null while there is no key. */
  licence: FactoryLicence | null;
  backendUrl: string;
  setBackendUrl: (url: string) => void;
  /** Makes and stores a key wrapped by the passphrase and unlocks it; resolves with the recovery phrase. */
  makeKey: (passphrase: string) => Promise<string>;
  /** Rejects with a plain message when the passphrase does not open the stored key. */
  unlockKey: (passphrase: string) => Promise<void>;
}

const FactoryContext = createContext<FactoryContextValue | null>(null);

const chainCheck: FactoryLicenceChecker = (publicKeyHex, collection) =>
  licence.licenceStatus(publicKeyHex, collection);

interface FactoryProviderProps {
  children: ReactNode;
  checkLicence?: FactoryLicenceChecker;
}

export function FactoryProvider({ children, checkLicence = chainCheck }: FactoryProviderProps) {
  const storage = useMemo(() => browserStorage(), []);
  // The unlocked key lives in memory only, for a day.
  const [session] = useState(() => vault.createKeySession());
  const [unlocked, setUnlocked] = useState(false);
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(() => storedPublicKeyHex());
  const [backendUrl, setBackendUrlState] = useState(readBackendUrl);
  const [checked, setChecked] = useState<{
    publicKeyHex: string;
    licence: FactoryLicence;
  } | null>(null);

  useEffect(
    () => session.onChange(() => setUnlocked(session.getKey() !== null)),
    [session],
  );

  // Nothing touches the network until a key exists; a failed check never blocks the app.
  useEffect(() => {
    if (!publicKeyHex) return;
    let cancelled = false;
    checkLicence(publicKeyHex, FACTORY_COLLECTION).then(
      (status) => {
        if (!cancelled) setChecked({ publicKeyHex, licence: status.state });
      },
      () => {
        if (!cancelled) setChecked({ publicKeyHex, licence: "unknown" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicKeyHex, checkLicence]);

  const makeKey = useCallback(
    async (passphrase: string) => {
      const made = await makeStoredKey(storage, passphrase);
      await session.setKey(made.key);
      setPublicKeyHex(made.publicKeyHex);
      return made.phrase;
    },
    [storage, session],
  );

  const unlockKey = useCallback(
    async (passphrase: string) => {
      const opened = await unlockStoredKey(storage, passphrase);
      await session.setKey(opened.key);
      setPublicKeyHex(opened.publicKeyHex);
    },
    [storage, session],
  );

  const setBackendUrl = useCallback((url: string) => {
    writeBackendUrl(url);
    setBackendUrlState(readBackendUrl());
  }, []);

  const licenceState: FactoryLicence | null = !publicKeyHex
    ? null
    : checked?.publicKeyHex === publicKeyHex
      ? checked.licence
      : "checking";

  let door: FactoryDoorState = "no-key";
  if (publicKeyHex) {
    door = !unlocked ? "locked" : licenceState === "held" ? "licensed" : "unlocked";
  }

  // The lookup queue runs while the app is open: sending and polling only when the
  // door is licensed and the device is online; polling only while the page is visible.
  const [runner] = useState(() => new LookupRunner());
  useEffect(() => {
    runner.setOnline(navigator.onLine);
    runner.setVisible(document.visibilityState !== "hidden");
    const goOnline = () => runner.setOnline(true);
    const goOffline = () => runner.setOnline(false);
    const changeVisibility = () => runner.setVisible(document.visibilityState !== "hidden");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", changeVisibility);
    runner.start();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", changeVisibility);
      runner.stop();
    };
  }, [runner]);

  const licensed = door === "licensed";
  useEffect(() => {
    const key = session.getKey();
    runner.setClient(licensed && key ? makeLookupClient(backendUrl, key) : null);
  }, [runner, session, licensed, backendUrl]);

  return (
    <FactoryContext
      value={{
        door,
        publicKeyHex,
        licence: licenceState,
        backendUrl,
        setBackendUrl,
        makeKey,
        unlockKey,
      }}
    >
      {children}
    </FactoryContext>
  );
}

export function useFactory() {
  const ctx = useContext(FactoryContext);
  if (!ctx) throw new Error("useFactory must be used within FactoryProvider");
  return ctx;
}
