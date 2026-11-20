import type { YnabAccount } from "@/contracts/types";
import { saysCardPayment, transferOffer, transferPayee } from "./transfer";

const acct = (id: string, name: string, type = "checking"): YnabAccount => ({ id, name, type, onBudget: true, closed: false });
const checking = acct("a1", "Chase Checking");
const amazon = acct("a3", "Chase Amazon", "creditCard");
const freedom = acct("a4", "Chase Freedom", "creditCard");

describe("transferOffer: a card payment is a transfer, not an expense", () => {
  it("his $684.73 case: 'Amazon & Whole Foods' on checking is a transfer to the Chase Amazon card", () => {
    expect(transferOffer("Amazon & Whole Foods", checking, [checking, amazon, freedom], false)).toEqual({ account: amazon });
  });

  it.each(["AUTOPAY", "Payment to Chase card", "Chase Bank bill", "CHASE CREDIT CARD PAYMENT", "Bill Pay"])("'%s' says card payment", (merchant) => {
    expect(saysCardPayment(merchant)).toBe(true);
  });

  it("a payment that names no card offers the cards to choose from; one that names a card offers it", () => {
    expect(transferOffer("Chase Bank bill", checking, [checking, amazon, freedom], false)).toEqual({ cards: [amazon, freedom] });
    expect(transferOffer("Payment to Amazon card", checking, [checking, amazon, freedom], false)).toEqual({ account: amazon });
    expect(transferOffer("AUTOPAY", checking, [checking, freedom], false)).toEqual({ account: freedom });
  });

  it("an ordinary merchant, or one already sorted as an expense, or a charge on the card itself, is not a transfer", () => {
    expect(transferOffer("Trader Joe's", checking, [checking, amazon], false)).toBeNull();
    expect(transferOffer("Amazon & Whole Foods", checking, [checking, amazon], true)).toBeNull();
    expect(transferOffer("Amazon & Whole Foods", amazon, [checking, amazon], false)).toBeNull();
    expect(transferOffer("Amazon", checking, [checking], false)).toBeNull();
  });

  // mw-6ww.148.59: his real names (shapes only; no account numbers), the $684.73 'Amazon & Whole Foods' charge the sheet still offered as an expense
  describe("on the names his YNAB holds", () => {
    const pnc = acct("r1", "PNC Checking");
    const gift = acct("r2", "Amazon Gift Card", "cash");
    const awf = acct("r3", "Amazon & Whole Foods", "creditCard");
    const costco = acct("r4", "Costco", "creditCard");
    const dc = acct("r5", "Double Cash", "creditCard");
    const target = acct("r6", "Target", "creditCard");
    const all = [pnc, gift, awf, costco, dc, target];
    const merchant = "Amazon & Whole Foods";

    it("(a) on PNC Checking it is a transfer to the Amazon & Whole Foods card", () => {
      expect(transferOffer(merchant, pnc, all, false)).toEqual({ account: awf });
    });

    it("(a) on a card number the book has no account for (unmapped) it is still offered as a transfer to that card", () => {
      expect(transferOffer(merchant, undefined, all, false)).toEqual({ account: awf });
    });

    it("(b) arriving on the Amazon & Whole Foods card itself it is a transfer from PNC Checking", () => {
      expect(transferOffer(merchant, awf, all, false)).toEqual({ account: awf, source: pnc });
    });

    it("(c) the cash account Amazon Gift Card is never taken for the card", () => {
      expect(transferOffer(merchant, pnc, [pnc, gift], false)).toBeNull();
      expect(transferOffer(merchant, gift, all, false)?.account).toBe(awf);
    });

    it("a purchase at Target or Costco on that very card is still an expense, as is one on another card", () => {
      expect(transferOffer("Target", target, all, false)).toBeNull();
      expect(transferOffer("Costco", costco, all, false)).toBeNull();
      expect(transferOffer("Costco", dc, all, false)).toBeNull();
      expect(transferOffer("Costco", pnc, all, true)).toBeNull();
    });

    it("a payment-words credit on a card is a transfer from checking; with two checking accounts it is not guessed", () => {
      expect(transferOffer("Payment Thank You", dc, all, false)).toEqual({ account: dc, source: pnc });
      expect(transferOffer("Payment Thank You", dc, [...all, acct("r7", "Savings Plus", "savings")], false)).toBeNull();
    });
  });

  it("finds the payee YNAB makes for transfers into an account", () => {
    expect(transferPayee(amazon, [{ id: "p1", name: "Trader Joe's" }, { id: "p9", name: "Transfer : Chase Amazon" }])?.id).toBe("p9");
    expect(transferPayee(amazon, [{ id: "p1", name: "Trader Joe's" }])).toBeUndefined();
  });
});
