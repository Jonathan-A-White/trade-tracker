import type { YnabAccount } from "@/contracts/types";
import { heldTransfer, judgeTransfer, saysCardPayment, transferOffer, transferPayee, type RecentTransfer } from "./transfer";

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

    it("a payment-words credit on a card is a transfer from checking; with two cash accounts he chooses which", () => {
      expect(transferOffer("Payment Thank You", dc, all, false)).toEqual({ account: dc, source: pnc });
      expect(transferOffer("Payment Thank You", dc, [...all, acct("r7", "Savings Plus", "savings")], false)).toEqual({ account: dc, sources: [pnc, acct("r7", "Savings Plus", "savings")] });
    });
  });

  // his real budget has PNC Checking, TD Bank Checking and PNC Savings: the paying account cannot be guessed, he is asked
  it("(b) on his real accounts the payment arriving on the Amazon & Whole Foods card asks which of his three cash accounts paid it", () => {
    const pnc = acct("r1", "PNC Checking");
    const td = acct("r8", "TD Bank Checking");
    const sav = acct("r9", "PNC Savings", "savings");
    const awf = acct("r3", "Amazon & Whole Foods", "creditCard");
    const gift = acct("r2", "Amazon Gift Card", "cash");
    expect(transferOffer("Amazon & Whole Foods", awf, [pnc, td, sav, gift, awf], false)).toEqual({ account: awf, sources: [pnc, td, sav] });
  });

  it("finds the payee YNAB makes for transfers into an account", () => {
    expect(transferPayee(amazon, [{ id: "p1", name: "Trader Joe's" }, { id: "p9", name: "Transfer : Chase Amazon" }])?.id).toBe("p9");
    expect(transferPayee(amazon, [{ id: "p1", name: "Trader Joe's" }])).toBeUndefined();
  });

  // YNAB's own payee row says which account it is the transfer payee of (transfer_account_id), so a rename does not lose it
  it("finds the transfer payee by its account id when the account was renamed after the payee was read", () => {
    const renamed = { ...amazon, name: "Chase Amazon Prime" };
    const payees = [{ id: "p1", name: "Trader Joe's" }, { id: "p9", name: "Transfer : Chase Amazon", transferAccountId: amazon.id }];
    expect(transferPayee(renamed, payees)?.id).toBe("p9");
    expect(transferPayee(amazon, [{ id: "p9", name: "Transfer : Old Name", transferAccountId: amazon.id }])?.id).toBe("p9");
  });

  it("does not take another account's transfer payee by name when the payee names a different account", () => {
    const payees = [{ id: "p9", name: "Transfer : Chase Amazon", transferAccountId: "some-other-account" }];
    expect(transferPayee(amazon, payees)).toBeUndefined();
  });

  // mw-6ww.148.66: the alert names no merchant ('A charge' on the sheet); YNAB already holds the payment as a transfer
  describe("a payment YNAB already holds as a transfer", () => {
    const pnc = acct("r1", "PNC Checking");
    const td = acct("r8", "TD Bank Checking");
    const sav = acct("r9", "PNC Savings", "savings");
    const awf = acct("r3", "Amazon & Whole Foods", "creditCard");
    const costco = acct("r4", "Costco", "creditCard");
    const gift = acct("r2", "Amazon Gift Card", "cash");
    const all = [pnc, td, sav, gift, awf, costco];
    // YNAB: 2026-11-18, PNC Checking -684.73, payee 'Transfer : Amazon & Whole Foods'
    const held: RecentTransfer[] = [{ from: "r1", to: "r3", date: "2026-11-18", amount: 684.73 }];

    it("his $684.73 with merchant 'A charge' on an unmapped card number is the transfer from PNC Checking to Amazon & Whole Foods, whatever the merchant", () => {
      expect(heldTransfer(684.73, "2026-11-18", undefined, all, held)).toEqual({ from: pnc, to: awf });
      expect(transferOffer("A charge", undefined, all, false, heldTransfer(684.73, "2026-11-18", undefined, all, held))).toEqual({ account: awf, source: pnc, held: true });
      expect(transferOffer("", undefined, all, false, heldTransfer(684.73, "2026-11-18", undefined, all, held))).toEqual({ account: awf, source: pnc, held: true });
    });

    it("on the Amazon & Whole Foods card itself, or on PNC Checking, it is the same transfer", () => {
      expect(heldTransfer(684.73, "2026-11-18", awf, all, held)).toEqual({ from: pnc, to: awf });
      expect(heldTransfer(684.73, "2026-11-18", pnc, all, held)).toEqual({ from: pnc, to: awf });
    });

    it("the date may differ by two days, not three; the amount must be the same to the cent", () => {
      expect(heldTransfer(684.73, "2026-11-20", undefined, all, held)).not.toBeNull();
      expect(heldTransfer(684.73, "2026-11-16", undefined, all, held)).not.toBeNull();
      expect(heldTransfer(684.73, "2026-11-21", undefined, all, held)).toBeNull();
      expect(heldTransfer(684.72, "2026-11-18", undefined, all, held)).toBeNull();
    });

    it("an account the transfer does not touch, or a checking account that only received it, is not matched", () => {
      expect(heldTransfer(684.73, "2026-11-18", costco, all, held)).toBeNull();
      expect(heldTransfer(684.73, "2026-11-18", td, all, held)).toBeNull();
      expect(heldTransfer(684.73, "2026-11-18", undefined, [pnc, td], held)).toBeNull();
    });

    it("a transfer between his savings and checking is matched on either account kind, once per account kind", () => {
      const move: RecentTransfer[] = [{ from: "r9", to: "r1", date: "2026-11-18", amount: 50 }];
      expect(heldTransfer(50, "2026-11-18", sav, all, move)).toEqual({ from: sav, to: pnc });
      expect(heldTransfer(50, "2026-11-18", undefined, all, move)).toEqual({ from: sav, to: pnc });
      expect(heldTransfer(50, "2026-11-18", pnc, all, move)).toBeNull();
    });
  });

  it("a payment arriving on a card with checking, checking and savings accounts offers all three to pick from (mw-6ww.148.66)", () => {
    const pnc = acct("r1", "PNC Checking");
    const td = acct("r8", "TD Bank Checking");
    const sav = acct("r9", "PNC Savings", "savings");
    const awf = acct("r3", "Amazon & Whole Foods", "creditCard");
    expect(transferOffer("Payment Thank You", awf, [pnc, td, sav, awf], false)).toEqual({ account: awf, sources: [pnc, td, sav] });
    expect(transferOffer("AUTOPAY", awf, [pnc, td, sav, awf], false)).toEqual({ account: awf, sources: [pnc, td, sav] });
  });
});

