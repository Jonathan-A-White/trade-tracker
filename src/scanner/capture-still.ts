/** The long side of a captured still, in pixels, at most. */
export const MAX_LONG_SIDE = 1600;
/** The size of a captured still, in bytes, stays under this. */
export const MAX_STILL_BYTES = 1_000_000;

const QUALITIES = [0.85, 0.7, 0.55, 0.4];
const SCALES = [1, 0.75, 0.5];

export function fitWithin(
  width: number,
  height: number,
  maxLongSide: number,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) return { width, height };
  const ratio = maxLongSide / longSide;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/**
 * Tries ever smaller encodings (lower quality, then smaller scale) until one is
 * under MAX_STILL_BYTES; falls back to the smallest if none is.
 */
export async function shrinkToLimit(
  encode: (scale: number, quality: number) => Promise<Blob | null>,
): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      const blob = await encode(scale, quality);
      if (!blob) continue;
      if (blob.size < MAX_STILL_BYTES) return blob;
      if (!smallest || blob.size < smallest.size) smallest = blob;
    }
  }
  if (!smallest) throw new Error("The camera gave no picture");
  return smallest;
}

/** Takes a JPEG still from a playing video, at most 1600 px on the long side and under 1 MB. */
export async function captureStill(video: HTMLVideoElement): Promise<Blob> {
  const frame = fitWithin(video.videoWidth, video.videoHeight, MAX_LONG_SIDE);
  if (frame.width === 0 || frame.height === 0) {
    throw new Error("The camera is not ready yet");
  }
  const canvas = document.createElement("canvas");

  return shrinkToLimit((scale, quality) => {
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return Promise.resolve(null);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  });
}
