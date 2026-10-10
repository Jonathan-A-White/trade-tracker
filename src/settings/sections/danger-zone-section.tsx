import { useState } from "react";
import { db } from "@/db/database";
import { announceDataCleared } from "../data-cleared";
import { ConfirmModal, SectionCard, SectionNote, SuccessNote } from "../parts";

export function DangerZoneSection() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

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
      setShowConfirm(false);
      announceDataCleared();
    } catch {
      // silently fail
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <SectionCard title="Danger Zone">
        <SectionNote>
          Permanently delete all stores, items, trips, and price history.
          This cannot be undone.
        </SectionNote>
        {cleared ? (
          <SuccessNote>All data has been cleared.</SuccessNote>
        ) : (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="w-full rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 px-4 py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/30 active:bg-red-100 transition-colors cursor-pointer"
          >
            Clear All Data
          </button>
        )}
      </SectionCard>

      {showConfirm && (
        <ConfirmModal
          title="Clear All Data?"
          message="This will permanently delete all your stores, items, trips, and price history. Consider exporting a backup first."
          confirmLabel={clearing ? "Clearing..." : "Delete Everything"}
          confirmClass="bg-red-600 hover:bg-red-700 disabled:opacity-50"
          confirmDisabled={clearing}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleClearData}
        />
      )}
    </>
  );
}
