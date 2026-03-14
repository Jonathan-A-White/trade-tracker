import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams, Link, useNavigate } from "react-router";
import { db } from "@/db/database";
import type { Item } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PageHeader } from "@/components/layout/page-header";
import { formatCurrency } from "@/core/pricing";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const trip = useLiveQuery(
    () => (id ? tripRepo.getById(id) : undefined),
    [id],
  );

  const tripItems = useLiveQuery(
    () => (id ? tripItemRepo.getByTrip(id) : []),
    [id],
  );

  const storeName = useLiveQuery(async () => {
    if (!trip) return "";
    const store = await db.stores.get(trip.storeId);
    return store?.name ?? "Unknown Store";
  }, [trip?.storeId]);

  const itemsMap = useLiveQuery(async () => {
    if (!tripItems || tripItems.length === 0) return {};
    const itemIds = [...new Set(tripItems.map((ti) => ti.itemId))];
    const items = await db.items.where("id").anyOf(itemIds).toArray();
    const map: Record<string, Item> = {};
    for (const item of items) {
      map[item.id] = item;
    }
    return map;
  }, [tripItems]);

  if (!trip) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <PageHeader title="Trip Details" backTo="/trips/history" />
        <main className="flex-1 flex items-center justify-center p-4">
          <p className="text-gray-500 dark:text-gray-400">
            {id ? "Loading trip..." : "Trip not found."}
          </p>
        </main>
      </div>
    );
  }

  const items = tripItems ?? [];
  const map = itemsMap ?? {};
  const scannedSubtotal = trip.scannedSubtotal;
  const actualTotal = trip.actualTotal;
  const difference =
    actualTotal !== undefined ? actualTotal - scannedSubtotal : undefined;

  const tripDate = new Date(trip.startedAt).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageHeader
        title={storeName ?? "Loading..."}
        backTo="/trips/history"
        rightAction={
          <Link
            to={`/trips/${id}/edit`}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          >
            Edit
          </Link>
        }
      />

      <main className="flex-1 p-4 space-y-4">
        {/* Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">{tripDate}</p>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Scanned Subtotal</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(scannedSubtotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Actual Total</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {actualTotal !== undefined ? formatCurrency(actualTotal) : "--"}
              </p>
            </div>
          </div>

          {difference !== undefined && (
            <div
              className={`rounded-lg px-3 py-2 ${
                Math.abs(difference) < 1
                  ? "bg-green-50 dark:bg-green-900/30"
                  : Math.abs(difference) < 5
                    ? "bg-yellow-50 dark:bg-yellow-900/30"
                    : "bg-red-50 dark:bg-red-900/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Difference</p>
                <p
                  className={`text-sm font-bold ${
                    Math.abs(difference) < 1
                      ? "text-green-600 dark:text-green-400"
                      : Math.abs(difference) < 5
                        ? "text-yellow-600"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {difference >= 0 ? "+" : ""}
                  {formatCurrency(difference)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Items list */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Items ({items.length})
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No items in this trip.
            </div>
          ) : (
            <ul className="divide-y dark:divide-gray-700">
              {items.map((ti) => {
                const item = map[ti.itemId];
                const quantityDisplay =
                  item?.unitType === "per_lb" && ti.weightLbs !== undefined
                    ? `${ti.weightLbs.toFixed(2)} lbs`
                    : `x${ti.quantity}`;

                return (
                  <li key={ti.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/items/${ti.itemId}`}
                          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline truncate block"
                        >
                          {item?.name ?? "Unknown Item"}
                        </Link>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {formatCurrency(ti.price)} /{" "}
                          {item?.unitType === "per_lb" ? "lb" : "each"}{" "}
                          {quantityDisplay}
                          {ti.onSale && (
                            <span className="ml-1 text-orange-600 dark:text-orange-400 font-medium">
                              SALE
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 ml-3">
                        {formatCurrency(ti.lineTotal)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Delete Trip */}
        <div className="pt-2">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-lg border border-red-300 dark:border-red-700 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Delete Trip
            </button>
          ) : (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
              <p className="text-sm text-red-700 dark:text-red-300">
                Delete this trip and all its items? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (id) {
                      await tripRepo.delete(id);
                      navigate("/trips/history", { replace: true });
                    }
                  }}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
