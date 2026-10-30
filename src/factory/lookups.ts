import { useEffect, useRef, useState } from "react";
import { useAiAllowed, useLicenceNow } from "./ai-allowed";
import { currentReceiptClient, makeLookupClient } from "@/services/lookup-client";
import { LookupRunner } from "@/services/lookup-runner";
import { ReceiptRunner } from "@/services/receipt-runner";

/** What the runners are doing that the lines need to tell: the connection, and a queue waiting out a failure. */
export interface RunnerState {
  online: boolean;
  lookupBackingOff: boolean;
  receiptBackingOff: boolean;
}

/**
 * The lookup queue runs while the app is open: sending and polling only when the AI is allowed
 * (a licensed key, 'checking' is no) and the key is unlocked and the device is online; polling only while the page is visible.
 * Receipts sent for a trip are waited on by the same rules (their answers are applied whether or
 * not the trip's page is open).
 */
export function useLookupRunning(opts: {
  key: Uint8Array | null;
  backendUrl: string;
}): RunnerState {
  const { key, backendUrl } = opts;
  const aiAllowed = useAiAllowed();
  const licenceNow = useLicenceNow();
  const [runner] = useState(() => new LookupRunner());
  const [receiptRunner] = useState(() => new ReceiptRunner());
  const [online, setOnlineState] = useState(() => navigator.onLine);
  const [lookupBackingOff, setLookupBackingOff] = useState(false);
  const [receiptBackingOff, setReceiptBackingOff] = useState(false);
  useEffect(() => {
    const setOnline = (online: boolean) => {
      setOnlineState(online);
      runner.setOnline(online);
      receiptRunner.setOnline(online);
    };
    const setVisible = (visible: boolean) => {
      runner.setVisible(visible);
      receiptRunner.setVisible(visible);
    };
    setOnline(navigator.onLine);
    setVisible(document.visibilityState !== "hidden");
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    const changeVisibility = () => setVisible(document.visibilityState !== "hidden");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", changeVisibility);
    runner.watchBackoff(setLookupBackingOff);
    receiptRunner.watchBackoff(setReceiptBackingOff);
    runner.start();
    receiptRunner.start();
    return () => {
      runner.watchBackoff(null);
      receiptRunner.watchBackoff(null);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", changeVisibility);
      runner.stop();
      receiptRunner.stop();
    };
  }, [runner, receiptRunner]);

  const licensed = aiAllowed && key !== null;
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    const clientKey = keyRef.current;
    runner.setClient(licensed && clientKey ? makeLookupClient(backendUrl, clientKey, licenceNow) : null);
    // makeLookupClient has just handed the key to the receipt client
    receiptRunner.setClient(licensed && clientKey ? currentReceiptClient() : null);
  }, [runner, receiptRunner, licensed, backendUrl, licenceNow]);
  return { online, lookupBackingOff, receiptBackingOff };
}
