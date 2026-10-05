import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { useFactory } from "@/contexts/factory-context";
import { captureStill } from "@/scanner/capture-still";

const pendingLookupRepo = new PendingLookupRepository();

export default function PhotoCapturePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const barcode = searchParams.get("barcode") ?? "";
  const { door } = useFactory();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  // The scanner has just released the camera; the permission is already granted, so this opens at once.
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
        if (!cancelled) setError("The camera would not open. You can type it instead.");
      }
    }

    openCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const save = useCallback(
    async (taken: Blob[]) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setBusy(true);
      try {
        const trip = await db.trips.where("status").equals("active").first();
        if (!trip) throw new Error("No active trip");
        await pendingLookupRepo.create({ barcode, tripId: trip.id, photos: taken });
        navigate("/trips/active/scan", { replace: true });
      } catch (err) {
        console.error("Failed to save the photos:", err);
        setError("Could not save the photos. Please try again.");
        savingRef.current = false;
        setBusy(false);
      }
    },
    [barcode, navigate],
  );

  const handleTake = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setError(null);
    try {
      const still = await captureStill(video);
      setPhotos((prev) => [...prev, still]);
    } catch (err) {
      console.error("Failed to take a photo:", err);
      setError("Could not take that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleTypeInstead = useCallback(() => {
    navigate(`/trips/active/add?barcode=${encodeURIComponent(barcode)}`, { replace: true });
  }, [barcode, navigate]);

  const handleCancel = useCallback(() => {
    navigate("/trips/active/scan", { replace: true });
  }, [navigate]);

  const step = photos.length === 0 ? "package" : "tag";
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

      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4 pr-16">
        <h1 className="text-lg font-semibold text-white">
          {step === "package" ? "Package" : "Shelf tag (optional)"}
        </h1>
        <p className="text-sm text-white/80">Barcode {barcode}</p>
        {door !== "licensed" && (
          <p className="mt-1 text-sm text-amber-300">
            Waiting for a licence: the lookup is kept and sent once the factory is ready.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleCancel}
        className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors cursor-pointer"
        aria-label="Cancel"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="absolute bottom-0 left-0 right-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4 pb-8">
        {step === "tag" && (
          <p className="text-center text-sm text-white/80">
            {photos.length} photo{photos.length === 1 ? "" : "s"} taken
          </p>
        )}
        <div className="flex gap-3">
          {step === "tag" && photos.length < 2 && (
            <button
              type="button"
              onClick={() => save(photos)}
              disabled={busy}
              className={`${button} flex-1 border border-white/60 text-white hover:bg-white/10`}
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={handleTake}
            disabled={busy || photos.length >= 2}
            className={`${button} flex-1 bg-blue-600 text-white hover:bg-blue-700`}
          >
            Take photo
          </button>
          {step === "tag" && (
            <button
              type="button"
              onClick={() => save(photos)}
              disabled={busy}
              className={`${button} flex-1 bg-green-600 text-white hover:bg-green-700`}
            >
              Done
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleTypeInstead}
          className="w-full text-center text-sm text-white/80 hover:text-white py-1 cursor-pointer"
        >
          Type it instead
        </button>
      </div>
    </div>
  );
}
