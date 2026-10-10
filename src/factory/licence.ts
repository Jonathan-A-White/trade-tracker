import { useCallback, useEffect, useRef, useState } from "react";
import { licence } from "bsv-kit/bsv";
import type { FactoryLicence } from "@/contracts/types";
import { askDoorLicence } from "@/services/door-licence";
import { POSTERN_ISSUER } from "@/services/factory-service";
import type { DoorLicenceAnswer, DoorLicenceAsker } from "@/services/door-licence";

/** Reads a key's licence in a collection; the chain by default, a fake in tests. */
export type FactoryLicenceChecker = (
  publicKeyHex: string,
  collection: string,
) => Promise<licence.LicenceStatus>;

/**
 * The chain check. It names the Postern issuer, so a licence Postern minted to the key (funded and
 * signed by the issuer, listed only in the issuer's history) reads as held even while the key is
 * locked. `reader` is for tests.
 */
export function makeChainCheck(
  options: { reader?: licence.ChainReader; issuer?: string } = {},
): FactoryLicenceChecker {
  const { reader, issuer = POSTERN_ISSUER } = options;
  return (publicKeyHex, collection) => licence.licenceStatus(publicKeyHex, collection, { reader, issuer });
}

export const chainCheck: FactoryLicenceChecker = makeChainCheck();

/** Waits before the 2nd and 3rd tries: three tries over about 30 seconds. */
export const CHAIN_RETRY_DELAYS_MS: readonly number[] = [10_000, 20_000];

/** The licence on show, and a way to read the chain again after it showed "unknown". */
export interface FactoryLicenceReading {
  licence: FactoryLicence;
  recheck: () => void;
}

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
 * blocks the app. A failed chain read is tried again after each of `retryDelaysMs` before the
 * licence reads "unknown"; `recheck` starts the reads over.
 */
export function useFactoryLicence(opts: {
  publicKeyHex: string | null;
  key: Uint8Array | null;
  backendUrl: string;
  collection: string;
  checkLicence?: FactoryLicenceChecker;
  askDoor?: DoorLicenceAsker;
  retryDelaysMs?: readonly number[];
}): FactoryLicenceReading | null {
  const {
    publicKeyHex,
    key,
    backendUrl,
    collection,
    checkLicence = chainCheck,
    askDoor = askDoorLicence,
    retryDelaysMs = CHAIN_RETRY_DELAYS_MS,
  } = opts;
  const delaysRef = useRef(retryDelaysMs);
  useEffect(() => {
    delaysRef.current = retryDelaysMs;
  });
  const [rechecks, setRechecks] = useState(0);
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
    let wake: (() => void) | null = null;
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    (async () => {
      const delays = delaysRef.current;
      for (let attempt = 0; ; attempt++) {
        try {
          const status = await checkLicence(publicKeyHex, collection);
          if (!cancelled) setChecked({ publicKeyHex, licence: status.state });
          return;
        } catch {
          if (cancelled) return;
          if (attempt >= delays.length) {
            setChecked({ publicKeyHex, licence: "unknown" });
            return;
          }
          await pause(delays[attempt]);
          if (cancelled) return;
        }
      }
    })();
    return () => {
      cancelled = true;
      wake?.();
    };
  }, [publicKeyHex, collection, checkLicence, rechecks]);

  const recheck = useCallback(() => {
    setChecked(null);
    setRechecks((n) => n + 1);
  }, []);

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
  return { licence: mergeLicence(chainLicence, doorAnswer), recheck };
}
