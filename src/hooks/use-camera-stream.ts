import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { PHOTO_VIDEO_CONSTRAINTS, openCameraStream } from "@/scanner/camera-controls";

/**
 * Opens the rear camera for a picture to be read (the photo page, the receipt camera) in the video element:
 * the high-resolution constraints, then `attachTrack` (from useCameraZoomFocus) for continuous focus,
 * tap to focus and zoom. The camera is released when the screen goes. `onFail` runs when it will not open.
 */
export function useCameraStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  attachTrack: (track: MediaStreamTrack | null) => void,
  onFail: () => void,
) {
  // read when the camera fails, so a new callback does not reopen the camera
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onFailRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function openCamera() {
      try {
        stream = await openCameraStream(PHOTO_VIDEO_CONSTRAINTS);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const tracks = stream.getTracks();
        attachTrack(tracks.find((t) => t.kind === "video") ?? tracks[0] ?? null);
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
      } catch {
        if (!cancelled) onFailRef.current();
      }
    }

    openCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attachTrack, videoRef]);
}
