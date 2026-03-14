import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { formatCurrency } from "@/core/pricing";
import { PageHeader } from "@/components/layout/page-header";
import { PriceChart } from "@/components/data-display/price-chart";
import { ItemForm } from "@/components/forms/item-form";
import { ItemRepository } from "@/db/repositories/item-repository";
import type { UnitType } from "@/contracts/types";

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const itemRepo = new ItemRepository();
  const [isEditing, setIsEditing] = useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("");

  const item = useLiveQuery(() => {
    if (!id) return undefined;
    return db.items.get(id);
  }, [id]);

  const priceHistory = useLiveQuery(() => {
    if (!id) return [];
    return db.priceHistory
      .where("itemId")
      .equals(id)
      .sortBy("recordedAt");
  }, [id]);

  const stores = useLiveQuery(() => db.stores.toArray());

  const storeMap = new Map(stores?.map((s) => [s.id, s.name]) ?? []);

  const chartData = (priceHistory ?? []).map((entry) => ({
    date: new Date(entry.recordedAt),
    price: entry.price,
    storeName: storeMap.get(entry.storeId) ?? "Unknown Store",
  }));

  const relevantStoreIds = new Set(
    (priceHistory ?? []).map((entry) => entry.storeId)
  );
  const relevantStores = (stores ?? []).filter((s) =>
    relevantStoreIds.has(s.id)
  );

  async function handleUpdate(values: {
    barcode: string;
    name: string;
    currentPrice: number;
    unitType: string;
    category: string;
  }) {
    if (!id) return;
    await itemRepo.update(id, {
      barcode: values.barcode,
      name: values.name,
      currentPrice: values.currentPrice,
      unitType: values.unitType as UnitType,
      category: values.category || undefined,
    });
    setIsEditing(false);
  }

  if (item === undefined) {
    return (
      <div className="flex flex-col min-h-full">
        <PageHeader title="Item" backTo="/items" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (item === null) {
    return (
      <div className="flex flex-col min-h-full">
        <PageHeader title="Item" backTo="/items" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">Item not found.</p>
        </div>
      </div>
    );
  }

  const unitLabel = item.unitType === "per_lb" ? "/lb" : "/ea";

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={item.name}
        backTo="/items"
        rightAction={
          !isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
            >
              Edit
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 px-4 py-4 space-y-6">
        {isEditing ? (
          <ItemForm
            initialValues={{
              barcode: item.barcode,
              name: item.name,
              currentPrice: item.currentPrice,
              unitType: item.unitType,
              category: item.category ?? "",
            }}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            submitLabel="Update"
          />
        ) : (
          <>
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatCurrency(item.currentPrice)}
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
                    {unitLabel}
                  </span>
                </span>
                {item.category && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                    {item.category}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Barcode</span>
                  <p className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                    {item.barcode}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Unit Type</span>
                  <p className="font-medium text-gray-900 dark:text-gray-100 mt-0.5 capitalize">
                    {item.unitType === "per_lb" ? "Per Pound" : "Each"}
                  </p>
                </div>
              </div>
            </div>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Price History
                </h2>
                {relevantStores.length > 0 && (
                  <select
                    value={storeFilter}
                    onChange={(e) => setStoreFilter(e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">All Stores</option>
                    {relevantStores.map((store) => (
                      <option key={store.id} value={store.name}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
                <PriceChart
                  data={chartData}
                  storeFilter={storeFilter || undefined}
                />
              </div>
            </section>

            {(priceHistory ?? []).length > 0 && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => navigate(`/items/${id}/price-history`)}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium cursor-pointer"
                >
                  View Full Price History Report
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
