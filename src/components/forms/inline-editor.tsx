import { useState } from "react";
import type { FormEvent } from "react";

interface InlineEditorProps {
  label: string;
  value: number;
  onSave: (v: number) => void;
  onCancel: () => void;
  inputType?: "currency" | "decimal" | "integer";
}

export function InlineEditor({
  label,
  value,
  onSave,
  onCancel,
  inputType = "currency",
}: InlineEditorProps) {
  const [localValue, setLocalValue] = useState(String(value));

  function getStep() {
    switch (inputType) {
      case "currency":
        return "0.01";
      case "decimal":
        return "0.01";
      case "integer":
        return "1";
    }
  }

  function parseValue(raw: string): number {
    if (inputType === "integer") {
      return parseInt(raw, 10) || 0;
    }
    return parseFloat(raw) || 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave(parseValue(localValue));
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 shrink-0">
        {label}
      </label>
      <input
        type="number"
        step={getStep()}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        autoFocus
        className="w-24 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <button
        type="submit"
        className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
      >
        Cancel
      </button>
    </form>
  );
}
