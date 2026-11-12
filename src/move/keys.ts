import { vault } from "bsv-kit/bsv";
import { DEFAULT_LICENCE_STORAGE_KEY } from "bsv-kit/bsv/react";
import { LAST_MAIL_KEY } from "@/family/last-mail";
import {
  FACTORY_BACKEND_KEY,
  FACTORY_FINGERPRINT_CREDENTIAL_KEY,
  FACTORY_FINGERPRINT_VAULT_KEY,
  FACTORY_PUBLIC_KEY,
  FACTORY_VAULT_KEY,
} from "@/services/factory-service";
import { SETTING_PREFIX } from "@/settings/connections";
import { HISTORY_KEY, LEARNED_KEY } from "@/sort/suggest";
import { HANDED_KEY, ME_KEY, SORTED_KEY } from "@/sort/waiting";
import { KEPT_FEED_KEY, PENDING_CLAIMS_KEY } from "@/sort/useAlerts";
import { CHARGES_KEY, DISMISSED_KEY, IDEA_SETTINGS_KEY, INTRODUCED_KEY, KINDS_KEY } from "@/ynab/budget-ideas";
import { SHORT_RULE_KEY } from "@/ynab/payee-rules";
import { TALLY_FAILED_KEY, TALLY_KEY } from "@/ynab/tally";
import { YNAB_TOKEN_KEY } from "@/ynab/token";
import { YNAB_BUSY_KEY } from "@/ynab/writer";

// The one list of the localStorage keys this app owns. Two things read it: Settings > Move's pack (src/move/pack.ts) carries exactly these
// keys to a new address, and Clear All Data (src/settings/forget-device-data.ts) forgets the ones marked `data`. src/move/keys.test.ts greps
// src/ for every 'tradetracker...' and 'bsv-kit.' literal and fails naming any that is neither here nor listed there as not a storage key,
// so a key added to the app later cannot be missed by the pack.
//
// Not here, and why (the sweep of mw-hmnm2xi.1): bsv-kit's key session (IndexedDB 'bsv-kit-session', the unlocked key wrapped with a
// non-extractable device key: cannot be carried, the new address unlocks with the 12 words or a new fingerprint), voice-kit's talk store
// (IndexedDB 'voice-kit-talks': not opened by this app), pwa-kit/whats-new's seen-version (unused by this app), pwa-kit/tap's
// 'pwa-kit:tapSettleMs' (an optional tuning knob), and the service worker's Workbox caches (rebuilt from the network at the new address).

export interface OwnedKey {
  /** The localStorage key, or its start when `prefix` is set. */
  key: string;
  /** Every key that starts with `key` is owned (the connection switches, one per connection). */
  prefix?: true;
  /** What it holds. */
  note: string;
  /** The Governor's data (what he sorted, what the family's mail showed), which Clear All Data forgets; the rest is a setting or who this device is. */
  data?: true;
  /** Bound to the address the app runs at (a passkey belongs to its hostname): the pack carries it, and the new address drops it and sets it up again. */
  perAddress?: true;
}

export const OWNED_KEYS: readonly OwnedKey[] = [
  { key: "tradetracker-theme", note: "Setting: light or dark." },
  { key: SETTING_PREFIX, prefix: true, note: "Setting: a connection's switch (Family, YNAB), On or Off." },
  { key: ME_KEY, note: "Setting: whose phone this is." },
  { key: FACTORY_VAULT_KEY, note: "The passphrase copy of the factory key (only a key made before the passphrase went away has one)." },
  { key: FACTORY_PUBLIC_KEY, note: "The factory key's public half, in the clear: who this device is, and what the licence hangs off." },
  { key: FACTORY_BACKEND_KEY, note: "Setting: the address of the factory backend." },
  { key: FACTORY_FINGERPRINT_VAULT_KEY, perAddress: true, note: "The factory key wrapped by the passkey's fingerprint secret; the passkey is per address, so it is enrolled again at a new one." },
  { key: FACTORY_FINGERPRINT_CREDENTIAL_KEY, perAddress: true, note: "The fingerprint passkey's credential id, beside its wrapped copy of the key." },
  { key: YNAB_TOKEN_KEY, note: "The YNAB personal access token, sealed under the factory key: ciphertext only, carried as it is." },
  { key: YNAB_BUSY_KEY, note: "YNAB's rate-limit wait: a service's clock." },
  { key: TALLY_KEY, data: true, note: "YNAB's tally of the Governor's payees and categories." },
  { key: TALLY_FAILED_KEY, note: "When the tally's last read of YNAB failed: a clock." },
  { key: KINDS_KEY, data: true, note: "What each payee's spend is for, as the AI said, for Budget ideas." },
  { key: CHARGES_KEY, data: true, note: "The charges to Stuff I Forgot to Budget For last read from YNAB, for Budget ideas." },
  { key: DISMISSED_KEY, data: true, note: "The Budget ideas the Governor answered Not now or Never." },
  { key: INTRODUCED_KEY, data: true, note: "The Budget ideas first shown this month." },
  { key: IDEA_SETTINGS_KEY, note: "Setting: what a Budget idea must pass (dollars over a year, or charges)." },
  { key: SHORT_RULE_KEY, note: "Setting: whether a payee rule approves a charge its category lacks the money for (and notes it), or leaves it for the Governor." },
  { key: HANDED_KEY, data: true, note: "The alerts this phone handed to the other person." },
  { key: SORTED_KEY, data: true, note: "What was sorted lately, by this phone or seen gone from the feed." },
  { key: HISTORY_KEY, data: true, note: "The categories chosen for a sort, newest last." },
  { key: LEARNED_KEY, data: true, note: "The category the Governor taught the suggestion for a merchant." },
  { key: KEPT_FEED_KEY, data: true, note: "The last read of the family's alert feed." },
  { key: PENDING_CLAIMS_KEY, data: true, note: "Claims this phone made that the backend has not taken yet." },
  { key: LAST_MAIL_KEY, data: true, note: "The time of the latest card or order alert this device saw." },
  { key: DEFAULT_LICENCE_STORAGE_KEY, note: "bsv-kit's licence check, kept for the 24 h grace; it hangs off the key, so the key carries it." },
  { key: vault.DEFAULT_VAULT_KEY, note: "bsv-kit's default vault slot for a sealed key." },
];

/** The listed entry that owns `key`, if any. */
function entryFor(key: string): OwnedKey | undefined {
  return OWNED_KEYS.find((e) => (e.prefix ? key.startsWith(e.key) : key === e.key));
}

/** Whether `key` is one of the app's localStorage keys. */
export function ownsKey(key: string): boolean {
  return entryFor(key) !== undefined;
}

/** What `key` holds, or undefined when the app does not own it. */
export function ownedKeyNote(key: string): string | undefined {
  return entryFor(key)?.note;
}

/** The exact keys that belong to the address they were made at (the entries marked `perAddress`): Unpack drops them, so the new address enrols again. */
export const PER_ADDRESS_KEYS: readonly string[] = OWNED_KEYS.filter((e) => e.perAddress).map((e) => e.key);

/** The exact keys Clear All Data forgets (the entries marked `data`). */
export const DATA_KEYS: readonly string[] = OWNED_KEYS.filter((e) => e.data).map((e) => e.key);