describe("transferOffer: a merchant already sorted as an expense (mw-6ww.148.61)", () => {
  const awf = acct("r3", "Amazon & Whole Foods", "creditCard");
  const pnc = acct("r1", "PNC Checking");
  it("is still a payment when it is the card's whole name, but not when it is one word of it", () => {
    expect(transferOffer("Amazon & Whole Foods", pnc, [pnc, awf], true)).toEqual({ account: awf });
    expect(transferOffer("Amazon.com", pnc, [pnc, awf], true)).toBeNull();
  });
});

describe("judgeTransfer: a card with no transfer payee is named, not dropped (mw-6ww.148.63)", () => {
  const awf = acct("r3", "Amazon & Whole Foods", "creditCard");
  const pnc = acct("r1", "PNC Checking");
  const base = { merchant: "Amazon & Whole Foods", amount: 10, date: "2026-11-18", account: pnc, accounts: [pnc, awf], categories: [], tally: null };
  it("offers the transfer with a payee, and says the payee is missing without one", () => {
    const payee = { id: "p", name: "Transfer : Amazon & Whole Foods", deleted: false, transferAccountId: "r3" };
    expect(judgeTransfer({ ...base, payees: [payee] })).toEqual({ offer: { account: awf }, missing: [] });
    expect(judgeTransfer({ ...base, payees: [] })).toEqual({ offer: null, missing: [awf] });
  });
});
