import { useState } from "react";
import { useAlive } from "pwa-kit/alive";
import { packCounts, packPhone, type PackCounts } from "@/move/pack";
import { downloadAsFile } from "@/services/export-service";
import { ErrorNote, OUTLINE_BUTTON_CLASS, SectionCard, SectionNote, SuccessNote } from "../parts";

/** Where the app lives from now on: the line after a pack says to open it and Unpack. */
const NEW_ADDRESS = "https://trade.allmymind.org";

/**
 * Drops this origin's push subscription, if the browser has one. Push is per address, so the new address subscribes afresh. The backend
 * keeps the old endpoint until the push service answers 410 or 404 on its next send, then drops it (postern server/internal/push/sender.go:380):
 * unsubscribing here is enough, nothing is told to the backend. Notify me has no setting of its own: it reads this subscription, so with it
 * gone Notify me is Off. Resolves false when the browser would not (or could not) unsubscribe.
 */
async function turnNotifyOff(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}

function countsLine(c: PackCounts): string {
  return `Packed: ${c.stores} stores, ${c.items} items, ${c.trips} trips, ${c.priceHistory} prices, ${c.photos} photos. Open ${NEW_ADDRESS} and Unpack.`;
}

export function MoveSection() {
  const alive = useAlive();
  const [packing, setPacking] = useState(false);
  const [packed, setPacked] = useState<PackCounts | null>(null);
  const [notifyKept, setNotifyKept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePack() {
    setPacking(true);
    setError(null);
    setPacked(null);
    setNotifyKept(false);
    try {
      const pack = await packPhone();
      const day = pack.when.split("T")[0];
      downloadAsFile(JSON.stringify(pack), `tradetracker-move-${day}.json`, "application/json");
      const off = await turnNotifyOff();
      if (!alive()) return;
      setPacked(packCounts(pack));
      setNotifyKept(!off);
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : "This phone could not be packed.");
    } finally {
      if (alive()) setPacking(false);
    }
  }

  return (
    <SectionCard title="Move">
      <SectionNote>
        Moving to a new address? Pack up this phone into one file with everything it holds: every store, item, trip, price and photo, and the
        key, the licence and YNAB with them. Nothing on this phone is deleted. The fingerprint and notifications are set again at the new address.
      </SectionNote>
      <button
        type="button"
        disabled={packing}
        onClick={() => void handlePack()}
        className={`w-full min-h-[44px] disabled:opacity-50 ${OUTLINE_BUTTON_CLASS}`}
      >
        {packing ? "Packing…" : "Pack up this phone"}
      </button>
      {packed && <SuccessNote>{countsLine(packed)}</SuccessNote>}
      {packed && notifyKept && (
        <ErrorNote>The browser could not turn notifications off here, so this phone may still ping from the old address.</ErrorNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </SectionCard>
  );
}
