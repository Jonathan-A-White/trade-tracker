import { createBrowserRouter, RouterProvider } from "react-router";
import { ActiveTripProvider } from "@/contexts/active-trip-context";
import { ToastProvider } from "@/contexts/toast-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { FactoryProvider } from "@/contexts/factory-context";
import { ErrorBoundary } from "@/components/feedback/error-boundary";
import { appRoutes } from "@/routes";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

const router = createBrowserRouter(appRoutes, { basename });

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ActiveTripProvider>
          <ToastProvider>
            <FactoryProvider>
              <RouterProvider router={router} />
            </FactoryProvider>
          </ToastProvider>
        </ActiveTripProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
