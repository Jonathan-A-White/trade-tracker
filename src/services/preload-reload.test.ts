import { installPreloadErrorReload } from "./preload-reload";

describe("installPreloadErrorReload", () => {
  it("reloads the page and stops the error when a chunk fails to load", () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installPreloadErrorReload(target, reload);
    const event = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing for other events", () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installPreloadErrorReload(target, reload);
    target.dispatchEvent(new Event("error"));
    expect(reload).not.toHaveBeenCalled();
  });
});
