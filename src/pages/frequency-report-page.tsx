import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { formatCurrency } from "@/core/pricing";
import { PageHeader } from "@/components/layout/page-header";
import { Link } from "react-router";

interface RankedItem {
  rank: number;
  itemId: string;
  name: string;
  timesBought: number;
  totalSpent: number;
}

export default function FrequencyReportPage() {
  const tripItems = useLiveQuery(() => db.tripItems.toArray());
  const items = useLiveQuery(() => db.items.toArray());

  const rankedItems: RankedItem[] = useMemo(() => {
    if (!tripItems || !items) return [];

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const grouped = new Map<string, { count: number; spent: number }>();

    for (const ti of tripItems) {
      const existing = grouped.get(ti.itemId) ?? { count: 0, spent: 0 };
      existing.count += ti.quantity;
      existing.spent += ti.lineTotal;
      grouped.set(ti.itemId, existing);
    }

    return Array.from(grouped.entries())
      .map(([itemId, data]) => ({
        rank: 0,
        itemId,
        name: itemMap.get(itemId)?.name ?? "Unknown Item",
        timesBought: data.count,
        totalSpent: data.spent,
      }))
      .sort((a, b) => b.timesBought - a.timesBought)
      .slice(0, 20)
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }, [tripItems, items]);

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Most Bought" backTo="/reports" />

      <div className="flex-1 p-4">
        {rankedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-gray-400 dark:text-gray-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-3"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <p className="text-sm">No purchase data yet</p>
            <p className="text-xs mt-1">Complete a trip to see your most bought items</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <span className="w-8">#</span>
              <span className="flex-1">Item</span>
              <span className="w-16 text-right">Bought</span>
              <span className="w-20 text-right">Total</span>
            </div>

            {rankedItems.map((item) => (
              <Link
                key={item.itemId}
                to={`/reports/price/${item.itemId}`}
                className="flex items-center px-3 py-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span
                  className={`w-8 text-sm font-bold ${
                    item.rank <= 3 ? "text-amber-500" : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {item.rank}
                </span>
                <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {item.name}
                </span>
                <span className="w-16 text-sm text-gray-600 dark:text-gray-400 text-right">
                  {item.timesBought}x
                </span>
                <span className="w-20 text-sm font-medium text-gray-900 dark:text-gray-100 text-right">
                  {formatCurrency(item.totalSpent)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
