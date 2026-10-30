import { createContext, useContext } from "react";
import type { FactoryLicence } from "@/contracts/types";

/** Why the phone is not sending to the factory right now; null when nothing holds it back. */
export type SendHold =
  | "no-key"
  | "locked"
  | "offline"
  | "licence-checking"
  | "no-licence"
  | "backing-off";

/**
 * Why nothing goes out, from what the app knows: the key, the connection, the licence, and whether
 * the queue is waiting out a failed send. First true reason wins; null when the queue is free to send.
 */
export function sendHold(state: {
  publicKeyHex: string | null;
  key: Uint8Array | null;
  online: boolean;
  licence: FactoryLicence | null;
  backingOff: boolean;
}): SendHold | null {
  if (!state.publicKeyHex) return "no-key";
  if (!state.key) return "locked";
  if (!state.online) return "offline";
  switch (state.licence) {
    case "unlicensed":
      return "no-licence";
    case "licensed":
      return state.backingOff ? "backing-off" : null;
    default:
      return "licence-checking";
  }
}

const HOLD_TEXT: Record<SendHold, string> = {
  "no-key": "Not sent: no factory key. Settings > Factory",
  locked: "Not sent: factory key is locked. Settings > Factory > Unlock",
  offline: "Not sent: offline, sends when you are back",
  "licence-checking": "Not sent: checking the licence",
  "no-licence": "Not sent: no licence",
  "backing-off": "Not sent yet, trying again",
};

/** The sentence a line shows while the phone has not sent it. */
export function sendHoldText(hold: SendHold): string {
  return HOLD_TEXT[hold];
}

/** What a receipt already sent says while the phone is not asking for its answer. */
const RECEIPT_HOLD_TEXT: Record<SendHold, string> = {
  "no-key": "Not checking for the answer: no factory key. Settings > Factory",
  locked: "Not checking for the answer: factory key is locked. Settings > Factory > Unlock",
  offline: "Not checking for the answer: offline, checks when you are back",
  "licence-checking": "Not checking for the answer: checking the licence",
  "no-licence": "Not checking for the answer: no licence",
  "backing-off": "Not checking for the answer just now, trying again",
};

export function receiptHoldText(hold: SendHold): string {
  return RECEIPT_HOLD_TEXT[hold];
}

/** The provider's reading, for the lines: lookups are held by `lookup`, a sent receipt's polling by `receipt`. */
export interface SendHolds {
  lookup: SendHold | null;
  receipt: SendHold | null;
}

const noHolds: SendHolds = { lookup: null, receipt: null };

export const SendHoldContext = createContext<SendHolds>(noHolds);

/** Why lookups are not going out; null with no factory provider around (then nothing is known to hold them). */
export function useSendHold(): SendHold | null {
  return useContext(SendHoldContext).lookup;
}

/** Why a sent receipt's answer is not being fetched. */
export function useReceiptHold(): SendHold | null {
  return useContext(SendHoldContext).receipt;
}
