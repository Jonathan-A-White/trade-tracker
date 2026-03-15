import type { TaxModule, TaxEstimate, TaxLineItem } from "../types";

/**
 * Connecticut sales tax: 6.35% general rate.
 * Most food for home consumption is exempt.
 *
 * Exempt categories include groceries, produce, meat, dairy, bakery, etc.
 * Taxable categories include health & beauty, household & cleaning,
 * paper & plastic goods, and pet supplies.
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
  "snacks & candy",
  "soup",
  "spices",
  "spices & seasonings",
  "vegetables",
]);

const CT_RATE = 0.0635;

function isExempt(category: string | undefined): boolean {
  if (!category) return false;
  return EXEMPT_CATEGORIES.has(category.toLowerCase());
}

function getRate(category: string | undefined): number {
  return isExempt(category) ? 0 : CT_RATE;
}

function calculate(
  items: Array<{ name: string; lineTotal: number; category?: string }>
): TaxEstimate {
  let taxableAmount = 0;
  let exemptAmount = 0;
  let totalTax = 0;

  const lines: TaxLineItem[] = items.map((item) => {
    const exempt = isExempt(item.category);
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
