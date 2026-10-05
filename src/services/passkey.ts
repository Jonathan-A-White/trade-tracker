// src/services/passkey.ts — wraps the WebAuthn PRF extension (adapted from Postern's
// webauthnPrf.ts): a platform passkey (fingerprint/face unlock) that, given a fixed
// salt, deterministically returns the same secret on every unlock. That secret wraps
// a copy of the factory key (bsv-kit's vault, { prfSecret }).
//
// The PRF extension isn't reliably evaluable during registration on every
// authenticator (the spec notes some can't compute outputs until they've been
// used once), so registration only detects support; a separate assertion
// ceremony evaluates the actual secret. MDN's WebAuthn extensions reference
// says as much explicitly: "evaluating a PRF when creating a credential may
// not be supported... You could still try evaluating the PRF in an
// assertion" — so a false/absent `prf.enabled` here must not by itself rule
// PRF out; only a failed or empty get() does.
const PRF_EVAL_SALT = new TextEncoder().encode("tradetracker-factory-prf-v1");

export interface PrfPasskey {
  credentialId: ArrayBuffer;
  prfSupported: boolean;
}

/** The WebAuthn calls, behind a port so tests can fake them. */
export interface PasskeyPort {
  isAvailable(): boolean;
  create(userId: string, userName: string): Promise<PrfPasskey>;
  /** The PRF secret for the credential, or null when the authenticator returned none. */
  getPrfSecret(credentialId: ArrayBuffer): Promise<ArrayBuffer | null>;
}

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.create === "function"
  );
}

export async function createPrfPasskey(userId: string, userName: string): Promise<PrfPasskey> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "TradeTracker" },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      // residentKey 'required' asks for a discoverable credential. Without it,
      // Chrome on Android may create a device-bound credential rather than a
      // Google Password Manager passkey — and PRF support on Android is
      // documented for Google Password Manager passkeys, not device-bound
      // credentials, which is why an otherwise-successful ceremony can come
      // back with no usable PRF secret.
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential;

  const results = credential.getClientExtensionResults() as { prf?: { enabled?: boolean } };

  return {
    credentialId: credential.rawId,
    prfSupported: results.prf?.enabled === true,
  };
}

export async function getPrfSecret(credentialId: ArrayBuffer): Promise<ArrayBuffer | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: credentialId, type: "public-key" }],
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_EVAL_SALT } } },
    },
  })) as PublicKeyCredential;

  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };

  return results.prf?.results?.first ?? null;
}

/** The real browser's WebAuthn. */
export const browserPasskeyPort: PasskeyPort = {
  isAvailable: isWebAuthnAvailable,
  create: createPrfPasskey,
  getPrfSecret,
};

// A dismissed or timed-out fingerprint prompt rejects navigator.credentials.get()
// with a DOMException named NotAllowedError whose message is the browser's own
// sentence plus a w3.org link — not an error of the person's making, and not text
// for a phone screen. Every fingerprint catch should show this instead of the raw
// err.message.
export function describeUnlockError(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Fingerprint cancelled. Tap the button to try again.";
  }
  if (err instanceof DOMException && err.name === "NotSupportedError") {
    return "This browser cannot use a fingerprint here; use your 12 words instead.";
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s*See:\s*https?:\/\/\S+/gi, "").replace(/https?:\/\/\S+/g, "").trim();
}

export function credentialIdToBase64(id: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(id)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function credentialIdFromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
