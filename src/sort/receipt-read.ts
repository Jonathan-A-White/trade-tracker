// Reading a receipt photographed for a charge on the Sort sheet. The camera page keeps the shots here by alert id and the sheet
// takes them on its way back; the receipt-reconcile grind reads the lines (no trip lines go with it), and the sheet asks the
// sort-charge grind to group them.
import type { ReceiptReconcileOutcome } from "@/services/receipt-reconcile";

/** At most this many photos of one receipt: the receipt grind takes one to three. */
export const RECEIPT_PHOTOS_MAX = 3;
/** The longest the sheet waits for the mill to read the receipt, and again for it to group the lines. */
export const RECEIPT_DEADLINE_MS = 180_000;

/** Reads the receipt photos of a charge at `merchant`; never throws, an answer that cannot be used comes back as a plain sentence. */
export type ReceiptReader = (merchant: string, photos: Blob[], signal: AbortSignal) => Promise<ReceiptReconcileOutcome>;

const shots = new Map<string, Blob[]>();

/** Keeps the photos taken for a charge until its sheet takes them. */
export function keepReceiptShots(alertId: string, photos: Blob[]): void {
  shots.set(alertId, photos);
}

export function receiptShotsOf(alertId: string): Blob[] | undefined {
  return shots.get(alertId);
}

export function dropReceiptShots(alertId: string): void {
  shots.delete(alertId);
}
