import { useState, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router";
import { db } from "@/db/database";
import type { Store } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { PageHeader } from "@/components/layout/page-header";
import { TripCard } from "@/components/data-display/trip-card";
import { DateRangePicker } from "@/components/forms/date-range-picker";

const tripRepo = new TripRepository();

function getDefaultStartDate(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDefaultEndDate(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function TripHistoryPage() {
  const navigate = useNavigate();
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [startDate, setStartDate] = useState<Date>(getDefaultStartDate);
  const [endDate, setEndDate] = useState<Date>(getDefaultEndDate);

  const stores = useLiveQuery(() => db.stores.orderBy("name").toArray(), []);

  const trips = useLiveQuery(
    () =>
      tripRepo.list({
        storeId: selectedStoreId || undefined,
        startAfter: startDate.getTime(),
        startBefore: endDate.getTime(),
      }),
    [selectedStoreId, startDate, endDate],
  );

  const storesMap = useMemo(() => {
    const map: Record<string, Store> = {};
    if (stores) {
      for (const s of stores) {
        map[s.id] = s;
      }
    }
    return map;
  }, [stores]);

  const handleTripPress = useCallback(
    (trip: { id: string }) => {
      navigate(`/trips/${trip.id}`);
    },
    [navigate],
  );

  const handleDateChange = useCallback((start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  const presets = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    monthAgo.setHours(0, 0, 0, 0);

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    threeMonthsAgo.setHours(0, 0, 0, 0);

    return [
      { label: "Last 7 Days", start: weekAgo, end: now },
      { label: "Last 30 Days", start: monthAgo, end: now },
      { label: "Last 3 Months", start: threeMonthsAgo, end: now },
    ];
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <PageHeader title="Trip History" backTo="/" />

      <main className="flex-1 p-4 space-y-4">
        {/* Filter bar */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div>
            <label
              htmlFor="store-filter"
              className="block text-xs font-medium text-gray-500 mb-1"
            >
              Store
            </label>
            <select
              id="store-filter"
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Stores</option>
              {(stores ?? []).map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </div>

          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={handleDateChange}
            presets={presets}
          />
        </div>

        {/* Trip list */}
        {!trips || trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-300 mb-3"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <line x1="3" x2="21" y1="6" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <p className="text-gray-500 text-sm">No trips found</p>
            <p className="text-gray-400 text-xs mt-1">
              Try adjusting your filters or start a new trip.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {trips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                storeName={storesMap[trip.storeId]?.name ?? "Unknown Store"}
                onPress={handleTripPress}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
