// The family's feed of alerts on this phone: read whole every poll (so a charge another phone claimed drops out), each read
// with a deadline (rule 32), the last list kept on the device so a start without the network still shows it, and a claim
// that cannot reach the backend kept and sent again on the next poll.
import { useCallback, useEffect, useRef, useState } from "react";
import { openWithin, LaunchTimeout } from "pwa-kit/launch-gate";
import type { LaunchPhase, LaunchTiming } from "pwa-kit/launch-gate";
import type { AlertsClient, FamilyAlert } from "@/family/alerts-client";

/** How often an open screen reads the feed again. A push, coming back to the app or the network wakes it sooner. */
export const SORT_POLL_MS = 30_000;
/** The feed's deadline: slow at 3 s, Try again at 8 s, given up at 15 s. */
export const FEED_TIMING: Required<LaunchTiming> = { slowAfterMs: 3_000, tryAgainAfterMs: 8_000, timeoutMs: 15_000 };
/** The last feed read, kept on the device. */
export const KEPT_FEED_KEY = "tradetracker-alerts-kept";
/** Claims this phone made that the backend has not taken yet. */
export const PENDING_CLAIMS_KEY = "tradetracker-alerts-claims";
/** The message the service worker posts to an open page when a push comes. */
export const PUSH_MESSAGE = "tradetracker-alert-push";

/** Where the latest read stands: reading (with launch-gate's phases), read, or given up. */
export type FeedPhase = "idle" | LaunchPhase | "ready";

export interface AlertsFeed {
  /** the family's alerts, oldest first; null before anything was read or kept */
  alerts: FamilyAlert[] | null;
  phase: FeedPhase;
  /** the plain line for the last failed read; null after a read that worked */
  error: string | null;
  /** reads the feed now */
  refresh: () => void;
  /** claims an alert for every phone; it leaves this phone's list at once, and a claim that fails is sent again later */
  claim: (id: string) => Promise<void>;
  /**
   * Asks the backend for the alert before it is sorted, with a short deadline: 'claimed' (this phone has it), 'gone'
   * (another phone claimed it first; the feed is read again) or 'unreached' (nothing changed; sort it anyway).
   */
  take: (id: string) => Promise<TakeResult>;
  /** drops an alert from this phone's list (and its notification), asking the backend nothing */
  forget: (id: string) => void;
}

export type TakeResult = "claimed" | "gone" | "unreached";

/** How long Done waits to hear whether another phone took the charge first; past it the charge is sorted offline. */
export const TAKE_TIMEOUT_MS = 4_000;

export interface UseAlertsOptions {
  pollMs?: number;
  timing?: LaunchTiming;
  /** told of the alerts that were in the last list and are not in this one (claimed by another phone) */
  onGone?: (gone: FamilyAlert[]) => void;
}

function readList<T>(key: string, valid: (v: unknown) => v is T): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(valid) : null;
  } catch {
    return null;
  }
}

const isAlert = (v: unknown): v is FamilyAlert =>
  typeof v === "object" && v !== null && typeof (v as FamilyAlert).id === "string" && typeof (v as FamilyAlert).seq === "number";
const isId = (v: unknown): v is string => typeof v === "string";

function pendingClaims(): string[] {
  return readList(PENDING_CLAIMS_KEY, isId) ?? [];
}

function setPendingClaims(ids: string[]): void {
  if (ids.length === 0) localStorage.removeItem(PENDING_CLAIMS_KEY);
  else localStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(ids));
}

function messageOf(err: unknown, timing: Required<LaunchTiming>): string {
  if (err instanceof LaunchTimeout) {
    const seconds = Math.max(1, Math.round(timing.timeoutMs / 1000));
    return `The backend did not answer in ${seconds} second${seconds === 1 ? "" : "s"}.`;
  }
  if (err instanceof Error && err.message && err.message !== "Failed to fetch") return err.message;
  return "Could not reach the backend. Check the connection.";
}

