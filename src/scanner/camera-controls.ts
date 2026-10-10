/**
 * What the photo camera asks of the rear camera, and the zoom and focus controls
 * for its live picture. Everything here tolerates a track that cannot do a thing:
 * it does nothing and says so, and never throws.
 */

/** The photo page asks for the camera's high resolution as ideals; a phone that cannot give it still opens. */
export const PHOTO_VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: "environment",
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

/** How far the picture is cropped in when the camera has no zoom of its own. */
export const MAX_DIGITAL_ZOOM = 4;

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export interface FocusPoint {
  x: number;
  y: number;
}

interface RangeCapability {
  min?: number;
  max?: number;
  step?: number;
}

interface CameraCapabilities {
  zoom?: RangeCapability;
  focusMode?: string[];
  pointsOfInterest?: unknown;
}

/** The part of a MediaStreamTrack these controls use (zoom and focus are not in TypeScript's DOM types). */
export interface ZoomableTrack {
  getCapabilities?: () => unknown;
  getSettings?: () => unknown;
  applyConstraints: (constraints: { advanced: Record<string, unknown>[] }) => Promise<void>;
}

function capabilitiesOf(track: ZoomableTrack | null): CameraCapabilities {
  try {
    return (track?.getCapabilities?.() as CameraCapabilities | undefined) ?? {};
  } catch {
    return {};
  }
}

function settingsOf(track: ZoomableTrack | null): Record<string, unknown> {
  try {
    return (track?.getSettings?.() as Record<string, unknown> | undefined) ?? {};
  } catch {
    return {};
  }
}

/** The camera's own zoom range, or null when the track cannot zoom. */
export function readZoomRange(track: ZoomableTrack | null): ZoomRange | null {
  const zoom = capabilitiesOf(track).zoom;
  if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number") return null;
  if (!(zoom.max > zoom.min)) return null;
  return { min: zoom.min, max: zoom.max, step: zoom.step ?? 0 };
}

/** Keeps a zoom inside the range and on a step the camera accepts. */
export function clampZoom(value: number, range: ZoomRange): number {
  const stepped =
    range.step > 0
      ? range.min + Math.round((value - range.min) / range.step) * range.step
      : value;
  const clamped = Math.min(range.max, Math.max(range.min, stepped));
  // steps like 0.1 leave float dust (2.5000000000000004)
  return Math.round(clamped * 1e6) / 1e6;
}

/** The zoom after a pinch: the zoom at its start, scaled by how far the fingers have spread. */
export function zoomFromPinch(
  startZoom: number,
  startDistance: number,
  distance: number,
  range: ZoomRange,
): number {
  if (startDistance <= 0) return startZoom;
  return clampZoom(startZoom * (distance / startDistance), range);
}

/** Zooms the camera itself. False when it cannot or would not. */
export async function setHardwareZoom(track: ZoomableTrack | null, zoom: number): Promise<boolean> {
  const range = readZoomRange(track);
  if (!track || !range) return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom: clampZoom(zoom, range) }] });
    return true;
  } catch {
    return false;
  }
}

/** Asks for continuous focus where the track has it. */
export async function keepFocusContinuous(track: ZoomableTrack | null): Promise<boolean> {
  if (!track || !capabilitiesOf(track).focusMode?.includes("continuous")) return false;
  try {
    await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    return true;
  } catch {
    return false;
  }
}

/** Focuses where the picture was tapped (x and y are 0..1 of the picture), where the track can. */
export async function focusAt(track: ZoomableTrack | null, point: FocusPoint): Promise<boolean> {
  if (!track) return false;
  const capabilities = capabilitiesOf(track);
  const modes = capabilities.focusMode ?? [];
  const mode = modes.includes("continuous")
    ? "continuous"
    : modes.includes("single-shot")
      ? "single-shot"
      : null;
  const hasPoints =
    "pointsOfInterest" in capabilities || "pointsOfInterest" in settingsOf(track);
  if (!mode && !hasPoints) return false;
  const constraint: Record<string, unknown> = { pointsOfInterest: [point] };
  if (mode) constraint.focusMode = mode;
  try {
    await track.applyConstraints({ advanced: [constraint] });
    return true;
  } catch {
    return false;
  }
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where in the camera's picture (0..1) a tap on the screen landed, allowing for the
 * video being shown object-cover in its box and for a digital zoom into the middle.
 */
export function pointInVideo(
  clientX: number,
  clientY: number,
  box: Box,
  video: { width: number; height: number },
  digitalZoom: number,
): FocusPoint {
  if (video.width === 0 || video.height === 0 || box.width === 0 || box.height === 0) {
    return { x: 0.5, y: 0.5 };
  }
  const zoom = Math.max(1, digitalZoom);
  const boxX = 0.5 + ((clientX - box.left) / box.width - 0.5) / zoom;
  const boxY = 0.5 + ((clientY - box.top) / box.height - 0.5) / zoom;
  const scale = Math.max(box.width / video.width, box.height / video.height);
  const shownWidth = video.width * scale;
  const shownHeight = video.height * scale;
  const x = (boxX * box.width - (box.width - shownWidth) / 2) / shownWidth;
  const y = (boxY * box.height - (box.height - shownHeight) / 2) / shownHeight;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** The middle part of a frame that a digital zoom shows. */
export function digitalCrop(
  width: number,
  height: number,
  zoom: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const z = Math.max(1, zoom);
  const sw = width / z;
  const sh = height / z;
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh };
}
