import { useState } from "react";

/** The host of the new address, or null when the build names none (unset, empty or not an https URL). */
function newHost(movedTo: string | undefined): string | null {
  if (!movedTo) return null;
  try {
    const url = new URL(movedTo);
    return url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

/**
 * The old address's line above every screen: the build (VITE_MOVED_TO, set by the Pages workflow) says the app now lives elsewhere, so
 * pack up this phone and open the new address. Later hides it until the next launch (state only, nothing is stored). A build with
 * no VITE_MOVED_TO, such as the new address itself, draws nothing.
 */
export function MovedBanner({
  movedTo = import.meta.env.VITE_MOVED_TO,
  onPackUp,
}: {
  movedTo?: string;
  onPackUp: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const host = newHost(movedTo);
  if (!host || hidden) return null;
  return (
    <div role="region" aria-label="Moved" className="bg-amber-400 px-3 py-2 text-gray-900">
      <p className="text-base font-medium">{`Trade Tracker has moved to ${host}. Pack up this phone, then open the new address.`}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onPackUp}
          className="min-h-[44px] flex-1 rounded-lg bg-gray-900 px-4 text-base font-medium text-white"
        >
          Pack up
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="min-h-[44px] flex-1 rounded-lg border border-gray-900 px-4 text-base font-medium"
        >
          Later
        </button>
      </div>
    </div>
  );
}
