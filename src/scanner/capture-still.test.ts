import { Blob } from "node:buffer";
import { fitWithin, shrinkToLimit, MAX_LONG_SIDE, MAX_STILL_BYTES, RECEIPT_STILL } from "./capture-still";

function blobOf(size: number): globalThis.Blob {
  return new Blob([new Uint8Array(size)], { type: "image/jpeg" }) as unknown as globalThis.Blob;
}

describe("fitWithin", () => {
  it("leaves a small frame alone", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape frame so the long side is the limit", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait frame so the long side is the limit", () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("limits the long side to 1600 px", () => {
    expect(MAX_LONG_SIDE).toBe(1600);
  });
});

describe("shrinkToLimit", () => {
  it("returns the first encoding that is small enough", async () => {
    const encode = vi.fn(async () => blobOf(500_000));
    const result = await shrinkToLimit(encode);
    expect(result.size).toBe(500_000);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("lowers quality, then scale, until under 1 MB", async () => {
    const encode = vi.fn(async (scale: number, quality: number) =>
      blobOf(scale === 1 && quality > 0.5 ? 2_000_000 : 900_000),
    );
    const result = await shrinkToLimit(encode);
    expect(result.size).toBeLessThan(MAX_STILL_BYTES);
    expect(encode.mock.calls.length).toBeGreaterThan(1);
  });

  it("rejects when the camera gives nothing", async () => {
    await expect(shrinkToLimit(async () => null)).rejects.toThrow();
  });
});

describe("a receipt still", () => {
  it("may be 2400 px on the long side and up to 3 MB, under the grind's 4 MB", () => {
    expect(RECEIPT_STILL.maxLongSide).toBe(2400);
    expect(RECEIPT_STILL.maxBytes).toBe(3_000_000);
    expect(fitWithin(4000, 3000, RECEIPT_STILL.maxLongSide!)).toEqual({ width: 2400, height: 1800 });
  });

  it("shrinks to the size given instead of 1 MB", async () => {
    const encode = vi.fn(async () => blobOf(2_000_000));
    const result = await shrinkToLimit(encode, RECEIPT_STILL.maxBytes);
    expect(result.size).toBe(2_000_000);
    expect(encode).toHaveBeenCalledTimes(1);
  });
});
