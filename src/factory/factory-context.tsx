import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { licence } from "bsv-kit/bsv";
import { LicenceProvider } from "bsv-kit/bsv/react";
import type { FactoryDoorState, FactoryLicence } from "@/contracts/types";
import {
  FACTORY_COLLECTION,
  POSTERN_ISSUER,
  browserStorage,
  hasPassphraseCopy,
  readBackendUrl,
  writeBackendUrl,
} from "@/services/factory-service";
import { browserPasskeyPort } from "@/services/passkey";
import type { PasskeyPort } from "@/services/passkey";
import { useAiAllowed, useLicence, useLicenceNow } from "./ai-allowed";
import { useKeySession } from "./key-session";
import type { KeySession, MadeKeyResult } from "./key-session";
import { useLookupRunning } from "./lookups";
import { SendHoldContext, sendHold } from "./send-hold";
import { FormTutorContext } from "@/tutor/tutor-context";
import { makeFormTalkAsk } from "@/tutor/form-talk";
import type { FormTalkAsk } from "@/tutor/form-talk";

/** Reads a key's licence in a collection; the chain by default, a fake in tests. */
export type FactoryLicenceChecker = (
  publicKeyHex: string,
  collection: string,
) => Promise<licence.LicenceStatus>;

/**
 * The chain check. It names the Postern issuer, so a licence Postern minted to the key (funded and
 * signed by the issuer, listed only in the issuer's history) reads as held even while the key is
 * locked.
 */
const chainCheck: FactoryLicenceChecker = (publicKeyHex, collection) =>
  licence.licenceStatus(publicKeyHex, collection, { issuers: [POSTERN_ISSUER] });

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

const FactoryContext = createContext<FactoryContextValue | null>(null);

interface FactoryProviderProps {
  children: ReactNode;
  /** Reads the chain for a key's licence; the real chain by default, a fake in tests. */
  checkLicence?: FactoryLicenceChecker;
  /** The WebAuthn calls; the browser's by default, a fake in tests. */
  passkeyPort?: PasskeyPort;
}

/** The licence of a key not made yet: no answer, so the kit's reading stays 'checking' and nothing is asked of the chain. */
const noAnswer = () => new Promise<licence.LicenceStatus>(() => {});

export function FactoryProvider({
  children,
  checkLicence = chainCheck,
  passkeyPort = browserPasskeyPort,
}: FactoryProviderProps) {
  const storage = useMemo(() => browserStorage(), []);
  const keySession = useKeySession({ storage, passkeyPort });
  const { publicKeyHex } = keySession;
  // One LicenceProvider for the app's life, so a key made later does not remount what is beneath it.
  const check = (hex: string) => (hex ? checkLicence(hex, FACTORY_COLLECTION) : noAnswer());
  return (
    <LicenceProvider publicKeyHex={publicKeyHex ?? ""} check={check}>
      <FactoryState keySession={keySession} storage={storage} passkeyPort={passkeyPort}>
        {children}
      </FactoryState>
    </LicenceProvider>
  );
}

/** The factory beneath the licence check: the door, the lookup queue and the forms' tutor read the kit's licence. */
function FactoryState({
  children,
  keySession,
  storage,
  passkeyPort,
}: {
  children: ReactNode;
  keySession: KeySession;
  storage: ReturnType<typeof browserStorage>;
  passkeyPort: PasskeyPort;
}) {
  const { publicKeyHex } = keySession;
  const [backendUrl, setBackendUrlState] = useState(readBackendUrl);
  const key = keySession.getKey();
  const reading = useLicence();
  const aiAllowed = useAiAllowed();
  const licenceNow = useLicenceNow();
  const licenceState: FactoryLicence | null = publicKeyHex ? reading : null;
  const runnerState = useLookupRunning({ key, backendUrl });

  const holds = useMemo(() => {
    const base = { publicKeyHex, key, online: runnerState.online, licence: licenceState };
    return {
      lookup: sendHold({ ...base, backingOff: runnerState.lookupBackingOff }),
      receipt: sendHold({ ...base, backingOff: runnerState.receiptBackingOff }),
    };
  }, [publicKeyHex, key, runnerState, licenceState]);

  // The forms' tutor asks the factory only while the AI is allowed; the key is read when it asks, not keyed on.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  const licensed = aiAllowed && key !== null;
  const formAsk = useMemo<FormTalkAsk | null>(() => {
    if (!licensed) return null;
    return async (request, signal) => {
      const current = keyRef.current;
      if (!current) throw new Error("The factory is locked.");
      return makeFormTalkAsk(backendUrl, current, licenceNow)(request, signal);
    };
  }, [licensed, backendUrl, licenceNow]);

  const setBackendUrl = useCallback((url: string) => {
    writeBackendUrl(url);
    setBackendUrlState(readBackendUrl());
  }, []);

  let door: FactoryDoorState = keySession.state;
  if (door === "unlocked" && aiAllowed) door = "licensed";

  return (
    <FactoryContext
      value={{
        door,
        publicKeyHex,
        licence: licenceState,
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
      <FormTutorContext value={formAsk}>
        <SendHoldContext value={holds}>{children}</SendHoldContext>
      </FormTutorContext>
    </FactoryContext>
  );
}

export function useFactory() {
  const ctx = useContext(FactoryContext);
  if (!ctx) throw new Error("useFactory must be used within FactoryProvider");
  return ctx;
}
