import { Blob } from "node:buffer";
import {
  captureStill,
  fitWithin,
  shrinkToLimit,
  MAX_LONG_SIDE,
  MAX_STILL_BYTES,
  RECEIPT_STILL,
} from "./capture-still";

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

describe("captureStill with a digital zoom", () => {
  function fakeVideo(width: number, height: number) {
    return { videoWidth: width, videoHeight: height } as unknown as HTMLVideoElement;
  }

  function stubCanvas() {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (done: (blob: globalThis.Blob | null) => void) => done(blobOf(1000)),
    };
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : real(tag),
    );
    return { drawImage, canvas };
  }

  afterEach(() => vi.restoreAllMocks());

  it("draws the whole frame when not zoomed, at most 1600 px on the long side", async () => {
    const { drawImage, canvas } = stubCanvas();
    await captureStill(fakeVideo(3200, 1800));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 3200, 1800, 0, 0, 1600, 900);
    expect(canvas.width).toBe(1600);
  });

  it("draws only the middle of the frame when zoomed, which is what the screen showed", async () => {
    const { drawImage, canvas } = stubCanvas();
    await captureStill(fakeVideo(1920, 1080), { zoom: 2 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 480, 270, 960, 540, 0, 0, 960, 540);
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(540);
  });

  it("still holds the 1600 px cap on a cropped picture", async () => {
    const { canvas } = stubCanvas();
    await captureStill(fakeVideo(4000, 3000), { zoom: 1.5 });
    expect(Math.max(canvas.width, canvas.height)).toBe(1600);
  });
});
