import { useState } from "react";
import type { FormEvent } from "react";

interface StoreFormValues {
  name: string;
  notes: string;
}

interface StoreFormProps {
  initialValues?: Partial<StoreFormValues>;
  onSubmit: (values: StoreFormValues) => void;
  onCancel: () => void;
}

export function StoreForm({ initialValues, onSubmit, onCancel }: StoreFormProps) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [notes, setNotes] = useState(initialValues?.notes ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ name, notes });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="store-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Store Name
        </label>
        <input
          id="store-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label htmlFor="store-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Notes (optional)
        </label>
        <textarea
          id="store-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Save
        </button>
      </div>
    </form>
  );
}
