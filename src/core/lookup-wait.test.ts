import type { PendingLookup } from "@/contracts/types";
import { lookupNotBack, notBackAt, resendDueAt, sentTimeOf } from "./lookup-wait";

const LIMITS = { resendAfterMs: 1000, giveUpAfterMs: 500 };

function lookup(extra: Partial<PendingLookup> = {}): PendingLookup {
  return {
    id: "l1",
    barcode: "1",
    tripId: "t",
    itemId: "pending:l1",
    photos: [],
    status: "at-the-factory",
    gristTxid: "direct:x",
    createdAt: 100,
    sentAt: 1000,
    ...extra,
  };
}

describe("lookup wait, read from stored times", () => {
  it("takes the send time, else when the lookup was made", () => {
    expect(sentTimeOf(lookup())).toBe(1000);
    expect(sentTimeOf(lookup({ sentAt: undefined }))).toBe(100);
  });

  it("is due to be sent again one limit after the send, and not come back both limits after it", () => {
    expect(resendDueAt(lookup(), LIMITS)).toBe(2000);
    expect(notBackAt(lookup(), LIMITS)).toBe(2500);
  });

  it("after a second send the second limit counts from that send", () => {
    expect(notBackAt(lookup({ resentAt: 5000 }), LIMITS)).toBe(5500);
  });

  it("is not come back at its time, and before it is not", () => {
    expect(lookupNotBack(lookup(), 2499, LIMITS)).toBe(false);
    expect(lookupNotBack(lookup(), 2500, LIMITS)).toBe(true);
  });

  it("is come back whenever the runner marked it", () => {
    expect(lookupNotBack(lookup({ notBack: true }), 1001, LIMITS)).toBe(true);
  });

  it("only a lookup at the factory can be not come back", () => {
    expect(lookupNotBack(lookup({ status: "waiting-to-send" }), 1e9, LIMITS)).toBe(false);
    expect(lookupNotBack(lookup({ status: "failed" }), 1e9, LIMITS)).toBe(false);
  });
});
