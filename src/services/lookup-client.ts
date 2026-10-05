import { door } from "bsv-kit/bsv";
import { grist } from "bsv-kit/grist";
import { FACTORY_COLLECTION } from "@/services/factory-service";
import type { LookupClient } from "@/services/lookup-runner";

/** The grind the lookup runs: grinds/item-from-photos.json, version 1.0 of its input and answer. */
export const LOOKUP_KIND = "item-from-photos";
export const LOOKUP_VERSION = "1.0";

/** The runner's client over bsv-kit/grist, signing every call with the unlocked key. */
export function makeLookupClient(backendUrl: string, key: Uint8Array): LookupClient {
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
