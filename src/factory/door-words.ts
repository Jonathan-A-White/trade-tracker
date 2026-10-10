import type { FactoryDoorState, FactoryLicence } from "@/contracts/types";

/**
 * What to tell the Governor about the factory's door when a feature needs it open, in plain words
 * that name the actual state (no key, locked, or a key without a licence); null when it is open.
 * `licence` is the provider's reading of the unlocked key's licence.
 */
export function doorWords(door: FactoryDoorState, licence: FactoryLicence | null): string | null {
  switch (door) {
    case "licensed":
      return null;
    case "no-key":
      return "Set up the factory in Settings";
    case "locked":
      return "Locked. Unlock with your fingerprint to read a receipt.";
    case "unlocked":
      switch (licence) {
        case "none":
        case "revoked":
          return "This key holds no TradeTracker licence.";
        case "indexing":
          return "The licence is on its way. Try again in a minute.";
        case "unknown":
          return "Could not check the licence just now. Open Settings to check again.";
        default:
          return "Checking the licence.";
      }
  }
}
