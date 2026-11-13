// What main.tsx hands pwa-kit/app-update so a waiting build with no line in the changelog after the running version is taken
// quietly instead of raising 'Update ready'. The judge is pwa-kit's hasNewsSince; this file only supplies the two things it needs:
// the running version and a read of the WAITING build's changelog. The running page's own CHANGELOG.md is the old build's, so the
// read goes to the server for changelog.md (emitted beside index.html by vite.config.ts from CHANGELOG.md), never the bundle.
import { hasNewsSince, type ChangelogEntry, type ReadChangelog } from "pwa-kit/whats-new";
import type { AppUpdateOptions } from "pwa-kit/app-update";
import { changelogEntries } from "./changelog-entries";

/** The running build's package version ('0.1.116') out of the 'v0.1.116 · date · commit' string Settings shows; '' when it has none. */
export function runningVersion(buildString: string = __APP_VERSION__): string {
  return /^v(\d+(?:\.\d+)*)/.exec(buildString)?.[1] ?? "";
}

/**
 * Reads changelog.md fresh from the server (never the HTTP cache or the worker's). null when it cannot be told apart from a
 * changelog: a failed fetch, or an answer with no "## <version>" heading (a host that serves index.html for a missing file).
 */
export function readServedChangelog(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  url: string = `${import.meta.env.BASE_URL}changelog.md`,
): ReadChangelog {
  return async (): Promise<readonly ChangelogEntry[] | null> => {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) return null;
    const text = await response.text();
    if (!/^## \d/m.test(text)) return null;
    return changelogEntries(text);
  };
}

/** The options startAppUpdates takes: the running version and pwa-kit's hasNewsSince over the served changelog. */
export function appUpdateOptions(read: ReadChangelog = readServedChangelog(), version: string = runningVersion()): AppUpdateOptions {
  // No version to compare from: leave the judge out, so every waiting build is offered.
  if (!version) return {};
  return { version, hasNewsSince: hasNewsSince(read) };
}
