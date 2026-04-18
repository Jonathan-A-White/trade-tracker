import { useState, useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams, Link, useNavigate } from "react-router";
import { db } from "@/db/database";
import type { Item, UnitType } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { PageHeader } from "@/components/layout/page-header";
import { formatCurrency } from "@/core/pricing";
import { getTaxModule } from "@/core/tax";
import type { TaxEstimate } from "@/core/tax";
import {
  exportTripForAI,
  isManualBarcode,
  reimportTripFromAI,
  validateTripImportData,
} from "@/services/trip-exchange-service";
import { downloadAsFile } from "@/services/export-service";
import { FixUnknownItemModal } from "@/components/forms/fix-unknown-item-modal";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fixingItem, setFixingItem] = useState<{
    itemId: string;
    price: number;
    item?: Item;
  } | null>(null);
  const [reimporting, setReimporting] = useState(false);
  const [reimportError, setReimportError] = useState<string | null>(null);
  const [reimportSuccess, setReimportSuccess] = useState<string | null>(null);
  const reimportFileRef = useRef<HTMLInputElement>(null);

  const trip = useLiveQuery(
    () => (id ? tripRepo.getById(id) : undefined),
    [id],
  );

  const tripItems = useLiveQuery(
    () => (id ? tripItemRepo.getByTrip(id) : []),
    [id],
  );

  const store = useLiveQuery(async () => {
    if (!trip) return undefined;
    return db.stores.get(trip.storeId);
  }, [trip?.storeId]);

  const storeName = store?.name ?? "Unknown Store";

  const itemsMap = useLiveQuery(async () => {
    if (!tripItems || tripItems.length === 0) return {};
    const itemIds = [...new Set(tripItems.map((ti) => ti.itemId))];
    const items = await db.items.where("id").anyOf(itemIds).toArray();
    const map: Record<string, Item> = {};
    for (const item of items) {
      map[item.id] = item;
    }
    return map;
  }, [tripItems]);

  const storeState = store?.state;
  const taxEstimate = useMemo((): TaxEstimate | null => {
    if (!storeState || !tripItems || !itemsMap) return null;
    const taxModule = getTaxModule(storeState);
    if (!taxModule) return null;

    const lineItems = tripItems.map((ti) => {
      const item = itemsMap[ti.itemId];
      return {
        name: item?.name ?? "Unknown Item",
        lineTotal: ti.lineTotal,
        category: item?.category,
        taxOverride: ti.taxOverride,
      };
    });

    return taxModule.calculate(lineItems);
  }, [storeState, tripItems, itemsMap]);

  // Build a map from tripItem index to its tax line result
  const taxLineByIndex = useMemo(() => {
    if (!taxEstimate) return null;
    return taxEstimate.lines;
  }, [taxEstimate]);

  const handleToggleTax = async (tripItemId: string, currentTaxOverride: boolean | undefined, currentlyTaxable: boolean) => {
    if (currentTaxOverride !== undefined) {
      // Currently overridden — clear back to heuristic
      // Dexie ignores undefined in update(), so we modify the record directly
      const record = await db.tripItems.get(tripItemId);
      if (record) {
        delete record.taxOverride;
        await db.tripItems.put(record);
      }
    } else {
      // Currently using heuristic — flip to explicit override
      await tripItemRepo.update(tripItemId, { taxOverride: !currentlyTaxable });
    }
  };

  function handleReimportFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setReimportError(null);
    setReimportSuccess(null);
    const file = e.target.files?.[0];
    if (!file || !id) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const validation = validateTripImportData(parsed);
        if (!validation.valid) {
          setReimportError(`Invalid file: ${validation.errors.join(", ")}`);
          return;
        }
        setReimporting(true);
        try {
          const result = await reimportTripFromAI(id, text);
          const parts: string[] = [];
          if (result.itemsMatched > 0) parts.push(`${result.itemsMatched} matched`);
          if (result.itemsCreated > 0) parts.push(`${result.itemsCreated} created`);
          if (result.itemsMissingBarcode > 0) parts.push(`${result.itemsMissingBarcode} need barcodes`);
          setReimportSuccess(`Trip reimported! ${parts.join(", ")}`);
        } catch (err) {
          setReimportError(err instanceof Error ? err.message : "Reimport failed");
        } finally {
          setReimporting(false);
          if (reimportFileRef.current) {
            reimportFileRef.current.value = "";
          }
        }
      } catch {
        setReimportError("Could not parse file. Make sure it is valid JSON.");
      }
    };
    reader.readAsText(file);
  }

  if (!trip) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <PageHeader title="Trip Details" backTo="/trips/history" />
        <main className="flex-1 flex items-center justify-center p-4">
          <p className="text-gray-500 dark:text-gray-400">
            {id ? "Loading trip..." : "Trip not found."}
          </p>
        </main>
      </div>
    );
  }

  const items = tripItems ?? [];
  const map = itemsMap ?? {};
  const scannedSubtotal = trip.scannedSubtotal;
  const actualTotal = trip.actualTotal;
  const bottleDeposits = items.reduce((sum, ti) => sum + (ti.bottleDeposit ?? 0), 0);
  const estimatedTotal =
    (taxEstimate ? scannedSubtotal + taxEstimate.totalTax : scannedSubtotal) +
    bottleDeposits;
  const difference =
    actualTotal !== undefined ? actualTotal - estimatedTotal : undefined;

  const tripDate = new Date(trip.startedAt).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader
        title={store ? storeName : "Loading..."}
        backTo="/trips/history"
        rightAction={
          <Link
            to={`/trips/${id}/edit`}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          >
            Edit
          </Link>
        }
      />

      <main className="flex-1 p-4 space-y-4">
        {/* Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">{tripDate}</p>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Scanned Subtotal</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(scannedSubtotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Actual Total</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {actualTotal !== undefined ? formatCurrency(actualTotal) : "--"}
              </p>
            </div>
          </div>

          {(taxEstimate || bottleDeposits > 0) && (
            <div className="space-y-2 text-sm border-t dark:border-gray-700 pt-3">
              {taxEstimate && (
                <>
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
                      Est. tax ({(taxEstimate.lines.find((l) => l.taxable)?.taxRate ?? 0) * 100}%)
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(taxEstimate.totalTax)}</span>
                  </div>
                </>
              )}
              {bottleDeposits > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Bottle deposits</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(bottleDeposits)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span className="text-gray-700 dark:text-gray-300">Estimated Total</span>
                <span className="text-gray-900 dark:text-gray-100">{formatCurrency(estimatedTotal)}</span>
              </div>
            </div>
          )}

          {difference !== undefined && (
            <div
              className={`rounded-lg px-3 py-2 ${
                Math.abs(difference) < 1
                  ? "bg-green-50 dark:bg-green-900/30"
                  : Math.abs(difference) < 5
                    ? "bg-yellow-50 dark:bg-yellow-900/30"
                    : "bg-red-50 dark:bg-red-900/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Difference</p>
                <p
                  className={`text-sm font-bold ${
                    Math.abs(difference) < 1
                      ? "text-green-600 dark:text-green-400"
                      : Math.abs(difference) < 5
                        ? "text-yellow-600"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {difference >= 0 ? "+" : ""}
                  {formatCurrency(difference)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Items list */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Items ({items.length})
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No items in this trip.
            </div>
          ) : (
            <ul className="divide-y dark:divide-gray-700">
              {items.map((ti, idx) => {
                const item = map[ti.itemId];
                const quantityDisplay =
                  item?.unitType === "per_lb" && ti.weightLbs !== undefined
                    ? `${ti.weightLbs.toFixed(2)} lbs`
                    : `x${ti.quantity}`;

                const isUnknown = !item;
                const hasManualBarcode = item && isManualBarcode(item.barcode);
                const needsFix = isUnknown || hasManualBarcode;

                const taxLine = taxLineByIndex?.[idx];
                const isTaxable = taxLine?.taxable ?? false;
                const hasOverride = ti.taxOverride !== undefined;

                return (
                  <li key={ti.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {needsFix ? (
                          <button
                            type="button"
                            onClick={() =>
                              setFixingItem({
                                itemId: ti.itemId,
                                price: ti.price,
                                item: item ?? undefined,
                              })
                            }
                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline truncate block text-left cursor-pointer"
                          >
                            {item?.name ?? "Unknown Item"}
                          </button>
                        ) : (
                          <Link
                            to={`/items/${ti.itemId}`}
                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline truncate block"
                          >
                            {item.name}
                          </Link>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {formatCurrency(ti.price)} /{" "}
                          {item?.unitType === "per_lb" ? "lb" : "each"}{" "}
                          {quantityDisplay}
                          {ti.bottleDeposit !== undefined && ti.bottleDeposit > 0 && (
                            <span className="ml-1 text-teal-600 dark:text-teal-400 font-medium">
                              +DEP {formatCurrency(ti.bottleDeposit)}
                            </span>
                          )}
                          {ti.onSale && (
                            <span className="ml-1 text-orange-600 dark:text-orange-400 font-medium">
                              SALE
                            </span>
                          )}
                          {isUnknown && (
                            <span className="ml-1 text-yellow-600 dark:text-yellow-400 font-medium">
                              TAP TO FIX
                            </span>
                          )}
                          {hasManualBarcode && (
                            <span className="ml-1 text-purple-600 dark:text-purple-400 font-medium">
                              NO BARCODE
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        {taxLine && (
                          <button
                            type="button"
                            onClick={() => handleToggleTax(ti.id, ti.taxOverride, taxLine.taxable)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold leading-tight cursor-pointer border ${
                              isTaxable
                                ? hasOverride
                                  ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 ring-1 ring-red-400 dark:ring-red-600"
                                  : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700"
                                : hasOverride
                                  ? "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-300 dark:border-gray-600 ring-1 ring-gray-400 dark:ring-gray-500"
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600"
                            }`}
                            title={
                              isTaxable
                                ? hasOverride ? "Taxable (manual) — tap to reset" : "Taxable — tap to mark exempt"
                                : hasOverride ? "Exempt (manual) — tap to reset" : "Exempt — tap to mark taxable"
                            }
                          >
                            {isTaxable ? "TAX" : "EX"}
                          </button>
                        )}
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {formatCurrency(ti.lineTotal)}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Export for AI */}
        <button
          type="button"
          onClick={async () => {
            if (!id) return;
            const json = await exportTripForAI(id);
            const timestamp = new Date().toISOString().split("T")[0];
            downloadAsFile(
              json,
              `trip-export-${timestamp}.json`,
              "application/json",
            );
          }}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 transition-colors cursor-pointer"
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
          Export for AI
        </button>

        {/* Import from AI */}
        <label
          className={`w-full flex items-center justify-center gap-2 rounded-lg border border-purple-300 dark:border-purple-600 text-purple-700 dark:text-purple-300 px-4 py-3 text-sm font-medium hover:bg-purple-50 dark:hover:bg-purple-900/20 active:bg-purple-100 transition-colors cursor-pointer ${reimporting ? "opacity-50 pointer-events-none" : ""}`}
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
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {reimporting ? "Importing..." : "Import from AI"}
          <input
            ref={reimportFileRef}
            type="file"
            accept=".json"
            onChange={handleReimportFileSelect}
            disabled={reimporting}
            className="hidden"
          />
        </label>

        {reimportError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
            {reimportError}
          </p>
        )}
        {reimportSuccess && (
          <p className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg p-3">
            {reimportSuccess}
          </p>
        )}

        {/* Delete Trip */}
        <div className="pt-2">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-lg border border-red-300 dark:border-red-700 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Delete Trip
            </button>
          ) : (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
              <p className="text-sm text-red-700 dark:text-red-300">
                Delete this trip and all its items? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (id) {
                      await tripRepo.delete(id);
                      navigate("/trips/history", { replace: true });
                    }
                  }}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {fixingItem && (
        <FixUnknownItemModal
          itemId={fixingItem.itemId}
          currentPrice={fixingItem.price}
          existingName={fixingItem.item?.name}
          existingBarcode={fixingItem.item?.barcode}
          existingUnitType={fixingItem.item?.unitType}
          existingCategory={fixingItem.item?.category}
          onCancel={() => setFixingItem(null)}
          onSave={async (data) => {
            if (fixingItem.item) {
              await itemRepo.update(data.itemId, {
                name: data.name,
                barcode: data.barcode,
                currentPrice: data.currentPrice,
                unitType: data.unitType as UnitType,
                category: data.category || undefined,
              });
            } else {
              await db.items.put({
                id: data.itemId,
                name: data.name,
                barcode: data.barcode,
                currentPrice: data.currentPrice,
                unitType: data.unitType as UnitType,
                category: data.category || undefined,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
            setFixingItem(null);
          }}
        />
      )}
    </div>
  );
}
