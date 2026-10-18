import { Blob } from "node:buffer";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReceiptCamera } from "./receipt-camera";
import { captureStill, stillFromFile } from "@/scanner/capture-still";

vi.mock("@/scanner/capture-still", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/scanner/capture-still")>()),
  captureStill: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
  stillFromFile: vi.fn(async () => new Blob(["from-phone-camera"], { type: "image/jpeg" })),
}));

// jsdom has no PointerEvent; a MouseEvent with a pointerId is enough for React's handlers
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
Object.defineProperty(window, "PointerEvent", { configurable: true, value: FakePointerEvent });

function openWith(capabilities: Record<string, unknown> | undefined) {
  const applyConstraints = vi.fn(async (constraints: unknown) => {
    void constraints;
  });
  const track = {
    kind: "video",
    stop: vi.fn(),
    getCapabilities: capabilities ? () => capabilities : undefined,
    getSettings: () => ({}),
    applyConstraints,
  };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  return { applyConstraints, getUserMedia };
}

function renderCamera(onTake: (photo: Blob) => void = () => {}) {
  return render(
    <ReceiptCamera taken={0} maxPhotos={3} onTake={onTake as (p: globalThis.Blob) => void} onClose={() => {}} />,
  );
}

describe("ReceiptCamera", () => {
  beforeEach(() => {
    vi.mocked(captureStill).mockClear();
    vi.mocked(stillFromFile).mockClear();
    // jsdom has no media playback
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 1080 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks for the rear camera at 1920x1080 as ideals, not a minimum", async () => {
    const { getUserMedia } = openWith({});
    renderCamera();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  });

  it("asks for continuous focus once open where the track supports it", async () => {
    const { applyConstraints } = openWith({ focusMode: ["manual", "continuous"] });
    renderCamera();
    await waitFor(() =>
      expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] }),
    );
  });

  it("opens, and shows no error, on a track with no focusMode or capabilities", async () => {
    const { applyConstraints } = openWith(undefined);
    renderCamera();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tapping the picture focuses there", async () => {
    const { applyConstraints } = openWith({ focusMode: ["continuous"] });
    renderCamera();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    applyConstraints.mockClear();
    const surface = screen.getByTestId("receipt-camera");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200, clientY: 400 });
    await waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(1));
    const [[constraints]] = applyConstraints.mock.calls as unknown as [
      [{ advanced: { pointsOfInterest: { x: number; y: number }[]; focusMode: string }[] }],
    ];
    expect(constraints.advanced[0].focusMode).toBe("continuous");
    expect(constraints.advanced[0].pointsOfInterest[0].x).toBeCloseTo(0.5);
    expect(constraints.advanced[0].pointsOfInterest[0].y).toBeCloseTo(0.5);
    expect(await screen.findByTestId("focus-ring")).toBeInTheDocument();
  });

  it("pinching zooms the camera where the track has zoom", async () => {
    const { applyConstraints } = openWith({ zoom: { min: 1, max: 8, step: 0.1 } });
    renderCamera();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    const surface = screen.getByTestId("receipt-camera");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 150, clientY: 400 });
    fireEvent.pointerDown(surface, { pointerId: 2, clientX: 250, clientY: 400 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 50, clientY: 400 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 350, clientY: 400 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 50, clientY: 400 });
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 350, clientY: 400 });
    const zooms = applyConstraints.mock.calls.map(
      ([c]) => (c as { advanced: { zoom?: number }[] }).advanced[0].zoom,
    );
    expect(zooms.at(-1)).toBeCloseTo(3);
  });

  it("a touch on a button is not a tap to focus", async () => {
    const { applyConstraints } = openWith({ focusMode: ["continuous"] });
    renderCamera();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    applyConstraints.mockClear();
    const button = screen.getByRole("button", { name: "Take photo" });
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 200, clientY: 400 });
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  it("offers the phone's own camera app as a file input that captures with the rear camera", () => {
    openWith({});
    renderCamera();
    expect(screen.getByRole("button", { name: "Use phone camera" })).toBeInTheDocument();
    const input = screen.getByTestId("phone-camera-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
  });

  it("a file from the phone camera goes the same way as a taken photo", async () => {
    openWith({});
    const onTake = vi.fn();
    renderCamera(onTake);
    const file = new File(["jpeg"], "IMG_1.jpg", { type: "image/jpeg" });
    await userEvent.setup().upload(screen.getByTestId("phone-camera-input"), file);
    await waitFor(() => expect(onTake).toHaveBeenCalledTimes(1));
    expect(stillFromFile).toHaveBeenCalledWith(file, expect.objectContaining({ maxLongSide: 2400 }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the phone camera's file cannot be read", async () => {
    openWith({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(stillFromFile).mockRejectedValueOnce(new Error("bad"));
    const onTake = vi.fn();
    renderCamera(onTake);
    const file = new File(["x"], "IMG_2.jpg", { type: "image/jpeg" });
    await userEvent.setup().upload(screen.getByTestId("phone-camera-input"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not use that photo");
    expect(onTake).not.toHaveBeenCalled();
  });
});
