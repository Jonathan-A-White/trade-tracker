import { door } from "bsv-kit/bsv";
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

/** A receipt-reconcile client over the key the lookup queue was last given; null before any. */
export function currentReceiptClient(): ReceiptClient | null {
  if (!latest) return null;
  const { backendUrl, key } = latest;
  const d = new door.Door({ baseUrl: backendUrl, key });
  return {
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
