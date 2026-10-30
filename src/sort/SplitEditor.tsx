// A charge split across categories: parts of a category and dollars each, that must add up to the charge. What is left to
// place (or how much too much) is said under the parts at every keystroke.
import { useId } from "react";
import type { YnabCategory } from "@/contracts/types";
import { newPart, partCents, remainderCents, remainderLine, type SplitPart } from "./split";
import { leftLine } from "./waiting";

export interface SplitEditorProps {
  categories: YnabCategory[];
  amount: number;
  parts: SplitPart[];
  onChange: (parts: SplitPart[]) => void;
}

const FIELD_CLASS =
  "min-h-12 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-base text-gray-900 dark:text-gray-100";

export function SplitEditor({ categories, amount, parts, onChange }: SplitEditorProps) {
  const id = useId();
  const left = remainderCents(parts, amount);
  const set = (key: string, change: Partial<SplitPart>) => onChange(parts.map((p) => (p.key === key ? { ...p, ...change } : p)));

  return (
    <div className="space-y-3">
      <ol aria-label="Parts" className="space-y-3">
        {parts.map((part, index) => {
          const n = index + 1;
          return (
            <li key={part.key} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Part {n}</span>
                {parts.length > 2 && (
                  <button
                    type="button"
                    aria-label={`Remove part ${n}`}
                    onClick={() => onChange(parts.filter((p) => p.key !== part.key))}
                    className="min-h-12 min-w-12 rounded-lg px-3 text-sm font-medium text-gray-600 dark:text-gray-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <label htmlFor={`${id}-c${part.key}`} className="sr-only">
                Category for part {n}
              </label>
              <select id={`${id}-c${part.key}`} value={part.categoryId} onChange={(e) => set(part.key, { categoryId: e.target.value })} className={FIELD_CLASS}>
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.balance === undefined ? c.name : `${c.name} · ${leftLine(c.balance)}`}
                  </option>
                ))}
              </select>
              <label htmlFor={`${id}-a${part.key}`} className="sr-only">
                Amount for part {n}
              </label>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-gray-500">
                  $
                </span>
                <input
                  id={`${id}-a${part.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  maxLength={10}
                  value={part.amount}
                  onChange={(e) => set(part.key, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                  aria-invalid={part.amount !== "" && partCents(part.amount) === null}
                  className={`${FIELD_CLASS} pl-7`}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className={`text-sm font-medium ${left === 0 ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>
        {remainderLine(parts, amount)}
      </p>
      <button
        type="button"
        onClick={() => onChange([...parts, newPart()])}
        className="min-h-12 w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 text-base font-medium text-blue-700 dark:text-blue-400"
      >
        Add a part
      </button>
    </div>
  );
}
