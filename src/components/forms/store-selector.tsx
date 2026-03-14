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
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      <ul className="divide-y border rounded-lg overflow-hidden">
        {filtered.map((store) => (
          <li key={store.id}>
            <button
              type="button"
              onClick={() => onSelect(store)}
              className="w-full text-left px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              {store.name}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">
            No stores found
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={onCreateNew}
        className="w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
      >
        + Create New Store
      </button>
    </div>
  );
}
