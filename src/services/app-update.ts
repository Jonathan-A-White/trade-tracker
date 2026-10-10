// A new build of TradeTracker waits behind the one in control until he taps: the banner
// (components/feedback/update-banner.tsx) shows while a worker is waiting, the tap
// posts {type:"SKIP_WAITING"} to it (the generated worker skips waiting) and
// the page reloads ONCE when the controller changes, only if he asked: a first install claiming the
// page, or another tab's update, never reloads this one. If the new worker has not taken over a few
// seconds after the tap, the page reloads anyway, so the banner never sits on 'Updating…'. The app also asks the browser whether there is
// a new build on start, on return to the foreground and every 30 minutes, so a phone that keeps
// TradeTracker open for days still finds out.
import { useSyncExternalStore } from "react";

/** How often a running app asks whether a newer build is up. */
export const UPDATE_CHECK_EVERY_MS = 30 * 60_000;

/** How long a tap waits for the new worker to take over before the page reloads anyway. */
export const TAKE_OVER_PATIENCE_MS = 3_000;

export type UpdateState = "none" | "ready" | "updating";

interface WorkerLike {
  state: ServiceWorkerState;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
}

export interface UpdateContainer {
  controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface UpdateRegistration {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: "updatefound", listener: () => void): void;
  removeEventListener(type: "updatefound", listener: () => void): void;
}

export interface AppUpdates {
  /** Tells the waiting worker to take over; the page reloads once it has. */
  apply(): void;
  /** Asks the browser now whether a newer build is up. */
  checkNow(): void;
  stop(): void;
}

let state: UpdateState = "none";
let active: AppUpdates | undefined;
const listeners = new Set<() => void>();

function setState(next: UpdateState): void {
  if (state === next) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

/** The banner's state: nothing waiting, a build ready to take, or the tap made and the worker taking over. */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => state,
  );
}

/** The tap on the banner. */
export function applyUpdate(): void {
  active?.apply();
}

/** Watches `registration` for a waiting worker and looks for a newer build now, on return to the foreground and every 30 minutes. */
export function startAppUpdates(deps: { container: UpdateContainer; registration: UpdateRegistration; reload: () => void }): AppUpdates {
  const { container, registration, reload } = deps;
  active?.stop();
  let asked = false;
  let patience: ReturnType<typeof setTimeout> | undefined;

  const syncWaiting = () => {
    // The first worker ever has nothing to wait behind: it activates, and claims the page.
    if (registration.waiting && container.controller) {
      if (state === "none") setState("ready");
    } else if (!asked) setState("none");
  };

  const onFound = () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") syncWaiting();
    });
  };

  // Reloads at most once per tap: on the controller change, or when the patience runs out first.
  const reloadOnce = () => {
    if (!asked) return;
    asked = false;
    clearTimeout(patience);
    reload();
  };

  const checkNow = () => {
    // Offline, or the server is down: the next check tries again.
    void Promise.resolve(registration.update()).catch(() => undefined);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") checkNow();
  };

  registration.addEventListener("updatefound", onFound);
  container.addEventListener("controllerchange", reloadOnce);
  document.addEventListener("visibilitychange", onVisible);
  const every = setInterval(checkNow, UPDATE_CHECK_EVERY_MS);
  onFound();
  syncWaiting();
  checkNow();

  const updates: AppUpdates = {
    apply() {
      const worker = registration.waiting;
      if (state !== "ready" || !worker) return;
      asked = true;
      setState("updating");
      worker.postMessage({ type: "SKIP_WAITING" });
      clearTimeout(patience);
      patience = setTimeout(reloadOnce, TAKE_OVER_PATIENCE_MS);
    },
    checkNow,
    stop() {
      registration.removeEventListener("updatefound", onFound);
      container.removeEventListener("controllerchange", reloadOnce);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(every);
      clearTimeout(patience);
      if (active === updates) {
        active = undefined;
        asked = false;
        setState("none");
      }
    },
  };
  active = updates;
  return updates;
}
