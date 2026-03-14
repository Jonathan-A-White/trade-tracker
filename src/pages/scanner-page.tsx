import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { db } from "@/db/database";
import type { Item } from "@/contracts/types";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";
import { ScannerViewfinder } from "@/components/scanner/scanner-viewfinder";
import { formatCurrency } from "@/core/pricing";

const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

export default function ScannerPage() {
  const navigate = useNavigate();
  const [scannerActive, setScannerActive] = useState(true);
  const [foundItem, setFoundItem] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [weightLbs, setWeightLbs] = useState("");
  const [adding, setAdding] = useState(false);

  const handleBarcodeDetected = useCallback(
    async (barcode: string) => {
      if (foundItem) return; // already showing a result
      setScannerActive(false);

      const item = await db.items.where("barcode").equals(barcode).first();
      if (item) {
        setFoundItem(item);
      } else {
        navigate(`/trips/active/add?barcode=${encodeURIComponent(barcode)}`);
      }
    },
    [foundItem, navigate],
  );

  const handleAddToTrip = useCallback(async () => {
    if (!foundItem || adding) return;
    setAdding(true);

    try {
      const trip = await tripRepo.getActive();
      if (!trip) {
        navigate("/trips/active");
        return;
      }

      await tripItemRepo.addToTrip({
        tripId: trip.id,
        itemId: foundItem.id,
        price: foundItem.currentPrice,
        quantity,
        weightLbs:
          foundItem.unitType === "per_lb" && weightLbs
            ? parseFloat(weightLbs)
            : undefined,
        onSale: false,
      });

      // Reset and allow scanning again
      setFoundItem(null);
      setQuantity(1);
      setWeightLbs("");
      setScannerActive(true);
    } finally {
      setAdding(false);
    }
  }, [foundItem, quantity, weightLbs, adding, navigate]);

  const handleClose = useCallback(() => {
    navigate("/trips/active");
  }, [navigate]);

  const handleScanAgain = useCallback(() => {
    setFoundItem(null);
    setQuantity(1);
    setWeightLbs("");
    setScannerActive(true);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <ScannerViewfinder
        onBarcodeDetected={handleBarcodeDetected}
        onClose={handleClose}
        isActive={scannerActive}
      />

      {/* Item found confirmation overlay */}
      {foundItem && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50">
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-6 space-y-4 animate-slide-up">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {foundItem.name}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Barcode: {foundItem.barcode}
                </p>
              </div>
              <p className="text-xl font-bold text-green-600">
                {formatCurrency(foundItem.currentPrice)}
              </p>
            </div>

            <div className="text-xs text-gray-500">
              Last price: {formatCurrency(foundItem.currentPrice)} /{" "}
              {foundItem.unitType === "per_lb" ? "lb" : "each"}
            </div>

            {foundItem.unitType === "per_lb" ? (
              <div>
                <label
                  htmlFor="scanner-weight"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Weight (lbs)
                </label>
                <input
                  id="scanner-weight"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={weightLbs}
                  onChange={(e) => setWeightLbs(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            ) : (
              <div>
                <label
                  htmlFor="scanner-qty"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Quantity
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-lg font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-lg font-semibold text-gray-900 w-10 text-center">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => q + 1)}
                    className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-lg font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleScanAgain}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Scan Again
              </button>
              <button
                type="button"
                onClick={handleAddToTrip}
                disabled={
                  adding ||
                  (foundItem.unitType === "per_lb" &&
                    (!weightLbs || parseFloat(weightLbs) <= 0))
                }
                className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? "Adding..." : "Add to Trip"}
              </button>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="w-full text-center text-sm text-gray-500 hover:text-gray-700 py-1 cursor-pointer"
            >
              Close Scanner
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
