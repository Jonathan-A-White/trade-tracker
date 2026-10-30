// Notify me: this phone's push subscription with the backend (pwa-kit/push), signed by the app's key through bsv-kit's door,
// so the backend's alert push reaches it. The worker's half is src/sw-push.ts.
import { useCallback, useEffect, useState } from "react";
import { door } from "bsv-kit/bsv";
import { createPush, PushError, type Push, type PushStatus } from "pwa-kit/push";
import { useFactory } from "@/factory";

export function makeNotify(backendUrl: string, key: Uint8Array, publicKeyHex: string): Push {
  return createPush({ signer: new door.Door({ baseUrl: backendUrl, key }), publicKeyHex });
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

  const turnOn = useCallback(async () => {
    if (!push) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await push.subscribe());
    } catch (err) {
      setError(err instanceof PushError || err instanceof Error ? err.message : "Notifications could not be turned on.");
    } finally {
      setBusy(false);
    }
  }, [push]);

  const shown = enabled && licensed ? status : null;
  return { status: shown, busy, error, turnOn, words: push?.words ?? null };
}
