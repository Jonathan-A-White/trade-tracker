import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, Link, Outlet } from "react-router";
import { db } from "@/db/database";
import type { Item, PendingLookup } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { countGuessedPrices, countsTowardTotal } from "@/core/pricing";
import { photoPricePath, priceLookupNote } from "@/core/photo-price";
import { PageHeader } from "@/components/layout/page-header";
import { TripItemRow } from "@/components/data-display/trip-item-row";
import { SubtotalBar } from "@/components/data-display/subtotal-bar";
import { PendingLineRow } from "@/components/data-display/pending-line-row";
import { InlineEditor } from "@/components/forms/inline-editor";
import { ItemForm } from "@/components/forms/item-form";


const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();
const pendingLookupRepo = new PendingLookupRepository();
const itemRepo = new ItemRepository();

function useElapsedTime(startedAt: number | undefined) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startedAt) return;

    function update() {
      const diff = Date.now() - startedAt!;
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1_000);
      setElapsed(
        hours > 0
          ? `${hours}h ${minutes}m ${seconds}s`
          : `${minutes}m ${seconds}s`,
      );
    }

    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return elapsed;
}

export default function ActiveTripPage() {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<"price" | "quantity" | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fillingLookupId, setFillingLookupId] = useState<string | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);

  const trip = useLiveQuery(() => tripRepo.getActive(), []);
  const tripItems = useLiveQuery(
    () => (trip ? tripItemRepo.getByTrip(trip.id) : []),
    [trip?.id],
  );

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

  // Pending lookups of this trip, keyed by the itemId their pending line carries.
  const lookupsByItemId = useLiveQuery(async () => {
    if (!trip) return {};
    const lookups = await pendingLookupRepo.listByTrip(trip.id);
    const map: Record<string, PendingLookup> = {};
    for (const lookup of lookups) {
      if (lookup.mode !== "price-only" && lookup.status !== "applied") {
        map[lookup.itemId] = lookup;
      }
    }
    return map;
  }, [trip?.id]);

  // The latest price-only lookup of each known item on this trip, keyed by the item's id.
  const priceLookupsByItemId = useLiveQuery(async () => {
    if (!trip) return {};
    const map: Record<string, PendingLookup> = {};
    for (const lookup of await pendingLookupRepo.listPriceOnlyByTrip(trip.id)) {
      map[lookup.itemId] = lookup;
    }
    return map;
  }, [trip?.id]);

  const storeName = useLiveQuery(async () => {
    if (!trip) return "";
    const store = await db.stores.get(trip.storeId);
    return store?.name ?? "Unknown Store";
  }, [trip?.storeId]);

  const elapsed = useElapsedTime(trip?.startedAt);

  const handleEditPrice = useCallback((id: string) => {
    setEditingId(id);
    setEditField("price");
  }, []);

  const handleEditQuantity = useCallback((id: string) => {
    setEditingId(id);
    setEditField("quantity");
  }, []);

  const handleSaveEdit = useCallback(
    async (value: number, byWeight: boolean) => {
      if (!editingId || !editField) return;
      if (editField === "price") {
        await tripItemRepo.update(editingId, { price: value });
      } else if (byWeight) {
        // a per-pound line is edited by its weight; no weight (0) falls back to price x quantity
        await tripItemRepo.update(editingId, { weightLbs: value > 0 ? value : undefined });
      } else {
        await tripItemRepo.update(editingId, { quantity: value });
      }
      setEditingId(null);
      setEditField(null);
    },
    [editingId, editField],
  );

  const handleRemove = useCallback(async (id: string) => {
    await tripItemRepo.remove(id);
  }, []);

  const handleRetryPending = useCallback(async (lookupId: string) => {
    await pendingLookupRepo.retry(lookupId);
  }, []);

  const handleDismissPriceLookup = useCallback(async (lookupId: string) => {
    await pendingLookupRepo.discard(lookupId);
  }, []);

  const handleClearPriceFlag = useCallback(async (id: string) => {
    await tripItemRepo.clearPriceFlag(id);
  }, []);

  const handleChangePendingQuantity = useCallback(
    async (lookupId: string, quantity: number) => {
      await pendingLookupRepo.setQuantity(lookupId, quantity);
    },
    [],
  );

  const handleDiscardPending = useCallback(async (lookupId: string) => {
    await pendingLookupRepo.discard(lookupId);
  }, []);

  const handleFillByHand = useCallback((lookupId: string) => {
    setFillError(null);
    setFillingLookupId(lookupId);
  }, []);

  const handleSubmitFill = useCallback(
    async (values: {
      barcode: string;
      name: string;
      currentPrice: number;
      unitType: string;
      category: string;
    }) => {
      if (!fillingLookupId) return;
      try {
        const existing = await itemRepo.findByBarcode(values.barcode);
        const item =
          existing ??
          (await itemRepo.create({
            barcode: values.barcode,
            name: values.name,
            currentPrice: values.currentPrice,
            unitType: values.unitType as Item["unitType"],
            category: values.category || undefined,
          }));
        await pendingLookupRepo.fillByHand(fillingLookupId, item);
        setFillingLookupId(null);
      } catch (err) {
        console.error("Failed to fill pending line:", err);
        setFillError("Could not save the item. Please try again.");
      }
    },
    [fillingLookupId],
  );

  const handleOpenBudgetEdit = useCallback(() => {
    setBudgetInput(trip?.budget?.toFixed(2) ?? "");
    setEditingBudget(true);
  }, [trip?.budget]);

  const handleSaveBudget = useCallback(async () => {
    if (!trip) return;
    const value = budgetInput.trim() ? parseFloat(budgetInput) : undefined;
    await tripRepo.updateBudget(trip.id, value && value > 0 ? value : undefined);
    setEditingBudget(false);
  }, [trip, budgetInput]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditField(null);
  }, []);

  if (!trip) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <PageHeader title="Active Trip" backTo="/" />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-4">
            <p className="text-gray-500 dark:text-gray-400">No active trip</p>
            <Link
              to="/trips/new"
              className="inline-block rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Start a Trip
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const items = tripItems ?? [];
  const map = itemsMap ?? {};
  const lookups = lookupsByItemId ?? {};
  const priceLookups = priceLookupsByItemId ?? {};
  const fillingLookup = Object.values(lookups).find(
    (l) => l.id === fillingLookupId,
  );
  const query = searchQuery.toLowerCase().trim();
  const filteredItems = query
    ? items.filter((ti) => {
        if (ti.pending) return lookups[ti.itemId]?.barcode.includes(query);
        const name = map[ti.itemId]?.name ?? "";
        return name.toLowerCase().includes(query);
      })
    : items;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader
        title={storeName ?? "Loading..."}
        backTo="/"
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleOpenBudgetEdit}
              className="text-xs text-blue-500 hover:text-blue-400 transition-colors cursor-pointer"
              title="Set budget"
            >
              {trip.budget ? `$${trip.budget.toFixed(2)} budget` : "+ Budget"}
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">{elapsed}</span>
          </div>
        }
      />

      {/* Sticky action buttons + search */}
      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900">
        <div className="flex gap-3 px-4 pt-4 pb-2">
          <Link
            to="/trips/active/scan"
            className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white text-center hover:bg-blue-700 transition-colors"
          >
            Scan
          </Link>
          <Link
            to="/trips/active/add"
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 text-center hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Add Manually
          </Link>
        </div>
        {items.length > 0 && (
          <div className="px-4 pb-3">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-8 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <main className="flex-1 overflow-y-auto pb-40">
        {/* Trip items list */}
        {items.length === 0 ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
            No items yet. Scan a barcode or add an item manually.
          </div>
        ) : (
          <div>
            {filteredItems.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                No items match &ldquo;{searchQuery}&rdquo;
              </div>
            ) : filteredItems.map((ti) => {
              const item = map[ti.itemId];
              if (ti.pending && lookups[ti.itemId]) {
                return (
                  <PendingLineRow
                    key={ti.id}
                    lookup={lookups[ti.itemId]}
                    onFillByHand={handleFillByHand}
                    onDiscard={handleDiscardPending}
                    onRetry={handleRetryPending}
                    quantity={ti.quantity}
                    onQuantityChange={handleChangePendingQuantity}
                  />
                );
              }
              if (editingId === ti.id && editField) {
                return (
                  <div key={ti.id} className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                      {item?.name ?? "Unknown Item"}
                    </p>
                    <InlineEditor
                      label={
                        editField === "price" ? "Price" : item?.unitType === "per_lb" ? "Weight (lb)" : "Qty"
                      }
                      value={
                        editField === "price"
                          ? ti.price
                          : item?.unitType === "per_lb"
                            ? (ti.weightLbs ?? ti.quantity)
                            : ti.quantity
                      }
                      onSave={(v) => handleSaveEdit(v, item?.unitType === "per_lb")}
                      onCancel={handleCancelEdit}
                      inputType={
                        editField === "price" ? "currency" : item?.unitType === "per_lb" ? "decimal" : "integer"
                      }
                    />
                  </div>
                );
              }
              return (
                <TripItemRow
                  key={ti.id}
                  tripItem={ti}
                  itemName={item?.name ?? "Unknown Item"}
                  unitType={item?.unitType ?? "each"}
                  editable
                  onEditPrice={handleEditPrice}
                  onEditQuantity={handleEditQuantity}
                  onRemove={handleRemove}
                  onClearPriceFlag={handleClearPriceFlag}
                  priceLookupNote={priceLookupNote(priceLookups[ti.itemId])}
                  onPhotoPrice={
                    item ? () => navigate(photoPricePath(item)) : undefined
                  }
                  onRetryPriceLookup={() => handleRetryPending(priceLookups[ti.itemId].id)}
                  onDismissPriceLookup={() =>
                    handleDismissPriceLookup(priceLookups[ti.itemId].id)
                  }
                />
              );
            })}
          </div>
        )}
      </main>

      <SubtotalBar
        subtotal={trip.scannedSubtotal}
        itemCount={items.filter(countsTowardTotal).length}
        guessCount={countGuessedPrices(items)}
        budget={trip.budget}
        onEndTrip={() => navigate("/trips/active/end")}
      />

      {/* Budget edit modal */}
      {editingBudget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl mx-4 p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Trip Budget
            </h2>
            <div className="relative mb-4">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-7 pr-3 py-2.5 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Leave empty to remove budget.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditingBudget(false)}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBudget}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fill a pending line by hand with the existing item form */}
      {fillingLookup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl mx-4 p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Fill by hand
            </h2>
            <ItemForm
              initialValues={{ barcode: fillingLookup.barcode }}
              onSubmit={handleSubmitFill}
              onCancel={() => setFillingLookupId(null)}
              submitLabel="Save Item"
            />
            {fillError && (
              <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
                {fillError}
              </p>
            )}
          </div>
        </div>
      )}

      <Outlet />
    </div>
  );
}
