import { useState, useMemo, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router";
import { db } from "@/db/database";
import type { Store } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { PageHeader } from "@/components/layout/page-header";
import { TripCard } from "@/components/data-display/trip-card";
import { DateRangePicker } from "@/components/forms/date-range-picker";
import {
  validateTripImportData,
  importTripFromAI,
} from "@/services/trip-exchange-service";

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
  const [tripImporting, setTripImporting] = useState(false);
  const [tripImportError, setTripImportError] = useState<string | null>(null);
  const [tripImportResult, setTripImportResult] = useState<{
    tripId: string;
    itemsCreated: number;
    itemsMatched: number;
    itemsMissingBarcode: number;
  } | null>(null);
  const tripFileInputRef = useRef<HTMLInputElement>(null);

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

  const handleTripFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTripImportError(null);
      setTripImportResult(null);
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target?.result as string;
        try {
          const parsed = JSON.parse(text);
          const validation = validateTripImportData(parsed);
          if (!validation.valid) {
            setTripImportError(`Invalid file: ${validation.errors.join(", ")}`);
            return;
          }
          setTripImporting(true);
          try {
            const result = await importTripFromAI(text);
            setTripImportResult(result);
          } catch (err) {
            setTripImportError(
              err instanceof Error ? err.message : "Trip import failed",
            );
          } finally {
            setTripImporting(false);
            if (tripFileInputRef.current) {
              tripFileInputRef.current.value = "";
            }
          }
        } catch {
          setTripImportError(
            "Could not parse file. Make sure it is valid JSON.",
          );
        }
      };
      reader.readAsText(file);
    },
    [],
  );

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
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader title="Trip History" backTo="/" />

      <main className="flex-1 overflow-y-auto">
        {/* Filter bar – sticky */}
        <div className="sticky top-0 z-10 p-4 pb-0 bg-gray-50 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <div>
            <label
              htmlFor="store-filter"
              className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
            >
              Store
            </label>
            <select
              id="store-filter"
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
        </div>

        {/* Import from AI */}
        <div className="px-4 pt-4 space-y-2">
          <label
            className={`w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-purple-300 dark:border-purple-600 text-purple-700 dark:text-purple-300 px-4 py-3 text-sm font-medium hover:bg-purple-50 dark:hover:bg-purple-900/20 active:bg-purple-100 transition-colors cursor-pointer ${tripImporting ? "opacity-50 pointer-events-none" : ""}`}
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
            {tripImporting ? "Importing..." : "Import Trip from AI"}
            <input
              ref={tripFileInputRef}
              type="file"
              accept=".json"
              onChange={handleTripFileSelect}
              disabled={tripImporting}
              className="hidden"
            />
          </label>

          {tripImportError && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
              {tripImportError}
            </p>
          )}
          {tripImportResult && (
            <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg p-3 space-y-2">
              <p className="font-medium">Trip imported successfully!</p>
              <ul className="text-xs space-y-1">
                <li>{tripImportResult.itemsCreated} items created</li>
                {tripImportResult.itemsMatched > 0 && (
                  <li>{tripImportResult.itemsMatched} items matched to existing</li>
                )}
                {tripImportResult.itemsMissingBarcode > 0 && (
                  <li className="text-purple-600 dark:text-purple-400">
                    {tripImportResult.itemsMissingBarcode} items need barcodes
                  </li>
                )}
              </ul>
              <button
                type="button"
                onClick={() => navigate(`/trips/${tripImportResult.tripId}`)}
                className="mt-2 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 cursor-pointer"
              >
                View Imported Trip
              </button>
            </div>
          )}
        </div>

        {/* Trip list */}
        <div className="p-4 pt-4 space-y-4">
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
              className="text-gray-300 dark:text-gray-600 mb-3"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <line x1="3" x2="21" y1="6" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 text-sm">No trips found</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
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
        </div>
      </main>
    </div>
  );
}
