import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { timingFilter, vitestTimeouts } from "pwa-kit/test-preset";
import { buildVersion, packageVersion, shortCommit } from "./build-version";


export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion(packageVersion(), new Date(), shortCommit())),
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    ...vitestTimeouts,
    // MW_TIMING=skip|only (with MW_TIMING_TESTS) leaves out or runs only the rig's timing tests; unset runs every test
    ...timingFilter({ include: ["src/**/*.test.{ts,tsx}", "tests/support/**/*.test.ts"] }),
    passWithNoTests: true,
  },
});
