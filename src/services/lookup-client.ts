import { door, vault } from "bsv-kit/bsv";
import { grist } from "bsv-kit/grist";
import { FACTORY_COLLECTION } from "@/services/factory-service";
import type { LookupClient } from "@/services/lookup-runner";
import { RECEIPT_KIND, RECEIPT_VERSION } from "@/services/receipt-reconcile";
import type { ReceiptClient } from "@/services/receipt-reconcile";

/** The grind the lookup runs: grinds/item-from-photos.json, version 1.0 of its input and answer. */
export const LOOKUP_KIND = "item-from-photos";
export const LOOKUP_VERSION = "1.0";

/**
 * The backend and key of the latest lookup client: FactoryProvider builds one each time the door
 * is licensed, and the End Trip page reaches the same key through it for a receipt, since the
 * provider does not hand the key out.
 */
let latest: { backendUrl: string; key: Uint8Array } | null = null;

/**
 * The bytes of the record bsv-kit's send would post for this grist, sealed the way its own size check
 * seals it (each photo stood in for by the longest attachment entry an upload can name). A sealed
 * message is the same size whoever it is sealed to, so it is sealed to the app's own key.
 */
function sealedRecordBytes(
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

/** A receipt-reconcile client over the key the lookup queue was last given; null before any. */
export function currentReceiptClient(): ReceiptClient | null {
  if (!latest) return null;
  const { backendUrl, key } = latest;
  const d = new door.Door({ baseUrl: backendUrl, key });
  return {
    measure: (input, photoCount) => ({
      bytes: sealedRecordBytes(key, RECEIPT_KIND, RECEIPT_VERSION, input, photoCount),
      cap: grist.MAX_PAYLOAD_BYTES,
    }),
    send: ({ input, photos, clientId }) =>
      grist.sendGrist({
        door: d,
        key,
        app: FACTORY_COLLECTION,
        kind: RECEIPT_KIND,
        v: RECEIPT_VERSION,
        input,
        photos,
        clientId,
      }),
    awaitAnswer: (txid, signal) => grist.awaitAnswer(txid, { door: d, key, signal }),
  };
}

/** The runner's client over bsv-kit/grist, signing every call with the unlocked key. */
export function makeLookupClient(backendUrl: string, key: Uint8Array): LookupClient {
  latest = { backendUrl, key };
  const d = new door.Door({ baseUrl: backendUrl, key });
  return {
    send: (request) =>
      grist.sendGrist({
        door: d,
        key,
        app: FACTORY_COLLECTION,
        kind: LOOKUP_KIND,
        v: LOOKUP_VERSION,
        input: {
          barcode: request.barcode,
          mode: request.mode,
          categories: request.categories,
        },
        photos: request.photos,
        clientId: request.clientId,
      }),
    awaitAnswer: (txid, signal) => grist.awaitAnswer(txid, { door: d, key, signal }),
  };
}
