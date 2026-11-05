import { db as appDb, type TradeTrackerDB } from "@/db/database";
import { ownsKey } from "./keys";
import { PACK_APP, PACK_VERSION, type Pack } from "./pack";

// The restore half of the pack (src/move/pack.ts): puts a pack's tables and keys onto this phone. It writes the keys exactly as packed, so the
// factory key's copies and the sealed YNAB token come through sealed; what is per address (the fingerprint passkey, the push subscription)
// is set again by the screen that calls this (mw-hmnm2xi.2).

export interface UnpackOptions {
  db?: TradeTrackerDB;
  storage?: Pick<Storage, "setItem">;
}

export class NotAPackError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** A value as pack.ts encoded it, with every { blob, type } turned back into a Blob. */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 2 && typeof value.blob === "string" && typeof value.type === "string") {
    return new Blob([base64ToBytes(value.blob)], { type: value.type });
  }
  return Object.fromEntries(keys.map((k) => [k, decode(value[k])]));
}

/** The pack in `file` once checked: this app's, a version it reads, a schema it has, and no table it does not know. Throws a plain sentence otherwise. */
export function checkPack(file: unknown, db: TradeTrackerDB = appDb): Pack {
  if (!isRecord(file) || file.app !== PACK_APP || !isRecord(file.db) || !isRecord(file.db.tables) || !isRecord(file.storage)) {
    throw new NotAPackError("This file is not a Trade Tracker pack.");
  }
  if (file.version !== PACK_VERSION) {
    throw new NotAPackError(`This pack is version ${String(file.version)}; this app reads version ${PACK_VERSION}.`);
  }
  if (typeof file.db.schema !== "number" || file.db.schema > db.verno) {
    throw new NotAPackError("This pack was made by a newer Trade Tracker than this one. Update the app, then try again.");
  }
  const known = new Set(db.tables.map((t) => t.name));
  for (const [name, rows] of Object.entries(file.db.tables)) {
    if (!known.has(name)) throw new NotAPackError(`This pack has a table this app does not know: ${name}.`);
    if (!Array.isArray(rows)) throw new NotAPackError(`This pack's table ${name} is not a list of rows.`);
  }
  return file as unknown as Pack;
}

/**
 * Replaces this phone's tables with the pack's (every table of the database is emptied, then the pack's rows are put, in one transaction: a
 * failure leaves the phone as it was) and then writes the pack's owned keys to storage. A key the app does not own is not written.
 */
export async function unpackPhone(file: unknown, options: UnpackOptions = {}): Promise<void> {
  const db = options.db ?? appDb;
  const storage = options.storage ?? localStorage;
  const pack = checkPack(file, db);
  await db.open();
  const decoded = Object.entries(pack.db.tables).map(([name, rows]) => [name, rows.map(decode)] as const);
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    for (const [name, rows] of decoded) await db.table(name).bulkPut(rows);
  });
  for (const [key, value] of Object.entries(pack.storage)) {
    if (ownsKey(key) && typeof value === "string") storage.setItem(key, value);
  }
}
