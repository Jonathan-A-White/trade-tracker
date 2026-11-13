import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";
import { buildVersion, shortCommit } from "./build-version";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

/** src/sw-push.ts (the push and notification-tap handlers, importing nothing) built to sw-push.js beside the worker that loads it. */
function swPush(): Plugin {
  return {
    name: "tradetracker-sw-push",
    apply: "build",
    async generateBundle() {
      const source = readFileSync("./src/sw-push.ts", "utf-8");
      const built = await transformWithEsbuild(source, "sw-push.ts", { loader: "ts", format: "iife", target: "es2020", minify: true });
      this.emitFile({ type: "asset", fileName: "sw-push.js", source: built.code });
    },
  };
}

/** CHANGELOG.md emitted as changelog.md beside index.html: the running page reads the waiting build's changelog from the server (src/services/app-update-options.ts). */
function servedChangelog(): Plugin {
  return {
    name: "tradetracker-served-changelog",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "changelog.md", source: readFileSync("./CHANGELOG.md", "utf-8") });
    },
  };
}

/**
 * VITE_MOVED_TO: an https URL, set only for the old address's build (the Pages workflow), which then shows the 'has moved' banner
 * (src/move/MovedBanner.tsx reads it as import.meta.env.VITE_MOVED_TO). Unset or empty, no banner. Anything else fails the build.
 */
function checkMovedTo(): void {
  const value = process.env.VITE_MOVED_TO;
  if (!value) return;
  if (!/^https:\/\/[^/\s]+/.test(value)) throw new Error(`VITE_MOVED_TO must be an https URL or unset, got '${value}'`);
}

checkMovedTo();

// GITHUB_ACTIONS is the Pages build under /trade-tracker/; any other build is the new address, at the root.
const onPages = Boolean(process.env.GITHUB_ACTIONS);

export default defineConfig({
  base: onPages ? "/trade-tracker/" : "/",
  plugins: [
    react(),
    tailwindcss(),
    swPush(),
    servedChangelog(),
    VitePWA({
      // "prompt": a new build waits until he taps the Update banner (pwa-kit/app-update).
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm}"],
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^(?!\/__).*/],
        // the push of a charge and the tap on its notification (src/sw-push.ts)
        importScripts: ["sw-push.js"],
        runtimeCaching: [
          {
            urlPattern: /\.wasm$/,
            handler: "CacheFirst",
            options: {
              cacheName: "wasm-cache",
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: "TradeTracker",
        short_name: "TradeTracker",
        description: "Local-first spending tracking",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait",
        // One identity for the installed app across updates at https://trade.allmymind.org. Not on the Pages build: its installed app keeps
        // the id it has (the start_url), so the retiring address is not changed under the phones that have not yet moved.
        ...(onPages ? {} : { id: "/" }),
        scope: onPages ? "/trade-tracker/" : "/",
        start_url: onPages ? "/trade-tracker/" : "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion(pkg.version, new Date(), shortCommit())),
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
