import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";
import { buildVersion, shortCommit } from "./build-version";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/trade-tracker/" : "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new build waits until he taps the Update banner (src/services/app-update.ts).
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm}"],
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^(?!\/__).*/],
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
