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
    expect(transferOffer("Payment to Chase card", undefined, [checking, amazon], false)).toBeNull();
    expect(transferOffer("Amazon", checking, [checking], false)).toBeNull();
  });

  it("finds the payee YNAB makes for transfers into an account", () => {
    expect(transferPayee(amazon, [{ id: "p1", name: "Trader Joe's" }, { id: "p9", name: "Transfer : Chase Amazon" }])?.id).toBe("p9");
    expect(transferPayee(amazon, [{ id: "p1", name: "Trader Joe's" }])).toBeUndefined();
  });
});
