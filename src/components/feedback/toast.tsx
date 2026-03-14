import { useEffect } from "react";

interface ToastProps {
  message: string;
  variant: "success" | "error" | "info";
  duration?: number;
  onDismiss: () => void;
}

const variantClasses = {
  success: "bg-green-600",
  error: "bg-red-600",
  info: "bg-blue-600",
};

export function Toast({ message, variant, duration = 3000, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 flex justify-center pointer-events-none">
      <div
        className={`${variantClasses[variant]} text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium max-w-sm w-full flex items-center justify-between pointer-events-auto animate-[slideUp_0.2s_ease-out]`}
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-3 text-white/80 hover:text-white shrink-0 cursor-pointer"
          aria-label="Dismiss"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
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
    </div>
  );
}
