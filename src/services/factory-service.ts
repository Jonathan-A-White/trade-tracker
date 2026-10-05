import { vault } from "bsv-kit/bsv";

/** The Postern collection whose licence opens the factory door for this app. */
export const FACTORY_COLLECTION = "trade-tracker";
export const DEFAULT_BACKEND_URL = "https://postern.allmymind.org";

// Device-only settings: never exported, never in IndexedDB.
export const FACTORY_VAULT_KEY = "tradetracker-factory-key";
export const FACTORY_BACKEND_KEY = "tradetracker-factory-backend";

export const WRONG_PASSPHRASE = "That passphrase does not open the stored key.";

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
