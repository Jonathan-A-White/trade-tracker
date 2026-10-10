import { create } from "qrcode";

const QUIET_ZONE = 4;

/** A QR code as plain data: the dark modules come back as one SVG path, one unit square per module. */
function qrPath(text: string): { size: number; path: string } {
  const { size, data } = create(text, { errorCorrectionLevel: "M" }).modules;
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}

/** The phone's public key as a QR code, the way Postern draws one, so Postern's Issue a licence scanner reads it. */
export function KeyQr({ text }: { text: string }) {
  const { size, path } = qrPath(text);
  const extent = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label="This phone's key as a QR code"
      data-testid="key-qr"
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`}
      width={192}
      height={192}
      shapeRendering="crispEdges"
      className="mx-auto h-48 w-48 rounded-lg"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={extent} height={extent} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
