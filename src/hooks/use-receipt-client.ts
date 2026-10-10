import { useCallback } from "react";
import { useFactory } from "@/contexts/factory-context";
import { currentReceiptClient } from "@/services/lookup-client";
import type { ReceiptClient } from "@/services/receipt-reconcile";

/**
 * The factory for a receipt: `ready` while the door is licensed, and `getClient` to ask for the
 * client at the moment of sending (null when the factory is not ready).
 */
export function useReceiptClient(): { ready: boolean; getClient: () => ReceiptClient | null } {
  const { door } = useFactory();
  const ready = door === "licensed";
  const getClient = useCallback(() => (ready ? currentReceiptClient() : null), [ready]);
  return { ready, getClient };
}
