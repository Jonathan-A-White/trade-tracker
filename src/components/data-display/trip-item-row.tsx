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
    <div className="bg-white border-b px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900 truncate">{itemName}</p>
            {tripItem.onSale && (
              <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">
                SALE
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            ${tripItem.price.toFixed(2)} / {unitType} {quantityDisplay}
          </p>
        </div>
        <div className="text-right ml-3">
          <p className="font-medium text-gray-900">
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
              className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-200 hover:bg-blue-50 cursor-pointer"
            >
              Edit Price
            </button>
          )}
          {onEditQuantity && (
            <button
              type="button"
              onClick={() => onEditQuantity(tripItem.id)}
              className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-200 hover:bg-blue-50 cursor-pointer"
            >
              Edit Qty
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(tripItem.id)}
              className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded border border-red-200 hover:bg-red-50 ml-auto cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
