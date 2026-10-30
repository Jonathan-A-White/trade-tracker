import { MAX_PAYLOAD_BYTES, openMill, sealedRecordBytes } from "@/factory/mill";
import type { MillLicence } from "@/factory/mill";
import type { LookupClient } from "@/services/lookup-runner";
import { RECEIPT_KIND, RECEIPT_VERSION } from "@/services/receipt-reconcile";
import type { ReceiptClient } from "@/services/receipt-reconcile";

/** The grind the lookup runs: grinds/item-from-photos.json, version 1.0 of its input and answer. */
export const LOOKUP_KIND = "item-from-photos";
export const LOOKUP_VERSION = "1.0";

/**
 * The backend, key and licence reading of the latest lookup client: FactoryProvider builds one each
 * time the door is licensed, and the End Trip page reaches the same key through it for a receipt,
 * since the provider does not hand the key out.
 */
let latest: { backendUrl: string; key: Uint8Array; licence: () => MillLicence } | null = null;

/** A receipt-reconcile client over the key the lookup queue was last given; null before any. */
export function currentReceiptClient(): ReceiptClient | null {
  if (!latest) return null;
  const { backendUrl, key, licence } = latest;
  const mill = openMill(backendUrl, key, licence);
  return {
    measure: (input, photoCount) => ({
      bytes: sealedRecordBytes(key, RECEIPT_KIND, RECEIPT_VERSION, input, photoCount),
      cap: MAX_PAYLOAD_BYTES,
    }),
    send: ({ input, photos, clientId }) =>
      mill.send({ kind: RECEIPT_KIND, v: RECEIPT_VERSION, input, photos, clientId }),
    awaitAnswer: (txid, signal) => mill.awaitAnswer(txid, signal),
  };
}

/**
 * The runner's client over the gated mill, signing every call with the unlocked key. `licence` is
 * read at each call: the mill refuses to send or poll while it is not 'licensed'.
 */
export function makeLookupClient(
  backendUrl: string,
  key: Uint8Array,
  licence: () => MillLicence,
): LookupClient {
  latest = { backendUrl, key, licence };
  const mill = openMill(backendUrl, key, licence);
  return {
    send: (request) =>
      mill.send({
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
    awaitAnswer: (txid, signal) => mill.awaitAnswer(txid, signal),
  };
}
