import type { ReactNode } from "react";
import { Link } from "react-router";

interface PageHeaderProps {
  title: string;
  backTo?: string;
  rightAction?: ReactNode;
}

export function PageHeader({ title, backTo, rightAction }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {backTo && (
          <Link
            to={backTo}
            className="text-gray-600 hover:text-gray-900 p-1 -ml-1"
            aria-label="Go back"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </Link>
        )}
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      </div>
      {rightAction && <div>{rightAction}</div>}
    </header>
  );
}
