import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  MAX_DIGITAL_ZOOM,
  clampZoom,
  focusAt,
  keepFocusContinuous,
  pointInVideo,
  readZoomRange,
  setHardwareZoom,
  zoomFromPinch,
  type ZoomRange,
  type ZoomableTrack,
} from "@/scanner/camera-controls";

/** A finger that moves further than this (px) between down and up is not a tap. */
const TAP_SLOP = 10;
/** How long the focus ring stays on the picture. */
const FOCUS_RING_MS = 900;

const DIGITAL_RANGE: ZoomRange = { min: 1, max: MAX_DIGITAL_ZOOM, step: 0 };

interface Point {
  x: number;
  y: number;
}

interface Gesture {
  start: Point;
  moved: boolean;
  pinched: boolean;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pinch to zoom and tap to focus on a live camera picture. Where the track can zoom,
 * the camera zooms; elsewhere `digitalZoom` is how far to crop in (the CSS scale of the
 * video, and the `zoom` for captureStill). Zoom goes back to its start when `resetKey` changes.
 */
export function useCameraZoomFocus(videoRef: RefObject<HTMLVideoElement | null>, resetKey: string) {
  const trackRef = useRef<ZoomableTrack | null>(null);
  const [range, setRange] = useState<ZoomRange | null>(null);
  const [zoomState, setZoomState] = useState({ key: resetKey, value: 1 });
  const [focusRing, setFocusRing] = useState<(Point & { id: number }) | null>(null);

  const base = range?.min ?? 1;
  const zoom = zoomState.key === resetKey ? zoomState.value : base;
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  // read by attachTrack, which stays the same function so the page does not reopen the camera for a new item
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    resetKeyRef.current = resetKey;
  }, [resetKey]);

  const pointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ringId = useRef(0);

  // a new item starts unzoomed, camera zoom included
  useEffect(() => {
    void setHardwareZoom(trackRef.current, readZoomRange(trackRef.current)?.min ?? 1);
  }, [resetKey]);

  useEffect(() => () => clearTimeout(ringTimer.current), []);

  /** Call when the camera has opened. */
  const attachTrack = useCallback((track: MediaStreamTrack | null) => {
    const zoomable = track as unknown as ZoomableTrack | null;
    trackRef.current = zoomable;
    const cameraRange = readZoomRange(zoomable);
    setRange(cameraRange);
    const key = resetKeyRef.current;
    const value = cameraRange?.min ?? 1;
    setZoomState((prev) => (prev.key === key && prev.value === value ? prev : { key, value }));
    void keepFocusContinuous(zoomable);
  }, []);

  const applyZoom = useCallback(
    (value: number) => {
      setZoomState({ key: resetKey, value });
      if (range) void setHardwareZoom(trackRef.current, value);
    },
    [range, resetKey],
  );

  const tapToFocus = useCallback(async (at: Point) => {
    const video = videoRef.current;
    const track = trackRef.current;
    if (!video || !track) return;
    const box = video.getBoundingClientRect();
    const digital = readZoomRange(track) ? 1 : zoomRef.current;
    const point = pointInVideo(
      at.x,
      at.y,
      box,
      { width: video.videoWidth, height: video.videoHeight },
      digital,
    );
    if (!(await focusAt(track, point))) return;
    ringId.current += 1;
    setFocusRing({ ...at, id: ringId.current });
    clearTimeout(ringTimer.current);
    ringTimer.current = setTimeout(() => setFocusRing(null), FOCUS_RING_MS);
  }, [videoRef]);

  const onPointerDown = (event: ReactPointerEvent) => {
    if ((event.target as Element).closest?.("button")) return;
    const at = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size === 1) {
      gesture.current = { start: at, moved: false, pinched: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { distance: distance(a, b), zoom: zoomRef.current };
      if (gesture.current) gesture.current.pinched = true;
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    const at = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, at);
    const current = gesture.current;
    if (current && distance(current.start, at) > TAP_SLOP) current.moved = true;
    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const next = zoomFromPinch(
        pinchStart.current.zoom,
        pinchStart.current.distance,
        distance(a, b),
        range ?? DIGITAL_RANGE,
      );
      if (next !== zoomRef.current) {
        zoomRef.current = next;
        applyZoom(next);
      }
    }
  };

  const onPointerEnd = (event: ReactPointerEvent) => {
    const at = pointers.current.get(event.pointerId);
    if (!at) return;
    pointers.current.delete(event.pointerId);
    pinchStart.current = null;
    const current = gesture.current;
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (event.type === "pointerup" && current && !current.moved && !current.pinched) {
        void tapToFocus({ x: event.clientX, y: event.clientY });
      }
    }
  };

  return {
    attachTrack,
    zoom,
    /** How far to crop in: 1 when the camera zooms itself. */
    digitalZoom: range ? 1 : clampZoom(zoom, DIGITAL_RANGE),
    focusRing,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
