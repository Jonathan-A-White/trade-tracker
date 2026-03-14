import { useState, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { PageHeader } from "@/components/layout/page-header";
import { exportAllData, downloadAsFile } from "@/services/export-service";
import { importAllData, validateImportData } from "@/services/import-service";
import { exportItemsAsCsv, exportTripsAsCsv } from "@/services/csv-export-service";

export default function ExportPage() {
  const [importing, setImporting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const storeCount = useLiveQuery(() => db.stores.count());
  const itemCount = useLiveQuery(() => db.items.count());
  const tripCount = useLiveQuery(() => db.trips.count());

  async function handleExportJson() {
    const json = await exportAllData();
    const timestamp = new Date().toISOString().split("T")[0];
    downloadAsFile(json, `tradetracker-backup-${timestamp}.json`, "application/json");
  }

  async function handleExportCsv() {
    const [itemsCsv, tripsCsv] = await Promise.all([
      exportItemsAsCsv(),
      exportTripsAsCsv(),
    ]);
    const timestamp = new Date().toISOString().split("T")[0];
    downloadAsFile(itemsCsv, `tradetracker-items-${timestamp}.csv`, "text/csv");
    downloadAsFile(tripsCsv, `tradetracker-trips-${timestamp}.csv`, "text/csv");
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null);
    setImportSuccess(false);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const validation = validateImportData(parsed);
        if (!validation.valid) {
          setImportError(`Invalid file: ${validation.errors.join(", ")}`);
          return;
        }
        setPendingImportData(text);
        setShowConfirm(true);
      } catch {
        setImportError("Could not parse file. Make sure it is a valid JSON backup.");
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirmImport() {
    if (!pendingImportData) return;
    setImporting(true);
    setShowConfirm(false);
    try {
      await importAllData(pendingImportData);
      setImportSuccess(true);
      setPendingImportData(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleCancelImport() {
    setShowConfirm(false);
    setPendingImportData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Data" />

      <div className="flex-1 p-4 space-y-6">
        {/* Data summary */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">
            Data Summary
          </h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {storeCount ?? 0}
              </div>
              <div className="text-xs text-gray-500">Stores</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {itemCount ?? 0}
              </div>
              <div className="text-xs text-gray-500">Items</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {tripCount ?? 0}
              </div>
              <div className="text-xs text-gray-500">Trips</div>
            </div>
          </div>
        </div>

        {/* Export section */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Export</h2>
          <button
            type="button"
            onClick={handleExportJson}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-3 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Backup (JSON)
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 text-gray-700 px-4 py-3 text-sm font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Export CSV
          </button>
        </div>

        {/* Import section */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Import</h2>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Warning: Importing a backup will overwrite all existing data. Make
            sure to export a backup first.
          </p>
          <label className="block w-full rounded-lg border-2 border-dashed border-gray-300 p-6 text-center cursor-pointer hover:border-gray-400 transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto mb-2 text-gray-400"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-sm text-gray-600">
              {importing ? "Importing..." : "Select a JSON backup file"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              disabled={importing}
              className="hidden"
            />
          </label>

          {importError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
              {importError}
            </p>
          )}
          {importSuccess && (
            <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3">
              Data imported successfully!
            </p>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Confirm Import
            </h3>
            <p className="text-sm text-gray-600">
              This will replace all existing data with the contents of the
              backup file. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelImport}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 cursor-pointer"
              >
                Replace Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
