import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface TripItem {
  id: string;
  price: number;
  quantity: number;
  weightLbs?: number;
  lineTotal: number;
  onSale: boolean;
}

interface TripItemRowProps {
  tripItem: TripItem;
  itemName: string;
  unitType: string;
  onEditPrice?: (id: string) => void;
  onEditQuantity?: (id: string) => void;
  onRemove?: (id: string) => void;
  editable?: boolean;
}

const SWIPE_THRESHOLD = 80;
const LONG_PRESS_MS = 500;

export function TripItemRow({
  tripItem,
  itemName,
  unitType,
  onEditPrice,
  onEditQuantity,
  onRemove,
  editable = false,
}: TripItemRowProps) {
  const quantityDisplay =
    unitType === "per_lb" && tripItem.weightLbs !== undefined
      ? `${tripItem.weightLbs.toFixed(2)} lbs`
      : `x${tripItem.quantity}`;

  // Swipe state
  const [offsetX, setOffsetX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const [animateTransition, setAnimateTransition] = useState(true);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isTracking = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Long press state
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Close menu on outside click
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const inRow = rowRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inRow && !inMenu) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [showMenu]);

  // Close swiped state on outside click
  useEffect(() => {
    if (!swiped) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setSwiped(false);
        setOffsetX(0);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [swiped]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!editable) return;
      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      isTracking.current = false;
      didLongPress.current = false;

      // If already swiped, a tap should close it
      if (swiped) return;

      longPressTimer.current = setTimeout(() => {
        didLongPress.current = true;
        if (rowRef.current) {
          const rect = rowRef.current.getBoundingClientRect();
          setMenuPosition({ top: rect.bottom, left: rect.left + 16 });
        }
        setShowMenu(true);
      }, LONG_PRESS_MS);
    },
    [editable, swiped],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!editable) return;
      clearLongPress();

      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX.current;
      const dy = touch.clientY - touchStartY.current;

      // Determine if horizontal swipe (only on first significant movement)
      if (!isTracking.current) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          isTracking.current = true;
          setAnimateTransition(false);
        } else if (Math.abs(dy) > 10) {
          // Vertical scroll, bail
          return;
        } else {
          return;
        }
      }

      if (swiped) {
        // Already swiped open, allow dragging further or closing
        const newOffset = Math.min(0, -SWIPE_THRESHOLD + dx);
        setOffsetX(newOffset);
      } else {
        // Only allow swiping left
        const newOffset = Math.min(0, dx);
        setOffsetX(newOffset);
      }
    },
    [editable, clearLongPress, swiped],
  );

  const handleTouchEnd = useCallback(() => {
    if (!editable) return;
    clearLongPress();

    setAnimateTransition(true);

    if (swiped && !isTracking.current) {
      // Tap while swiped = close
      setSwiped(false);
      setOffsetX(0);
      return;
    }

    if (Math.abs(offsetX) >= SWIPE_THRESHOLD) {
      setSwiped(true);
      setOffsetX(-SWIPE_THRESHOLD);
    } else {
      setSwiped(false);
      setOffsetX(0);
    }
    isTracking.current = false;
  }, [editable, clearLongPress, offsetX, swiped]);

  const handleDelete = useCallback(() => {
    onRemove?.(tripItem.id);
    setSwiped(false);
    setOffsetX(0);
  }, [onRemove, tripItem.id]);

  // Prevent context menu on long press
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (editable) e.preventDefault();
    },
    [editable],
  );

  return (
    <div ref={rowRef} className="relative overflow-hidden border-b dark:border-gray-700">
      {/* Delete button behind the row */}
      {editable && (
        <button
          type="button"
          onClick={handleDelete}
          className="absolute right-0 top-0 bottom-0 w-20 bg-red-600 flex items-center justify-center text-white text-sm font-medium cursor-pointer"
        >
          Delete
        </button>
      )}

      {/* Sliding row content */}
      <div
        className="relative bg-white dark:bg-gray-800 px-4 py-3"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: animateTransition ? "transform 0.2s ease-out" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenu}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{itemName}</p>
              {tripItem.onSale && (
                <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                  SALE
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              ${tripItem.price.toFixed(2)} / {unitType} {quantityDisplay}
            </p>
          </div>
          <div className="text-right ml-3">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              ${tripItem.lineTotal.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Long press edit menu (portal to escape overflow-hidden) */}
      {showMenu && editable && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 bg-white dark:bg-gray-700 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 overflow-hidden min-w-[140px]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          {onEditPrice && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                onEditPrice(tripItem.id);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
            >
              Edit Price
            </button>
          )}
          {onEditQuantity && (
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                onEditQuantity(tripItem.id);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer border-t border-gray-100 dark:border-gray-600"
            >
              Edit Quantity
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
