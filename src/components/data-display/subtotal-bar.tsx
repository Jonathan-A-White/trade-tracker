interface SubtotalBarProps {
  subtotal: number;
  itemCount: number;
  budget?: number;
  /** Lines whose price is a guess or missing; the bar says so when above zero. */
  guessCount?: number;
  onEndTrip: () => void;
}

// Show a warning once spending reaches this share of the budget.
const NEAR_BUDGET_THRESHOLD = 0.9;

type BudgetState = "normal" | "near" | "over";

const STATE_STYLES: Record<
  BudgetState,
  {
    bar: string;
    muted: string;
    track: string;
    fill: string;
    button: string;
  }
> = {
  normal: {
    bar: "bg-green-600",
    muted: "text-green-100",
    track: "bg-green-800",
    fill: "bg-green-300",
    button: "bg-white text-green-700 hover:bg-green-50",
  },
  near: {
    bar: "bg-yellow-500",
    muted: "text-yellow-50",
    track: "bg-yellow-700",
    fill: "bg-yellow-100",
    button: "bg-white text-yellow-700 hover:bg-yellow-50",
  },
  over: {
    bar: "bg-red-600",
    muted: "text-red-100",
    track: "bg-red-800",
    fill: "bg-red-300",
    button: "bg-white text-red-700 hover:bg-red-50",
  },
};

export function SubtotalBar({ subtotal, itemCount, budget, guessCount = 0, onEndTrip }: SubtotalBarProps) {
  const hasBudget = budget !== undefined && budget > 0;
  const remaining = hasBudget ? budget - subtotal : 0;
  const overBudget = hasBudget && remaining < 0;
  const nearBudget = hasBudget && !overBudget && subtotal >= budget * NEAR_BUDGET_THRESHOLD;
  const budgetUsedPercent = hasBudget ? Math.min((subtotal / budget) * 100, 100) : 0;

  const state: BudgetState = overBudget ? "over" : nearBudget ? "near" : "normal";
  const styles = STATE_STYLES[state];

  return (
    <div className={`fixed bottom-16 left-0 right-0 z-10 text-white px-4 py-3 ${styles.bar}`}>
      {hasBudget && (
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className={styles.muted}>
              {overBudget ? "Over budget by " : "Remaining: "}
              <span className="font-semibold text-white">
                ${Math.abs(remaining).toFixed(2)}
              </span>
            </span>
            <span className={styles.muted}>
              Budget: ${budget.toFixed(2)}
            </span>
          </div>
          <div className={`h-1.5 rounded-full ${styles.track}`}>
            <div
              className={`h-full rounded-full transition-all ${styles.fill}`}
              style={{ width: `${budgetUsedPercent}%` }}
            />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">${subtotal.toFixed(2)}</p>
          <p className={`text-sm ${styles.muted}`}>
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
          {guessCount > 0 && (
            <p className={`text-xs ${styles.muted}`}>
              {guessCount === 1 ? "1 price is a guess" : `${guessCount} prices are guesses`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onEndTrip}
          className={`font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer ${styles.button}`}
        >
          End Trip
        </button>
      </div>
    </div>
  );
}
