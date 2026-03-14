import { useState, useMemo } from "react";
import { useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { formatCurrency } from "@/core/pricing";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/data-display/stat-card";
import { PriceChart } from "@/components/data-display/price-chart";

export default function PriceHistoryReportPage() {
  const { itemId } = useParams();
  const [selectedStore, setSelectedStore] = useState<string>("");

  const item = useLiveQuery(
    () => (itemId ? db.items.get(itemId) : undefined),
    [itemId],
  );

  const priceHistory = useLiveQuery(
    () =>
      itemId
        ? db.priceHistory.where("itemId").equals(itemId).sortBy("recordedAt")
        : [],
    [itemId],
  );

  const stores = useLiveQuery(() => db.stores.toArray());

  const storeMap = useMemo(
    () => new Map((stores ?? []).map((s) => [s.id, s])),
    [stores],
  );

  const filteredHistory = useMemo(() => {
    if (!priceHistory) return [];
    if (!selectedStore) return priceHistory;
    return priceHistory.filter((ph) => ph.storeId === selectedStore);
  }, [priceHistory, selectedStore]);

  const chartData = useMemo(
    () =>
      filteredHistory.map((ph) => ({
        date: new Date(ph.recordedAt),
        price: ph.price,
        storeName: storeMap.get(ph.storeId)?.name ?? "Unknown",
      })),
    [filteredHistory, storeMap],
  );

  const stats = useMemo(() => {
    if (!filteredHistory.length) {
      return { lowest: 0, highest: 0, average: 0, current: 0 };
    }
    const prices = filteredHistory.map((ph) => ph.price);
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const average = prices.reduce((a, b) => a + b, 0) / prices.length;
    const current = prices[prices.length - 1];
    return { lowest, highest, average, current };
  }, [filteredHistory]);

  const relevantStoreIds = useMemo(() => {
    if (!priceHistory) return new Set<string>();
    return new Set(priceHistory.map((ph) => ph.storeId));
  }, [priceHistory]);

  if (!itemId) {
    return (
      <div className="flex flex-col min-h-full">
        <PageHeader title="Price History" backTo="/reports" />
        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
          No item selected
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={item?.name ?? "Price History"}
        backTo={`/items/${itemId}`}
      />

      <div className="flex-1 p-4 space-y-6">
        {/* Store filter */}
        <div>
          <label
            htmlFor="store-filter"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            Filter by Store
          </label>
          <select
            id="store-filter"
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Stores</option>
            {(stores ?? [])
              .filter((s) => relevantStoreIds.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Lowest" value={formatCurrency(stats.lowest)} />
          <StatCard label="Highest" value={formatCurrency(stats.highest)} />
          <StatCard label="Average" value={formatCurrency(stats.average)} />
          <StatCard label="Current" value={formatCurrency(stats.current)} />
        </div>

        {/* Chart */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Price Over Time
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3">
            <PriceChart data={chartData} height={220} />
          </div>
        </div>

        {/* History table */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            All Price Records
          </h2>
          {filteredHistory.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-400 dark:text-gray-500 text-sm bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
              No price records found
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">
                      Date
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">
                      Store
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredHistory].reverse().map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                        {new Date(entry.recordedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                        {storeMap.get(entry.storeId)?.name ?? "Unknown"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900 dark:text-gray-100">
                        {formatCurrency(entry.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
