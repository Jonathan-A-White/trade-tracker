import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router";
import { db } from "@/db/database";
import { PageHeader } from "@/components/layout/page-header";

export function StoresPage() {
  const navigate = useNavigate();

  const stores = useLiveQuery(() => db.stores.orderBy("name").toArray());

  const trips = useLiveQuery(() => db.trips.toArray());

  const tripCountByStore = new Map<string, number>();
  for (const trip of trips ?? []) {
    tripCountByStore.set(
      trip.storeId,
      (tripCountByStore.get(trip.storeId) ?? 0) + 1
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Stores"
        rightAction={
          <Link
            to="/stores/new"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            aria-label="Add store"
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
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </Link>
        }
      />

      <div className="flex-1 px-4 py-4">
        {stores === undefined ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-gray-400 dark:text-gray-500">Loading...</div>
          </div>
        ) : stores.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              No stores added yet.
            </p>
            <Link
              to="/stores/new"
              className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Add Your First Store
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => navigate(`/stores/${store.id}/edit`)}
                className="w-full bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {store.name}
                    </p>
                    {(store.city || store.state) && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {[store.city, store.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {store.notes && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                        {store.notes}
                      </p>
                    )}
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {tripCountByStore.get(store.id) ?? 0} trips
                    </span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-gray-400 dark:text-gray-500"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
