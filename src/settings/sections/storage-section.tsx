import { useState, useEffect } from "react";
import { SectionCard } from "../parts";
import { onDataCleared } from "../data-cleared";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

export function StorageSection() {
  const [storageUsage, setStorageUsage] = useState<{
    used: number;
    quota: number;
  } | null>(null);
  // Bumped when Clear All Data finishes, so the meter is read again.
  const [clears, setClears] = useState(0);

  useEffect(() => onDataCleared(() => setClears((n) => n + 1)), []);

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
  }, [clears]);

  const usagePercent =
    storageUsage && storageUsage.quota > 0
      ? (storageUsage.used / storageUsage.quota) * 100
      : 0;

  return (
    <SectionCard title="Storage Usage">
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
    </SectionCard>
  );
}
