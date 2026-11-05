import { createBrowserRouter, RouterProvider } from "react-router";
import { ActiveTripProvider } from "@/contexts/active-trip-context";
import { ToastProvider } from "@/contexts/toast-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { FactoryProvider } from "@/contexts/factory-context";
import { ErrorBoundary } from "@/components/feedback/error-boundary";
import { appRoutes } from "@/routes";
import { SortProvider } from "@/sort/sort-context";
import { CardListSync } from "@/push/CardListSync";
import { MovedBanner } from "@/move/MovedBanner";
import { link } from "pwa-kit/settings";
import { SETTINGS_PATH } from "@/settings/registry";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

const router = createBrowserRouter(appRoutes, { basename });

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ActiveTripProvider>
          <ToastProvider>
            <FactoryProvider>
              <SortProvider>
                <CardListSync />
                <MovedBanner onPackUp={() => void router.navigate(link("move", SETTINGS_PATH))} />
                <RouterProvider router={router} />
              </SortProvider>
            </FactoryProvider>
          </ToastProvider>
        </ActiveTripProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
