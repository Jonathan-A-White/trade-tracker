import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vault } from "bsv-kit/bsv";
import { DEFAULT_LICENCE_STORAGE_KEY } from "bsv-kit/bsv/react";
import { OWNED_KEYS, ownedKeyNote, ownsKey } from "./keys";

// Literals that begin 'tradetracker' or 'bsv-kit.' in src/ and are NOT localStorage keys: an event or message name, a salt, a file name, a label.
// A new literal that is not here and not in OWNED_KEYS fails the test below, so a storage key added later cannot be missed by the pack.
const NOT_STORAGE: Record<string, string> = {
  "tradetracker-factory-prf-v1": "the passkey PRF salt, not a key",
  "tradetracker-sort-changed": "a window event name",
  "tradetracker-alert-push": "the message the service worker posts to a page",
  "tradetracker:data-cleared": "a window event name",
  "tradetracker/ynab-token/v1": "the HKDF info string that seals the YNAB token",
  "tradetracker-backup-": "the Export Backup file name",
  "tradetracker-items-": "the items export file name",
  "tradetracker-trips-": "the trips export file name",
  "tradetracker-move-": "the pack's file name",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("OWNED_KEYS", () => {
  it("names every storage key the app's source uses", () => {
    const root = join(process.cwd(), "src");
    const skip = join(root, "move", "keys.ts");
    const found = new Map<string, string>();
    for (const file of sourceFiles(root)) {
      if (file === skip) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/["'`](tradetracker[-.:/][\w.:/*-]*|bsv-kit\.[\w.-]*)/g)) {
        if (!found.has(m[1])) found.set(m[1], file.slice(root.length + 1));
      }
    }
    expect(found.size).toBeGreaterThan(10);
    const missing = [...found].filter(([literal]) => !ownsKey(literal) && !(literal in NOT_STORAGE));
    expect(
      missing.map(([literal, file]) => `${literal} (${file})`),
      "storage keys the list in src/move/keys.ts lacks; add each with a note, or list it as not a storage key in this test",
    ).toEqual([]);
  });

  it("does not list a not-storage literal as a key", () => {
    for (const literal of Object.keys(NOT_STORAGE)) expect(ownsKey(literal), literal).toBe(false);
  });

  it("lists the keys the story names, each with a note", () => {
    for (const key of [
      "tradetracker-theme",
      "tradetracker-setting-ynab",
      "tradetracker-family-me",
      "tradetracker-factory-key",
      "tradetracker-factory-public",
      "tradetracker-factory-backend",
      "tradetracker-factory-fingerprint",
      "tradetracker-factory-fingerprint-credential",
      "tradetracker-ynab-token",
      "tradetracker-ynab-tally",
      "tradetracker-sort-handed",
      "tradetracker-alerts-kept",
      "tradetracker.family-last-mail",
      "bsv-kit.licence",
      "bsv-kit.vault",
    ]) {
      expect(ownsKey(key), key).toBe(true);
      expect(ownedKeyNote(key)?.length ?? 0, key).toBeGreaterThan(10);
    }
    expect(ownsKey("someone-elses-key")).toBe(false);
    for (const entry of OWNED_KEYS) expect(entry.note.length, entry.key).toBeGreaterThan(10);
  });

  it("agrees with bsv-kit's own names for its keys", () => {
    expect(ownsKey(DEFAULT_LICENCE_STORAGE_KEY)).toBe(true);
    expect(ownsKey(vault.DEFAULT_VAULT_KEY)).toBe(true);
  });
});
