// The YNAB categories to sort a charge into, each with what is left in it: 'Groceries · $212 left', and one the charge would
// overspend in red with 'short by $x'. One is chosen; a long list can be narrowed by typing.
import { useId, useState } from "react";
import type { YnabCategory } from "@/contracts/types";
import { leftLine, money, shortBy } from "./waiting";

/** Above this many categories a Find field narrows the list. */
const FIND_FROM = 8;

export interface CategoryPickerProps {
  categories: YnabCategory[];
  /** the charge's dollars, to say which category it would overspend */
  amount: number;
  selected: string | null;
  onSelect: (categoryId: string) => void;
}

export function CategoryPicker({ categories, amount, selected, onSelect }: CategoryPickerProps) {
  const findId = useId();
  const [find, setFind] = useState("");
  const words = find.trim().toLowerCase();
  const shown = words ? categories.filter((c) => `${c.groupName} ${c.name}`.toLowerCase().includes(words)) : categories;
  const groups = new Map<string, YnabCategory[]>();
  for (const category of shown) groups.set(category.groupName, [...(groups.get(category.groupName) ?? []), category]);

  return (
    <div className="space-y-2">
      {categories.length > FIND_FROM && (
        <div>
          <label htmlFor={findId} className="sr-only">
            Find a category
          </label>
          <input
            id={findId}
            type="search"
            placeholder="Find a category"
            autoComplete="off"
            maxLength={60}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-base text-gray-900 dark:text-gray-100"
          />
        </div>
      )}
      <div role="radiogroup" aria-label="Category" className="space-y-3">
        {[...groups].map(([group, rows]) => (
          <div key={group} className="space-y-1">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{group}</p>
            {rows.map((category) => {
              const short = shortBy(category, amount);
              const chosen = selected === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => onSelect(category.id)}
                  className={`min-h-12 w-full rounded-lg border px-3 py-2 text-left text-base transition-colors flex flex-wrap items-baseline gap-x-1 ${
                    chosen
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-950 ring-2 ring-blue-600"
                      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                  }`}
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100">{category.name}</span>
                  {category.balance !== undefined && (
                    <span className="text-gray-600 dark:text-gray-300"> · {leftLine(category.balance)}</span>
                  )}
                  {short !== null && (
                    <>
                      <span className="text-gray-600 dark:text-gray-300"> · </span>
                      <span className="font-medium text-red-600 dark:text-red-400">short by {money(short)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {shown.length === 0 && <p className="px-1 text-sm text-gray-600 dark:text-gray-400">No category has that name.</p>}
      </div>
    </div>
  );
}
