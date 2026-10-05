import { useLiveQuery } from "dexie-react-hooks";
import type { PendingLookup } from "@/contracts/types";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";

const pendingLookupRepo = new PendingLookupRepository();

/**
 * The open pending-line lookups of a trip, keyed by the itemId their pending
 * line carries. Price-only lookups have no line of their own and applied ones
 * are filled, so neither is here.
 */
export function usePendingLookupsByItemId(
  tripId: string | undefined,
): Record<string, PendingLookup> {
  return (
    useLiveQuery(async () => {
      if (!tripId) return {};
      const map: Record<string, PendingLookup> = {};
      for (const lookup of await pendingLookupRepo.listByTrip(tripId)) {
        if (lookup.mode !== "price-only" && lookup.status !== "applied") {
          map[lookup.itemId] = lookup;
        }
      }
      return map;
    }, [tripId]) ?? {}
  );
}
