import { useEffect, useState } from "react";
import type { PendingLookup } from "@/contracts/types";

interface PendingLineRowProps {
  lookup: PendingLookup;
  /** Each action shows only on the pages that can do it. */
  onFillByHand?: (lookupId: string) => void;
  onDiscard?: (lookupId: string) => void;
  onRetry?: (lookupId: string) => void;
  /** The quantity of the pending line; the control shows only with a handler. */
  quantity?: number;
  onQuantityChange?: (lookupId: string, quantity: number) => void;
}

/** What the line says of each state of its lookup. */
const STATE_TEXT: Record<PendingLookup["status"], string> = {
  "waiting-to-send": "Waiting on the factory",
  "at-the-factory": "At the factory",
  ready: "Answer ready",
  applied: "Filled in",
  failed: "The factory could not fill this in",
};

function useThumbnailUrl(photo: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== "function") return;
    const objectUrl = URL.createObjectURL(photo);
    // set after the effect body, so StrictMode's re-run never shows a revoked URL
    let live = true;
    queueMicrotask(() => {
      if (live) setUrl(objectUrl);
    });
    return () => {
      live = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [photo]);

  return photo ? url : undefined;
}

export function PendingLineRow({
  lookup,
  onFillByHand,
  onDiscard,
  onRetry,
  quantity,
  onQuantityChange,
}: PendingLineRowProps) {
  const thumbnail = useThumbnailUrl(lookup.photos[0]);

  return (
    <div className="border-b dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex items-center gap-3">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={`Photo of ${lookup.barcode}`}
            className="h-12 w-12 flex-none rounded-lg object-cover"
          />
        ) : (
          <div className="h-12 w-12 flex-none rounded-lg bg-gray-200 dark:bg-gray-700" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {lookup.barcode}
          </p>
          {lookup.status === "failed" ? (
            <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">
              {lookup.error || STATE_TEXT.failed}
            </p>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
              {STATE_TEXT[lookup.status]}
            </p>
          )}
        </div>
        {quantity !== undefined && (
          <div className="flex flex-none items-center gap-1">
            {onQuantityChange && (
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => onQuantityChange(lookup.id, quantity - 1)}
                className="h-8 w-8 rounded-lg border border-gray-300 dark:border-gray-600 text-lg leading-none text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                −
              </button>
            )}
            <span
              data-testid="pending-quantity"
              className="min-w-6 text-center font-medium text-gray-900 dark:text-gray-100"
            >
              {quantity}
            </span>
            {onQuantityChange && (
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => onQuantityChange(lookup.id, quantity + 1)}
                className="h-8 w-8 rounded-lg border border-gray-300 dark:border-gray-600 text-lg leading-none text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                +
              </button>
            )}
          </div>
        )}
      </div>
      {(onRetry || onFillByHand || onDiscard) && (
        <div className="mt-2 flex gap-3">
          {onRetry && lookup.status === "failed" && (
            <button
              type="button"
              onClick={() => onRetry(lookup.id)}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Retry
            </button>
          )}
          {onFillByHand && (
            <button
              type="button"
              onClick={() => onFillByHand(lookup.id)}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            >
              Fill by hand
            </button>
          )}
          {onDiscard && (
            <button
              type="button"
              onClick={() => onDiscard(lookup.id)}
              className="flex-1 rounded-lg border border-red-300 dark:border-red-700 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
            >
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}
