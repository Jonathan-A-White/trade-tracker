import {
  PHOTO_VIDEO_CONSTRAINTS,
  MAX_DIGITAL_ZOOM,
  clampZoom,
  digitalCrop,
  focusAt,
  keepFocusContinuous,
  pointInVideo,
  readZoomRange,
  setHardwareZoom,
  zoomFromPinch,
  type ZoomableTrack,
} from "./camera-controls";

function fakeTrack(
  capabilities: Record<string, unknown> | null,
  settings: Record<string, unknown> = {},
) {
  const applyConstraints = vi.fn(async () => {});
  const track: ZoomableTrack = {
    getCapabilities: capabilities === null ? undefined : () => capabilities,
    getSettings: () => settings,
    applyConstraints,
  };
  return { track, applyConstraints };
}

describe("PHOTO_VIDEO_CONSTRAINTS", () => {
  it("asks for the rear camera at 1920x1080 or better, as ideals and never a hard minimum", () => {
    const video = PHOTO_VIDEO_CONSTRAINTS.video as MediaTrackConstraints;
    expect(video.facingMode).toBe("environment");
    expect(video.width).toEqual({ ideal: 1920 });
    expect(video.height).toEqual({ ideal: 1080 });
    expect(JSON.stringify(video)).not.toMatch(/"min"|"exact"/);
  });
});

describe("readZoomRange", () => {
  it("reads min, max and step from a track that can zoom", () => {
    const { track } = fakeTrack({ zoom: { min: 1, max: 8, step: 0.1 } });
    expect(readZoomRange(track)).toEqual({ min: 1, max: 8, step: 0.1 });
  });

  it("is null when the track has no zoom, no capabilities, or a range that cannot zoom in", () => {
    expect(readZoomRange(fakeTrack({ focusMode: ["continuous"] }).track)).toBeNull();
    expect(readZoomRange(fakeTrack(null).track)).toBeNull();
    expect(readZoomRange(fakeTrack({ zoom: { min: 1, max: 1, step: 0.1 } }).track)).toBeNull();
    expect(readZoomRange(null)).toBeNull();
  });
});

describe("clampZoom", () => {
  it("stays within min and max and snaps to the step", () => {
    const range = { min: 1, max: 4, step: 0.5 };
    expect(clampZoom(0.2, range)).toBe(1);
    expect(clampZoom(9, range)).toBe(4);
    expect(clampZoom(2.3, range)).toBe(2.5);
    expect(clampZoom(2.2, range)).toBe(2);
  });

  it("does not snap when the step is zero", () => {
    expect(clampZoom(2.337, { min: 1, max: 4, step: 0 })).toBe(2.337);
  });
});

describe("zoomFromPinch", () => {
  it("scales the zoom by how far the fingers have moved apart", () => {
    expect(zoomFromPinch(1, 100, 200, { min: 1, max: 5, step: 0 })).toBe(2);
    expect(zoomFromPinch(2, 200, 100, { min: 1, max: 5, step: 0 })).toBe(1);
  });

  it("is clamped, and ignores a pinch that started with the fingers together", () => {
    expect(zoomFromPinch(1, 100, 900, { min: 1, max: 5, step: 0 })).toBe(5);
    expect(zoomFromPinch(3, 0, 50, { min: 1, max: 5, step: 0 })).toBe(3);
  });
});

describe("setHardwareZoom", () => {
  it("applies the zoom through applyConstraints as an advanced constraint", async () => {
    const { track, applyConstraints } = fakeTrack({ zoom: { min: 1, max: 8, step: 0.1 } });
    expect(await setHardwareZoom(track, 3)).toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] });
  });

  it("stays inside the track's range", async () => {
    const { track, applyConstraints } = fakeTrack({ zoom: { min: 1, max: 4, step: 1 } });
    await setHardwareZoom(track, 10);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 4 }] });
  });

  it("does nothing, and says so, on a track without zoom", async () => {
    const { track, applyConstraints } = fakeTrack({});
    expect(await setHardwareZoom(track, 3)).toBe(false);
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  it("says no when the camera refuses", async () => {
    const { track, applyConstraints } = fakeTrack({ zoom: { min: 1, max: 4, step: 1 } });
    applyConstraints.mockRejectedValueOnce(new Error("OverconstrainedError"));
    expect(await setHardwareZoom(track, 2)).toBe(false);
  });
});

