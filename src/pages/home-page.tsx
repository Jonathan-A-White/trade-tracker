import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { db } from "@/db/database";
import { formatCurrency } from "@/core/pricing";
import { StatCard } from "@/components/data-display/stat-card";
import { TripCard } from "@/components/data-display/trip-card";

export function HomePage() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const activeTrip = useLiveQuery(() =>
    db.trips.where("status").equals("active").first()
  );

  const tripsThisMonth = useLiveQuery(
    () =>
      db.trips
        .where("startedAt")
        .aboveOrEqual(startOfMonth)
        .toArray(),
    [startOfMonth]
  );

  const completedTrips = useLiveQuery(() =>
    db.trips
      .where("status")
      .equals("completed")
      .reverse()
      .sortBy("startedAt")
  );

  const totalItems = useLiveQuery(() => db.items.count());

  const stores = useLiveQuery(() => db.stores.toArray());

  const storeMap = new Map(stores?.map((s) => [s.id, s.name]) ?? []);

  const monthTrips = tripsThisMonth ?? [];
  const tripsCount = monthTrips.length;
  const spentThisMonth = monthTrips.reduce(
    (sum, t) => sum + (t.actualTotal ?? t.scannedSubtotal),
    0
  );
  const completedMonthTrips = monthTrips.filter(
    (t) => t.status === "completed"
  );
  const averageTripTotal =
    completedMonthTrips.length > 0
      ? completedMonthTrips.reduce(
          (sum, t) => sum + (t.actualTotal ?? t.scannedSubtotal),
          0
        ) / completedMonthTrips.length
      : 0;

  const recentTrips = (completedTrips ?? []).slice(0, 3);

  return (
    <div className="flex flex-col min-h-full">
      <header className="bg-blue-600 text-white px-4 py-6">
        <h1 className="text-2xl font-bold">TradeTracker</h1>
        <p className="text-blue-100 text-sm mt-1">
          Track your grocery spending
        </p>
      </header>

      <div className="flex-1 px-4 py-4 space-y-6">
        {activeTrip ? (
          <Link
            to="/trips/active"
            className="block w-full rounded-lg bg-green-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Resume Trip
          </Link>
        ) : (
          <Link
            to="/trips/new"
            className="block w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Start New Trip
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Trips This Month" value={tripsCount} />
          <StatCard
            label="Spent This Month"
            value={formatCurrency(spentThisMonth)}
          />
          <StatCard label="Items Tracked" value={totalItems ?? 0} />
          <StatCard
            label="Avg Trip Total"
            value={formatCurrency(averageTripTotal)}
          />
        </div>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Recent Trips
            </h2>
            {recentTrips.length > 0 && (
              <Link
                to="/trips/history"
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
              >
                View all
              </Link>
            )}
          </div>

          {recentTrips.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No completed trips yet. Start your first trip!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTrips.map((trip) => (
                <Link key={trip.id} to={`/trips/${trip.id}`}>
                  <TripCard
                    trip={trip}
                    storeName={storeMap.get(trip.storeId) ?? "Unknown Store"}
                  />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
