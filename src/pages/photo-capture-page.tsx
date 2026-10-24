import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAlive } from "pwa-kit/alive";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { useFactory } from "@/contexts/factory-context";
import { captureStill } from "@/scanner/capture-still";
import { useCameraStream } from "@/hooks/use-camera-stream";
import { useCameraZoomFocus } from "@/hooks/use-camera-zoom-focus";

const pendingLookupRepo = new PendingLookupRepository();

export default function PhotoCapturePage() {
  const navigate = useNavigate();
  const alive = useAlive();
  const [searchParams] = useSearchParams();
  // on an ended trip's Edit page the route names the trip; on the live trip it does not
  const { id: tripIdParam } = useParams<{ id: string }>();
  const basePath = tripIdParam ? `/trips/${tripIdParam}/edit` : "/trips/active";
  const barcode = searchParams.get("barcode") ?? "";
  const priceOnlyItemId =
    searchParams.get("mode") === "price-only" ? searchParams.get("itemId") : null;
  const priceOnly = priceOnlyItemId !== null;
  // only an in-app path is followed back; anything else goes to the trip
  const fromParam = searchParams.get("from");
  const backTo =
    fromParam && fromParam.startsWith("/") && !fromParam.startsWith("//")
      ? fromParam
      : basePath;
  const { door } = useFactory();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [photos, setPhotos] = useState<Blob[]>([]);
  // the shot just taken, shown for Retake / Use photo before anything is kept
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const { attachTrack, digitalZoom, focusRing, handlers } = useCameraZoomFocus(videoRef, barcode);

  // The scanner has just released the camera; the permission is already granted, so this opens at once.
  const onCameraFailed = useCallback(
    () => setError("The camera would not open. You can type it instead."),
    [],
  );
  useCameraStream(videoRef, attachTrack, onCameraFailed);

  useEffect(() => {
    if (!preview) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const save = useCallback(
    async (taken: Blob[]) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setBusy(true);
      try {
        const trip = tripIdParam
          ? await db.trips.get(tripIdParam)
          : await db.trips.where("status").equals("active").first();
        if (!trip) throw new Error(tripIdParam ? "Trip not found" : "No active trip");
        if (priceOnlyItemId) {
          await pendingLookupRepo.create({
            barcode,
            tripId: trip.id,
            photos: taken,
            mode: "price-only",
            itemId: priceOnlyItemId,
          });
          navigate(backTo, { replace: true });
        } else {
          await pendingLookupRepo.create({ barcode, tripId: trip.id, photos: taken });
          navigate(`${basePath}/scan`, { replace: true });
        }
      } catch (err) {
        console.error("Failed to save the photos:", err);
        savingRef.current = false;
        if (alive()) {
          setError("Could not save the photos. Please try again.");
          setBusy(false);
        }
      }
    },
    [barcode, navigate, priceOnlyItemId, backTo, tripIdParam, basePath, alive],
  );

  const handleTake = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setError(null);
    try {
      const still = await captureStill(video, { zoom: digitalZoom });
      if (alive()) setPreview(still);
    } catch (err) {
      console.error("Failed to take a photo:", err);
      if (alive()) setError("Could not take that photo. Try again.");
    } finally {
      if (alive()) setBusy(false);
    }
  }, [busy, digitalZoom, alive]);

  const handleRetake = useCallback(() => setPreview(null), []);

  const handleUse = useCallback(async () => {
    if (!preview || busy) return;
    if (priceOnly) {
      // one shot: the tag photo goes into the lookup; the preview stays up if saving fails
      await save([preview]);
      return;
    }
    if (photos.length >= 1) {
      // the tag is the last shot allowed: both photos go at once, with no Done to tap
      await save([...photos, preview]);
      return;
    }
    setPhotos([preview]);
    setPreview(null);
  }, [preview, busy, priceOnly, photos, save]);

  const handleTypeInstead = useCallback(() => {
    navigate(`${basePath}/add?barcode=${encodeURIComponent(barcode)}`, { replace: true });
  }, [barcode, navigate, basePath]);

  const handleCancel = useCallback(() => {
    navigate(priceOnly ? backTo : `${basePath}/scan`, { replace: true });
  }, [navigate, priceOnly, backTo, basePath]);

  const step = photos.length === 0 ? "package" : "tag";
  // the camera wants the package first, then (optionally) the shelf tag; a known item's price wants the tag only
  const wantsTag = priceOnly || step === "tag";
  const button =
    "rounded-lg px-4 py-3 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <>
      <div
        data-testid="photo-camera"
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

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            data-testid="photo-frame"
            data-frame={wantsTag ? "wide" : "tall"}
            className={
              wantsTag
                ? "w-[88%] aspect-[3/1] rounded-lg border-4 border-dashed border-amber-400"
                : "h-[55%] aspect-[3/4] rounded-2xl border-4 border-solid border-white/90"
            }
          />
        </div>

        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4 pr-16">
          <h1
            className={`text-2xl font-bold leading-tight ${wantsTag ? "text-amber-300" : "text-white"}`}
          >
            {wantsTag ? "Photo of the PRICE TAG (on the shelf)" : "Photo of the PACKAGE (front, name showing)"}
          </h1>
          {!priceOnly && step === "tag" && (
            <p className="text-sm text-white/80">Optional: Skip if the tag is not handy</p>
          )}
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

        <div className="absolute bottom-0 left-0 right-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4 pb-[calc(var(--tt-bar-inset)+1rem)]">
          {!priceOnly && step === "tag" && (
            <p className="text-center text-sm text-white/80">
              {photos.length} photo{photos.length === 1 ? "" : "s"} taken
            </p>
          )}
          <div className="flex gap-3">
            {!priceOnly && step === "tag" && (
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
              disabled={busy}
              className={`${button} flex-1 text-white ${
                wantsTag ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              Take photo
            </button>
          </div>
          {!priceOnly && (
            <button
              type="button"
              onClick={handleTypeInstead}
              className="w-full text-center text-sm text-white/80 hover:text-white py-1 cursor-pointer"
            >
              Type it instead
            </button>
          )}
        </div>
      </div>
      {previewUrl && (
        <div
          data-testid="photo-preview"
          className="fixed inset-0 z-[60] flex flex-col bg-black"
        >
          <img
            src={previewUrl}
            alt="The photo you just took"
            className="min-h-0 flex-1 w-full object-contain"
          />
          <div className="flex gap-3 p-4 pb-[calc(var(--tt-bar-inset)+1rem)]">
            <button
              type="button"
              onClick={handleRetake}
              disabled={busy}
              className={`${button} flex-1 border border-white/60 text-white hover:bg-white/10`}
            >
              Retake
            </button>
            <button
              type="button"
              onClick={handleUse}
              disabled={busy}
              className={`${button} flex-1 bg-green-600 text-white hover:bg-green-700`}
            >
              Use photo
            </button>
          </div>
        </div>
      )}
    </>
  );
}