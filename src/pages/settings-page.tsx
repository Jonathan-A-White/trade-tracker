import { useState, useEffect } from "react";
import { db } from "@/db/database";
import { seedPLUCodes } from "@/db/seed-plu-codes";
import { seedTJBarcodes } from "@/db/seed-tj-barcodes";
import { PageHeader } from "@/components/layout/page-header";
import { useTheme } from "@/contexts/theme-context";

export default function SettingsPage() {
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
