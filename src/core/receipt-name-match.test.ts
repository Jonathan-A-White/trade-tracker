import { matchByName } from "./receipt-name-match";

// the nine trip lines that were still pending lookups when his 2026-10-30 receipt went out
const late = [
  ["skyr-cherry", "Trader Joe's Icelandic Style Skyr Lowfat Yogurt Cherry"],
  ["skyr-vanilla", "Trader Joe's Icelandic Style Skyr Lowfat Yogurt Vanilla"],
  ["soup", "Trader Joe's Autumnal Harvest Soup"],
  ["waffles", "Trader Joe's Gluten Free Toaster Waffles"],
  ["crushers", "Trader Joe's Organic Apple Strawberry Fruit Sauce Crushers"],
  ["sugar", "Trader Joe's Vanilla Sugar"],
  ["pizza", "Trader Joe's Detroit Style Uncured Pepperoni Pizza"],
  ["satay", "Trader Joe's Thai Peanut Satay Sauce"],
  ["oatmeal", "Trader Joe's Maple & Brown Sugar Instant Oatmeal"],
].map(([id, name]) => ({ id, name }));

describe("matchByName", () => {
  it.each([
    ["YOGURT SKYR CHERRY 5.3 O", "skyr-cherry"],
    ["YOGURT SKYR VANILLA 5.3", "skyr-vanilla"],
    ["HOL SOUP AUTUMNAL HARVES", "soup"],
    ["GLUTEN FREE WAFFLES", "waffles"],
    ["ORG APPLE STRWBRY CRUSHE", "crushers"],
    ["HOL VANILLA SUGAR", "sugar"],
    ["DETROIT PEPPERONI PIZZA", "pizza"],
    ["THAI PEANUT SATAY SAUCE", "satay"],
    ["OATMEAL INSTANT MAPLE BR", "oatmeal"],
  ])("%s is %s", (printed, id) => {
    expect(matchByName(printed, late)).toBe(id);
  });

  it("matches nothing for products that are not on the trip", () => {
    for (const printed of [
      "MADELEINES GLUTEN FREE",
      "HOL HAM CARVER UNCURED F",
      "BANANA ORG EACH",
      "HOL LOAF PUMPKIN BRIOCHE",
    ]) {
      expect(matchByName(printed, late)).toBeNull();
    }
  });

  it("asks when two lines fit the printed name equally", () => {
    expect(matchByName("YOGURT SKYR 5.3 OZ", late)).toBeNull();
    expect(matchByName("SUGAR", late)).toBeNull();
  });
});
