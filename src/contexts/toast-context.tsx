import { createContext, useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 3000;

const variantStyles: Record<ToastVariant, string> = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-blue-600 text-white",
  warning: "bg-yellow-500 text-black",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = nextId.current++;
      setToasts((prev) => {
        const updated = [...prev, { id, message, variant }];
        if (updated.length > MAX_TOASTS) {
          return updated.slice(updated.length - MAX_TOASTS);
        }
        return updated;
      });

      setTimeout(() => {
        removeToast(id);
      }, AUTO_DISMISS_MS);
    },
    [removeToast],
  );

  return (
    <ToastContext value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role="alert"
      className={`
        rounded-lg px-4 py-3 shadow-lg transition-all duration-300 min-w-64 max-w-sm
        flex items-center justify-between
        ${variantStyles[toast.variant]}
        ${visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}
      `}
    >
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="ml-3 shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
