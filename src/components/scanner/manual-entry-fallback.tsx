import { useState } from "react";
import type { FormEvent } from "react";

interface ManualEntryFallbackProps {
  onSubmit: (barcode: string) => void;
  onSwitchToCamera: () => void;
  cameraAvailable: boolean;
}

export function ManualEntryFallback({
  onSubmit,
  onSwitchToCamera,
  cameraAvailable,
}: ManualEntryFallbackProps) {
  const [barcode, setBarcode] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (barcode.trim()) {
      onSubmit(barcode.trim());
      setBarcode("");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="manual-barcode" className="block text-sm font-medium text-gray-700">
          Enter Barcode Number
        </label>
        <input
          id="manual-barcode"
          type="text"
          inputMode="numeric"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="e.g. 012345678901"
          autoFocus
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={!barcode.trim()}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Look Up Barcode
        </button>
      </form>

      <button
        type="button"
        onClick={onSwitchToCamera}
        disabled={!cameraAvailable}
        className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        Switch to Camera
      </button>
    </div>
  );
}
