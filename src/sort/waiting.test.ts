import type { FamilyCard } from "@/contracts/types";
import type { FamilyAlert } from "@/family/alerts-client";
import { cardBook } from "@/family/cards";
import { isTemporaryHold, ownLastFours, temporaryHolds, waitingCharges } from "./waiting";

const card = (lastFour: string, owner: string): FamilyCard => ({ id: lastFour, lastFour, owner, createdAt: 1 });

describe("ownLastFours", () => {
  const cards = [card("1234", "Jonathan"), card("5678", "Sam"), card("9876", "shared"), card("4321", "anyone"), card("1111", "jonathan")];

  it("lists this phone's person's cards and the shared ones, never the other person's", () => {
    expect(ownLastFours(cards, "Jonathan")).toEqual(["1111", "1234", "9876"]);
    expect(ownLastFours(cards, "Sam")).toEqual(["5678", "9876"]);
  });

  it("leaves out a card owned by 'anyone', which follows the backend's rule for an unlisted card", () => {
    expect(ownLastFours(cards, "Sam")).not.toContain("4321");
  });

  it("lists nothing for a phone with no person set", () => {
    expect(ownLastFours(cards, null)).toEqual([]);
  });
});

const alert = (seq: number, merchant: string, amount = "1.00", when?: string): FamilyAlert => ({
  id: String(seq).padStart(16, "0"),
  seq,
  kind: "charge",
  amount,
  merchant,
  last4: "8235",
  ...(when ? { when } : {}),
});

describe("temporary holds", () => {
  const book = cardBook([card("8235", "shared")]);

  it("keeps the $1.00 GOOGLE*GPAY TEMP card check out of Waiting", () => {
    const hold = alert(1, "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA");
    expect(waitingCharges([hold], book, "Jonathan", new Set())).toEqual([]);
  });

  it("sorts a real charge from the same card as usual, even one that follows the hold", () => {
    const hold = alert(1, "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA");
    const real = alert(2, "SHELL OIL 5744", "42.17");
    const waiting = waitingCharges([hold, real], book, "Jonathan", new Set());
    expect(waiting.map((c) => c.alert.id)).toEqual([real.id]);
  });

  it("a hold that settles into a real charge (the same shop without the hold word) waits to be sorted", () => {
    const hold = alert(1, "SHELL OIL 5744 PREAUTH", "75.00");
    const settled = alert(2, "SHELL OIL 5744", "41.18");
    expect(waitingCharges([hold, settled], book, null, new Set()).map((c) => c.alert.id)).toEqual([settled.id]);
  });

  it.each([
    "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA",
    "GOOGLE *GPAY TEMP",
    "APPLE PAY TEMP AUTH",
    "SHELL OIL 5744 PRE-AUTH",
    "MARRIOTT AUTHORIZATION HOLD",
    "HERTZ TEMP HOLD",
    "CARD VERIFICATION",
    "ACME*TEMP 123",
  ])("recognises %s as a hold", (merchant) => {
    expect(isTemporaryHold(alert(1, merchant))).toBe(true);
  });

  it.each(["SHELL OIL 5744", "TEMPE MARKET", "TEMPORARY TATTOO CO", "AUTHENTIC PIZZA", "Trader Joe's", "TEMP-TATIONS BAKERY"])(
    "does not take %s for a hold",
    (merchant) => {
      expect(isTemporaryHold(alert(1, merchant))).toBe(false);
    },
  );

  it("lists the holds of the last two days, newest first, and drops older ones by itself", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const recent = alert(1, "GOOGLE*GPAY TEMP", "1.00", "2026-11-13T04:33:00Z");
    const older = alert(2, "GOOGLE*GPAY TEMP", "1.00", "2026-11-09T04:33:00Z");
    const real = alert(3, "SHELL OIL 5744", "42.17", "2026-11-13T05:00:00Z");
    expect(temporaryHolds([recent, older, real], now).map((a) => a.id)).toEqual([recent.id]);
  });
});
