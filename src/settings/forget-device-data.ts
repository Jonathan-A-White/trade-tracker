import { DATA_KEYS } from "@/move/keys";
import { SORT_CHANGED } from "@/sort/waiting";

// The localStorage keys that hold the Governor's data (what he sorted, what the family's mail showed, YNAB's tally of his payees and
// the categories he taught the suggestion) rather than a setting: the entries of src/move/keys.ts marked `data`. Clear All Data forgets
// these. Everything else the app keeps in localStorage is a setting or the key itself and stays (keys.ts says what each is):
// the theme, the connection switches, whose phone this is, the factory key and its fingerprint copy and backend URL, bsv-kit's licence and
// vault, and YNAB's rate-limit and failed-read clocks. The sealed YNAB token is cleared with YNAB itself (disconnectYnab), not here.

/** Forgets what this device keeps of the Governor's data in localStorage, and tells the open Sort screens to read again. */
export function forgetDeviceData(): void {
  try {
    for (const key of DATA_KEYS) localStorage.removeItem(key);
  } catch {
    // storage refused: nothing more to do
  }
  window.dispatchEvent(new Event(SORT_CHANGED));
}
