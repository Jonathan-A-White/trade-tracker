import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { PageHeader } from "@/components/layout/page-header";
import { StoreForm } from "@/components/forms/store-form";
import { StoreRepository } from "@/db/repositories/store-repository";

export function EditStorePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const storeRepo = new StoreRepository();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const store = useLiveQuery(() => {
    if (!id) return undefined;
    return db.stores.get(id);
  }, [id]);

  async function handleSubmit(values: { name: string; notes: string }) {
    if (!id) return;
    await storeRepo.update(id, {
      name: values.name,
      notes: values.notes || undefined,
    });
    navigate("/stores");
  }

  async function handleDelete() {
    if (!id) return;
    await storeRepo.delete(id);
    navigate("/stores");
  }

  if (store === undefined) {
    return (
      <div className="flex flex-col min-h-full">
        <PageHeader title="Edit Store" backTo="/stores" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (store === null) {
    return (
      <div className="flex flex-col min-h-full">
        <PageHeader title="Edit Store" backTo="/stores" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">Store not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Edit Store" backTo="/stores" />
      <div className="flex-1 px-4 py-4 space-y-6">
        <StoreForm
          initialValues={{ name: store.name, notes: store.notes ?? "" }}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/stores")}
        />

        <div className="border-t dark:border-gray-700 pt-6">
          {showDeleteConfirm ? (
            <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-4">
              <p className="text-sm text-red-800 dark:text-red-300 mb-3">
                Are you sure you want to delete this store? This action cannot
                be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors cursor-pointer"
                >
                  Delete Store
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-lg border border-red-300 dark:border-red-600 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
            >
              Delete Store
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
