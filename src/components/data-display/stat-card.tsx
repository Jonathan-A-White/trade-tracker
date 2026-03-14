import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "stable";
  icon?: ReactNode;
}

function TrendIndicator({ trend }: { trend: "up" | "down" | "stable" }) {
  switch (trend) {
    case "up":
      return (
        <span className="flex items-center text-red-500 text-sm font-medium">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 15-6-6-6 6" />
          </svg>
          Up
        </span>
      );
    case "down":
      return (
        <span className="flex items-center text-green-500 text-sm font-medium">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
          Down
        </span>
      );
    case "stable":
      return (
        <span className="flex items-center text-gray-500 text-sm font-medium">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
          </svg>
          Stable
        </span>
      );
  }
}

export function StatCard({ label, value, trend, icon }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        {icon && <div className="text-gray-400 dark:text-gray-500">{icon}</div>}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</span>
        {trend && <TrendIndicator trend={trend} />}
      </div>
    </div>
  );
}
