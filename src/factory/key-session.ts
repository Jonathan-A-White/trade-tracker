import { useCallback, useEffect, useState } from "react";
import { vault } from "bsv-kit/bsv";
import type { FactoryDoorState } from "@/contracts/types";
import {
  addFingerprint,
  hasFingerprintCopy,
  makeKey as makeStoredKey,
  removeFingerprint as removeStoredFingerprint,
  storedPublicKeyHex,
  unlockWithWords as unlockStoredWithWords,
  unlockWithFingerprint as unlockStoredWithFingerprint,
} from "@/services/factory-service";
import { describeUnlockError } from "@/services/passkey";
import type { PasskeyPort } from "@/services/passkey";

export interface MadeKeyResult {
  phrase: string;
  /** Why the fingerprint was not set up, in plain words; null when it was, or was not asked for. */
  fingerprintNote: string | null;
}

export interface KeySession {
  /** "no-key", "locked" or "unlocked"; "licensed" is the provider's word, once the licence is known. */
  state: FactoryDoorState;
  /** The public key, once a key exists (known while locked too); null before. */
  publicKeyHex: string | null;
  /** Whether a fingerprint copy of the key is stored on this device. */
  hasFingerprint: boolean;
  /**
   * Makes a key, unlocks it and, when WebAuthn is available, asks for the fingerprint at once and
   * keeps the fingerprint copy. Resolves with the 12 words (shown once, never stored) and, when the
   * fingerprint could not be set up, a plain sentence saying so; the key is made either way.
   */
  makeKey(): Promise<MadeKeyResult>;
  /**
   * Opens the stored key with its 12 words (or, for a key made with a passphrase, that passphrase)
   * and starts the day-long session. Rejects with a plain message.
   */
  unlockWithWords(input: string): Promise<void>;
  /** Opens the fingerprint copy and starts the same day-long session. Rejects with a plain message. */
  unlockWithFingerprint(): Promise<void>;
  /** With a key unlocked: registers a passkey and stores a fingerprint copy. Rejects with a plain message. */
  enableFingerprint(): Promise<void>;
  /** Deletes the fingerprint copy only. */
  removeFingerprint(): Promise<void>;
  /** The unlocked key; null while locked or without a key. */
  getKey(): Uint8Array | null;
  /** When the day's unlock ends (epoch ms); null while locked. A relaunch within the day keeps it. */
  expiresAt(): number | null;
  /** Ends the unlock here and on this device, so the next launch asks again. */
  lock(): Promise<void>;
}

/** The key session: the 12 words, the fingerprint copy and the day-long session. */
export function useKeySession(opts: {
  storage: vault.Storage;
  passkeyPort: PasskeyPort;
  /** The clock in epoch ms; Date.now unless a test sets it. */
  now?: () => number;
}): KeySession {
  const { storage, passkeyPort, now } = opts;
  const [hasFingerprint, setHasFingerprint] = useState(() => hasFingerprintCopy());
  // The unlocked key is held for a day from unlocking; bsv-kit keeps it, wrapped under a device key
  // that cannot be read out, so a relaunch within the day takes it back (resume, below).
  const [session] = useState(() => vault.createKeySession({ now }));
  const [unlocked, setUnlocked] = useState(false);
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(() => storedPublicKeyHex());

  useEffect(() => {
    const stop = session.onChange(() => setUnlocked(session.getKey() !== null));
    // On launch: take back the unlock kept from earlier today, if there is one (onChange tells us).
    void session.resume();
    return stop;
  }, [session]);

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

  const getKey = useCallback(() => session.getKey(), [session]);
  const expiresAt = useCallback(() => session.expiresAt(), [session]);
  const lock = useCallback(() => session.lock(), [session]);

  let state: FactoryDoorState = "no-key";
  if (publicKeyHex) state = unlocked ? "unlocked" : "locked";

  return {
    state,
    publicKeyHex,
    hasFingerprint,
    makeKey,
    unlockWithWords,
    unlockWithFingerprint,
    enableFingerprint,
    removeFingerprint,
    getKey,
    expiresAt,
    lock,
  };
}
