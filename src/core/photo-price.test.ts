import type { PendingLookup } from "@/contracts/types";
import { priceLookupNote } from "./photo-price";

function lookup(extra: Partial<PendingLookup> = {}): PendingLookup {
  return {
    id: "l1",
    barcode: "0099887766",
    tripId: "t1",
    itemId: "i1",
    mode: "price-only",
    photos: [],
    status: "at-the-factory",
    gristTxid: "direct:x",
    createdAt: 1,
    ...extra,
  };
}

describe("priceLookupNote", () => {
  it("a lookup the factory has says it is waiting", () => {
    expect(priceLookupNote(lookup())).toEqual({ kind: "waiting", text: "Waiting on the factory" });
  });

  it("a lookup sent twice with no answer says it did not come back", () => {
    expect(priceLookupNote(lookup({ notBack: true }))).toEqual({
      kind: "not-back",
      text: "The factory did not send this back",
    });
  });
});
