import type { PendingLookup } from "@/contracts/types";

/** Postern may hold a grist for minutes while the factory is busy, so the limits are generous. */
export const RESEND_AFTER_MS = 3 * 60_000;
export const GIVE_UP_AFTER_MS = 3 * 60_000;

export interface LookupWaitLimits {
  /** How long a sent lookup may wait for its answer before it is sent once more. */
  resendAfterMs: number;
  /** How long after that second send the line gives up and says the answer did not come back. */
  giveUpAfterMs: number;
}

export const DEFAULT_WAIT_LIMITS: LookupWaitLimits = {
  resendAfterMs: RESEND_AFTER_MS,
  giveUpAfterMs: GIVE_UP_AFTER_MS,
};

/**
 * When the grist went out: the stored send time, or, for a lookup sent before the app kept it, when
 * the lookup was made (never later than the send). The waits below are read from this stored time,
 * never from a clock that dies with the page.
 */
export function sentTimeOf(lookup: PendingLookup): number {
  return lookup.sentAt ?? lookup.createdAt;
}

/** When a sent lookup, not yet sent again, is due to be sent once more. */
export function resendDueAt(lookup: PendingLookup, limits: LookupWaitLimits = DEFAULT_WAIT_LIMITS): number {
  return sentTimeOf(lookup) + limits.resendAfterMs;
}

/**
 * When the line says the answer did not come back: the second limit after the second send, or, for a
 * lookup not sent again, both limits after the first send.
 */
export function notBackAt(lookup: PendingLookup, limits: LookupWaitLimits = DEFAULT_WAIT_LIMITS): number {
  return lookup.resentAt !== undefined
    ? lookup.resentAt + limits.giveUpAfterMs
    : sentTimeOf(lookup) + limits.resendAfterMs + limits.giveUpAfterMs;
}

/**
 * Whether a lookup at the factory did not come back: only once the runner has marked it so, which it does
 * after its limits ran out and a read of the backend found no answer. The stored times alone never say it:
 * with the app closed nobody has looked, and the answer may be waiting to be fetched (mw-31qug1.19).
 */
export function lookupNotBack(lookup: PendingLookup): boolean {
  return lookup.status === "at-the-factory" && lookup.notBack === true;
}
