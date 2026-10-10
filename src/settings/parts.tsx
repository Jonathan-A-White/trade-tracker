import type { ReactNode } from "react";

export const CARD_CLASS = "bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4";

export const OUTLINE_BUTTON_CLASS =
  "rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer";

export function SectionCard({
  title,
  spacing = "space-y-3",
  children,
}: {
  title: string;
  /** The Tailwind vertical-gap class; the About card is tighter. */
  spacing?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${CARD_CLASS} ${spacing}`}>
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h2>
      {children}
    </div>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-gray-500 dark:text-gray-400">{children}</p>;
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
      {children}
    </p>
  );
}

/** "Added 3 items. Skipped 2 already in library." (the word and tail vary by section). */
export function AddedSummary({
  added,
  skipped,
  noun,
  skippedTail,
}: {
  added: number;
  skipped: number;
  noun: string;
  skippedTail: string;
}) {
  return (
    <>
      Added {added} {noun}
      {added !== 1 ? "s" : ""}.{skipped > 0 && ` Skipped ${skipped} ${skippedTail}.`}
    </>
  );
}

const CANCEL_CLASS =
  "flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer";

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmClass,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
