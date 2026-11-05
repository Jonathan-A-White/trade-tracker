// Notify me: this phone's push subscription with the backend (pwa-kit/push), signed by the app's key through bsv-kit's door,
// so the backend's alert push reaches it. The worker's half is src/sw-push.ts.
//
// The subscription also says which cards are this phone's: pwa-kit's subscribe posts only {pubkey, subscription}, so the app posts
// the same signed POST /api/push/subscribe again with `last4s` (the last fours of this phone's person's cards, never a name). The
// backend then sends the amount, store and card to this phone for those cards (Postern's alert push, his A on mw-mr4xgrw.17).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { door } from "bsv-kit/bsv";
import { createPush, PushError, type Push, type PushStatus } from "pwa-kit/push";
import { useFactory } from "@/factory";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { ME_KEY, SORT_CHANGED, ownLastFours, readMe } from "@/sort/waiting";

const family = new FamilyRepository();

/** The line for a phone that has blocked notifications: the route to allow them depends on how the app runs. */
function deniedLine(standalone: boolean): string {
  return standalone
    ? "Notifications are blocked for TradeTracker. Open your phone's recent apps (or press and hold the TradeTracker icon), tap App info, then Notifications, and choose Allow. Then come back here."
    : "Notifications are blocked for this site. In Chrome, tap the three-dot menu, then Settings, Site settings, Notifications, find this site and choose Allow. Then come back here.";
}

function runsStandalone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

export function makeNotify(backendUrl: string, key: Uint8Array, publicKeyHex: string): Push {
  return createPush({
    signer: new door.Door({ baseUrl: backendUrl, key }),
    publicKeyHex,
    words: { denied: deniedLine(runsStandalone()) },
  });
}

/**
 * Posts this phone's push subscription again, with the last fours of its own cards (none: no list, as pwa-kit posts it). The backend
 * replaces the list on every post. False when the phone has no push subscription to post.
 */
export async function sendOwnCards(backendUrl: string, key: Uint8Array, publicKeyHex: string, last4s: readonly string[]): Promise<boolean> {
  const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!worker) return false;
  const subscription = await (await worker.ready).pushManager.getSubscription();
  if (!subscription) return false;
  const response = await new door.Door({ baseUrl: backendUrl, key }).fetch("/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: publicKeyHex, subscription: subscription.toJSON(), ...(last4s.length > 0 ? { last4s } : {}) }),
  });
  if (!response.ok) throw new Error(`The backend could not take the card list (${response.status}).`);
  return true;
}

/** Whose phone this is, following every change of it (Settings, the Waiting card, another tab). */
function useMe(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === ME_KEY) onChange();
      };
      window.addEventListener(SORT_CHANGED, onChange);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(SORT_CHANGED, onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    readMe,
    () => null,
  );
}

/**
 * Keeps the backend's list of this phone's cards right: posts it when My cards or whose phone this is changes, and once when the
 * app opens. Does nothing without a push subscription (Notify me turns it on and posts the list itself), an unlocked licensed key or a read of the cards.
 */
export function useCardListSync(): void {
  const { door: doorState, getKey, backendUrl, publicKeyHex } = useFactory();
  const cards = useLiveQuery(() => family.listCards(), []);
  const me = useMe();
  const licensed = doorState === "licensed";
  const list = useMemo(() => (cards ? ownLastFours(cards, me) : null), [cards, me]);
  const listText = list === null ? null : list.join(",");

  useEffect(() => {
    const key = getKey();
    if (!licensed || !key || !publicKeyHex || listText === null) return;
    sendOwnCards(backendUrl, key, publicKeyHex, listText === "" ? [] : listText.split(",")).catch(() => {});
  }, [licensed, getKey, backendUrl, publicKeyHex, listText]);
}

export interface Notify {
  /** where notifications stand on this phone; null until read, or while the key cannot sign */
  status: PushStatus | null;
  busy: boolean;
  error: string | null;
  turnOn: () => Promise<void>;
  /** the words of the kit (the button's label) */
  words: Push["words"] | null;
}

/** Notifications for the family's alerts on this phone, once the key is unlocked and licensed. */
export function useNotify(enabled: boolean): Notify {
  const { door: doorState, getKey, backendUrl, publicKeyHex } = useFactory();
  const [push, setPush] = useState<Push | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const licensed = doorState === "licensed";

  useEffect(() => {
    const key = getKey();
    if (!enabled || !licensed || !key || !publicKeyHex) return;
    let current = true;
    const made = makeNotify(backendUrl, key, publicKeyHex);
    made
      .status()
      .then((found) => {
        if (!current) return;
        setPush(made);
        setStatus(found);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [enabled, licensed, getKey, backendUrl, publicKeyHex]);

  // He allows notifications in the phone's settings and comes back to this same open page: read the permission again then.
  useEffect(() => {
    if (!push) return;
    let current = true;
    const reread = () => {
      if (document.visibilityState === "hidden") return;
      push
        .status()
        .then((found) => {
          if (current) setStatus(found);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", reread);
    window.addEventListener("focus", reread);
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", reread);
      window.removeEventListener("focus", reread);
    };
  }, [push]);

  const turnOn = useCallback(async () => {
    if (!push) return;
    setBusy(true);
    setError(null);
    try {
      const found = await push.subscribe();
      setStatus(found);
      // a phone with a person says which cards are theirs; one with none posts no list, as the kit has just done
      const key = getKey();
      const me = readMe();
      if (found.state === "on" && me !== null && key && publicKeyHex) {
        try {
          await sendOwnCards(backendUrl, key, publicKeyHex, ownLastFours(await family.listCards(), me));
        } catch {
          setError("Notifications are on, but this phone's cards could not be sent, so a ping may not show the amount. Open Settings and try again.");
        }
      }
    } catch (err) {
      setError(err instanceof PushError || err instanceof Error ? err.message : "Notifications could not be turned on.");
    } finally {
      setBusy(false);
    }
  }, [push, getKey, backendUrl, publicKeyHex]);

  const shown = enabled && licensed ? status : null;
  return { status: shown, busy, error, turnOn, words: push?.words ?? null };
}
