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

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/trade-tracker/" : "/",
  plugins: [
    react(),
    tailwindcss(),
    swPush(),
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
        description: "Local-first grocery price tracking",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait",
        scope: process.env.GITHUB_ACTIONS ? "/trade-tracker/" : "/",
        start_url: process.env.GITHUB_ACTIONS ? "/trade-tracker/" : "/",
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
