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
  /**
   * Polls until the mill's answer arrives, reading from the grist's own place in the backend's index; rejects with an
   * AbortError when the signal aborts.
   */
  awaitAnswer<A = unknown>(txid: string, signal?: AbortSignal): Promise<GristAnswer<A>>;
  /** Reads the backend once, from the grist's place to the head: the mill's answer, or null when it has sent none. */
  findAnswer<A = unknown>(txid: string, signal?: AbortSignal): Promise<GristAnswer<A> | null>;
}

/** Waits `ms`, or rejects with an AwaitAbortedError when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new grist.AwaitAbortedError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new grist.AwaitAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The mill for this app at `backendUrl`, signing with the unlocked `key`. `licence` is read at every call, so a
 * licence that goes while a lookup is in flight stops the next send or poll.
 */
export function openMill(backendUrl: string, key: Uint8Array, licence: () => MillLicence): AppMill {
  const d = new door.Door({ baseUrl: backendUrl, key });
  const mill = grist.createMill({ door: d, key, licence });

  /** A call of the door's own, refused as the mill refuses one while the AI is not allowed; an abort is an AwaitAbortedError. */
  const ask = async (path: string, signal?: AbortSignal): Promise<Response> => {
    const state = licence();
    if (state !== "licensed") throw new grist.NotAllowed(state);
    if (signal?.aborted) throw new grist.AwaitAbortedError();
    try {
      const response = await d.fetch(path, { signal });
      if (!response.ok) throw new Error(`The backend answered ${response.status} to /api${path.split("?")[0]}.`);
      return response;
    } catch (err) {
      if (signal?.aborted) throw new grist.AwaitAbortedError();
      throw err;
    }
  };

  /**
   * The mill's key, and where the grist sits in the backend's index (GET /api/messages?txid=). Its answer is indexed
   * after it, so a read starts there: read from 0, every record of the key's whole history comes down and every
   * older answer is opened before this one can be seen, which on a long history outlasts the app being open
   * (mw-31qug1.19). From the start only when the backend does not name the grist.
   */
  const startOf = async (txid: string, signal?: AbortSignal): Promise<{ millKey: string; since: number }> => {
    const me = (await (await ask("/me", signal)).json()) as { mill?: unknown };
    const millKey = typeof me.mill === "string" ? me.mill.trim() : "";
    if (!millKey) throw new Error("The backend names no mill key, so there is no answer to wait for.");
    const body = (await (await ask(`/messages?txid=${encodeURIComponent(txid)}`, signal)).json()) as {
      records?: { seq?: unknown; txid?: unknown }[];
    };
    const places = (body.records ?? [])
      .filter((r) => r.txid === txid && typeof r.seq === "number")
      .map((r) => r.seq as number);
    return { millKey, since: places.length > 0 ? Math.min(...places) : 0 };
  };

  return {
    send: async ({ kind, v, input, photos, clientId }) =>
      (await mill.send({ app: FACTORY_COLLECTION, kind, v, input, photos, clientId })).txid,
    awaitAnswer: async <A = unknown>(txid: string, signal?: AbortSignal) => {
      const start = await startOf(txid, signal);
      let since = start.since;
      for (;;) {
        const page = await mill.read<A>(txid, { since, mill: start.millKey, signal });
        if (page.answer) return page.answer;
        since = page.next;
        await pause(grist.POLL_INTERVAL_MS, signal);
      }
    },
    findAnswer: async <A = unknown>(txid: string, signal?: AbortSignal) => {
      const { millKey, since } = await startOf(txid, signal);
      return (await mill.read<A>(txid, { since, mill: millKey, signal })).answer;
    },
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
