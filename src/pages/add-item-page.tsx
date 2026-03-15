import { useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";

import type { Item, UnitType } from "@/contracts/types";
import { db } from "@/db/database";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ItemRepository } from "@/db/repositories/item-repository";
import { PageHeader } from "@/components/layout/page-header";
import { ItemForm } from "@/components/forms/item-form";
import { formatCurrency } from "@/core/pricing";

const tripItemRepo = new TripItemRepository();
const itemRepo = new ItemRepository();

export default function AddItemPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const barcodeFromScanner = searchParams.get("barcode") ?? "";

  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(!!barcodeFromScanner);
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [quantityPrompt, setQuantityPrompt] = useState<{
    item: Item;
    quantity: number;
    weightLbs: string;
  } | null>(null);

  const searchResults = useLiveQuery(async () => {
    if (!searchQuery || searchQuery.length < 2) return [];
    return itemRepo.searchByName(searchQuery);
  }, [searchQuery]);

  const handleSelectItem = useCallback((item: Item) => {
    setQuantityPrompt({ item, quantity: 1, weightLbs: "" });
  }, []);

  const handleAddToTrip = useCallback(async () => {
    if (!quantityPrompt || savingRef.current) return;
    const { item, quantity, weightLbs } = quantityPrompt;

    savingRef.current = true;
    setAddingItemId(item.id);
    try {
      await db.transaction("rw", [db.tripItems, db.priceHistory, db.trips], async () => {
        const trip = await db.trips.where("status").equals("active").first();
        if (!trip) return;

        await tripItemRepo.addToTrip({
          tripId: trip.id,
          itemId: item.id,
          price: item.currentPrice,
          quantity,
          weightLbs:
            item.unitType === "per_lb" && weightLbs
              ? parseFloat(weightLbs)
              : undefined,
          onSale: false,
        });
      });

      setQuantityPrompt(null);
      navigate("/trips/active");
    } catch (err) {
      console.error("Failed to add item to trip:", err);
      alert("Failed to add item. Please try again.");
    } finally {
      savingRef.current = false;
      setAddingItemId(null);
    }
  }, [quantityPrompt, navigate]);

  const handleCreateNewItem = useCallback(
    async (values: {
      barcode: string;
      name: string;
      currentPrice: number;
      unitType: string;
      category: string;
    }) => {
      const item = await itemRepo.create({
        barcode: values.barcode,
        name: values.name,
        currentPrice: values.currentPrice,
        unitType: values.unitType as UnitType,
        category: values.category || undefined,
      });

      // Immediately add to active trip
      const trip = await db.trips.where("status").equals("active").first();
      if (trip) {
        handleSelectItem(item);
      }

      setShowCreateForm(false);
    },
    [handleSelectItem],
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader title="Add Item" backTo="/trips/active" />

      <main className="flex-1 p-4 space-y-6">
        {/* Quantity/weight prompt */}
        {quantityPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white dark:bg-gray-800 rounded-xl mx-4 p-6 max-w-sm w-full shadow-xl space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {quantityPrompt.item.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {formatCurrency(quantityPrompt.item.currentPrice)} /{" "}
                {quantityPrompt.item.unitType === "per_lb" ? "lb" : "each"}
              </p>

              {quantityPrompt.item.unitType === "per_lb" ? (
                <div>
                  <label
                    htmlFor="add-weight"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Weight (lbs)
                  </label>
                  <input
                    id="add-weight"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={quantityPrompt.weightLbs}
                    onChange={(e) =>
                      setQuantityPrompt((prev) =>
                        prev ? { ...prev, weightLbs: e.target.value } : null,
                      )
                    }
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="add-qty"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Quantity
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setQuantityPrompt((prev) =>
                          prev
                            ? {
                                ...prev,
                                quantity: Math.max(1, prev.quantity - 1),
                              }
                            : null,
                        )
                      }
                      className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      -
                    </button>
                    <span className="text-lg font-semibold text-gray-900 dark:text-gray-100 w-10 text-center">
                      {quantityPrompt.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuantityPrompt((prev) =>
                          prev
                            ? { ...prev, quantity: prev.quantity + 1 }
                            : null,
                        )
                      }
                      className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setQuantityPrompt(null)}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddToTrip}
                  disabled={
                    addingItemId !== null ||
                    (quantityPrompt.item.unitType === "per_lb" &&
                      (!quantityPrompt.weightLbs ||
                        parseFloat(quantityPrompt.weightLbs) <= 0))
                  }
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingItemId ? "Adding..." : "Add to Trip"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search existing items */}
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Search Existing Items
          </h2>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by item name..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          {searchResults && searchResults.length > 0 && (
            <ul className="mt-2 divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-lg overflow-hidden">
              {searchResults.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectItem(item)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {item.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {item.barcode} &middot;{" "}
                          {item.unitType === "per_lb" ? "per lb" : "each"}
                        </p>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.currentPrice)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchResults && searchResults.length === 0 && searchQuery.length >= 2 && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              No items found matching "{searchQuery}"
            </p>
          )}
        </section>

        {/* Create new item */}
        <section>
          {showCreateForm ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Create New Item
              </h2>
              <ItemForm
                initialValues={{
                  barcode: barcodeFromScanner,
                }}
                onSubmit={handleCreateNewItem}
                onCancel={() => setShowCreateForm(false)}
                submitLabel="Create & Add"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="w-full rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-4 text-sm font-medium text-blue-600 dark:text-blue-400 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
            >
              + Create New Item
              {barcodeFromScanner && (
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Barcode: {barcodeFromScanner}
                </span>
              )}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
