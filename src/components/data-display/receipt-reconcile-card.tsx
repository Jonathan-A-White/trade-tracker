import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { grist } from "bsv-kit/grist";
import { ReceiptCamera } from "@/components/scanner/receipt-camera";
import { formatCurrency } from "@/core/pricing";
import { useReceiptClient } from "@/hooks/use-receipt-client";
import { RECEIPT_STILL, stillFromFile } from "@/scanner/capture-still";
import {
  applyReceiptAnswer,
  buildReceiptRequest,
  reconcileReceipt,
} from "@/services/receipt-reconcile";
import type { ReceiptApplyResult, ReceiptChange } from "@/services/receipt-reconcile";

/** The grind takes one to three photos of a receipt. */
export const MAX_RECEIPT_PHOTOS = 3;

interface ReceiptReconcileCardProps {
  tripId: string;
  /** The receipt's total, when the factory read one. */
  onTotal: (total: number) => void;
}

async function toPhoto(blob: Blob): Promise<grist.Photo> {
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

function describeChange(change: ReceiptChange): string {
  const parts = [`${formatCurrency(change.oldPrice)} → ${formatCurrency(change.newPrice)}`];
  if (change.newQuantity !== change.oldQuantity) {
    parts.push(`${change.oldQuantity} → ${change.newQuantity} bought`);
  }
  if (change.newWeightLbs !== change.oldWeightLbs && change.newWeightLbs !== null) {
    parts.push(`${change.newWeightLbs} lb`);
  }
  return parts.join(", ");
}

/**
 * End Trip: photograph the receipt, send it with the trip's lines to the factory, and let its answer
 * update every matched line's price and the receipt total, then list what changed.
 */
export function ReceiptReconcileCard({ tripId, onTotal }: ReceiptReconcileCardProps) {
  const { ready, getClient } = useReceiptClient();
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptApplyResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const full = photos.length >= MAX_RECEIPT_PHOTOS;

  function addPhoto(photo: Blob) {
    setPhotos((prev) => [...prev, photo].slice(0, MAX_RECEIPT_PHOTOS));
    setResult(null);
    setError(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      addPhoto(await stillFromFile(file, RECEIPT_STILL));
    } catch (err) {
      console.error("Failed to read the chosen photo:", err);
      setError("Could not use that photo. Try another one.");
    }
  }

  function handleTake(photo: Blob) {
    addPhoto(photo);
    if (photos.length + 1 >= MAX_RECEIPT_PHOTOS) setCameraOpen(false);
  }

  async function handleSend() {
    const client = getClient();
    if (!client) {
      setError("The factory is not ready. Unlock it under Settings.");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setWaiting(true);
    setError(null);
    setResult(null);
    try {
      const request = await buildReceiptRequest(tripId);
      const outcome = await reconcileReceipt(client, request, await Promise.all(photos.map(toPhoto)), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      const applied = await applyReceiptAnswer(tripId, outcome.answer);
      if (controller.signal.aborted) return;
      if (applied.total !== null) onTotal(applied.total);
      setResult(applied);
      setPhotos([]);
    } catch (err) {
      console.error("Failed to reconcile the receipt:", err);
      if (!controller.signal.aborted) {
        setError("The receipt could not be used, and your trip is as it was. Please try again.");
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      if (!controller.signal.aborted) setWaiting(false);
    }
  }

  const button =
    "rounded-lg px-4 py-3 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const primary = `${button} bg-blue-600 text-white hover:bg-blue-700`;
  const secondary = `${button} border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700`;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        Check against the receipt
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Photograph the receipt and the factory updates each line's price and the receipt total. Barcodes are kept.
      </p>

      {!ready && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          The factory needs a licence to read a receipt. Set it up under Settings.
        </p>
      )}

      {photos.length > 0 && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {photos.length} photo{photos.length === 1 ? "" : "s"} ready
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={!ready || waiting || full}
          className={photos.length === 0 ? primary : secondary}
        >
          {photos.length === 0 ? "Photograph receipt" : "Add another photo"}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={!ready || waiting || full}
          className={secondary}
        >
          Choose a photo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
          data-testid="receipt-file-input"
        />
      </div>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleSend} disabled={waiting} className={primary}>
            Send receipt
          </button>
          <button
            type="button"
            onClick={() => setPhotos([])}
            disabled={waiting}
            className={secondary}
          >
            Clear photos
          </button>
        </div>
      )}

      {waiting && (
        <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
          Waiting for the factory to read your receipt. This can take a minute or two.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 border-t dark:border-gray-700 pt-3">
          {result.unreadable && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{result.unreadable}</p>
          )}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">What changed</h3>
            {result.changes.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Every matched price already agreed with the receipt.
              </p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {result.changes.map((change) => (
                  <li key={change.tripItemId} className="flex justify-between gap-3">
                    <span className="text-gray-900 dark:text-gray-100">{change.name}</span>
                    <span className="text-gray-600 dark:text-gray-300 text-right">
                      {describeChange(change)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Not matched: {result.unmatched.length}
            </h3>
            {result.unmatched.length > 0 && (
              <ul className="mt-1 space-y-1 text-sm">
                {result.unmatched.map((line, index) => (
                  <li key={index} className="flex justify-between gap-3">
                    <span className="text-gray-900 dark:text-gray-100">{line.text}</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      {formatCurrency(line.price)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {cameraOpen && (
        <ReceiptCamera
          taken={photos.length}
          maxPhotos={MAX_RECEIPT_PHOTOS}
          onTake={handleTake}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}
