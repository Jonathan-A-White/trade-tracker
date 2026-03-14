interface TripItem {
  id: string;
  price: number;
  quantity: number;
  weightLbs?: number;
  lineTotal: number;
  onSale: boolean;
}

interface TripItemRowProps {
  tripItem: TripItem;
  itemName: string;
  unitType: string;
  onEditPrice?: (id: string) => void;
  onEditQuantity?: (id: string) => void;
  onRemove?: (id: string) => void;
  editable?: boolean;
}

export function TripItemRow({
  tripItem,
  itemName,
  unitType,
  onEditPrice,
  onEditQuantity,
  onRemove,
  editable = false,
}: TripItemRowProps) {
  const quantityDisplay =
    unitType === "per_lb" && tripItem.weightLbs !== undefined
      ? `${tripItem.weightLbs.toFixed(2)} lbs`
      : `x${tripItem.quantity}`;

  return (
    <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{itemName}</p>
            {tripItem.onSale && (
              <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                SALE
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            ${tripItem.price.toFixed(2)} / {unitType} {quantityDisplay}
          </p>
        </div>
        <div className="text-right ml-3">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            ${tripItem.lineTotal.toFixed(2)}
          </p>
        </div>
      </div>

      {editable && (
        <div className="flex items-center gap-2 mt-2">
          {onEditPrice && (
            <button
              type="button"
              onClick={() => onEditPrice(tripItem.id)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-2 py-1 rounded border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer"
            >
              Edit Price
            </button>
          )}
          {onEditQuantity && (
            <button
              type="button"
              onClick={() => onEditQuantity(tripItem.id)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-2 py-1 rounded border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer"
            >
              Edit Qty
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(tripItem.id)}
              className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 px-2 py-1 rounded border border-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900 ml-auto cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
