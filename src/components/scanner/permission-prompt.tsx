interface PermissionPromptProps {
  onRetry: () => void;
}

export function PermissionPrompt({ onRetry }: PermissionPromptProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 text-gray-400 dark:text-gray-500">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75" />
          <rect x="3.75" y="10.5" width="16.5" height="11.25" rx="2" />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Camera Permission Required
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
        TradeTracker needs camera access to scan barcodes. Please allow camera
        access in your browser settings and try again.
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
      >
        Try Again
      </button>
    </div>
  );
}
