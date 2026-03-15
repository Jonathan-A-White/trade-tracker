interface SubtotalBarProps {
  subtotal: number;
  itemCount: number;
  budget?: number;
  onEndTrip: () => void;
}

export function SubtotalBar({ subtotal, itemCount, budget, onEndTrip }: SubtotalBarProps) {
  const hasBudget = budget !== undefined && budget > 0;
  const remaining = hasBudget ? budget - subtotal : 0;
  const overBudget = hasBudget && remaining < 0;
  const budgetUsedPercent = hasBudget ? Math.min((subtotal / budget) * 100, 100) : 0;

  return (
    <div className={`fixed bottom-16 left-0 right-0 z-10 text-white px-4 py-3 ${overBudget ? "bg-red-600" : "bg-green-600"}`}>
      {hasBudget && (
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className={overBudget ? "text-red-100" : "text-green-100"}>
              {overBudget ? "Over budget by " : "Remaining: "}
              <span className="font-semibold text-white">
                ${Math.abs(remaining).toFixed(2)}
              </span>
            </span>
            <span className={overBudget ? "text-red-100" : "text-green-100"}>
              Budget: ${budget.toFixed(2)}
            </span>
          </div>
          <div className={`h-1.5 rounded-full ${overBudget ? "bg-red-800" : "bg-green-800"}`}>
            <div
              className={`h-full rounded-full transition-all ${overBudget ? "bg-red-300" : "bg-green-300"}`}
              style={{ width: `${budgetUsedPercent}%` }}
            />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">${subtotal.toFixed(2)}</p>
          <p className={`text-sm ${overBudget ? "text-red-100" : "text-green-100"}`}>
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
        </div>
        <button
          type="button"
          onClick={onEndTrip}
          className={`font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer ${overBudget ? "bg-white text-red-700 hover:bg-red-50" : "bg-white text-green-700 hover:bg-green-50"}`}
        >
          End Trip
        </button>
      </div>
    </div>
  );
}
