// The phone's side of the backend's alerts routes (Postern docs/protocol.md 26): the family's address, its feed, and a claim. Every call
// is signed by the unlocked key through bsv-kit's door, as the mill's are; the backend answers them only for a licensed key.
import { door } from "bsv-kit/bsv";

/** How often the open Family row asks the feed for Gmail's confirmation. */
export const ALERT_POLL_MS = 5000;

export type FamilyAlertKind = "charge" | "forward-confirm" | "amazon" | "unread";

/** One alert, parsed facts only (the backend never holds a mail). `amount` is a string as the receiver parsed it: "42.17". */
export interface FamilyAlert {
  id: string;
  seq: number;
  kind: FamilyAlertKind;
  amount?: string;
  merchant?: string;
  last4?: string;
  when?: string;
  subject?: string;
  /** a forward-confirm alert's confirmation code */
  code?: string;
}

export interface AlertsPage {
  alerts: FamilyAlert[];
  /** the cursor to ask from next time */
  next: number;
}

export interface AlertsClient {
  /** POST /api/alerts/address: the family's address, made the first time and the same after. */
  address(): Promise<string>;
  /** GET /api/alerts?since=: the family's alerts after `since`, oldest first. */
  list(since: number): Promise<AlertsPage>;
  /** DELETE /api/alerts/{id}: the alert is gone for every phone of the family. True when this call claimed it, false when it was gone already (404: another phone claimed it). */
  claim(id: string): Promise<boolean>;
}

/** The plain sentence for a status the backend answered with that is not a success. */
function refusal(status: number): Error {
  if (status === 501) return new Error("This backend does not keep alerts yet.");
  if (status === 403) return new Error("This key may not read the family's alerts.");
  return new Error(`The backend could not answer (${status}).`);
}

function isAlert(value: unknown): value is FamilyAlert {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return typeof a.id === "string" && typeof a.seq === "number" && typeof a.kind === "string";
}

/** The alerts client for `backendUrl`, signing with `key`. `fetchImpl` is the global fetch by default. */
export function makeAlertsClient(backendUrl: string, key: Uint8Array, fetchImpl?: typeof fetch): AlertsClient {
  const gate = new door.Door({ baseUrl: backendUrl, key, fetch: fetchImpl });
  return {
    async address() {
      const response = await gate.fetch("/alerts/address", { method: "POST" });
      if (!response.ok) throw refusal(response.status);
      const body = (await response.json()) as { address?: unknown };
      if (typeof body.address !== "string" || !body.address.includes("@")) {
        throw new Error("The backend sent an address this app cannot read.");
      }
      return body.address;
    },
    async list(since) {
      const response = await gate.fetch(`/alerts?since=${since}`);
      if (!response.ok) throw refusal(response.status);
      const body = (await response.json()) as { alerts?: unknown; next?: unknown };
      if (!Array.isArray(body.alerts) || typeof body.next !== "number") {
        throw new Error("The backend sent a list of alerts this app cannot read.");
      }
      return { alerts: body.alerts.filter(isAlert), next: body.next };
    },
    async claim(id) {
      const response = await gate.fetch(`/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (response.status === 404) return false;
      if (!response.ok) throw refusal(response.status);
      return true;
    },
  };
}
