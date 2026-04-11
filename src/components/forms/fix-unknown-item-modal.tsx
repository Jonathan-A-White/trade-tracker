import { useState, useCallback } from "react";
import type { FormEvent } from "react";
import { BarcodeInput } from "./barcode-input";
import { CategoryAutocomplete } from "./category-autocomplete";
import { ScannerViewfinder } from "../scanner/scanner-viewfinder";
import { isManualBarcode } from "@/services/trip-exchange-service";
import { ItemRepository } from "@/db/repositories/item-repository";

const itemRepo = new ItemRepository();

interface FixUnknownItemModalProps {
  itemId: string;
  currentPrice: number;
  onSave: (data: {
    itemId: string;
    name: string;
    barcode: string;
    currentPrice: number;
    unitType: string;
    category: string;
  }) => void | Promise<void>;
  onCancel: () => void;
  existingName?: string;
  existingBarcode?: string;
  existingUnitType?: string;
  existingCategory?: string;
}

export function FixUnknownItemModal({
  itemId,
  currentPrice,
  onSave,
  onCancel,
  existingName,
  existingBarcode,
  existingUnitType,
  existingCategory,
}: FixUnknownItemModalProps) {
  const hasManualBarcode = existingBarcode
    ? isManualBarcode(existingBarcode)
    : true;
  const [name, setName] = useState(existingName ?? "");
  const [barcode, setBarcode] = useState(
    hasManualBarcode ? "" : (existingBarcode ?? "")
  );
  const [unitType, setUnitType] = useState(existingUnitType ?? "each");
  const [category, setCategory] = useState(existingCategory ?? "");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBarcodeDetected = useCallback((detectedBarcode: string) => {
    setBarcode(detectedBarcode);
    setScannerOpen(false);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmedBarcode = barcode.trim();
    const finalBarcode =
      trimmedBarcode || `manual-${crypto.randomUUID()}`;

    setSubmitting(true);
    try {
      // Pre-check: when a real (non-manual) barcode is supplied and it
      // differs from what's already on this item, make sure it isn't
      // already owned by a different item. The items table has a
      // unique `&barcode` index, so otherwise the update would throw
      // a ConstraintError and the modal would appear to hang.
      if (
        trimmedBarcode &&
        trimmedBarcode !== existingBarcode &&
        !isManualBarcode(trimmedBarcode)
      ) {
        const conflict = await itemRepo.findByBarcode(trimmedBarcode);
        if (conflict && conflict.id !== itemId) {
          setError(
            `Barcode already used by "${conflict.name}". Remove it from that item first or enter a different barcode.`,
          );
          setSubmitting(false);
          return;
        }
      }

      await onSave({
        itemId,
        name,
        barcode: finalBarcode,
        currentPrice,
        unitType,
        category,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong saving this item. Please try again.",
      );
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        role="presentation"
      />
      <div className="relative w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {existingName ? "Edit Item" : "Identify Item"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="fix-item-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Name
            </label>
            <input
              id="fix-item-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Organic Bananas"
              autoFocus
              required
            />
          </div>

          <div>
            <label
              htmlFor="fix-item-barcode"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Barcode or PLU (optional)
            </label>
            <BarcodeInput
              value={barcode}
              onChange={setBarcode}
              onScanPress={() => setScannerOpen(true)}
              placeholder="Scan or enter barcode"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Leave blank if you don&apos;t have a barcode
            </p>
          </div>

          <ScannerViewfinder
            isActive={scannerOpen}
            onBarcodeDetected={handleBarcodeDetected}
            onClose={() => setScannerOpen(false)}
          />

          <div>
            <label
              htmlFor="fix-item-unit"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Unit Type
            </label>
            <select
              id="fix-item-unit"
              value={unitType}
              onChange={(e) => setUnitType(e.target.value)}
              className={inputClass}
            >
              <option value="each">Each</option>
              <option value="per_lb">Per Pound</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="fix-item-category"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Category (optional)
            </label>
            <CategoryAutocomplete
              value={category}
              onChange={setCategory}
              className={inputClass}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
