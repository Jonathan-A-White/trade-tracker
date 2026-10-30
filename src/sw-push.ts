// The service worker's half of the ping: a push shows the charge's notification, and its tap opens the Sort sheet. The
// generated worker loads this file with importScripts (vite.config.ts builds it to sw-push.js), so it imports nothing.
//
// Postern's push today is `{"class": "alert", "title": "New alert", "ts": ...}` and nothing more (its protocol.md 26: no
// amount or merchant leaves the backend in a push); a push that carries the alert's id, amount and merchant is shown with them.

/** The message posted to an open page when a push comes, so it reads the feed at once (useAlerts' PUSH_MESSAGE). */
export const PUSH_MESSAGE = "tradetracker-alert-push";

/** A push's JSON, as much of it as the worker reads. */
export interface AlertPush {
  class?: string;
  title?: string;
  /** the alert's id: the tap opens its sheet */
  id?: string;
  amount?: string;
  merchant?: string;
  last4?: string;
}

/** What the worker shows for a push. `url` is relative to the worker's scope. */
export interface AlertNotification {
  title: string;
  body: string;
  tag: string;
  url: string;
}

function money(amount: string | undefined): string | null {
  if (!amount) return null;
  const value = Number(amount.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** The notification for a push: '$43.12 at Trader Joe's' when the push says them, else a plain line; the tap opens its sheet. */
export function notificationFor(push: AlertPush): AlertNotification {
  const amount = money(push.amount);
  const merchant = push.merchant?.trim();
  const id = push.id && /^[0-9A-Za-z-]{1,64}$/.test(push.id) ? push.id : null;
  const title = amount && merchant ? `${amount} at ${merchant}` : amount ? `${amount} charge` : merchant ? `A charge at ${merchant}` : "A new charge to sort";
  const card = push.last4 ? `Card ending ${push.last4}. ` : "";
  return {
    title,
    body: `${card}Tap to sort it.`,
    tag: id ? `alert-${id}` : "alert",
    url: id ? `sort/${id}` : "",
  };
}

function readPush(data: { json(): unknown; text(): string } | null | undefined): AlertPush {
  if (!data) return {};
  try {
    const parsed = data.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as AlertPush) : {};
  } catch {
    return { title: data.text() };
  }
}

/** The part of a window client the worker uses. */
export interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
  postMessage(message: unknown): void;
}

/** The part of the service worker's global scope the handlers use. */
export interface PushScope {
  registration: {
    scope: string;
    showNotification(title: string, options: NotificationOptions): Promise<void>;
  };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
}

export interface PushEventLike {
  data?: { json(): unknown; text(): string } | null;
  waitUntil(promise: Promise<unknown>): void;
}

export interface NotificationClickLike {
  notification: { data?: unknown; close(): void };
  waitUntil(promise: Promise<unknown>): void;
}

/** A push: an alert's notification shown, and every open page told to read the feed. */
export function handlePush(scope: PushScope, event: PushEventLike): void {
  const push = readPush(event.data);
  if (push.class !== undefined && push.class !== "alert") return;
  const shown = notificationFor(push);
  event.waitUntil(
    Promise.all([
      scope.registration.showNotification(shown.title, {
        body: shown.body,
        tag: shown.tag,
        icon: new URL("icon-192.png", scope.registration.scope).href,
        badge: new URL("icon-192.png", scope.registration.scope).href,
        data: { url: shown.url },
      }),
      scope.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((open) => open.forEach((client) => client.postMessage({ type: PUSH_MESSAGE })))
        .catch(() => {}),
    ]),
  );
}

/** A tap on the notification: the app opens at the charge's sheet, in its open window when there is one. */
export function handleNotificationClick(scope: PushScope, event: NotificationClickLike): void {
  event.notification.close();
  const data = event.notification.data as { url?: unknown } | undefined;
  const target = new URL(typeof data?.url === "string" ? data.url : "", scope.registration.scope).href;
  event.waitUntil(
    scope.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (open) => {
      const window = open.find((client) => client.url.startsWith(scope.registration.scope));
      if (window?.navigate) {
        await window.focus();
        await window.navigate(target);
        return;
      }
      await scope.clients.openWindow(target);
    }),
  );
}

/** Puts the two handlers on the worker. */
export function installPushHandlers(scope: PushScope & { addEventListener(type: string, listener: (event: never) => void): void }): void {
  scope.addEventListener("push", (event: PushEventLike) => handlePush(scope, event));
  scope.addEventListener("notificationclick", (event: NotificationClickLike) => handleNotificationClick(scope, event));
}

declare const ServiceWorkerGlobalScope: { new (): unknown } | undefined;

// In the worker (not under a test): put the handlers on it.
if (typeof ServiceWorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
  installPushHandlers(self as unknown as Parameters<typeof installPushHandlers>[0]);
}
