// The one answer to "may the AI be used": bsv-kit's, true only on a licensed key; 'checking' is no.
import { useCallback, useEffect, useRef } from "react";
import { useLicence } from "bsv-kit/bsv/react";
import type { FactoryLicence } from "@/contracts/types";

export { useAiAllowed, useLicence } from "bsv-kit/bsv/react";

/**
 * The licence as it stands at the moment of asking, for the mill client, which reads it at each send and
 * poll: a licence that goes while a lookup is in flight stops the next call. The function never changes.
 */
export function useLicenceNow(): () => FactoryLicence {
  const licence = useLicence();
  const ref = useRef<FactoryLicence>(licence);
  useEffect(() => {
    ref.current = licence;
  });
  return useCallback(() => ref.current, []);
}
