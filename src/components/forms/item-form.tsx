import { useState } from "react";
import type { FormEvent } from "react";

interface ItemFormValues {
  barcode: string;
  name: string;
  currentPrice: number;
  unitType: string;
  category: string;
}

interface ItemFormProps {
  initialValues?: Partial<ItemFormValues>;
  onSubmit: (values: ItemFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}

export function ItemForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}: ItemFormProps) {
  const [barcode, setBarcode] = useState(initialValues?.barcode ?? "");
  const [name, setName] = useState(initialValues?.name ?? "");
  const [currentPrice, setCurrentPrice] = useState(
    initialValues?.currentPrice ?? 0
  );
  const [unitType, setUnitType] = useState(initialValues?.unitType ?? "each");
  const [category, setCategory] = useState(initialValues?.category ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ barcode, name, currentPrice, unitType, category });
  }

  const inputClass = "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="item-barcode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Barcode
        </label>
        <input
          id="item-barcode"
          type="text"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="item-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Name
        </label>
        <input
          id="item-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="item-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Price
        </label>
        <input
          id="item-price"
          type="number"
          step="0.01"
          min="0"
          value={currentPrice}
          onChange={(e) => setCurrentPrice(parseFloat(e.target.value) || 0)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="item-unit-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Unit Type
        </label>
        <select
          id="item-unit-type"
          value={unitType}
          onChange={(e) => setUnitType(e.target.value)}
          className={inputClass}
        >
          <option value="each">Each</option>
          <option value="per_lb">Per Pound</option>
        </select>
      </div>

      <div>
        <label htmlFor="item-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Category (optional)
        </label>
        <input
          id="item-category"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass}
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
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
