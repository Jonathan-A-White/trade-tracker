/**
 * Calculates the check digit for EAN/UPC barcodes using the standard algorithm.
 */
function calculateCheckDigit(digits: number[]): number {
  const len = digits.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const weight = (len - i) % 2 === 0 ? 3 : 1;
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validates EAN-13, UPC-A, and EAN-8 barcodes by verifying the check digit.
 */
export function validateBarcode(code: string): boolean {
  const trimmed = code.trim();

  if (!/^\d+$/.test(trimmed)) {
    return false;
  }

  if (trimmed.length !== 8 && trimmed.length !== 12 && trimmed.length !== 13) {
    return false;
  }

  const digits = trimmed.split("").map(Number);
  const checkDigit = digits.pop()!;
  const calculated = calculateCheckDigit(digits);

  return checkDigit === calculated;
}

/**
 * Returns true for PLU codes (4-5 digit numeric codes used for produce).
 */
export function isPLUCode(code: string): boolean {
  const trimmed = code.trim();
  return /^\d{4,5}$/.test(trimmed);
}

/**
 * Pads a barcode to standard length:
 * - 7 digits -> pad to 8 (EAN-8)
 * - 11 digits -> pad to 12 (UPC-A)
 * - 12 digits -> pad to 13 (EAN-13)
 * Otherwise returns the code as-is.
 */
export function formatBarcode(code: string): string {
  const trimmed = code.trim();

  if (trimmed.length === 7) {
    return trimmed.padStart(8, "0");
  }
  if (trimmed.length === 11) {
    return trimmed.padStart(12, "0");
  }
  if (trimmed.length === 12) {
    return trimmed.padStart(13, "0");
  }

  return trimmed;
}
