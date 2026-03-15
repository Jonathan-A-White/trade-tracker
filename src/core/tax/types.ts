/**
 * Represents a tax calculation result for a single item.
 */
export interface TaxLineItem {
  itemName: string;
  lineTotal: number;
  taxable: boolean;
  taxRate: number;
  taxAmount: number;
}

/**
 * Represents the full tax calculation for a trip.
 */
export interface TaxEstimate {
  subtotal: number;
  taxableAmount: number;
  exemptAmount: number;
  totalTax: number;
  effectiveRate: number;
  lines: TaxLineItem[];
  moduleName: string;
}

/**
 * Interface that all state/region tax modules must implement.
 */
export interface TaxModule {
  /** Display name, e.g. "Connecticut" */
  readonly name: string;
  /** Two-letter state code, e.g. "CT" */
  readonly stateCode: string;
  /** Default tax rate for this state */
  readonly defaultRate: number;

  /**
   * Returns true if the given item category is tax-exempt.
   */
  isExempt(category: string | undefined): boolean;

  /**
   * Returns the tax rate for a given category.
   * Returns 0 for exempt categories.
   */
  getRate(category: string | undefined): number;

  /**
   * Calculates the full tax estimate for a list of items.
   */
  calculate(
    items: Array<{ name: string; lineTotal: number; category?: string }>
  ): TaxEstimate;
}
