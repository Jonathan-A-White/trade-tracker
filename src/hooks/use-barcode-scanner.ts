import { useState, useCallback, useRef, useEffect } from "react";
import { initScanner, detectFromVideoFrame, isCameraAvailable } from "@/scanner/camera-scanner";

type ScannerStatus = "idle" | "requesting" | "active" | "denied" | "unavailable" | "error";

export function useBarcodeScanner() {
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);

  const startScanning = useCallback(async (videoElement: HTMLVideoElement) => {
    videoRef.current = videoElement;
    setStatus("requesting");

    const hasCamera = await isCameraAvailable();
    if (!hasCamera) {
      setStatus("unavailable");
      return;
    }

    try {
      await initScanner();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      videoElement.srcObject = stream;
      await videoElement.play();
      setStatus("active");

      intervalRef.current = window.setInterval(async () => {
        try {
          const result = await detectFromVideoFrame(videoElement);
          if (result) {
            setLastResult(result);
          }
        } catch {
          // ignore detection errors
        }
      }, 200);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setStatus("denied");
      } else {
        setStatus("error");
      }
    }
  }, []);

  const stopScanning = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus("idle");
  }, []);

  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  useEffect(() => {
    return () => stopScanning();
  }, [stopScanning]);

  return { status, lastResult, startScanning, stopScanning, clearResult };
}
