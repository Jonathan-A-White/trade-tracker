import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FactoryDoorState, FactoryLicence } from "@/contracts/types";
import {
  FACTORY_COLLECTION,
  browserStorage,
  hasPassphraseCopy,
  readBackendUrl,
  writeBackendUrl,
} from "@/services/factory-service";
import { askDoorLicence } from "@/services/door-licence";
import type { DoorLicenceAsker } from "@/services/door-licence";
import { browserPasskeyPort } from "@/services/passkey";
import type { PasskeyPort } from "@/services/passkey";
import { useKeySession } from "./key-session";
import type { MadeKeyResult } from "./key-session";
import { chainCheck, useFactoryLicence } from "./licence";
import type { FactoryLicenceChecker } from "./licence";
import { useLookupRunning } from "./lookups";

interface FactoryContextValue {
  door: FactoryDoorState;
  /** The public key, once a key exists (known while locked too); null before. */
  publicKeyHex: string | null;
  /** Licence in the collection trade-tracker; null while there is no key. */
  licence: FactoryLicence | null;
  /** Reads the chain again, after the licence showed "unknown". */
  recheckLicence: () => void;
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

const noRecheck = () => {};

const FactoryContext = createContext<FactoryContextValue | null>(null);

interface FactoryProviderProps {
  children: ReactNode;
  checkLicence?: FactoryLicenceChecker;
  /** The WebAuthn calls; the browser's by default, a fake in tests. */
  passkeyPort?: PasskeyPort;
  /** Asks the Postern door whether the unlocked key is licensed; the real door by default, a fake in tests. */
  askDoor?: DoorLicenceAsker;
  /** Waits (ms) before each retry of a failed chain read; about 30 seconds in all by default. */
  licenceRetryMs?: readonly number[];
}

export function FactoryProvider({
  children,
  checkLicence = chainCheck,
  passkeyPort = browserPasskeyPort,
  askDoor = askDoorLicence,
  licenceRetryMs,
}: FactoryProviderProps) {
  const storage = useMemo(() => browserStorage(), []);
  const keySession = useKeySession({ storage, passkeyPort });
  const { publicKeyHex } = keySession;
  const [backendUrl, setBackendUrlState] = useState(readBackendUrl);
  const key = keySession.getKey();
  const reading = useFactoryLicence({
    publicKeyHex,
    key,
    backendUrl,
    collection: FACTORY_COLLECTION,
    checkLicence,
    askDoor,
    retryDelaysMs: licenceRetryMs,
  });
  const licenceState = reading?.licence ?? null;
  useLookupRunning({ licence: licenceState, key, backendUrl });

  const setBackendUrl = useCallback((url: string) => {
    writeBackendUrl(url);
    setBackendUrlState(readBackendUrl());
  }, []);

  let door: FactoryDoorState = keySession.state;
  if (door === "unlocked" && licenceState === "held") door = "licensed";

  return (
    <FactoryContext
      value={{
        door,
        publicKeyHex,
        licence: licenceState,
        recheckLicence: reading?.recheck ?? noRecheck,
        backendUrl,
        setBackendUrl,
        makeKey: keySession.makeKey,
        unlockWithWords: keySession.unlockWithWords,
        hasPassphraseCopy: hasPassphraseCopy(storage),
        fingerprintAvailable: passkeyPort.isAvailable(),
        hasFingerprint: keySession.hasFingerprint,
        enableFingerprint: keySession.enableFingerprint,
        unlockWithFingerprint: keySession.unlockWithFingerprint,
        removeFingerprint: keySession.removeFingerprint,
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
