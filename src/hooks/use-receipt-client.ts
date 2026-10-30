import { useCallback } from "react";
import { useFactory } from "@/contexts/factory-context";
import { useAiAllowed } from "@/factory/ai-allowed";
import type { FactoryDoorState, FactoryLicence } from "@/contracts/types";
import { currentReceiptClient } from "@/services/lookup-client";
import type { ReceiptClient } from "@/services/receipt-reconcile";

/**
 * The factory for a receipt: `ready` while the AI is allowed and the key is unlocked (the door is licensed), and `getClient` to ask for the
 * client at the moment of sending (null when the factory is not ready). `door` and `licence` say why
 * it is not ready, and `unlock` opens a locked key with the fingerprint (rejects with a plain message).
 */
export function useReceiptClient(): {
  ready: boolean;
  door: FactoryDoorState;
  licence: FactoryLicence | null;
  unlock: () => Promise<void>;
  getClient: () => ReceiptClient | null;
} {
  const { door, licence, unlockWithFingerprint } = useFactory();
  const aiAllowed = useAiAllowed();
  const ready = aiAllowed && door === "licensed";
  const getClient = useCallback(() => (ready ? currentReceiptClient() : null), [ready]);
  return { ready, door, licence, unlock: unlockWithFingerprint, getClient };
}
