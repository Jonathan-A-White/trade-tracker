import { defineConfig, devices } from "@playwright/test";
import { browserEnv } from "./tests/support/browser-env";
import { previewPort, reuseExistingPreview } from "./tests/support/preview-port";

// One preview server per worktree: see tests/support/preview-port.ts.
const PREVIEW_PORT = previewPort(process.cwd());

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}/`,
    // A cached worker would serve a stale build to the next spec.
    serviceWorkers: "block",
  },
  // channel: "chromium" uses the full Chromium build rather than the headless-shell binary.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chromium", launchOptions: { env: browserEnv } },
    },
    // `npm run shots` (--project=shots): every spec's end-of-test screenshots (tests/e2e/shot.ts) are taken at a 390x844 phone width.
    {
      name: "shots",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        viewport: { width: 390, height: 844 },
        launchOptions: { env: browserEnv },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: `http://localhost:${PREVIEW_PORT}/`,
    reuseExistingServer: reuseExistingPreview(),
    timeout: 60_000,
  },
});