describe("keepFocusContinuous", () => {
  it("asks for continuous focus where the track supports it", async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ["manual", "continuous"] });
    expect(await keepFocusContinuous(track)).toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] });
  });

  it("does nothing where it does not", async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ["manual"] });
    expect(await keepFocusContinuous(track)).toBe(false);
    expect(await keepFocusContinuous(fakeTrack(null).track)).toBe(false);
    expect(await keepFocusContinuous(null)).toBe(false);
    expect(applyConstraints).not.toHaveBeenCalled();
  });
});

describe("focusAt", () => {
  it("focuses at the point (0..1 of the picture) with continuous focus when the track has it", async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ["single-shot", "continuous"] });
    expect(await focusAt(track, { x: 0.25, y: 0.75 })).toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ pointsOfInterest: [{ x: 0.25, y: 0.75 }], focusMode: "continuous" }],
    });
  });

  it("falls back to a single shot of focus", async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ["single-shot"] });
    await focusAt(track, { x: 0.5, y: 0.5 });
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ pointsOfInterest: [{ x: 0.5, y: 0.5 }], focusMode: "single-shot" }],
    });
  });

  it("sends just the point where the track only reports pointsOfInterest in its settings", async () => {
    const { track, applyConstraints } = fakeTrack({}, { pointsOfInterest: [] });
    expect(await focusAt(track, { x: 0.1, y: 0.2 })).toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ pointsOfInterest: [{ x: 0.1, y: 0.2 }] }],
    });
  });

  it("does nothing, and breaks nothing, where the track cannot focus", async () => {
    const { track, applyConstraints } = fakeTrack({});
    expect(await focusAt(track, { x: 0.5, y: 0.5 })).toBe(false);
    expect(await focusAt(fakeTrack(null).track, { x: 0.5, y: 0.5 })).toBe(false);
    expect(await focusAt(null, { x: 0.5, y: 0.5 })).toBe(false);
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  it("swallows a refusal from the camera", async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ["continuous"] });
    applyConstraints.mockRejectedValueOnce(new Error("nope"));
    expect(await focusAt(track, { x: 0.5, y: 0.5 })).toBe(false);
  });
});

describe("pointInVideo", () => {
  it("maps a tap on a same-shaped box straight across", () => {
    const box = { left: 0, top: 0, width: 400, height: 200 };
    expect(pointInVideo(100, 150, box, { width: 1600, height: 800 }, 1)).toEqual({
      x: 0.25,
      y: 0.75,
    });
  });

  it("allows for object-cover cropping the sides of a wide picture shown in a tall box", () => {
    // 1600x800 shown in a 200x200 box: scaled to 400x200, the middle 200 px is visible
    const box = { left: 0, top: 0, width: 200, height: 200 };
    const centre = pointInVideo(100, 100, box, { width: 1600, height: 800 }, 1);
    expect(centre.x).toBeCloseTo(0.5);
    const rightEdge = pointInVideo(200, 100, box, { width: 1600, height: 800 }, 1);
    expect(rightEdge.x).toBeCloseTo(0.75);
  });

  it("allows for a digital zoom into the middle", () => {
    const box = { left: 0, top: 0, width: 400, height: 200 };
    const corner = pointInVideo(400, 200, box, { width: 400, height: 200 }, 2);
    expect(corner.x).toBeCloseTo(0.75);
    expect(corner.y).toBeCloseTo(0.75);
  });

  it("is the middle while the video has no size yet", () => {
    const box = { left: 0, top: 0, width: 400, height: 200 };
    expect(pointInVideo(10, 10, box, { width: 0, height: 0 }, 1)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("digitalCrop", () => {
  it("is the whole frame at 1x", () => {
    expect(digitalCrop(1600, 900, 1)).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
  });

  it("is the middle of the frame when zoomed", () => {
    expect(digitalCrop(1600, 900, 2)).toEqual({ sx: 400, sy: 225, sw: 800, sh: 450 });
  });

  it("never zooms out", () => {
    expect(digitalCrop(1600, 900, 0.5)).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
  });
});

it("a digital zoom is capped", () => {
  expect(MAX_DIGITAL_ZOOM).toBeGreaterThanOrEqual(3);
});
