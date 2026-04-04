import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { db } from "@/db/database";
import { formatCurrency } from "@/core/pricing";
import { getTaxModule } from "@/core/tax";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/data-display/stat-card";

export default function TripComparisonPage() {
  const trips = useLiveQuery(() =>
    db.trips.where("status").equals("completed").sortBy("startedAt"),
  );
  const stores = useLiveQuery(() => db.stores.toArray());

  const storeMap = useMemo(
    () => new Map((stores ?? []).map((s) => [s.id, s])),
    [stores],
  );

  const tripsWithActual = useMemo(
    () => (trips ?? []).filter((t) => t.actualTotal !== undefined && t.actualTotal !== null),
    [trips],
  );

  // Load trip items and item details for tax calculation
  const tripTaxData = useLiveQuery(async () => {
    if (tripsWithActual.length === 0) return new Map<string, number>();
    const taxByTrip = new Map<string, number>();

    for (const trip of tripsWithActual) {
      const store = storeMap.get(trip.storeId);
      if (!store?.state) {
        taxByTrip.set(trip.id, 0);
        continue;
      }
      const taxModule = getTaxModule(store.state);
      if (!taxModule) {
        taxByTrip.set(trip.id, 0);
        continue;
      }

      const tripItems = await db.tripItems.where("tripId").equals(trip.id).toArray();
      const itemIds = tripItems.map((ti) => ti.itemId);
      const items = await db.items.where("id").anyOf(itemIds).toArray();
      const itemMap = new Map(items.map((item) => [item.id, item]));

      const lineItems = tripItems.map((ti) => {
        const item = itemMap.get(ti.itemId);
        return {
          name: item?.name ?? "Unknown Item",
          lineTotal: ti.lineTotal,
          category: item?.category,
          taxOverride: ti.taxOverride,
        };
      });

      const estimate = taxModule.calculate(lineItems);
      taxByTrip.set(trip.id, estimate.totalTax);
    }

    return taxByTrip;
  }, [tripsWithActual, storeMap]);

  const rows = useMemo(
    () =>
      tripsWithActual.map((t) => {
        const estimatedTax = tripTaxData?.get(t.id) ?? 0;
        const estimatedTotal = t.scannedSubtotal + estimatedTax;
        const diff = (t.actualTotal ?? 0) - estimatedTotal;
        return {
          id: t.id,
          date: new Date(t.startedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          storeName: storeMap.get(t.storeId)?.name ?? "Unknown",
          scanned: estimatedTotal,
          actual: t.actualTotal ?? 0,
          diff,
          absDiff: Math.abs(diff),
        };
      }),
    [tripsWithActual, storeMap, tripTaxData],
  );

  const avgDifference = useMemo(() => {
    if (rows.length === 0) return 0;
    return rows.reduce((sum, r) => sum + r.absDiff, 0) / rows.length;
  }, [rows]);

  const accuracy = useMemo(() => {
    if (rows.length === 0) return 100;
    const totalActual = rows.reduce((sum, r) => sum + r.actual, 0);
    if (totalActual === 0) return 100;
    const totalAbsDiff = rows.reduce((sum, r) => sum + r.absDiff, 0);
    return Math.max(0, (1 - totalAbsDiff / totalActual) * 100);
  }, [rows]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        label: `${r.date}`,
        difference: Math.round(r.diff * 100) / 100,
      })),
    [rows],
  );

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Trip Accuracy" backTo="/reports" />

      <div className="flex-1 p-4 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Avg Difference" value={formatCurrency(avgDifference)} />
          <StatCard label="Accuracy" value={`${accuracy.toFixed(1)}%`} />
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Difference per Trip
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis
                    tickFormatter={(v: number) => `$${v}`}
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), "Difference"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "13px",
                    }}
                  />
                  <Bar
                    dataKey="difference"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Trip list */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Completed Trips
          </h2>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-2"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              <p className="text-sm">No completed trips with actual totals</p>
              <p className="text-xs mt-1">Enter an actual total when finishing a trip</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...rows].reverse().map((row) => {
                const isOver = row.diff > 0.01;
                const isUnder = row.diff < -0.01;
                const isMatch = !isOver && !isUnder;

                return (
                  <div
                    key={row.id}
                    className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {row.date}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {row.storeName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>Estimated: {formatCurrency(row.scanned)}</span>
                        <span>Actual: {formatCurrency(row.actual)}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-sm font-bold ${
                          isOver
                            ? "text-red-500"
                            : isUnder
                              ? "text-green-500"
                              : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {isOver ? "+" : ""}
                        {formatCurrency(row.diff)}
                      </span>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {isMatch ? "Exact" : isOver ? "Over" : "Under"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
