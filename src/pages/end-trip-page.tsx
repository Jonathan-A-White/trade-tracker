import { useState, useMemo, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router";
import { db } from "@/db/database";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PageHeader } from "@/components/layout/page-header";
import { formatCurrency } from "@/core/pricing";
import { getTaxModule } from "@/core/tax";
import type { TaxEstimate } from "@/core/tax";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

export default function EndTripPage() {
  const navigate = useNavigate();
  const [receiptTotal, setReceiptTotal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const trip = useLiveQuery(() => tripRepo.getActive(), []);

  const tripItems = useLiveQuery(
    () => (trip ? tripItemRepo.getByTrip(trip.id) : []),
    [trip?.id],
  );

  const store = useLiveQuery(async () => {
    if (!trip) return undefined;
    return db.stores.get(trip.storeId);
  }, [trip?.storeId]);

  const storeName = store?.name ?? "Unknown Store";

  // Load items to get categories for tax calculation
  const itemsById = useLiveQuery(async () => {
    if (!tripItems || tripItems.length === 0) return new Map<string, { name: string; category?: string }>();
    const itemIds = tripItems.map((ti) => ti.itemId);
    const items = await db.items.where("id").anyOf(itemIds).toArray();
    return new Map(items.map((item) => [item.id, { name: item.name, category: item.category }]));
  }, [tripItems]);

  // Calculate tax estimate if a tax module is available for this store's state
  const storeState = store?.state;
  const taxEstimate = useMemo((): TaxEstimate | null => {
    if (!storeState || !tripItems || !itemsById) return null;
    const taxModule = getTaxModule(storeState);
    if (!taxModule) return null;

    const lineItems = tripItems.map((ti) => {
      const item = itemsById.get(ti.itemId);
      return {
        name: item?.name ?? "Unknown Item",
        lineTotal: ti.lineTotal,
        category: item?.category,
        taxOverride: ti.taxOverride,
      };
    });

    return taxModule.calculate(lineItems);
  }, [storeState, tripItems, itemsById]);

  const receiptValue = parseFloat(receiptTotal) || 0;
  const scannedSubtotal = trip?.scannedSubtotal ?? 0;
  const bottleDeposits = (tripItems ?? []).reduce(
    (sum, ti) => sum + (ti.bottleDeposit ?? 0),
    0,
  );
  const estimatedTotal =
    (taxEstimate ? scannedSubtotal + taxEstimate.totalTax : scannedSubtotal) +
    bottleDeposits;
  const difference = receiptValue - estimatedTotal;
  const absDifference = Math.abs(difference);

  const diffColorClass = useMemo(() => {
    if (!receiptTotal) return "text-gray-400 dark:text-gray-500";
    if (absDifference < 1) return "text-green-600 dark:text-green-400";
    if (absDifference < 5) return "text-yellow-600";
    return "text-red-600 dark:text-red-400";
  }, [receiptTotal, absDifference]);

  const diffBgClass = useMemo(() => {
    if (!receiptTotal) return "bg-gray-50 dark:bg-gray-800";
    if (absDifference < 1) return "bg-green-50 dark:bg-green-900/30";
    if (absDifference < 5) return "bg-yellow-50 dark:bg-yellow-900/30";
    return "bg-red-50 dark:bg-red-900/30";
  }, [receiptTotal, absDifference]);

  const handleSaveTrip = useCallback(async () => {
    if (!trip || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await tripRepo.complete(
        trip.id,
        receiptTotal ? receiptValue : undefined,
      );
      navigate("/");
    } catch (error) {
      console.error("Failed to save trip:", error);
      setSaveError("Failed to save trip. Please try again.");
      savingRef.current = false;
      setSaving(false);
    }
  }, [trip, receiptTotal, receiptValue, navigate]);

  if (!trip) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <PageHeader title="End Trip" backTo="/trips/active" />
        <main className="flex-1 flex items-center justify-center p-4">
          <p className="text-gray-500 dark:text-gray-400">No active trip found.</p>
        </main>
      </div>
    );
  }

  const itemCount = tripItems?.length ?? 0;
  const tripDate = new Date(trip.startedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader title="End Trip" backTo="/trips/active" />

      <main className="flex-1 p-4 space-y-6">
        {/* Trip summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Trip Summary</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 dark:text-gray-400">Store</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{storeName}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Date</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{tripDate}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Items</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{itemCount}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Scanned Subtotal</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {formatCurrency(scannedSubtotal)}
              </p>
            </div>
          </div>
        </div>

        {/* Tax estimate */}
        {taxEstimate && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Estimated Tax ({taxEstimate.moduleName})
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Tax-exempt items</span>
                <span className="text-gray-900 dark:text-gray-100">{formatCurrency(taxEstimate.exemptAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Taxable items</span>
                <span className="text-gray-900 dark:text-gray-100">{formatCurrency(taxEstimate.taxableAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">
                  Tax ({(taxEstimate.lines.find((l) => l.taxable)?.taxRate ?? 0) * 100}%)
                </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(taxEstimate.totalTax)}</span>
              </div>
              {bottleDeposits > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Bottle deposits</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(bottleDeposits)}</span>
                </div>
              )}
              <div className="border-t dark:border-gray-700 pt-2 flex justify-between font-medium">
                <span className="text-gray-700 dark:text-gray-300">Estimated Total</span>
                <span className="text-gray-900 dark:text-gray-100">{formatCurrency(estimatedTotal)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Receipt total input */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Receipt Total
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Enter the total from your receipt to compare with {taxEstimate ? "estimated" : "scanned"} total.
          </p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-2xl text-gray-400 dark:text-gray-500">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={receiptTotal}
              onChange={(e) => setReceiptTotal(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 pl-8 pr-3 py-4 text-3xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
              autoFocus
            />
          </div>
        </div>

        {/* Live difference */}
        <div className={`rounded-lg border dark:border-gray-700 p-4 ${diffBgClass}`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Difference</p>
            <p className={`text-xl font-bold ${diffColorClass}`}>
              {receiptTotal
                ? `${difference >= 0 ? "+" : ""}${formatCurrency(difference)}`
                : "--"}
            </p>
          </div>
          {receiptTotal && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {absDifference < 1
                ? "Great match! Receipt and scanned totals are very close."
                : absDifference < 5
                  ? "Slight difference. You may have missed an item or a price changed."
                  : "Large difference. Review your items for missing or incorrect prices."}
            </p>
          )}
        </div>

        {/* Error message */}
        {saveError && (
          <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-3">
            <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleSaveTrip}
            disabled={saving}
            className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Trip"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/trips/active")}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Keep Shopping
          </button>
        </div>
      </main>
    </div>
  );
}
