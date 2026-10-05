import { vault } from "bsv-kit/bsv";
import {
  credentialIdFromBase64,
  credentialIdToBase64,
  type PasskeyPort,
} from "@/services/passkey";

/** The Postern collection whose licence opens the factory door for this app. */
export const FACTORY_COLLECTION = "trade-tracker";
export const DEFAULT_BACKEND_URL = "https://postern.allmymind.org";

// Device-only settings: never exported, never in IndexedDB.
export const FACTORY_VAULT_KEY = "tradetracker-factory-key";
export const FACTORY_BACKEND_KEY = "tradetracker-factory-backend";
/** The second wrapped copy of the key, wrapped by the passkey's PRF secret; the passphrase copy stays as it is. */
export const FACTORY_FINGERPRINT_VAULT_KEY = "tradetracker-factory-fingerprint";
/** The passkey's credential id (base64), beside the fingerprint copy. */
export const FACTORY_FINGERPRINT_CREDENTIAL_KEY = "tradetracker-factory-fingerprint-credential";

export const WRONG_PASSPHRASE = "That passphrase does not open the stored key.";

export const NO_PRF_SECRET =
  "This device's passkey cannot unlock with a fingerprint here. Use your passphrase instead.";
export const WRONG_FINGERPRINT =
  "The fingerprint did not open the stored key. Remove it and set it up again, or use your passphrase.";

export interface UnlockedKey {
  key: Uint8Array;
  publicKeyHex: string;
}

export interface MadeKey extends UnlockedKey {
  /** The 12-word recovery phrase: shown once, never stored. */
  phrase: string;
}

/** The browser's localStorage behind bsv's storage port. */
export function browserStorage(): vault.Storage {
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
  };
}

/** The public key of the wrapped key kept on this device, read without a passphrase; null when none. */
export function storedPublicKeyHex(storage: vault.Storage = browserStorage()): string | null {
  const raw = storage.get(FACTORY_VAULT_KEY);
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const hex = (parsed as { publicKeyHex?: unknown } | null)?.publicKeyHex;
    return typeof hex === "string" && hex !== "" ? hex : null;
  } catch {
    return null;
  }
}

export async function makeKey(storage: vault.Storage, passphrase: string): Promise<MadeKey> {
  if (!passphrase.trim()) throw new Error("Type a passphrase first.");
  if ((await vault.loadVault(storage, FACTORY_VAULT_KEY)) !== null) {
    throw new Error("A key is already stored on this device. Unlock it instead.");
  }
  const made = await vault.generate();
  await vault.saveVault(storage, await vault.wrap(made.key, { passphrase }), FACTORY_VAULT_KEY);
  return { phrase: made.phrase, key: made.key, publicKeyHex: made.publicKeyHex };
}

export async function unlockKey(storage: vault.Storage, passphrase: string): Promise<UnlockedKey> {
  if (!passphrase.trim()) throw new Error("Type a passphrase first.");
  const wrapped = await vault.loadVault(storage, FACTORY_VAULT_KEY);
  if (!wrapped) throw new Error("No key is stored on this device yet. Make one first.");
  try {
    const key = await vault.unwrap(wrapped, { passphrase });
    return { key, publicKeyHex: vault.publicKeyHexFromKey(key) };
  } catch (err) {
    if (err instanceof vault.VaultError && err.code === "wrong-secret") {
      throw new Error(WRONG_PASSPHRASE);
    }
    throw err;
  }
}

/** Whether a fingerprint copy of the key is stored on this device. */
export function hasFingerprintCopy(storage: vault.Storage = browserStorage()): boolean {
  return (
    typeof storage.get(FACTORY_FINGERPRINT_VAULT_KEY) === "string" &&
    typeof storage.get(FACTORY_FINGERPRINT_CREDENTIAL_KEY) === "string"
  );
}

/**
 * Registers a passkey, reads its PRF secret and stores a second copy of `key` wrapped by it.
 * Stores nothing when the passkey gives no PRF secret.
 */
export async function addFingerprint(
  storage: vault.Storage,
  port: PasskeyPort,
  key: Uint8Array,
): Promise<void> {
  const publicKeyHex = vault.publicKeyHexFromKey(key);
  const passkey = await port.create(publicKeyHex.slice(0, 16), "TradeTracker factory key");
  // PRF may only evaluate on get(), so registration only detected support.
  const secret = await port.getPrfSecret(passkey.credentialId);
  if (!secret || secret.byteLength === 0) throw new Error(NO_PRF_SECRET);
  const wrapped = await vault.wrap(key, { prfSecret: secret });
  await vault.saveVault(storage, wrapped, FACTORY_FINGERPRINT_VAULT_KEY);
  await storage.set(FACTORY_FINGERPRINT_CREDENTIAL_KEY, credentialIdToBase64(passkey.credentialId));
}

export async function unlockWithFingerprint(
  storage: vault.Storage,
  port: PasskeyPort,
): Promise<UnlockedKey> {
  const wrapped = await vault.loadVault(storage, FACTORY_FINGERPRINT_VAULT_KEY);
  const credential = await storage.get(FACTORY_FINGERPRINT_CREDENTIAL_KEY);
  if (!wrapped || !credential) throw new Error("No fingerprint is set up on this device.");
  const secret = await port.getPrfSecret(credentialIdFromBase64(credential));
  if (!secret || secret.byteLength === 0) throw new Error(NO_PRF_SECRET);
  try {
    const key = await vault.unwrap(wrapped, { prfSecret: secret });
    return { key, publicKeyHex: vault.publicKeyHexFromKey(key) };
  } catch (err) {
    if (err instanceof vault.VaultError && err.code === "wrong-secret") {
      throw new Error(WRONG_FINGERPRINT);
    }
    throw err;
  }
}

/** Deletes the fingerprint copy only; the passphrase copy stays. */
export async function removeFingerprint(storage: vault.Storage): Promise<void> {
  await vault.removeVault(storage, FACTORY_FINGERPRINT_VAULT_KEY);
  await storage.remove(FACTORY_FINGERPRINT_CREDENTIAL_KEY);
}

/** The backend URL set on this device, or the default. */
export function readBackendUrl(): string {
  return localStorage.getItem(FACTORY_BACKEND_KEY)?.trim() || DEFAULT_BACKEND_URL;
}

/** Keeps the URL on this device; an empty one forgets it, so the default applies again. */
export function writeBackendUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) localStorage.setItem(FACTORY_BACKEND_KEY, trimmed);
  else localStorage.removeItem(FACTORY_BACKEND_KEY);
}
