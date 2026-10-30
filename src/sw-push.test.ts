import { PUSH_MESSAGE as PAGE_MESSAGE } from "@/sort/useAlerts";
import {
  PUSH_MESSAGE,
  handleNotificationClick,
  handlePush,
  installPushHandlers,
  notificationFor,
  type PushScope,
  type WindowClientLike,
} from "./sw-push";

const SCOPE = "https://jonathan-a-white.github.io/trade-tracker/";

function fakeWorker(open: WindowClientLike[] = []) {
  const shown: { title: string; options: NotificationOptions }[] = [];
  const opened: string[] = [];
  const scope: PushScope = {
    registration: {
      scope: SCOPE,
      showNotification: async (title, options) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => open,
      openWindow: async (url) => {
        opened.push(url);
      },
    },
  };
  return { scope, shown, opened };
}

function pushEvent(body: unknown) {
  const waits: Promise<unknown>[] = [];
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    event: {
      data: { json: () => JSON.parse(text) as unknown, text: () => text },
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    },
    settled: () => Promise.all(waits),
  };
}

function clickEvent(data: unknown) {
  const waits: Promise<unknown>[] = [];
  const notification = { data, close: vi.fn() };
  return {
    notification,
    event: { notification, waitUntil: (p: Promise<unknown>) => void waits.push(p) },
    settled: () => Promise.all(waits),
  };
}

describe("the service worker's push", () => {
  it("shows the notification with the amount and merchant, and its tap opens the charge's sheet", async () => {
    const worker = fakeWorker();
    const push = pushEvent({ class: "alert", title: "New alert", id: "00000000000000a1", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    handlePush(worker.scope, push.event);
    await push.settled();

    expect(worker.shown).toHaveLength(1);
    const [{ title, options }] = worker.shown;
    expect(title).toBe("$43.12 at Trader Joe's");
    expect(options.body).toBe("Card ending 1234. Tap to sort it.");
    expect(options.tag).toBe("alert-00000000000000a1");

    const click = clickEvent(options.data);
    handleNotificationClick(worker.scope, click.event);
    await click.settled();
    expect(click.notification.close).toHaveBeenCalled();
    expect(worker.opened).toEqual([`${SCOPE}sort/00000000000000a1`]);
  });

  it("a tap with the app already open moves that window to the sheet instead of opening another", async () => {
    const window: WindowClientLike = { url: `${SCOPE}trips/history`, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}), postMessage: vi.fn() };
    const worker = fakeWorker([window]);
    const click = clickEvent({ url: "sort/00000000000000a1" });
    handleNotificationClick(worker.scope, click.event);
    await click.settled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.navigate).toHaveBeenCalledWith(`${SCOPE}sort/00000000000000a1`);
    expect(worker.opened).toEqual([]);
  });

  it("Postern's push today (no amount, merchant or id) shows a plain line and its tap opens Home", async () => {
    const worker = fakeWorker();
    const push = pushEvent({ class: "alert", title: "New alert", ts: 1793836800 });
    handlePush(worker.scope, push.event);
    await push.settled();
    expect(worker.shown[0]!.title).toBe("A new charge to sort");
    expect(worker.shown[0]!.options.data).toEqual({ url: "" });

    const click = clickEvent(worker.shown[0]!.options.data);
    handleNotificationClick(worker.scope, click.event);
    await click.settled();
    expect(worker.opened).toEqual([SCOPE]);
  });

  it("tells an open page to read the feed, with the message the page listens for", async () => {
    const window: WindowClientLike = { url: SCOPE, focus: vi.fn(), postMessage: vi.fn() };
    const worker = fakeWorker([window]);
    const push = pushEvent({ class: "alert" });
    handlePush(worker.scope, push.event);
    await push.settled();
    expect(PUSH_MESSAGE).toBe(PAGE_MESSAGE);
    expect(window.postMessage).toHaveBeenCalledWith({ type: PUSH_MESSAGE });
  });

  it("shows nothing for a push of another class", async () => {
    const worker = fakeWorker();
    const push = pushEvent({ class: "talk", title: "Hello" });
    handlePush(worker.scope, push.event);
    await push.settled();
    expect(worker.shown).toEqual([]);
  });

  it("an id that is no alert's is not put in the URL", () => {
    expect(notificationFor({ id: "../../evil", amount: "5" }).url).toBe("");
    expect(notificationFor({ amount: "5.5" }).title).toBe("$5.50 charge");
  });

  it("installs both handlers on the worker", () => {
    const worker = fakeWorker();
    const types: string[] = [];
    installPushHandlers({ ...worker.scope, addEventListener: (type) => void types.push(type) });
    expect(types).toEqual(["push", "notificationclick"]);
  });
});
