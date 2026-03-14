import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, Link, Outlet } from "react-router";
import { db } from "@/db/database";
import type { Item } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PageHeader } from "@/components/layout/page-header";
import { TripItemRow } from "@/components/data-display/trip-item-row";
import { SubtotalBar } from "@/components/data-display/subtotal-bar";
import { InlineEditor } from "@/components/forms/inline-editor";


const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

function useElapsedTime(startedAt: number | undefined) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startedAt) return;

    function update() {
      const diff = Date.now() - startedAt!;
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1_000);
      setElapsed(
        hours > 0
          ? `${hours}h ${minutes}m ${seconds}s`
          : `${minutes}m ${seconds}s`,
      );
    }

    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return elapsed;
}

export default function ActiveTripPage() {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<"price" | "quantity" | null>(null);

  const trip = useLiveQuery(() => tripRepo.getActive(), []);
  const tripItems = useLiveQuery(
    () => (trip ? tripItemRepo.getByTrip(trip.id) : []),
    [trip?.id],
  );

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

  const storeName = useLiveQuery(async () => {
    if (!trip) return "";
    const store = await db.stores.get(trip.storeId);
    return store?.name ?? "Unknown Store";
  }, [trip?.storeId]);

  const elapsed = useElapsedTime(trip?.startedAt);

  const handleEditPrice = useCallback((id: string) => {
    setEditingId(id);
    setEditField("price");
  }, []);

  const handleEditQuantity = useCallback((id: string) => {
    setEditingId(id);
    setEditField("quantity");
  }, []);

  const handleSaveEdit = useCallback(
    async (value: number) => {
      if (!editingId || !editField) return;
      if (editField === "price") {
        await tripItemRepo.update(editingId, { price: value });
      } else {
        await tripItemRepo.update(editingId, { quantity: value });
      }
      setEditingId(null);
      setEditField(null);
    },
    [editingId, editField],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditField(null);
  }, []);

  if (!trip) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <PageHeader title="Active Trip" backTo="/" />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-4">
            <p className="text-gray-500">No active trip</p>
            <Link
              to="/trips/new"
              className="inline-block rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Start a Trip
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const items = tripItems ?? [];
  const map = itemsMap ?? {};

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <PageHeader
        title={storeName ?? "Loading..."}
        backTo="/"
        rightAction={
          <span className="text-sm text-gray-500">{elapsed}</span>
        }
      />

      <main className="flex-1 pb-40">
        {/* Action buttons */}
        <div className="flex gap-3 p-4">
          <Link
            to="/trips/active/scan"
            className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white text-center hover:bg-blue-700 transition-colors"
          >
            Scan
          </Link>
          <Link
            to="/trips/active/add"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 text-center hover:bg-gray-50 transition-colors"
          >
            Add Manually
          </Link>
        </div>

        {/* Trip items list */}
        {items.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No items yet. Scan a barcode or add an item manually.
          </div>
        ) : (
          <div>
            {items.map((ti) => {
              const item = map[ti.itemId];
              if (editingId === ti.id && editField) {
                return (
                  <div key={ti.id} className="bg-white border-b px-4 py-3">
                    <p className="text-sm font-medium text-gray-900 mb-2">
                      {item?.name ?? "Unknown Item"}
                    </p>
                    <InlineEditor
                      label={editField === "price" ? "Price" : "Qty"}
                      value={editField === "price" ? ti.price : ti.quantity}
                      onSave={handleSaveEdit}
                      onCancel={handleCancelEdit}
                      inputType={editField === "price" ? "currency" : "integer"}
                    />
                  </div>
                );
              }
              return (
                <TripItemRow
                  key={ti.id}
                  tripItem={ti}
                  itemName={item?.name ?? "Unknown Item"}
                  unitType={item?.unitType ?? "each"}
                  editable
                  onEditPrice={handleEditPrice}
                  onEditQuantity={handleEditQuantity}
                />
              );
            })}
          </div>
        )}
      </main>

      <SubtotalBar
        subtotal={trip.scannedSubtotal}
        itemCount={items.length}
        onEndTrip={() => navigate("/trips/active/end")}
      />

      <Outlet />
    </div>
  );
}
