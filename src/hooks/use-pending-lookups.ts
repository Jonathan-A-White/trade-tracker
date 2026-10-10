import { useLiveQuery } from "dexie-react-hooks";
import type { PendingLookup } from "@/contracts/types";
import { loadPendingByItemId } from "@/trips/use-trip-lines";

/**
 * The open pending-line lookups of a trip, keyed by the itemId their pending
 * line carries. For the pages that do not yet read their trip through
 * useTripLines.
 */
export function usePendingLookupsByItemId(
  tripId: string | undefined,
): Record<string, PendingLookup> {
  return (
    useLiveQuery(
      async () => (tripId ? loadPendingByItemId(tripId) : {}),
      [tripId],
    ) ?? {}
  );
}
