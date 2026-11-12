import type { YnabCategory } from "@/contracts/types";
import { MEMO_MAX, memoFor, resolveCheckRead } from "./check-read";

const cat = (id: string, name: string, groupName = "Food"): YnabCategory => ({ id, groupId: groupName, groupName, name, hidden: false });
const categories = [cat("c1", "Groceries"), cat("c2", "Eating Out"), cat("c3", "Household", "Home"), cat("c4", "Stuff I Forgot to Budget For", "Surprises")];

describe("the read of a check image", () => {
  it("names the category the mill chose, whatever the case, and says what was read", () => {
    const read = resolveCheckRead({ payTo: "Joe's Diner", memo: "lunch", category: "eating out", confidence: "high", why: "A diner." }, categories);
    expect(read).toMatchObject({ payTo: "Joe's Diner", memo: "lunch", categoryId: "c2", confidence: "likely" });
    expect(read!.why).toContain("Joe's Diner");
    expect(read!.why).toContain("lunch");
    expect(read!.why).toContain("A diner.");
  });

  it("is never more than likely, and a medium or low read is unsure", () => {
    expect(resolveCheckRead({ payTo: "A", memo: "", category: "Eating Out", confidence: "medium", why: "w" }, categories)?.confidence).toBe("unsure");
    expect(resolveCheckRead({ payTo: "A", memo: "", category: "Eating Out", confidence: "low", why: "w" }, categories)?.confidence).toBe("unsure");
  });

  it("leaves the category out when the mill chose none, or one the budget does not have", () => {
    expect(resolveCheckRead({ payTo: "A", memo: "", confidence: "low", why: "Cannot tell." }, categories)?.categoryId).toBeNull();
    expect(resolveCheckRead({ payTo: "A", memo: "", category: "Yacht Fund", confidence: "high", why: "w" }, categories)?.categoryId).toBeNull();
  });

  it("will not name food or the household for a payee not seen there: it falls to Stuff I Forgot to Budget For, saying so", () => {
    const read = resolveCheckRead({ payTo: "Farmer Joe", memo: "eggs", category: "Groceries", confidence: "high", why: "Eggs." }, categories);
    expect(read).toMatchObject({ categoryId: "c4", confidence: "unsure" });
    expect(read!.why).toContain("Stuff I Forgot to Budget For");
  });

  it("is nothing when the answer has neither a payee nor a why", () => {
    expect(resolveCheckRead({ payTo: "", memo: "", confidence: "low", why: "" }, categories)).toBeNull();
  });

  it("writes the payee read into the memo, beside what YNAB already holds, and never twice", () => {
    expect(memoFor("", { payTo: "Joe's Diner", memo: "" })).toBe("Paid to Joe's Diner");
    expect(memoFor("", { payTo: "Joe's Diner", memo: "lunch" })).toBe("Paid to Joe's Diner (lunch)");
    expect(memoFor("Check cleared", { payTo: "Joe's Diner", memo: "" })).toBe("Check cleared · Paid to Joe's Diner");
    expect(memoFor("Paid to Joe's Diner", { payTo: "Joe's Diner", memo: "" })).toBe("Paid to Joe's Diner");
    expect(memoFor("", { payTo: "", memo: "" })).toBe("");
    expect(memoFor("x".repeat(300), { payTo: "Joe", memo: "" }).length).toBeLessThanOrEqual(MEMO_MAX);
  });
});
