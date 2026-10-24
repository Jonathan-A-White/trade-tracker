import { BarcodeDetector } from "barcode-detector/ponyfill";
import { resolveScanValue } from "./scan-value";

export const GROCERY_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39",
  "databar", "databar_omni", "databar_stacked", "databar_stacked_omni",
  "databar_expanded", "databar_expanded_stacked", "databar_limited",
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
  if (barcodes.length === 0) return null;
  const { rawValue, format } = barcodes[0];
  return resolveScanValue(rawValue, format);
}

export async function isCameraAvailable(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
}
