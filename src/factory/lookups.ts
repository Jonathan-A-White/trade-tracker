import { useEffect, useRef, useState } from "react";
import type { FactoryLicence } from "@/contracts/types";
import { makeLookupClient } from "@/services/lookup-client";
import { LookupRunner } from "@/services/lookup-runner";

/**
 * The lookup queue runs while the app is open: sending and polling only when the door is licensed
 * (a held licence and an unlocked key) and the device is online; polling only while the page is visible.
 */
export function useLookupRunning(opts: {
  licence: FactoryLicence | null;
  key: Uint8Array | null;
  backendUrl: string;
}): void {
  const { licence, key, backendUrl } = opts;
  const [runner] = useState(() => new LookupRunner());
  useEffect(() => {
    runner.setOnline(navigator.onLine);
    runner.setVisible(document.visibilityState !== "hidden");
    const goOnline = () => runner.setOnline(true);
    const goOffline = () => runner.setOnline(false);
    const changeVisibility = () => runner.setVisible(document.visibilityState !== "hidden");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", changeVisibility);
    runner.start();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", changeVisibility);
      runner.stop();
    };
  }, [runner]);

  const licensed = licence === "held" && key !== null;
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    const clientKey = keyRef.current;
    runner.setClient(licensed && clientKey ? makeLookupClient(backendUrl, clientKey) : null);
  }, [runner, licensed, backendUrl]);
}
