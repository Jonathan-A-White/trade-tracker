import { useEffect, useRef, useState } from "react";
import { licence } from "bsv-kit/bsv";
import type { FactoryLicence } from "@/contracts/types";
import { askDoorLicence } from "@/services/door-licence";
import type { DoorLicenceAnswer, DoorLicenceAsker } from "@/services/door-licence";

/** Reads a key's licence in a collection; the chain by default, a fake in tests. */
export type FactoryLicenceChecker = (
  publicKeyHex: string,
  collection: string,
) => Promise<licence.LicenceStatus>;

export const chainCheck: FactoryLicenceChecker = (publicKeyHex, collection) =>
  licence.licenceStatus(publicKeyHex, collection);

/**
 * The licence to show: the door's word wins while the key is unlocked ("held" opens the door; "none"
 * only stays "revoked" when the chain said so); with no door answer the chain's stands.
 */
function mergeLicence(chain: FactoryLicence | null, doorAnswer: DoorLicenceAnswer | null): FactoryLicence {
  if (doorAnswer === "held") return "held";
  if (doorAnswer === "none") return chain === "revoked" ? "revoked" : "none";
  return chain ?? "checking";
}

/**
 * The licence for a key: the chain check, then (with the key unlocked) the door check, merged.
 * Null while there is no key. Nothing touches the network until a key exists; a failed check never
 * blocks the app.
 */
export function useFactoryLicence(opts: {
  publicKeyHex: string | null;
  key: Uint8Array | null;
  backendUrl: string;
  collection: string;
  checkLicence?: FactoryLicenceChecker;
  askDoor?: DoorLicenceAsker;
}): FactoryLicence | null {
  const { publicKeyHex, key, backendUrl, collection, checkLicence = chainCheck, askDoor = askDoorLicence } = opts;
  const unlocked = key !== null;
  // The door is asked when the key unlocks, not each time the same session hands back its key.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  const [checked, setChecked] = useState<{
    publicKeyHex: string;
    licence: FactoryLicence;
  } | null>(null);
  const [doorChecked, setDoorChecked] = useState<{
    publicKeyHex: string;
    backendUrl: string;
    answer: DoorLicenceAnswer;
  } | null>(null);

  useEffect(() => {
    if (!publicKeyHex) return;
    let cancelled = false;
    checkLicence(publicKeyHex, collection).then(
      (status) => {
        if (!cancelled) setChecked({ publicKeyHex, licence: status.state });
      },
      () => {
        if (!cancelled) setChecked({ publicKeyHex, licence: "unknown" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicKeyHex, collection, checkLicence]);

  // Unlocked, the door is asked (at unlock and when the backend URL changes; no polling). It never
  // blocks anything: offline or failing, the chain's answer stands.
  useEffect(() => {
    const doorKey = keyRef.current;
    if (!unlocked || !publicKeyHex || !doorKey) return;
    let cancelled = false;
    askDoor(backendUrl, doorKey).then(
      (answer) => {
        if (!cancelled) setDoorChecked({ publicKeyHex, backendUrl, answer });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [unlocked, publicKeyHex, backendUrl, askDoor]);

  if (!publicKeyHex) return null;
  const chainLicence = checked?.publicKeyHex === publicKeyHex ? checked.licence : null;
  const doorAnswer =
    unlocked && doorChecked?.publicKeyHex === publicKeyHex && doorChecked.backendUrl === backendUrl
      ? doorChecked.answer
      : null;
  return mergeLicence(chainLicence, doorAnswer);
}
