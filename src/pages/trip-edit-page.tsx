import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams, useNavigate } from "react-router";
import { db } from "@/db/database";
import type { Item } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { PageHeader } from "@/components/layout/page-header";
import { TripItemRow } from "@/components/data-display/trip-item-row";
import { InlineEditor } from "@/components/forms/inline-editor";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

export default function TripEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<"price" | "quantity" | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trip = useLiveQuery(
    () => (id ? tripRepo.getById(id) : undefined),
    [id],
  );

  const tripItems = useLiveQuery(
    () => (id ? tripItemRepo.getByTrip(id) : []),
    [id],
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

  const handleEditPrice = useCallback((itemId: string) => {
    setEditingId(itemId);
    setEditField("price");
  }, []);

  const handleEditQuantity = useCallback((itemId: string) => {
    setEditingId(itemId);
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

  const handleRemove = useCallback((itemId: string) => {
    setConfirmRemoveId(itemId);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    if (!confirmRemoveId) return;
    await tripItemRepo.remove(confirmRemoveId);
    setConfirmRemoveId(null);
  }, [confirmRemoveId]);

  const handleSaveChanges = useCallback(async () => {
    if (!id || saving) return;
    setSaving(true);
    try {
      // Subtotal is auto-recalculated by the repository on item changes,
      // but force a recalc to be safe
      const allItems = await tripItemRepo.getByTrip(id);
      const subtotal = allItems.reduce((sum, ti) => sum + ti.lineTotal, 0);
      await tripRepo.updateSubtotal(id, subtotal);
      navigate(`/trips/${id}`);
    } finally {
      setSaving(false);
    }
  }, [id, saving, navigate]);

  if (!trip) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <PageHeader title="Edit Trip" backTo={id ? `/trips/${id}` : "/trips"} />
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

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <PageHeader title="Edit Trip" backTo={`/trips/${id}`} />

      <main className="flex-1 pb-24">
        {/* Items list */}
        {items.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No items in this trip.
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
                  onRemove={handleRemove}
                />
              );
            })}
          </div>
        )}

        {/* Add item button */}
        <div className="p-4">
          <button
            type="button"
            onClick={() => navigate(`/trips/active/add`)}
            className="w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
          >
            + Add Item
          </button>
        </div>
      </main>

      {/* Save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t px-4 py-3">
        <button
          type="button"
          onClick={handleSaveChanges}
          disabled={saving}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {/* Confirm remove dialog */}
      {confirmRemoveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl mx-4 p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Remove Item
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to remove{" "}
              <span className="font-medium">
                {map[
                  items.find((ti) => ti.id === confirmRemoveId)?.itemId ?? ""
                ]?.name ?? "this item"}
              </span>{" "}
              from the trip?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmRemoveId(null)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
