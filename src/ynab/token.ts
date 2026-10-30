import type { vault } from "bsv-kit/bsv";

/** Where the sealed token is kept (the same device-only storage as the key's vault): ciphertext only, never the token. */
export const YNAB_TOKEN_KEY = "tradetracker-ynab-token";

const INFO = new TextEncoder().encode("tradetracker/ynab-token/v1");

interface Sealed {
  iv: string;
  ciphertext: string;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The AES-GCM key the token is sealed with: derived (HKDF-SHA-256) from the factory key, so only the unlocked key opens it. */
async function sealingKey(key: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new Uint8Array(key), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seals the Personal Access Token under the unlocked key and keeps it in `storage`. */
export async function sealToken(storage: vault.Storage, key: Uint8Array, token: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealingKey(key), new TextEncoder().encode(token)),
  );
  const sealed: Sealed = { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
  await storage.set(YNAB_TOKEN_KEY, JSON.stringify(sealed));
}

/** The token, opened with the unlocked key; null when none is kept, it is damaged, or the key is another. */
export async function openToken(storage: vault.Storage, key: Uint8Array): Promise<string | null> {
  const raw = await storage.get(YNAB_TOKEN_KEY);
  if (raw === null) return null;
  try {
    const sealed = JSON.parse(raw) as Sealed;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) },
      await sealingKey(key),
      fromBase64(sealed.ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function hasSealedToken(storage: vault.Storage): Promise<boolean> {
  return (await storage.get(YNAB_TOKEN_KEY)) !== null;
}

export async function forgetToken(storage: vault.Storage): Promise<void> {
  await storage.remove(YNAB_TOKEN_KEY);
}
