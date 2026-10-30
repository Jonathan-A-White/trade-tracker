// The one gated mill client of the app, and the only file that imports bsv-kit/grist (only-mill-imports-grist.test.ts).
// Whatever goes to the mill is the AI, and the AI is allowed only on a licensed key: every send and every wait goes
// through bsv-kit's createMill, which throws NotAllowed (reason 'checking' or 'unlicensed') before it touches anything.
import { door, vault } from "bsv-kit/bsv";
import { grist } from "bsv-kit/grist";
import { FACTORY_COLLECTION } from "@/services/factory-service";

export type Photo = grist.Photo;
export type GristAnswer<A = unknown> = grist.GristAnswer<A>;
/** Where the licence check stands; only 'licensed' lets the mill through. */
export type MillLicence = grist.MillLicence;

export const AwaitAbortedError = grist.AwaitAbortedError;
export const GristInputError = grist.GristInputError;
export const NotAllowed = grist.NotAllowed;
/** The most one sealed record may be. */
export const MAX_PAYLOAD_BYTES = grist.MAX_PAYLOAD_BYTES;

/** What one grist sends: the grind (kind and the version of its input schema), its input and its photos. */
export interface MillSend {
  kind: string;
  v: string;
  input: unknown;
  photos?: Photo[];
  /** The row's id, so the backend stores a retried send once. */
  clientId?: string;
}

export interface AppMill {
  /** Uploads the photos and posts the grist; resolves with its txid. */
  send(call: MillSend): Promise<string>;
  /** Polls until the mill's answer arrives; rejects with an AbortError when the signal aborts. */
  awaitAnswer<A = unknown>(txid: string, signal?: AbortSignal): Promise<GristAnswer<A>>;
}

/**
 * The mill for this app at `backendUrl`, signing with the unlocked `key`. `licence` is read at every call, so a
 * licence that goes while a lookup is in flight stops the next send or poll.
 */
export function openMill(backendUrl: string, key: Uint8Array, licence: () => MillLicence): AppMill {
  const mill = grist.createMill({ door: new door.Door({ baseUrl: backendUrl, key }), key, licence });
  return {
    send: async ({ kind, v, input, photos, clientId }) =>
      (await mill.send({ app: FACTORY_COLLECTION, kind, v, input, photos, clientId })).txid,
    awaitAnswer: (txid, signal) => mill.wait(txid, { signal }),
  };
}

/**
 * The bytes of the record the mill's send would post for this grist, sealed the way its own size check
 * seals it (each photo stood in for by the longest attachment entry an upload can name). A sealed
 * message is the same size whoever it is sealed to, so it is sealed to the app's own key.
 */
export function sealedRecordBytes(
  key: Uint8Array,
  kind: string,
  v: string,
  input: unknown,
  photoCount: number,
): number {
  const attachments = Array.from({ length: photoCount }, () => ({
    hash: "0".repeat(64),
    size: 99_999_999,
    mime: "image/webp",
  }));
  const plaintext = { grist: { app: FACTORY_COLLECTION, kind, v }, input, attachments };
  const envelope = grist.sealEnvelope(
    JSON.stringify(plaintext),
    key,
    vault.publicKeyHexFromKey(key),
    Math.floor(Date.now() / 1000),
  );
  return new TextEncoder().encode(JSON.stringify(envelope)).length;
}
