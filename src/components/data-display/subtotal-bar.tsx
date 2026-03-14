interface SubtotalBarProps {
  subtotal: number;
  itemCount: number;
  onEndTrip: () => void;
}

export function SubtotalBar({ subtotal, itemCount, onEndTrip }: SubtotalBarProps) {
  return (
    <div className="fixed bottom-16 left-0 right-0 z-10 bg-green-600 text-white px-4 py-3 flex items-center justify-between">
      <div>
        <p className="text-lg font-bold">${subtotal.toFixed(2)}</p>
        <p className="text-sm text-green-100">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </p>
      </div>
      <button
        type="button"
        onClick={onEndTrip}
        className="bg-white text-green-700 font-semibold px-4 py-2 rounded-lg hover:bg-green-50 transition-colors cursor-pointer"
      >
        End Trip
      </button>
    </div>
  );
}
