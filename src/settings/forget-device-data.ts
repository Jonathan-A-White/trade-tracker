import { forgetLastMail } from "@/family/last-mail";
import { HANDED_KEY, SORTED_KEY, SORT_CHANGED } from "@/sort/waiting";
import { HISTORY_KEY } from "@/sort/suggest";
import { KEPT_FEED_KEY, PENDING_CLAIMS_KEY } from "@/sort/useAlerts";

// The localStorage keys that hold the Governor's data (what he sorted, what the family's mail showed) rather than a setting.
// Clear All Data forgets these. Everything else the app keeps in localStorage is a setting or the key itself and stays:
//   tradetracker-theme               setting: light or dark
//   tradetracker-setting-*           setting: the connection switches (Family, YNAB)
//   tradetracker-family-me           setting: whose phone this is
//   tradetracker-factory-*           the factory key, its public half, the backend URL and the fingerprint unlock: who this device is
//   bsv-kit.licence, bsv-kit.vault   bsv-kit's own licence check and vault: the licence and the key are not data
//   tradetracker-ynab-busy-until     YNAB's own rate-limit wait: a service's clock, not data
//   tradetracker-ynab-token          cleared with YNAB itself (disconnectYnab), not here
const DATA_KEYS = [HANDED_KEY, SORTED_KEY, HISTORY_KEY, KEPT_FEED_KEY, PENDING_CLAIMS_KEY];

/** Forgets what this device keeps of the Governor's data in localStorage, and tells the open Sort screens to read again. */
export function forgetDeviceData(): void {
  try {
    for (const key of DATA_KEYS) localStorage.removeItem(key);
  } catch {
    // storage refused: nothing more to do
  }
  forgetLastMail();
  window.dispatchEvent(new Event(SORT_CHANGED));
}
