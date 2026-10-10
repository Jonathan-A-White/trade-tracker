import { useEffect, useRef, useState } from "react";
import { RECEIPT_STILL, captureStill } from "@/scanner/capture-still";

interface ReceiptCameraProps {
  /** Photos already taken, counting toward the limit. */
  taken: number;
  maxPhotos: number;
  onTake: (photo: Blob) => void;
  onClose: () => void;
}

/** A full-screen camera for a receipt: take a photo, take another for a long receipt, then Done. */
export function ReceiptCamera({ taken, maxPhotos, onTake, onClose }: ReceiptCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function openCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
      } catch {
        if (!cancelled) setError("The camera would not open. You can choose a photo instead.");
      }
    }

    openCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handleTake() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setError(null);
    try {
      onTake(await captureStill(video, RECEIPT_STILL));
    } catch (err) {
      console.error("Failed to take a photo:", err);
      setError("Could not take that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const button =
    "rounded-lg px-4 py-3 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4">
        <h1 className="text-lg font-semibold text-white">Receipt</h1>
        <p className="text-sm text-white/80">
          Fill the screen with the receipt. A long one can be shot in up to {maxPhotos} parts.
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4 pb-8">
        {taken > 0 && (
          <p className="text-center text-sm text-white/80">
            {taken} photo{taken === 1 ? "" : "s"} taken
          </p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className={`${button} flex-1 border border-white/60 text-white hover:bg-white/10`}
          >
            {taken > 0 ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleTake}
            disabled={busy || taken >= maxPhotos}
            className={`${button} flex-1 bg-blue-600 text-white hover:bg-blue-700`}
          >
            Take photo
          </button>
        </div>
      </div>
    </div>
  );
}
