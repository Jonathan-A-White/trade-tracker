import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="mb-4 text-gray-400">{icon}</div>}

      <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>

      {description && (
        <p className="text-sm text-gray-500 max-w-xs mb-6">{description}</p>
      )}

      {action && (
        <button
          type="button"
          onClick={action.onPress}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
