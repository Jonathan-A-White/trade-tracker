import type { ReactNode } from "react";

/** A line saying what he just did, with an Undo beside it when something is kept to put it back. */
export function UndoNotice({
  children,
  onUndo,
  disabled = false,
  className = "text-sm text-gray-800 dark:text-gray-200",
}: {
  children: ReactNode;
  /** none: nothing is kept, so there is no Undo */
  onUndo?: () => void;
  disabled?: boolean;
  /** the colours and spacing of the line */
  className?: string;
}) {
  return (
    <p className={`flex flex-wrap items-center justify-between gap-x-3 ${className}`}>
      <span>{children}</span>
      {onUndo && (
        <button
          type="button"
          disabled={disabled}
          onClick={onUndo}
          className="min-h-12 px-2 font-semibold underline disabled:opacity-50"
        >
          Undo
        </button>
      )}
    </p>
  );
}
