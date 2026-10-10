import { Link } from "react-router";
import { SectionCard } from "../parts";

export function AboutSection() {
  return (
    <SectionCard title="About" spacing="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">App</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">TradeTracker</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">Version</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium text-right" data-testid="build-version">{__APP_VERSION__}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">Storage</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">IndexedDB (Dexie.js)</span>
      </div>
      <Link
        to="/about"
        className="block pt-1 text-sm font-medium text-blue-600 dark:text-blue-400 underline"
      >
        Credits and thanks
      </Link>
    </SectionCard>
  );
}
