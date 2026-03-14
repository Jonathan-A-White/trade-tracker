import { Link } from "react-router";
import { PageHeader } from "@/components/layout/page-header";

const reportCards = [
  {
    title: "Spending Summary",
    description: "See how much you spend over time by week or month",
    to: "/reports/spending",
    bg: "bg-blue-50",
    border: "border-blue-200",
    iconColor: "text-blue-600",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="8" width="4" height="13" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
  },
  {
    title: "Most Bought",
    description: "Your most frequently purchased items ranked",
    to: "/reports/frequency",
    bg: "bg-green-50",
    border: "border-green-200",
    iconColor: "text-green-600",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
  },
  {
    title: "Price Trends",
    description: "Track how prices change over time for any item",
    to: "/items",
    bg: "bg-purple-50",
    border: "border-purple-200",
    iconColor: "text-purple-600",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: "Trip Accuracy",
    description: "Compare your scanned subtotals to actual receipts",
    to: "/reports/comparison",
    bg: "bg-amber-50",
    border: "border-amber-200",
    iconColor: "text-amber-600",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
] as const;

export default function ReportsPage() {
  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Reports" />

      <div className="flex-1 p-4 space-y-4">
        {reportCards.map((card) => (
          <Link
            key={card.title}
            to={card.to}
            className={`block rounded-xl border ${card.border} ${card.bg} p-5 active:scale-[0.98] transition-transform`}
          >
            <div className="flex items-start gap-4">
              <div className={`${card.iconColor} mt-0.5`}>{card.icon}</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-gray-900">
                  {card.title}
                </h2>
                <p className="text-sm text-gray-600 mt-1">{card.description}</p>
              </div>
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
                className="text-gray-400 mt-1 shrink-0"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </div>
          </Link>
        ))}

        <p className="text-xs text-center text-gray-400 pt-2">
          Select a report to view detailed analytics
        </p>
      </div>
    </div>
  );
}
