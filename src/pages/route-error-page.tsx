import { Link, useRouteError } from "react-router";

export function RouteErrorPage() {
  const error = useRouteError();
  if (error) console.error("Route error:", error);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center min-h-full">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Something went wrong
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mb-6">
        This screen hit an unexpected problem. Your data is safe on this phone.
      </p>
      <Link
        to="/"
        className="inline-flex items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-light transition-colors"
      >
        Go Home
      </Link>
    </div>
  );
}
