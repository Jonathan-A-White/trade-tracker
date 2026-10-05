import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { licence, vault } from "bsv-kit/bsv";
import type { FactoryDoorState, FactoryLicence } from "@/contracts/types";
import {
  FACTORY_COLLECTION,
  addFingerprint,
  browserStorage,
  hasFingerprintCopy,
  hasPassphraseCopy,
  makeKey as makeStoredKey,
  readBackendUrl,
  removeFingerprint as removeStoredFingerprint,
  storedPublicKeyHex,
  unlockWithWords as unlockStoredWithWords,
  unlockWithFingerprint as unlockStoredWithFingerprint,
  writeBackendUrl,
} from "@/services/factory-service";
import { askDoorLicence } from "@/services/door-licence";
import type { DoorLicenceAnswer, DoorLicenceAsker } from "@/services/door-licence";
import { makeLookupClient } from "@/services/lookup-client";
import { LookupRunner } from "@/services/lookup-runner";
import { browserPasskeyPort, describeUnlockError } from "@/services/passkey";
import type { PasskeyPort } from "@/services/passkey";

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
  /**
   * Makes a key, unlocks it and, when WebAuthn is available, asks for the fingerprint at once and
   * keeps the fingerprint copy. Resolves with the 12 words (shown once, never stored) and, when the
   * fingerprint could not be set up, a plain sentence saying so; the key is made either way.
   */
  makeKey: () => Promise<MadeKeyResult>;
  /**
   * Opens the stored key with its 12 words (or, for a key made with a passphrase, that passphrase)
   * and starts the day-long session. Rejects with a plain message.
   */
  unlockWithWords: (input: string) => Promise<void>;
  /** Whether a key made with a passphrase is stored here, so the passphrase still opens it. */
  hasPassphraseCopy: boolean;
  /** Whether this device can do WebAuthn (so a fingerprint can be offered). */
  fingerprintAvailable: boolean;
  /** Whether a fingerprint copy of the key is stored on this device. */
  hasFingerprint: boolean;
  /** With a key unlocked: registers a passkey and stores a fingerprint copy. Rejects with a plain message. */
  enableFingerprint: () => Promise<void>;
  /** Opens the fingerprint copy and starts the same day-long session. Rejects with a plain message. */
  unlockWithFingerprint: () => Promise<void>;
  /** Deletes the fingerprint copy only. */
  removeFingerprint: () => Promise<void>;
}

export interface MadeKeyResult {
  phrase: string;
  /** Why the fingerprint was not set up, in plain words; null when it was, or was not asked for. */
  fingerprintNote: string | null;
}

const FactoryContext = createContext<FactoryContextValue | null>(null);

const chainCheck: FactoryLicenceChecker = (publicKeyHex, collection) =>
  licence.licenceStatus(publicKeyHex, collection);

interface FactoryProviderProps {
  children: ReactNode;
  checkLicence?: FactoryLicenceChecker;
  /** The WebAuthn calls; the browser's by default, a fake in tests. */
  passkeyPort?: PasskeyPort;
  /** Asks the Postern door whether the unlocked key is licensed; the real door by default, a fake in tests. */
  askDoor?: DoorLicenceAsker;
}

/**
 * The licence to show: the door's word wins while the key is unlocked ("held" opens the door; "none"
 * only stays "revoked" when the chain said so); with no door answer the chain's stands.
 */
function mergeLicence(chain: FactoryLicence | null, doorAnswer: DoorLicenceAnswer | null): FactoryLicence {
  if (doorAnswer === "held") return "held";
  if (doorAnswer === "none") return chain === "revoked" ? "revoked" : "none";
  return chain ?? "checking";
}

export function FactoryProvider({
  children,
  checkLicence = chainCheck,
  passkeyPort = browserPasskeyPort,
  askDoor = askDoorLicence,
}: FactoryProviderProps) {
  const storage = useMemo(() => browserStorage(), []);
  const [hasFingerprint, setHasFingerprint] = useState(() => hasFingerprintCopy());
  // The unlocked key lives in memory only, for a day.
  const [session] = useState(() => vault.createKeySession());
  const [unlocked, setUnlocked] = useState(false);
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(() => storedPublicKeyHex());
  const [backendUrl, setBackendUrlState] = useState(readBackendUrl);
  const [checked, setChecked] = useState<{
    publicKeyHex: string;
    licence: FactoryLicence;
  } | null>(null);
  const [doorChecked, setDoorChecked] = useState<{
    publicKeyHex: string;
    backendUrl: string;
    answer: DoorLicenceAnswer;
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

  // Unlocked, the door is asked (at unlock and when the backend URL changes; no polling). It never
  // blocks anything: offline or failing, the chain's answer stands.
  useEffect(() => {
    const key = session.getKey();
    if (!unlocked || !publicKeyHex || !key) return;
    let cancelled = false;
    askDoor(backendUrl, key).then(
      (answer) => {
        if (!cancelled) setDoorChecked({ publicKeyHex, backendUrl, answer });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [unlocked, publicKeyHex, backendUrl, session, askDoor]);

  const makeKey = useCallback(async (): Promise<MadeKeyResult> => {
    const made = await makeStoredKey(storage);
    await session.setKey(made.key);
    setPublicKeyHex(made.publicKeyHex);
    let fingerprintNote: string | null = null;
    if (passkeyPort.isAvailable()) {
      try {
        await addFingerprint(storage, passkeyPort, made.key);
        setHasFingerprint(true);
      } catch (err) {
        fingerprintNote = describeUnlockError(err);
      }
    }
    return { phrase: made.phrase, fingerprintNote };
  }, [storage, session, passkeyPort]);

  const unlockWithWords = useCallback(
    async (input: string) => {
      const opened = await unlockStoredWithWords(storage, input);
      await session.setKey(opened.key);
      setPublicKeyHex(opened.publicKeyHex);
    },
    [storage, session],
  );

  const enableFingerprint = useCallback(async () => {
    const key = session.getKey();
    if (!key) throw new Error("Unlock the key first.");
    try {
      await addFingerprint(storage, passkeyPort, key);
    } catch (err) {
      throw new Error(describeUnlockError(err));
    }
    setHasFingerprint(true);
  }, [storage, session, passkeyPort]);

  const unlockWithFingerprint = useCallback(async () => {
    let opened;
    try {
      opened = await unlockStoredWithFingerprint(storage, passkeyPort);
    } catch (err) {
      throw new Error(describeUnlockError(err));
    }
    await session.setKey(opened.key);
    setPublicKeyHex(opened.publicKeyHex);
  }, [storage, session, passkeyPort]);

  const removeFingerprint = useCallback(async () => {
    await removeStoredFingerprint(storage);
    setHasFingerprint(false);
  }, [storage]);

  const setBackendUrl = useCallback((url: string) => {
    writeBackendUrl(url);
    setBackendUrlState(readBackendUrl());
  }, []);

  const chainLicence = checked?.publicKeyHex === publicKeyHex ? checked.licence : null;
  const doorAnswer =
    unlocked && doorChecked?.publicKeyHex === publicKeyHex && doorChecked.backendUrl === backendUrl
      ? doorChecked.answer
      : null;
  const licenceState: FactoryLicence | null = !publicKeyHex
    ? null
    : mergeLicence(chainLicence, doorAnswer);

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
        unlockWithWords,
        hasPassphraseCopy: hasPassphraseCopy(storage),
        fingerprintAvailable: passkeyPort.isAvailable(),
        hasFingerprint,
        enableFingerprint,
        unlockWithFingerprint,
        removeFingerprint,
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
