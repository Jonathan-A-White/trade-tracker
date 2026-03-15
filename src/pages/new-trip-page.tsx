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
  const [loadingStoreId, setLoadingStoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetStep, setBudgetStep] = useState<{ storeId: string; storeName: string } | null>(null);
  const [budgetInput, setBudgetInput] = useState("");

  const stores = useLiveQuery(() => db.stores.orderBy("name").toArray(), []);
  const activeTrip = useLiveQuery(() => tripRepo.getActive(), []);

  const startTrip = useCallback(
    async (storeId: string, budget?: number) => {
      await tripRepo.create({ storeId, startedAt: Date.now(), budget });
      navigate("/trips/active");
    },
    [navigate],
  );

  const handleStoreSelect = useCallback(
    async (store: { id: string; name: string }) => {
      if (loadingStoreId) return;
      setError(null);
      if (activeTrip) {
        setPendingStoreId(store.id);
        setShowConfirm(true);
        return;
      }
      setBudgetStep({ storeId: store.id, storeName: store.name });
      setBudgetInput("");
    },
    [activeTrip, loadingStoreId],
  );

  const handleStartWithBudget = useCallback(async () => {
    if (!budgetStep || loadingStoreId) return;
    setLoadingStoreId(budgetStep.storeId);
    const budget = budgetInput.trim() ? parseFloat(budgetInput) : undefined;
    try {
      await startTrip(budgetStep.storeId, budget && budget > 0 ? budget : undefined);
    } catch {
      setError("Failed to start trip. Please try again.");
      setLoadingStoreId(null);
    }
  }, [budgetStep, budgetInput, startTrip, loadingStoreId]);

  const handleConfirmEnd = useCallback(async () => {
    if (!activeTrip || !pendingStoreId) return;
    try {
      await tripRepo.complete(activeTrip.id);
      setShowConfirm(false);
      const store = stores?.find((s) => s.id === pendingStoreId);
      setBudgetStep({ storeId: pendingStoreId, storeName: store?.name ?? "Store" });
      setBudgetInput("");
      setPendingStoreId(null);
    } catch {
      setError("Failed to start trip. Please try again.");
      setShowConfirm(false);
    }
  }, [activeTrip, pendingStoreId, stores]);

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
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader title="Start Trip" backTo="/" />

      <main className="flex-1 p-4 space-y-4">
        {budgetStep ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Set a budget for your trip to <span className="font-medium text-gray-900 dark:text-gray-100">{budgetStep.storeName}</span>, or skip to start without one.
            </p>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
              <label htmlFor="budget" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Trip Budget
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  id="budget"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-7 pr-3 py-2.5 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBudgetStep(null)}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleStartWithBudget}
                disabled={!!loadingStoreId}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingStoreId ? "Starting..." : budgetInput.trim() ? "Start Trip" : "Skip & Start"}
              </button>
            </div>
          </div>
        ) : showStoreForm ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Create New Store
            </h2>
            <StoreForm
              onSubmit={handleCreateStore}
              onCancel={() => setShowStoreForm(false)}
            />
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select a store to begin your shopping trip.
            </p>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <StoreSelector
              stores={stores ?? []}
              onSelect={handleStoreSelect}
              onCreateNew={() => setShowStoreForm(true)}
              loadingStoreId={loadingStoreId}
            />
          </>
        )}
      </main>

      {/* Confirm dialog to end active trip */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl mx-4 p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Active Trip in Progress
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
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
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
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
