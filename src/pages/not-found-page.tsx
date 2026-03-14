import { Link } from "react-router";
import { PageHeader } from "@/components/layout/page-header";

export function NotFoundPage() {
  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Not Found" />
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <p className="text-6xl font-bold text-gray-300 dark:text-gray-600">404</p>
        <p className="mt-4 text-gray-600 dark:text-gray-400">
          This page doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-light transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
