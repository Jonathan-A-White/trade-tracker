/**
 * Maps what the camera decoded to what the app looks up.
 *
 * A produce sticker carries a GS1 DataBar. GS1 DataBar encodes a 14-digit GTIN
 * (GS1 General Specifications, "GS1 DataBar" symbology: a GTIN-8/12/13 is
 * zero-filled on the left to 14 digits), and the fresh-produce industry's
 * DataBar guidance (IFPS "DataBar Implementation Global Guide", with the
 * PMA/IFPA "DataBar Online" pages) lets a grower-packer carry the item's PLU
 * in that GTIN: zero-filled on the left, then the 4- or 5-digit PLU, then the
 * GTIN check digit. So 4959 is 000000000 4959 7 and organic 94959 is
 * 00000000 94959 0. IFPS also says many stickers carry the packer's own,
 * company-specific GTIN instead; that is looked up as a barcode.
 */

const DATABAR_FORMATS = [
  "databar",
  "databar_omni",
  "databar_stacked",
  "databar_stacked_omni",
  "databar_expanded",
  "databar_expanded_stacked",
  "databar_limited",
] as const;

export function isDataBarFormat(format: string): boolean {
  return (DATABAR_FORMATS as readonly string[]).includes(format);
}

/** GTIN check digit over the digits before it (mod-10, weights 3,1 from the right). */
function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * ((body.length - i) % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** The PLU a PLU-form GTIN-14 holds, or null when the GTIN is not that form. */
function pluFromGtin14(gtin14: string): string | null {
  if (Number(gtin14[13]) !== gtinCheckDigit(gtin14.slice(0, 13))) return null;
  const match = /^0+([1-9]\d{3,4})\d$/.exec(gtin14);
  return match ? match[1] : null;
}

/** A GTIN-14 without its zero fill, down to the 12 digits of a UPC-A. */
function barcodeFromGtin14(gtin14: string): string {
  let code = gtin14;
  while (code.length > 12 && code.startsWith("0")) code = code.slice(1);
  return code;
}

export function resolveScanValue(rawValue: string, format: string): string {
  if (!isDataBarFormat(format)) return rawValue;
  // the ponyfill reads a DataBar as the (01) identifier plus the GTIN-14, bare
  // ("01" + 14 digits); a reader may bracket it, or give the GTIN-14 alone
  const value = rawValue.trim();
  const match = /^(?:\(01\)|01)(\d{14})(?!\d)/.exec(value) ?? /^(\d{14})(?!\d)/.exec(value);
  if (!match) return rawValue;
  const gtin14 = match[1];
  return pluFromGtin14(gtin14) ?? barcodeFromGtin14(gtin14);
}
