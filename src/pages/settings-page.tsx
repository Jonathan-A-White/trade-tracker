import { useState, useEffect } from "react";
import { db } from "@/db/database";
import { PageHeader } from "@/components/layout/page-header";

export default function SettingsPage() {
  const [storageUsage, setStorageUsage] = useState<{
    used: number;
    quota: number;
  } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

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
        {/* Storage usage */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Storage Usage</h2>
          {storageUsage ? (
            <>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{formatBytes(storageUsage.used)} used</span>
                <span>{formatBytes(storageUsage.quota)} available</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">
              Storage estimate not available
            </p>
          )}
        </div>

        {/* Clear data */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Danger Zone</h2>
          <p className="text-xs text-gray-500">
            Permanently delete all stores, items, trips, and price history.
            This cannot be undone.
          </p>
          {cleared ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
              All data has been cleared.
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="w-full rounded-lg border border-red-300 text-red-600 px-4 py-2.5 text-sm font-medium hover:bg-red-50 active:bg-red-100 transition-colors cursor-pointer"
            >
              Clear All Data
            </button>
          )}
        </div>

        {/* App info */}
        <div className="bg-white rounded-lg border p-4 space-y-2">
          <h2 className="text-sm font-medium text-gray-700">About</h2>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">App</span>
            <span className="text-gray-900 font-medium">TradeTracker</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Version</span>
            <span className="text-gray-900 font-medium">1.0.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Storage</span>
            <span className="text-gray-900 font-medium">IndexedDB (Dexie.js)</span>
          </div>
        </div>
      </div>

      {/* Confirm dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Clear All Data?
            </h3>
            <p className="text-sm text-gray-600">
              This will permanently delete all your stores, items, trips, and
              price history. Consider exporting a backup first.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
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
