import { BarcodeDetector } from "barcode-detector/ponyfill";

const GROCERY_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39",
] as const;

let detector: InstanceType<typeof BarcodeDetector> | null = null;

export async function initScanner(): Promise<void> {
  detector = new BarcodeDetector({ formats: [...GROCERY_FORMATS] });
}

export async function detectFromVideoFrame(
  video: HTMLVideoElement,
): Promise<string | null> {
  if (!detector) throw new Error("Scanner not initialized");
  const barcodes = await detector.detect(video);
  return barcodes.length > 0 ? barcodes[0].rawValue : null;
}

export async function isCameraAvailable(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
}