/** The feed for `client`; null (Family Off, no key, no licence) reads nothing and shows what was kept. */
export function useAlerts(client: AlertsClient | null, options: UseAlertsOptions = {}): AlertsFeed {
  const pollMs = options.pollMs ?? SORT_POLL_MS;
  const timing: Required<LaunchTiming> = { ...FEED_TIMING, ...options.timing };
  const { slowAfterMs, tryAgainAfterMs, timeoutMs } = timing;
  const [alerts, setAlerts] = useState<FamilyAlert[] | null>(() => readList(KEPT_FEED_KEY, isAlert));
  const [phase, setPhase] = useState<FeedPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [wake, setWake] = useState(0);
  const onGone = useRef(options.onGone);
  useEffect(() => {
    onGone.current = options.onGone;
  });
  const last = useRef<FamilyAlert[] | null>(alerts);

  const refresh = useCallback(() => setWake((n) => n + 1), []);

  useEffect(() => {
    if (!client) {
      setPhase("idle");
      return;
    }
    let current = true;
    let reading = false;
    const run: { abort?: AbortController } = {};

    const read = async () => {
      if (reading) return;
      reading = true;
      const abort = new AbortController();
      run.abort = abort;
      setPhase("opening");
      try {
        // claims made while the backend could not be reached go first, so the list read after has them gone
        const claims = pendingClaims();
        if (claims.length > 0) {
          const left: string[] = [];
          for (const id of claims) {
            try {
              await client.claim(id);
            } catch {
              left.push(id);
            }
          }
          setPendingClaims(left);
        }
        const page = await openWithin(() => client.list(0), {
          slowAfterMs,
          tryAgainAfterMs,
          timeoutMs,
          signal: abort.signal,
          onPhase: (p) => {
            if (current) setPhase(p);
          },
        });
        if (!current) return;
        const stillPending = new Set(pendingClaims());
        const fresh = page.alerts.filter((a) => !stillPending.has(a.id)).sort((a, b) => a.seq - b.seq);
        const before = last.current;
        if (before) {
          const now = new Set(fresh.map((a) => a.id));
          const gone = before.filter((a) => !now.has(a.id) && !stillPending.has(a.id));
          if (gone.length > 0) onGone.current?.(gone);
        }
        last.current = fresh;
        localStorage.setItem(KEPT_FEED_KEY, JSON.stringify(fresh));
        setAlerts(fresh);
        setError(null);
        setPhase("ready");
      } catch (err) {
        if (!current) return;
        setError(messageOf(err, { slowAfterMs, tryAgainAfterMs, timeoutMs }));
        setPhase("failed");
      } finally {
        reading = false;
      }
    };

    void read();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void read();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === PUSH_MESSAGE) void read();
    };
    const onOnline = () => void read();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      current = false;
      run.abort?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [client, pollMs, slowAfterMs, tryAgainAfterMs, timeoutMs, wake]);

  const forget = useCallback((id: string) => {
    const drop = (list: FamilyAlert[] | null) => list?.filter((a) => a.id !== id) ?? null;
    last.current = drop(last.current);
    setAlerts((list) => {
      const next = drop(list);
      if (next) localStorage.setItem(KEPT_FEED_KEY, JSON.stringify(next));
      return next;
    });
    closeNotification(id);
  }, []);

  const claim = useCallback(
    async (id: string) => {
      forget(id);
      try {
        if (!client) throw new Error("no client");
        await client.claim(id);
      } catch {
        setPendingClaims([...new Set([...pendingClaims(), id])]);
      }
    },
    [client, forget],
  );

  const take = useCallback(
    async (id: string): Promise<TakeResult> => {
      if (!client) return "unreached";
      let claimed: boolean;
      try {
        claimed = await openWithin(() => client.claim(id), { slowAfterMs: TAKE_TIMEOUT_MS, tryAgainAfterMs: TAKE_TIMEOUT_MS, timeoutMs: TAKE_TIMEOUT_MS });
      } catch {
        return "unreached";
      }
      if (claimed) return "claimed";
      refresh();
      return "gone";
    },
    [client, refresh],
  );

  return { alerts, phase, error, refresh, claim, take, forget };
}

/** Closes this phone's notification of an alert, when it shows one (sorted here, or claimed by another phone). */
export function closeNotification(id: string): void {
  const container = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  void container
    ?.getRegistration?.()
    .then((registration) => registration?.getNotifications({ tag: `alert-${id}` }))
    .then((shown) => shown?.forEach((n) => n.close()))
    .catch(() => {});
}
