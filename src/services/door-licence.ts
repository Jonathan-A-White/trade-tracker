import { door } from "bsv-kit/bsv";
import { FACTORY_COLLECTION } from "@/services/factory-service";

/**
 * What the Postern door says about the key's licence for this app:
 * "held" (the door lists the app), "none" (it says the key holds no licence for it), or
 * "unreachable" (offline, a timeout, a 5xx, an older backend, a refused proof: no answer).
 */
export type DoorLicenceAnswer = "held" | "none" | "unreachable";

/** Asks the door at `backendUrl`, signing with the unlocked key; never rejects. */
export type DoorLicenceAsker = (backendUrl: string, key: Uint8Array) => Promise<DoorLicenceAnswer>;

/**
 * A signed GET /api/me. The reply's `apps` names the apps the key's licences open (the backend maps
 * the collection trade-tracker to the app trade-tracker); bsv-kit's Me parser drops it, so the JSON
 * is read here. `fetchImpl` is for tests.
 */
export const askDoorLicence = async (
  backendUrl: string,
  key: Uint8Array,
  fetchImpl?: typeof fetch,
): Promise<DoorLicenceAnswer> => {
  try {
    const d = new door.Door({ baseUrl: backendUrl, key, fetch: fetchImpl });
    const response = await d.fetch("/me");
    if (response.status !== 200) return "unreachable";
    const body = (await response.json()) as { apps?: unknown };
    const apps = Array.isArray(body.apps) ? body.apps : [];
    return apps.includes(FACTORY_COLLECTION) ? "held" : "none";
  } catch (err) {
    // Door.fetch turns a 401 that says no licence into this refusal; any other failure is no answer.
    if (err instanceof door.RefusedError && err.message === door.LICENCE_REQUIRED) return "none";
    return "unreachable";
  }
};
