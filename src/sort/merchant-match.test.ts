import { meets, merchantKey } from "./merchant-match";

describe("a card alert's merchant meets a YNAB payee", () => {
  it.each([
    ["JONES FAMILY FARMS, LL SHELTON USA", "Jones Family Farms"],
    ["TRADER JOE S #552", "Trader Joe's"],
    ["Trader Joe's", "TRADER JOES"],
    ["WAL-MART #1234", "Walmart"],
    ["AMAZON MKTPL*2X3Y4", "Amazon"],
    ["PAYPAL *LOGOS", "Logos"],
    ["SQ *LOGOS BIBLE SOFTWARE", "Logos Bible Software"],
    ["Logos", "Logos Bible Software"],
    ["Jones Family Farms", "Jones Family Farms LLC"],
    ["Café Nero", "CAFE NERO 0042"],
  ])("'%s' meets '%s' though they are written differently", (merchant, payee) => {
    expect(meets(merchant, payee)).toBe(true);
  });

  it.each([
    ["JONES FAMILY FARMS, LL SHELTON USA", "Family Dollar"],
    ["SMITH FAMILY FARMS", "Jones Family Farms"],
    ["FAMILY DOLLAR #12", "Family"],
    ["THE HOME DEPOT #6512", "The Market"],
    ["SHELLYS BAKERY", "Shell"],
    ["SHELL OIL 5741", "Shelly's Bakery"],
    ["SQ *1234", "Square"],
  ])("'%s' does not meet '%s': they merely share a common word, or a part of one", (merchant, payee) => {
    expect(meets(merchant, payee)).toBe(false);
  });

  it("keys a merchant by its words, without case, punctuation, a processor's prefix or the codes that change charge to charge", () => {
    expect(merchantKey("AMAZON MKTPL*2X3Y4")).toBe(merchantKey("Amazon Mktpl*9Z8Q1"));
    expect(merchantKey("SQ *LOGOS BIBLE")).toBe("logos bible");
    expect(merchantKey("  Trader Joe's ")).toBe("trader joes");
    expect(merchantKey("#552")).toBe("");
  });
});
