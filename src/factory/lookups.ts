import { useEffect, useRef, useState } from "react";
import type { FactoryLicence } from "@/contracts/types";
import { currentReceiptClient, makeLookupClient } from "@/services/lookup-client";
import { LookupRunner } from "@/services/lookup-runner";
import { ReceiptRunner } from "@/services/receipt-runner";

/**
 * The lookup queue runs while the app is open: sending and polling only when the door is licensed
 * (a held licence and an unlocked key) and the device is online; polling only while the page is visible.
 * Receipts sent for a trip are waited on by the same rules (their answers are applied whether or
 * not the trip's page is open).
 */
export function useLookupRunning(opts: {
  licence: FactoryLicence | null;
  key: Uint8Array | null;
  backendUrl: string;
}): void {
  const { licence, key, backendUrl } = opts;
  const [runner] = useState(() => new LookupRunner());
  const [receiptRunner] = useState(() => new ReceiptRunner());
  useEffect(() => {
    const setOnline = (online: boolean) => {
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
    runner.start();
    receiptRunner.start();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", changeVisibility);
      runner.stop();
      receiptRunner.stop();
    };
  }, [runner, receiptRunner]);

  const licensed = licence === "held" && key !== null;
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    const clientKey = keyRef.current;
    runner.setClient(licensed && clientKey ? makeLookupClient(backendUrl, clientKey) : null);
    // makeLookupClient has just handed the key to the receipt client
    receiptRunner.setClient(licensed && clientKey ? currentReceiptClient() : null);
  }, [runner, receiptRunner, licensed, backendUrl]);
}
