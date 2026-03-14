import { createBrowserRouter, RouterProvider } from "react-router";
import { ActiveTripProvider } from "@/contexts/active-trip-context";
import { ToastProvider } from "@/contexts/toast-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/pages/home-page";
import NewTripPage from "@/pages/new-trip-page";
import ActiveTripPage from "@/pages/active-trip-page";
import ScannerPage from "@/pages/scanner-page";
import AddItemPage from "@/pages/add-item-page";
import EndTripPage from "@/pages/end-trip-page";
import TripHistoryPage from "@/pages/trip-history-page";
import TripDetailPage from "@/pages/trip-detail-page";
import TripEditPage from "@/pages/trip-edit-page";
import { ItemLibraryPage } from "@/pages/item-library-page";
import { NewItemPage } from "@/pages/new-item-page";
import { ItemDetailPage } from "@/pages/item-detail-page";
import ReportsPage from "@/pages/reports-page";
import SpendingReportPage from "@/pages/spending-report-page";
import FrequencyReportPage from "@/pages/frequency-report-page";
import PriceHistoryReportPage from "@/pages/price-history-report-page";
import TripComparisonPage from "@/pages/trip-comparison-page";
import { StoresPage } from "@/pages/stores-page";
import { NewStorePage } from "@/pages/new-store-page";
import { EditStorePage } from "@/pages/edit-store-page";
import ExportPage from "@/pages/export-page";
import SettingsPage from "@/pages/settings-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { ErrorBoundary } from "@/components/feedback/error-boundary";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppShell />,
      children: [
        { index: true, element: <HomePage /> },
        { path: "trips/new", element: <NewTripPage /> },
        {
          path: "trips/active",
          element: <ActiveTripPage />,
          children: [
            { path: "scan", element: <ScannerPage /> },
            { path: "add", element: <AddItemPage /> },
          ],
        },
        { path: "trips/active/end", element: <EndTripPage /> },
        { path: "trips/history", element: <TripHistoryPage /> },
        { path: "trips/:id", element: <TripDetailPage /> },
        { path: "trips/:id/edit", element: <TripEditPage /> },
        { path: "items", element: <ItemLibraryPage /> },
        { path: "items/new", element: <NewItemPage /> },
        { path: "items/:id", element: <ItemDetailPage /> },
        { path: "reports", element: <ReportsPage /> },
        { path: "reports/spending", element: <SpendingReportPage /> },
        { path: "reports/frequency", element: <FrequencyReportPage /> },
        { path: "reports/price/:itemId", element: <PriceHistoryReportPage /> },
        { path: "reports/comparison", element: <TripComparisonPage /> },
        { path: "stores", element: <StoresPage /> },
        { path: "stores/new", element: <NewStorePage /> },
        { path: "stores/:id/edit", element: <EditStorePage /> },
        { path: "export", element: <ExportPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  { basename },
);

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ActiveTripProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ActiveTripProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
