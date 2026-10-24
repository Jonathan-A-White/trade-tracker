import { resolveScanValue, isDataBarFormat } from "./scan-value";
import { GROCERY_FORMATS } from "./camera-scanner";

describe("resolveScanValue", () => {
  it("turns the PLU-form GTIN-14 of 4959 into the PLU 4959", () => {
    expect(resolveScanValue("00000000049597", "databar_stacked_omni")).toBe("4959");
  });

  it("turns the PLU-form GTIN-14 of the organic PLU 94959 into 94959", () => {
    expect(resolveScanValue("00000000949590", "databar")).toBe("94959");
  });

  it("strips the bare 01 identifier the ponyfill puts before the GTIN-14", () => {
    // read from generated DataBar symbols with the ponyfill
    expect(resolveScanValue("0100000000049597", "databar_omni")).toBe("4959");
    expect(resolveScanValue("0100036632001252", "databar_omni")).toBe("036632001252");
    expect(resolveScanValue("0100000000049597", "databar_limited")).toBe("4959");
  });

  it("strips an (01) application identifier before reading the GTIN", () => {
    expect(resolveScanValue("(01)00000000049597", "databar_expanded")).toBe("4959");
    expect(resolveScanValue("(01)00036632001252", "databar_expanded")).toBe("036632001252");
  });

  it("ignores the other application identifiers after (01) in an Expanded value", () => {
    expect(resolveScanValue("(01)00000000049597(3103)000150", "databar_expanded")).toBe("4959");
  });

  it("looks a non-PLU GTIN-14 up as a barcode, minus its indicator-digit padding", () => {
    // 0 + UPC-A 036632001252 padded to 14
    expect(resolveScanValue("00036632001252", "databar_stacked")).toBe("036632001252");
    // 0 + EAN-13 1234567890128
    expect(resolveScanValue("01234567890128", "databar_omni")).toBe("1234567890128");
  });

  it("keeps a GTIN-14 with a packaging indicator digit whole", () => {
    expect(resolveScanValue("10036632001259", "databar_limited")).toBe("10036632001259");
  });

  it("does not read a PLU out of a GTIN-14 whose check digit is wrong", () => {
    expect(resolveScanValue("00000000049598", "databar")).toBe("000000049598");
  });

  it("leaves non-DataBar formats alone", () => {
    expect(resolveScanValue("036632001252", "upc_a")).toBe("036632001252");
    expect(resolveScanValue("00000000049597", "code_128")).toBe("00000000049597");
  });

  it("returns a DataBar value that is not a GTIN as it was read", () => {
    expect(resolveScanValue("ABC", "databar_expanded")).toBe("ABC");
  });
});

describe("isDataBarFormat", () => {
  it("is true for the DataBar names and false for the rest", () => {
    expect(isDataBarFormat("databar_expanded_stacked")).toBe(true);
    expect(isDataBarFormat("ean_13")).toBe(false);
  });
});

describe("GROCERY_FORMATS", () => {
  it("includes every DataBar format the ponyfill names", () => {
    expect(GROCERY_FORMATS).toEqual(
      expect.arrayContaining([
        "databar",
        "databar_omni",
        "databar_stacked",
        "databar_stacked_omni",
        "databar_expanded",
        "databar_expanded_stacked",
        "databar_limited",
      ]),
    );
  });
});
