import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router";
import { db } from "@/db/database";
import { TripRepository } from "@/db/repositories/trip-repository";
import { StoreRepository } from "@/db/repositories/store-repository";
import { PageHeader } from "@/components/layout/page-header";
import { StoreSelector } from "@/components/forms/store-selector";
import { StoreForm } from "@/components/forms/store-form";

const tripRepo = new TripRepository();
const storeRepo = new StoreRepository();

export default function NewTripPage() {
  const navigate = useNavigate();
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null);

  const stores = useLiveQuery(() => db.stores.orderBy("name").toArray(), []);
  const activeTrip = useLiveQuery(() => tripRepo.getActive(), []);

  const startTrip = useCallback(
    async (storeId: string) => {
      await tripRepo.create({ storeId, startedAt: Date.now() });
      navigate("/trips/active");
    },
    [navigate],
  );

  const handleStoreSelect = useCallback(
    async (store: { id: string; name: string }) => {
      if (activeTrip) {
        setPendingStoreId(store.id);
        setShowConfirm(true);
        return;
      }
      await startTrip(store.id);
    },
    [activeTrip, startTrip],
  );

  const handleConfirmEnd = useCallback(async () => {
    if (!activeTrip || !pendingStoreId) return;
    await tripRepo.complete(activeTrip.id);
    setShowConfirm(false);
    await startTrip(pendingStoreId);
  }, [activeTrip, pendingStoreId, startTrip]);

  const handleCreateStore = useCallback(
    async (values: { name: string; notes: string }) => {
      const store = await storeRepo.create({
        name: values.name,
        notes: values.notes || undefined,
      });
      setShowStoreForm(false);
      await handleStoreSelect(store);
    },
    [handleStoreSelect],
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <PageHeader title="Start Trip" backTo="/" />

      <main className="flex-1 p-4 space-y-4">
        {showStoreForm ? (
          <div className="bg-white rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              Create New Store
            </h2>
            <StoreForm
              onSubmit={handleCreateStore}
              onCancel={() => setShowStoreForm(false)}
            />
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Select a store to begin your shopping trip.
            </p>
            <StoreSelector
              stores={stores ?? []}
              onSelect={handleStoreSelect}
              onCreateNew={() => setShowStoreForm(true)}
            />
          </>
        )}
      </main>

      {/* Confirm dialog to end active trip */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl mx-4 p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Active Trip in Progress
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              You already have an active trip. Would you like to end it and
              start a new one?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  setPendingStoreId(null);
                }}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmEnd}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors cursor-pointer"
              >
                End & Start New
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
