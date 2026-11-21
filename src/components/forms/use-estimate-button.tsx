import { useState } from "react";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { estimateHoldText, useSendHold } from "@/factory/send-hold";

const pendingLookupRepo = new PendingLookupRepository();

interface UseEstimateButtonProps {
  tripItemId: string;
  /** The estimate was asked for: the line is now waiting on the factory, so the editor can close. */
  onAsked: () => void;
}

/**
 * 'Use an estimate' beside a line's price: drops the line's price and asks the factory for an estimate
 * of the item, which then shows as a Guess. When the phone cannot ask right now (offline, no licence,
 * key locked) it says why and leaves the line as it was, rather than queueing a line at $0.
 */
export function UseEstimateButton({ tripItemId, onAsked }: UseEstimateButtonProps) {
  const hold = useSendHold();
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask() {
    if (hold) {
      setProblem(`${estimateHoldText(hold)} The price is unchanged.`);
      return;
    }
    setProblem(null);
    setAsking(true);
    try {
      const lookup = await pendingLookupRepo.askForEstimate(tripItemId);
      if (lookup) onAsked();
      else setProblem("Could not find this line. The price is unchanged.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void ask()}
        disabled={asking}
        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer"
      >
        Use an estimate
      </button>
      {problem && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
