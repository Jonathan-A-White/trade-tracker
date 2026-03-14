/**
 * Calculates the line total for a trip item.
 * Uses weightLbs if provided (per-lb pricing), otherwise uses quantity.
 */
export function calculateLineTotal(
  price: number,
  quantity: number,
  weightLbs?: number
): number {
  if (weightLbs !== undefined && weightLbs !== null) {
    return price * weightLbs;
  }
  return price * quantity;
}

/**
 * Determines the price trend based on recent prices.
 * Compares the last price to the average of previous prices.
 */
export function calculateTrend(
  prices: number[]
): "up" | "down" | "stable" {
  if (prices.length < 2) return "stable";

  const recent = prices[prices.length - 1];
  const previous = prices[prices.length - 2];

  if (recent > previous) return "up";
  if (recent < previous) return "down";
  return "stable";
}

/**
 * Formats a number as a USD currency string.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}
