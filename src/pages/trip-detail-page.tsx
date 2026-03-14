import { useLiveQuery } from "dexie-react-hooks";
import { useParams, Link } from "react-router";
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
      <div className="flex flex-col min-h-screen bg-gray-50">
        <PageHeader title="Trip Details" backTo="/trips" />
        <main className="flex-1 flex items-center justify-center p-4">
          <p className="text-gray-500">
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
    <div className="flex flex-col min-h-screen bg-gray-50">
      <PageHeader
        title={storeName ?? "Loading..."}
        backTo="/trips"
        rightAction={
          <Link
            to={`/trips/${id}/edit`}
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Edit
          </Link>
        }
      />

      <main className="flex-1 p-4 space-y-4">
        {/* Summary */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <p className="text-sm text-gray-500">{tripDate}</p>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <p className="text-xs text-gray-500">Scanned Subtotal</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatCurrency(scannedSubtotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Actual Total</p>
              <p className="text-lg font-semibold text-gray-900">
                {actualTotal !== undefined ? formatCurrency(actualTotal) : "--"}
              </p>
            </div>
          </div>

          {difference !== undefined && (
            <div
              className={`rounded-lg px-3 py-2 ${
                Math.abs(difference) < 1
                  ? "bg-green-50"
                  : Math.abs(difference) < 5
                    ? "bg-yellow-50"
                    : "bg-red-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Difference</p>
                <p
                  className={`text-sm font-bold ${
                    Math.abs(difference) < 1
                      ? "text-green-600"
                      : Math.abs(difference) < 5
                        ? "text-yellow-600"
                        : "text-red-600"
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
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-gray-900">
              Items ({items.length})
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No items in this trip.
            </div>
          ) : (
            <ul className="divide-y">
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
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate block"
                        >
                          {item?.name ?? "Unknown Item"}
                        </Link>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatCurrency(ti.price)} /{" "}
                          {item?.unitType === "per_lb" ? "lb" : "each"}{" "}
                          {quantityDisplay}
                          {ti.onSale && (
                            <span className="ml-1 text-orange-600 font-medium">
                              SALE
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="text-sm font-medium text-gray-900 ml-3">
                        {formatCurrency(ti.lineTotal)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
