/** A dynamic import that fails because a deploy swapped the files under the running page: reload to pick up the new build. */
export function installPreloadErrorReload(target: EventTarget, reload: () => void): void {
  target.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reload();
  });
}
