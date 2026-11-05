/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 'v<version> · <UTC time>Z · <commit>', stamped by the build (build-version.ts, vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** An https URL: set, the build is the old address and says the app has moved there (src/move/MovedBanner.tsx). Unset otherwise. */
  readonly VITE_MOVED_TO?: string;
}
