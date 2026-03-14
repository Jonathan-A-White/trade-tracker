import { useState } from "react";

interface Store {
  id: string;
  name: string;
}

interface StoreSelectorProps {
  stores: Store[];
  onSelect: (store: Store) => void;
  onCreateNew: () => void;
}

export function StoreSelector({ stores, onSelect, onCreateNew }: StoreSelectorProps) {
  const [search, setSearch] = useState("");

  const filtered = stores.filter((store) =>
    store.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search stores..."
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      <ul className="divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-lg overflow-hidden">
        {filtered.map((store) => (
          <li key={store.id}>
            <button
              type="button"
              onClick={() => onSelect(store)}
              className="w-full text-left px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            >
              {store.name}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
            No stores found
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={onCreateNew}
        className="w-full rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors cursor-pointer"
      >
        + Create New Store
      </button>
    </div>
  );
}
