import type { ReactNode } from "react";

interface Item {
  id: string;
  name: string;
  barcode: string;
  currentPrice: number;
  unitType: string;
}

interface ItemCardProps {
  item: Item;
  onPress?: (item: Item) => void;
  trailing?: ReactNode;
}

export function ItemCard({ item, onPress, trailing }: ItemCardProps) {
  const content = (
    <>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{item.name}</p>
        <p className="text-sm text-gray-500 mt-0.5">{item.barcode}</p>
      </div>
      <div className="flex items-center gap-3 ml-3">
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">
          ${item.currentPrice.toFixed(2)}
          <span className="text-xs text-green-600 ml-1">/{item.unitType}</span>
        </span>
        {trailing && <div>{trailing}</div>}
      </div>
    </>
  );

  const className =
    "bg-white rounded-lg border p-4 flex items-center justify-between";

  if (onPress) {
    return (
      <button
        type="button"
        onClick={() => onPress(item)}
        className={`${className} w-full text-left hover:bg-gray-50 transition-colors cursor-pointer`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
