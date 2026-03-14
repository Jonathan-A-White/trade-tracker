import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { PageHeader } from "@/components/layout/page-header";
import { ItemCard } from "@/components/data-display/item-card";

export function ItemLibraryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const items = useLiveQuery(() => {
    if (search.trim()) {
      const lowerSearch = search.toLowerCase();
      return db.items
        .filter((item) => item.name.toLowerCase().includes(lowerSearch))
        .toArray();
    }
    return db.items.orderBy("name").toArray();
  }, [search]);

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Items"
        rightAction={
          <Link
            to="/items/new"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            aria-label="Add item"
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

      <div className="px-4 py-3">
        <div className="relative">
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
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="flex-1 px-4 pb-4">
        {items === undefined ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
            {search.trim() ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No items matching &ldquo;{search}&rdquo;
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  No items in your library yet.
                </p>
                <Link
                  to="/items/new"
                  className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Add Your First Item
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onPress={() => navigate(`/items/${item.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
