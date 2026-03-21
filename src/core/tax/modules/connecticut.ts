import type { TaxModule, TaxEstimate, TaxLineItem } from "../types";

/**
 * Connecticut sales tax: 6.35% general rate.
 * Most food for home consumption is exempt.
 *
 * Exempt categories include groceries, produce, meat, dairy, bakery, etc.
 * Taxable categories include health & beauty, household & cleaning,
 * paper & plastic goods, and pet supplies.
 *
 * Within "Snacks & Candy", CT taxes candy/confections (sugar-based, no flour)
 * but exempts regular snack foods (chips, pretzels, granola bars, etc.).
 *
 * Reference: CT DRS Policy Statement 2002(2) — Sales and Use Tax on Food
 */

const EXEMPT_CATEGORIES = new Set([
  "bakery",
  "beverages",
  "breakfast & cereal",
  "canned",
  "canned goods",
  "condiments & sauces",
  "dairy",
  "dairy & eggs",
  "deli",
  "dips",
  "frozen",
  "frozen foods",
  "fruits",
  "grains, pasta & sides",
  "international foods",
  "meat",
  "meat & seafood",
  "oils & vinegars",
  "produce",
  "sauces",
  "snacks",
  "soup",
  "spices",
  "spices & seasonings",
  "vegetables",
]);

/** Categories where taxability depends on the specific item. */
const MIXED_CATEGORIES = new Set(["snacks & candy"]);

/**
 * Name patterns that indicate candy/confections (taxable in CT).
 * CT defines "candy" as products with sugar/sweetener as a primary ingredient
 * that do NOT contain flour.
 */
const CANDY_PATTERNS = [
  /\bgumm(?:y|ies)\b/,
  /\blicorice\b/,
  /\bcandy\b/,
  /\bcandies\b/,
  /\bpeanut butter cup/,
  /\bconfection/,
  /\btaffy\b/,
  /\bcaramel(?:s)?\b/,
  /\btruffle/,
  /\blollipop/,
  /\bjelly bean/,
  /\bsour patch\b/,
  /\bswedish fish\b/,
  /\bfudge\b/,
  /\bmarshmallow/,
  /\bhard candy\b/,
  /\bcandy corn\b/,
  /\bskittles\b/,
  /\bstarbursts?\b/,
  /\bjolly rancher/,
  /\bsour worm/,
  /\bpeach ring/,
  /\bsweet tart/,
];

/**
 * Name patterns that indicate regular snack food (exempt in CT),
 * checked before candy patterns to avoid false positives.
 */
const SNACK_EXEMPT_PATTERNS = [
  /\bchip(?:s)?\b/,
  /\bpretzel/,
  /\bcracker/,
  /\bgranola\b/,
  /\b(?:protein|granola|cereal|snack) bar/,
  /\bpopcorn\b/,
  /\btrail mix\b/,
  /\brice cake/,
  /\bnut(?:s)?\b/,
  /\bjerky\b/,
  /\bseaweed\b/,
  /\bcheese puff/,
  /\bcorn nuts\b/,
  /\bchocolate chip/,
];

/**
 * Patterns that indicate a chocolate-covered/coated product (always candy),
 * checked after flour exemption to override snack-exempt patterns like "corn nuts".
 */
const CHOCOLATE_COATED_PATTERNS = [
  /\bchocolate.{0,10}cover/,
  /\bchocolate.{0,10}coat/,
  /\bdark chocolate (?!chip)/,
  /\bmilk chocolate (?!chip)/,
  /\bwhite chocolate (?!chip)/,
];

/**
 * Patterns for flour-containing baked goods. Under CT law, products that
 * contain flour are classified as food (not candy) and are tax-exempt,
 * even if they also match candy keywords like "coated" or "drizzled".
 */
const FLOUR_PRODUCT_PATTERNS = [
  /\bgranola bar/,
  /\bcookie/,
  /\bbrownie/,
  /\bwafer/,
  /\bcake\b/,
  /\bmuffin/,
  /\bcracker/,
  /\bpretzel/,
  /\bbiscuit/,
  /\bbiscotti/,
];

/**
 * For items in mixed categories (e.g. "Snacks & Candy"), determine taxability
 * based on item name heuristics.
 */
function isCandyOrConfection(name: string): boolean {
  const lower = name.toLowerCase();

  // Flour-containing products are always food (not candy) under CT law,
  // even if coated, drizzled, or chocolate-covered
  for (const pattern of FLOUR_PRODUCT_PATTERNS) {
    if (pattern.test(lower)) return false;
  }

  // Chocolate-covered/coated items are candy, even if the base
  // product (e.g. "corn nuts") would otherwise be an exempt snack
  for (const pattern of CHOCOLATE_COATED_PATTERNS) {
    if (pattern.test(lower)) return true;
  }

  // Check exempt snack patterns to avoid false positives on regular snacks
  for (const pattern of SNACK_EXEMPT_PATTERNS) {
    if (pattern.test(lower)) return false;
  }

  // Check candy/confection patterns
  for (const pattern of CANDY_PATTERNS) {
    if (pattern.test(lower)) return true;
  }

  return false;
}

const CT_RATE = 0.0635;

function isItemExempt(
  category: string | undefined,
  name: string
): boolean {
  if (!category) return false;
  const cat = category.toLowerCase();

  if (EXEMPT_CATEGORIES.has(cat)) return true;
  if (MIXED_CATEGORIES.has(cat)) return !isCandyOrConfection(name);

  return false;
}

function isExempt(category: string | undefined): boolean {
  if (!category) return false;
  const cat = category.toLowerCase();
  return EXEMPT_CATEGORIES.has(cat) || MIXED_CATEGORIES.has(cat);
}

function getRate(category: string | undefined): number {
  return isExempt(category) ? 0 : CT_RATE;
}

function calculate(
  items: Array<{ name: string; lineTotal: number; category?: string; taxOverride?: boolean }>
): TaxEstimate {
  let taxableAmount = 0;
  let exemptAmount = 0;
  let totalTax = 0;

  const lines: TaxLineItem[] = items.map((item) => {
    const exempt =
      item.taxOverride !== undefined
        ? !item.taxOverride
        : isItemExempt(item.category, item.name);
    const rate = exempt ? 0 : CT_RATE;
    const taxAmount = Math.round(item.lineTotal * rate * 100) / 100;

    if (exempt) {
      exemptAmount += item.lineTotal;
    } else {
      taxableAmount += item.lineTotal;
    }
    totalTax += taxAmount;

    return {
      itemName: item.name,
      lineTotal: item.lineTotal,
      taxable: !exempt,
      taxRate: rate,
      taxAmount,
    };
  });

  const subtotal = taxableAmount + exemptAmount;

  return {
    subtotal,
    taxableAmount: Math.round(taxableAmount * 100) / 100,
    exemptAmount: Math.round(exemptAmount * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    effectiveRate: subtotal > 0 ? totalTax / subtotal : 0,
    lines,
    moduleName: "Connecticut",
  };
}

export const connecticutTaxModule: TaxModule = {
  name: "Connecticut",
  stateCode: "CT",
  defaultRate: CT_RATE,
  isExempt,
  getRate,
  calculate,
};
