import { useEffect, useRef } from "react";

interface ScannerViewfinderProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
  isActive: boolean;
}

export function ScannerViewfinder({
  onBarcodeDetected,
  onClose,
  isActive,
}: ScannerViewfinderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    async function startScanner() {
      try {
        const { initScanner, detectFromVideoFrame } = await import(
          "@/scanner/camera-scanner"
        );

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        await initScanner();

        function scanFrame() {
          if (cancelled || !videoRef.current) return;
          try {
            detectFromVideoFrame(videoRef.current).then(
              (result: string | null) => {
                if (result && !cancelled) {
                  onBarcodeDetected(result);
                }
              }
            );
          } catch {
            // scanner not ready yet
          }
          animationRef.current = requestAnimationFrame(scanFrame);
        }

        scanFrame();
      } catch {
        // camera-scanner module or camera not available
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isActive, onBarcodeDetected]);

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />

      {/* Viewfinder overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-64 h-40 border-2 border-white rounded-lg relative">
          {/* Corner accents */}
          <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-green-400 rounded-tl" />
          <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-green-400 rounded-tr" />
          <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-green-400 rounded-bl" />
          <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-green-400 rounded-br" />
        </div>
      </div>

      {/* Scan instruction */}
      <p className="absolute bottom-24 left-0 right-0 text-center text-white text-sm">
        Align barcode within the frame
      </p>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors cursor-pointer"
        aria-label="Close scanner"
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
    </div>
  );
}
