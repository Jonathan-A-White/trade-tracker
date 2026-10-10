import { CARD_CLASS } from "../parts";
import { useTheme } from "@/contexts/theme-context";

export function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Appearance</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {theme === "dark" ? "Dark" : "Light"} mode
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="relative inline-flex h-8 w-14 items-center rounded-full transition-colors cursor-pointer"
          style={{ backgroundColor: theme === "dark" ? "#3b82f6" : "#d1d5db" }}
          role="switch"
          aria-checked={theme === "dark"}
          aria-label="Toggle dark mode"
        >
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform"
            style={{ transform: theme === "dark" ? "translateX(1.625rem)" : "translateX(0.25rem)" }}
          >
            {theme === "dark" ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
