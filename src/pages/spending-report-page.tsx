import { useState, useMemo } from "react";
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
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/data-display/stat-card";
import { DateRangePicker } from "@/components/forms/date-range-picker";

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function getWeekLabel(ts: number): string {
  const d = new Date(ts);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getMonthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

const presets = [
  {
    label: "This Week",
    get start() {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay());
      return startOfDay(d);
    },
    get end() {
      return endOfDay(new Date());
    },
  },
  {
    label: "This Month",
    get start() {
      const d = new Date();
      d.setDate(1);
      return startOfDay(d);
    },
    get end() {
      return endOfDay(new Date());
    },
  },
  {
    label: "Last 30 Days",
    get start() {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return startOfDay(d);
    },
    get end() {
      return endOfDay(new Date());
    },
  },
  {
    label: "Last 90 Days",
    get start() {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return startOfDay(d);
    },
    get end() {
      return endOfDay(new Date());
    },
  },
];

export default function SpendingReportPage() {
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return startOfDay(d);
  });
  const [endDate, setEndDate] = useState<Date>(() => endOfDay(new Date()));

  const trips = useLiveQuery(
    () =>
      db.trips
        .where("startedAt")
        .between(startDate.getTime(), endDate.getTime(), true, true)
        .toArray(),
    [startDate, endDate],
  );

  const completedTrips = useMemo(
    () => (trips ?? []).filter((t) => t.status === "completed"),
    [trips],
  );

  const totalSpent = useMemo(
    () => completedTrips.reduce((sum, t) => sum + (t.actualTotal ?? t.scannedSubtotal), 0),
    [completedTrips],
  );

  const averagePerTrip = useMemo(
    () => (completedTrips.length > 0 ? totalSpent / completedTrips.length : 0),
    [completedTrips, totalSpent],
  );

  const daySpan = useMemo(
    () => (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    [startDate, endDate],
  );

  const groupBy = daySpan > 60 ? "month" : "week";

  const chartData = useMemo(() => {
    const groups = new Map<string, number>();

    for (const trip of completedTrips) {
      const label =
        groupBy === "week"
          ? getWeekLabel(trip.startedAt)
          : getMonthLabel(trip.startedAt);
      groups.set(label, (groups.get(label) ?? 0) + (trip.actualTotal ?? trip.scannedSubtotal));
    }

    return Array.from(groups.entries()).map(([period, amount]) => ({
      period,
      amount: Math.round(amount * 100) / 100,
    }));
  }, [completedTrips, groupBy]);

  function handleRangeChange(start: Date, end: Date) {
    setStartDate(start);
    setEndDate(end);
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Spending" backTo="/reports" />

      <div className="flex-1 p-4 space-y-6">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={handleRangeChange}
          presets={presets}
        />

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Spent" value={formatCurrency(totalSpent)} />
          <StatCard label="Avg / Trip" value={formatCurrency(averagePerTrip)} />
          <StatCard label="Trips" value={completedTrips.length} />
        </div>

        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3">
            Spending per {groupBy === "week" ? "Week" : "Month"}
          </h2>
          {chartData.length > 0 ? (
            <div className="bg-white rounded-lg border p-3">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis
                    tickFormatter={(v: number) => `$${v}`}
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), "Spent"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "13px",
                    }}
                  />
                  <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm bg-white rounded-lg border">
              No completed trips in this period
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
