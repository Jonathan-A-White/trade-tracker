import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { RECEIPT_STILL, captureStill, stillFromFile } from "@/scanner/capture-still";
import { useCameraStream } from "@/hooks/use-camera-stream";
import { useCameraZoomFocus } from "@/hooks/use-camera-zoom-focus";

interface ReceiptCameraProps {
  /** Photos already taken, counting toward the limit. */
  taken: number;
  maxPhotos: number;
  onTake: (photo: Blob) => void;
  onClose: () => void;
}

/**
 * A full-screen camera for a receipt: take a photo, take another for a long receipt, then Done. It opens the way the
 * item photo page does (high resolution, continuous focus, tap to focus, pinch zoom); Use phone camera hands the shot to
 * the phone's own camera app instead.
 */
export function ReceiptCamera({ taken, maxPhotos, onTake, onClose }: ReceiptCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const phoneCameraInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { attachTrack, digitalZoom, focusRing, handlers } = useCameraZoomFocus(videoRef, "receipt");
  const onCameraFailed = useCallback(
    () => setError("The camera would not open. You can choose a photo instead."),
    [],
  );
  useCameraStream(videoRef, attachTrack, onCameraFailed);

  async function handleTake() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setError(null);
    try {
      onTake(await captureStill(video, { ...RECEIPT_STILL, zoom: digitalZoom }));
    } catch (err) {
      console.error("Failed to take a photo:", err);
      setError("Could not take that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoneCameraFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      onTake(await stillFromFile(file, RECEIPT_STILL));
    } catch (err) {
      console.error("Failed to read the phone camera's photo:", err);
      setError("Could not use that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const button =
    "rounded-lg px-4 py-3 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      data-testid="receipt-camera"
      className="fixed inset-0 z-50 bg-black overflow-hidden touch-none"
      {...handlers}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={digitalZoom > 1 ? { transform: `scale(${digitalZoom})` } : undefined}
        playsInline
        muted
      />
      {focusRing && (
        <div
          key={focusRing.id}
          data-testid="focus-ring"
          className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90"
          style={{ left: focusRing.x, top: focusRing.y }}
        />
      )}
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
        <button
          type="button"
          onClick={() => phoneCameraInput.current?.click()}
          disabled={busy || taken >= maxPhotos}
          className="w-full text-center text-sm text-white/80 hover:text-white py-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Use phone camera
        </button>
        <input
          ref={phoneCameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoneCameraFile}
          className="hidden"
          data-testid="phone-camera-input"
        />
      </div>
    </div>
  );
}
