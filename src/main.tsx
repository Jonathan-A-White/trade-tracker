import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.tsx";
import { startAppUpdates } from "./services/app-update";
import { installPreloadErrorReload } from "./services/preload-reload";

// A deploy that swaps the files under a running page: reload to pick up the new build.
installPreloadErrorReload(window, () => window.location.reload());

// vite.config.ts: registerType "prompt", so a new build waits for his tap on the banner. The registration
// goes to the update logic, which shows the banner, sends SKIP_WAITING on the tap, reloads once, and
// looks for a new build on start, on return to the foreground and every 30 minutes.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) {
      startAppUpdates({
        container: navigator.serviceWorker,
        registration,
        reload: () => window.location.reload(),
      });
    }
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
