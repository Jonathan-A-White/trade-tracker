import { db as appDb, type TradeTrackerDB } from "@/db/database";
import { ownsKey } from "./keys";

// Settings > Move's pack: one file carrying everything this phone holds, so a phone at a new address can take it up again (src/move/unpack.ts
// is the other half). It is a whole-phone copy and not the Export Backup (src/services/export-service.ts), which carries five tables and no key.
//   - every table of TradeTrackerDB, read whole through db.tables (never a list kept by hand, so a table added later is carried);
//   - every localStorage key the app owns (src/move/keys.ts), carried as it is: the factory key's copies and the sealed YNAB token stay sealed.
// A Blob (a pending lookup's photos) is carried as { blob: <base64>, type } and restored as a Blob.

export const PACK_VERSION = 1;
export const PACK_APP = "trade-tracker";

export interface Pack {
  version: typeof PACK_VERSION;
  app: typeof PACK_APP;
  /** The origin the pack was made at. */
  from: string;
  /** ISO time. */
  when: string;
  db: {
    /** The database's schema version (db.verno) when it was packed. */
    schema: number;
    tables: Record<string, unknown[]>;
  };
  storage: Record<string, string>;
}

/** What the phone's localStorage is, as far as the pack reads it. */
export type PackStorage = Pick<Storage, "length" | "key" | "getItem">;

export interface PackOptions {
  db?: TradeTrackerDB;
  storage?: PackStorage;
  now?: Date;
  origin?: string;
}

interface EncodedBlob {
  blob: string;
  type: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** A value of a row as JSON can carry it: a Blob becomes { blob, type }; anything JSON would change or lose (a Date, a typed array, a Map) is refused. */
async function encode(value: unknown, where: string): Promise<unknown> {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot pack ${where}: a number that is not finite.`);
    return value;
  }
  if (value instanceof Blob) {
    const encoded: EncodedBlob = { blob: bytesToBase64(new Uint8Array(await value.arrayBuffer())), type: value.type };
    return encoded;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v, i) => encode(v, `${where}[${i}]`)));
  const proto: unknown = Object.getPrototypeOf(value);
  if (typeof value === "object" && (proto === Object.prototype || proto === null)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await encode(v, `${where}.${k}`);
    return out;
  }
  throw new Error(`Cannot pack ${where}: a value JSON cannot carry.`);
}

/** The pack of this phone: every table whole, and every owned localStorage key found. Deletes nothing. */
export async function packPhone(options: PackOptions = {}): Promise<Pack> {
  const db = options.db ?? appDb;
  const storage = options.storage ?? localStorage;
  await db.open();
  // one read transaction over every table, so the rows are one moment of the phone
  const raw = await db.transaction("r", db.tables, async () =>
    Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()] as const)),
  );
  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of raw) tables[name] = (await encode(rows, name)) as unknown[];

  const kept: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null || !ownsKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) kept[key] = value;
  }

  return {
    version: PACK_VERSION,
    app: PACK_APP,
    from: options.origin ?? location.origin,
    when: (options.now ?? new Date()).toISOString(),
    db: { schema: db.verno, tables },
    storage: kept,
  };
}

export interface PackCounts {
  stores: number;
  items: number;
  trips: number;
  priceHistory: number;
  photos: number;
}

/** What a pack holds, in the words the Move section says. `photos` counts the pending lookups' photos. */
export function packCounts(pack: Pack): PackCounts {
  const rows = (name: string) => pack.db.tables[name] ?? [];
  const photos = rows("pendingLookups").reduce<number>((sum, row) => {
    const held = (row as { photos?: unknown }).photos;
    return sum + (Array.isArray(held) ? held.length : 0);
  }, 0);
  return {
    stores: rows("stores").length,
    items: rows("items").length,
    trips: rows("trips").length,
    priceHistory: rows("priceHistory").length,
    photos,
  };
}
