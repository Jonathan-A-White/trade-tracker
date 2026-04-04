import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { db } from "@/db/database";
import { seedPLUCodes } from "@/db/seed-plu-codes";
import { seedTJBarcodes } from "@/db/seed-tj-barcodes";
import { seedTJReceipt } from "@/db/seed-tj-receipt";
import { PageHeader } from "@/components/layout/page-header";
import { useTheme } from "@/contexts/theme-context";
import { exportItemsData, exportTripsData, downloadAsFile } from "@/services/export-service";
import {
  validateItemsImportData,
  validateTripsImportData,
  importItemsData,
  importTripsData,
} from "@/services/import-service";
import {
  validateTripImportData,
  importTripFromAI,
} from "@/services/trip-exchange-service";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [storageUsage, setStorageUsage] = useState<{
    used: number;
    quota: number;
  } | null>(null);
  const { theme, toggleTheme } = useTheme();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ added: number; skipped: number } | null>(null);
  const [seedingTJ, setSeedingTJ] = useState(false);
  const [seedTJResult, setSeedTJResult] = useState<{ added: number; skipped: number } | null>(null);
  const [seedingReceipt, setSeedingReceipt] = useState(false);
  const [seedReceiptResult, setSeedReceiptResult] = useState<{ added: number; skipped: number } | null>(null);

  // Items export/import state
  const [importingItems, setImportingItems] = useState(false);
  const [itemsImportResult, setItemsImportResult] = useState<{ added: number; skipped: number } | null>(null);
  const [itemsImportError, setItemsImportError] = useState<string | null>(null);
  const [showItemsImportConfirm, setShowItemsImportConfirm] = useState(false);
  const [pendingItemsImportData, setPendingItemsImportData] = useState<string | null>(null);
  const itemsFileRef = useRef<HTMLInputElement>(null);

  // AI trip import state
  const [aiTripImporting, setAiTripImporting] = useState(false);
  const [aiTripImportError, setAiTripImportError] = useState<string | null>(null);
  const [aiTripImportResult, setAiTripImportResult] = useState<{
    tripId: string;
    itemsCreated: number;
    itemsMatched: number;
    itemsMissingBarcode: number;
  } | null>(null);
  const aiTripFileRef = useRef<HTMLInputElement>(null);

  // Trips export/import state
  const [importingTrips, setImportingTrips] = useState(false);
  const [tripsImportResult, setTripsImportResult] = useState<{ added: number; skipped: number } | null>(null);
  const [tripsImportError, setTripsImportError] = useState<string | null>(null);
  const [showTripsImportConfirm, setShowTripsImportConfirm] = useState(false);
  const [pendingTripsImportData, setPendingTripsImportData] = useState<string | null>(null);
  const tripsFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function estimateStorage() {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageUsage({
          used: estimate.usage ?? 0,
          quota: estimate.quota ?? 0,
        });
      }
    }
    estimateStorage();
  }, [cleared]);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(1)} ${units[i]}`;
  }

  async function handleClearData() {
    setClearing(true);
    try {
      await db.transaction(
        "rw",
        [db.stores, db.items, db.trips, db.tripItems, db.priceHistory],
        async () => {
          await db.stores.clear();
          await db.items.clear();
          await db.trips.clear();
          await db.tripItems.clear();
          await db.priceHistory.clear();
        },
      );
      setCleared(true);
      setShowClearConfirm(false);
    } catch {
      // silently fail
    } finally {
      setClearing(false);
    }
  }

  async function handleExportItems() {
    const json = await exportItemsData();
    const timestamp = new Date().toISOString().split("T")[0];
    downloadAsFile(json, `tradetracker-items-${timestamp}.json`, "application/json");
  }

  async function handleExportTrips() {
    const json = await exportTripsData();
    const timestamp = new Date().toISOString().split("T")[0];
    downloadAsFile(json, `tradetracker-trips-${timestamp}.json`, "application/json");
  }

  function handleItemsFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setItemsImportError(null);
    setItemsImportResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const validation = validateItemsImportData(parsed);
        if (!validation.valid) {
          setItemsImportError(`Invalid file: ${validation.errors.join(", ")}`);
          return;
        }
        setPendingItemsImportData(text);
        setShowItemsImportConfirm(true);
      } catch {
        setItemsImportError("Could not parse file. Make sure it is a valid JSON items export.");
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirmItemsImport() {
    if (!pendingItemsImportData) return;
    setImportingItems(true);
    setShowItemsImportConfirm(false);
    try {
      const result = await importItemsData(pendingItemsImportData);
      setItemsImportResult(result);
      setPendingItemsImportData(null);
    } catch (err) {
      setItemsImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingItems(false);
      if (itemsFileRef.current) itemsFileRef.current.value = "";
    }
  }

  function handleTripsFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setTripsImportError(null);
    setTripsImportResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const validation = validateTripsImportData(parsed);
        if (!validation.valid) {
          setTripsImportError(`Invalid file: ${validation.errors.join(", ")}`);
          return;
        }
        setPendingTripsImportData(text);
        setShowTripsImportConfirm(true);
      } catch {
        setTripsImportError("Could not parse file. Make sure it is a valid JSON trips export.");
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirmTripsImport() {
    if (!pendingTripsImportData) return;
    setImportingTrips(true);
    setShowTripsImportConfirm(false);
    try {
      const result = await importTripsData(pendingTripsImportData);
      setTripsImportResult(result);
      setPendingTripsImportData(null);
    } catch (err) {
      setTripsImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingTrips(false);
      if (tripsFileRef.current) tripsFileRef.current.value = "";
    }
  }

  function handleAiTripFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setAiTripImportError(null);
    setAiTripImportResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const validation = validateTripImportData(parsed);
        if (!validation.valid) {
          setAiTripImportError(`Invalid file: ${validation.errors.join(", ")}`);
          return;
        }
        setAiTripImporting(true);
        try {
          const result = await importTripFromAI(text);
          setAiTripImportResult(result);
        } catch (err) {
          setAiTripImportError(err instanceof Error ? err.message : "Trip import failed");
        } finally {
          setAiTripImporting(false);
          if (aiTripFileRef.current) aiTripFileRef.current.value = "";
        }
      } catch {
        setAiTripImportError("Could not parse file. Make sure it is valid JSON.");
      }
    };
    reader.readAsText(file);
  }

  const usagePercent =
    storageUsage && storageUsage.quota > 0
      ? (storageUsage.used / storageUsage.quota) * 100
      : 0;

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Settings" />

      <div className="flex-1 p-4 space-y-6">
        {/* Appearance */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Appearance</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {theme === "dark" ? "Dark" : "Light"} mode
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="relative inline-flex h-8 w-14 items-center rounded-full transition-colors cursor-pointer"
              style={{ backgroundColor: theme === "dark" ? "#3b82f6" : "#d1d5db" }}
              role="switch"
              aria-checked={theme === "dark"}
              aria-label="Toggle dark mode"
            >
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform"
                style={{ transform: theme === "dark" ? "translateX(1.625rem)" : "translateX(0.25rem)" }}
              >
                {theme === "dark" ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </div>

        {/* Storage usage */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Storage Usage</h2>
          {storageUsage ? (
            <>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{formatBytes(storageUsage.used)} used</span>
                <span>{formatBytes(storageUsage.quota)} available</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Storage estimate not available
            </p>
          )}
        </div>

        {/* Pre-populate PLU codes */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Produce PLU Codes</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Load ~120 common fruit and vegetable PLU codes (including organics) with approximate Trader Joe's prices.
            Existing items won't be overwritten.
          </p>
          {seedResult ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              Added {seedResult.added} item{seedResult.added !== 1 ? "s" : ""}.
              {seedResult.skipped > 0 && ` Skipped ${seedResult.skipped} already in library.`}
            </div>
          ) : (
            <button
              type="button"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                try {
                  const result = await seedPLUCodes();
                  setSeedResult(result);
                } catch {
                  // silently fail
                } finally {
                  setSeeding(false);
                }
              }}
              className="w-full rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              {seeding ? "Loading..." : "Load PLU Codes"}
            </button>
          )}
        </div>

        {/* Pre-populate Trader Joe's barcodes */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Trader Joe's Barcodes</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Load ~30 popular Trader Joe's product barcodes (frozen, dairy, snacks, dips, and more)
            with approximate prices. Existing items won't be overwritten.
          </p>
          {seedTJResult ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              Added {seedTJResult.added} item{seedTJResult.added !== 1 ? "s" : ""}.
              {seedTJResult.skipped > 0 && ` Skipped ${seedTJResult.skipped} already in library.`}
            </div>
          ) : (
            <button
              type="button"
              disabled={seedingTJ}
              onClick={async () => {
                setSeedingTJ(true);
                try {
                  const result = await seedTJBarcodes();
                  setSeedTJResult(result);
                } catch {
                  // silently fail
                } finally {
                  setSeedingTJ(false);
                }
              }}
              className="w-full rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              {seedingTJ ? "Loading..." : "Load TJ Barcodes"}
            </button>
          )}
        </div>

        {/* Pre-populate TJ Receipt (03/14/2026) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">TJ's Receipt (03/14/2026)</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Load ~40 items from the Trader Joe's Danbury receipt (03/14/2026) with prices as purchased.
            Items with placeholder barcodes (TJR prefix) can be updated by scanning the actual product.
            Existing items won't be overwritten.
          </p>
          {seedReceiptResult ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              Added {seedReceiptResult.added} item{seedReceiptResult.added !== 1 ? "s" : ""}.
              {seedReceiptResult.skipped > 0 && ` Skipped ${seedReceiptResult.skipped} already in library.`}
            </div>
          ) : (
            <button
              type="button"
              disabled={seedingReceipt}
              onClick={async () => {
                setSeedingReceipt(true);
                try {
                  const result = await seedTJReceipt();
                  setSeedReceiptResult(result);
                } catch {
                  // silently fail
                } finally {
                  setSeedingReceipt(false);
                }
              }}
              className="w-full rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              {seedingReceipt ? "Loading..." : "Load Receipt Items"}
            </button>
          )}
        </div>

        {/* Export/Import Items */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Export / Import Items</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Export all items as a JSON file, or import items from a previously exported file.
            Importing will add new items without overwriting existing ones.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleExportItems}
              className="flex-1 rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer"
            >
              Export Items
            </button>
            <label className="flex-1 rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer text-center">
              {importingItems ? "Importing..." : "Import Items"}
              <input
                ref={itemsFileRef}
                type="file"
                accept=".json"
                onChange={handleItemsFileSelect}
                disabled={importingItems}
                className="hidden"
              />
            </label>
          </div>
          {itemsImportError && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
              {itemsImportError}
            </p>
          )}
          {itemsImportResult && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              Added {itemsImportResult.added} item{itemsImportResult.added !== 1 ? "s" : ""}.
              {itemsImportResult.skipped > 0 && ` Skipped ${itemsImportResult.skipped} already in library.`}
            </div>
          )}
        </div>

        {/* Export/Import Trips */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Export / Import Trips</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Export all trip data (trips, stores, and price history) as a JSON file, or import from a
            previously exported file. Importing will add new trips without overwriting existing ones.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleExportTrips}
              className="flex-1 rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer"
            >
              Export Trips
            </button>
            <label className="flex-1 rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer text-center">
              {importingTrips ? "Importing..." : "Import Trips"}
              <input
                ref={tripsFileRef}
                type="file"
                accept=".json"
                onChange={handleTripsFileSelect}
                disabled={importingTrips}
                className="hidden"
              />
            </label>
          </div>
          {tripsImportError && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
              {tripsImportError}
            </p>
          )}
          {tripsImportResult && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              Added {tripsImportResult.added} trip{tripsImportResult.added !== 1 ? "s" : ""}.
              {tripsImportResult.skipped > 0 && ` Skipped ${tripsImportResult.skipped} already imported.`}
            </div>
          )}
        </div>

        {/* Import Trip from AI */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Import Trip from AI</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Import a trip JSON generated by AI (from an &quot;Export for AI&quot; + receipt workflow).
            This creates a new completed trip with all items.
          </p>
          <label
            className={`block w-full rounded-lg border border-dashed border-purple-300 dark:border-purple-600 text-purple-600 dark:text-purple-400 px-4 py-2.5 text-sm font-medium hover:bg-purple-50 dark:hover:bg-purple-900/30 active:bg-purple-100 transition-colors cursor-pointer text-center ${aiTripImporting ? "opacity-50 pointer-events-none" : ""}`}
          >
            {aiTripImporting ? "Importing..." : "Import AI Trip JSON"}
            <input
              ref={aiTripFileRef}
              type="file"
              accept=".json"
              onChange={handleAiTripFileSelect}
              disabled={aiTripImporting}
              className="hidden"
            />
          </label>
          {aiTripImportError && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
              {aiTripImportError}
            </p>
          )}
          {aiTripImportResult && (
            <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg p-3 space-y-2">
              <p className="font-medium">Trip imported successfully!</p>
              <ul className="text-xs space-y-1">
                <li>{aiTripImportResult.itemsCreated} items created</li>
                {aiTripImportResult.itemsMatched > 0 && (
                  <li>{aiTripImportResult.itemsMatched} items matched to existing</li>
                )}
                {aiTripImportResult.itemsMissingBarcode > 0 && (
                  <li className="text-purple-600 dark:text-purple-400">
                    {aiTripImportResult.itemsMissingBarcode} items need barcodes
                  </li>
                )}
              </ul>
              <button
                type="button"
                onClick={() => navigate(`/trips/${aiTripImportResult.tripId}`)}
                className="mt-2 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 cursor-pointer"
              >
                View Imported Trip
              </button>
            </div>
          )}
        </div>

        {/* Clear data */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Danger Zone</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Permanently delete all stores, items, trips, and price history.
            This cannot be undone.
          </p>
          {cleared ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              All data has been cleared.
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="w-full rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 px-4 py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/30 active:bg-red-100 transition-colors cursor-pointer"
            >
              Clear All Data
            </button>
          )}
        </div>

        {/* App info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-2">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">About</h2>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">App</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">TradeTracker</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Version</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">1.0.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Storage</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">IndexedDB (Dexie.js)</span>
          </div>
        </div>
      </div>

      {/* Confirm items import dialog */}
      {showItemsImportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Import Items?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              New items will be added to your library. Existing items with the same
              ID will be skipped.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowItemsImportConfirm(false);
                  setPendingItemsImportData(null);
                  if (itemsFileRef.current) itemsFileRef.current.value = "";
                }}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmItemsImport}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm trips import dialog */}
      {showTripsImportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Import Trips?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              New trips and their associated stores will be added. Existing trips
              with the same ID will be skipped.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowTripsImportConfirm(false);
                  setPendingTripsImportData(null);
                  if (tripsFileRef.current) tripsFileRef.current.value = "";
                }}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmTripsImport}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Clear All Data?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This will permanently delete all your stores, items, trips, and
              price history. Consider exporting a backup first.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearData}
                disabled={clearing}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {clearing ? "Clearing..." : "Delete Everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
