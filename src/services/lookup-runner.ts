import { liveQuery, type Subscription } from "dexie";
import { door } from "bsv-kit/bsv";
import { grist } from "bsv-kit/grist";
import type { LookupMode, PendingLookup } from "@/contracts/types";
import { GROCERY_CATEGORIES } from "@/core/categories";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { parseItemAnswer } from "@/services/lookup-answer";

/** What one lookup sends: the app's input (schemas/item-from-photos-input-1.0) plus its photos. */
export interface LookupRequest {
  barcode: string;
  mode: LookupMode;
  categories: string[];
  photos: grist.Photo[];
  /** The lookup's id, so the backend stores a retried send once. */
  clientId: string;
}

/** The two things the runner needs of bsv-kit/grist; a fake in tests. */
export interface LookupClient {
  /** Uploads the photos and posts the grist; resolves with its txid. */
  send(request: LookupRequest): Promise<string>;
  /** Polls (every 20 s) until the mill's answer arrives; rejects with an AbortError when the signal aborts. */
  awaitAnswer(txid: string, signal: AbortSignal): Promise<grist.GristAnswer>;
}

export interface LookupRunnerOptions {
  /** First wait after a network error, doubled for each failure in a row. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

const DEFAULT_REASON = "The factory could not read this one.";

function isAbort(err: unknown): boolean {
  return (
    err instanceof grist.AwaitAbortedError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

async function toPhoto(blob: Blob): Promise<grist.Photo> {
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

/**
 * Runs the lookup queue while the app is open: sends waiting lookups one at a
 * time (oldest first) and waits for the answer of each one at the factory, but
 * only while it has a client (the door is licensed), the device is online, and,
 * for the waiting, the page is visible. State lives in the stored lookups, so a
 * reload resumes from the stored status.
 */
export class LookupRunner {
  private readonly repo = new PendingLookupRepository();
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private client: LookupClient | null = null;
  private online = true;
  private visible = true;
  private subscription: Subscription | null = null;
  private stopped = true;
  private pumping = false;
  private again = false;
  private failures = 0;
  private retryAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiters = new Map<string, AbortController>();

  constructor(options: LookupRunnerOptions = {}) {
    this.backoffBaseMs = options.backoffBaseMs ?? 5_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 5 * 60_000;
  }

  /** Begins watching the queue; safe to call once per runner. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.subscription = liveQuery(() => this.repo.listRunnable()).subscribe({
      next: () => this.kick(),
      error: () => undefined,
    });
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.abortWaiters();
  }

  /** The client is null while the door is not licensed (or not unlocked): then nothing goes out and nothing is polled. */
  setClient(client: LookupClient | null): void {
    if (client === this.client) return;
    this.client = client;
    this.kick();
  }

  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    this.kick();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.kick();
  }

  /** Looks at the queue again; runs are serialised, a call during a run asks for one more pass. */
  kick(): void {
    if (this.stopped) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    void this.pump().finally(() => {
      this.pumping = false;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  private async pump(): Promise<void> {
    const client = this.client;
    if (!client || !this.online) {
      this.abortWaiters();
      return;
    }

    let lookups: PendingLookup[];
    try {
      lookups = await this.repo.listRunnable();
    } catch {
      return;
    }

    // forget waits for lookups that are gone (discarded) or no longer at the factory
    const atFactory = new Set(
      lookups.filter((l) => l.status === "at-the-factory").map((l) => l.id),
    );
    for (const [id, controller] of this.waiters) {
      if (!atFactory.has(id) || !this.visible) {
        controller.abort();
        this.waiters.delete(id);
      }
    }

    // a timer can fire a hair before the clock says the backoff is over: wait out the rest
    if (Date.now() < this.retryAt && !this.retryTimer) this.armRetryTimer();

    if (Date.now() >= this.retryAt) {
      for (const lookup of lookups) {
        if (lookup.status !== "waiting-to-send") continue;
        if (this.stopped || this.client !== client || !this.online) return;
        if (!(await this.send(client, lookup))) break;
      }
    }

    if (this.visible && !this.stopped && Date.now() >= this.retryAt) {
      for (const lookup of lookups) {
        if (lookup.status !== "at-the-factory" || !lookup.gristTxid) continue;
        if (this.waiters.has(lookup.id)) continue;
        this.wait(client, lookup.id, lookup.gristTxid);
      }
    }
  }

  /** Sends one lookup; false when the queue should stop for now (a network error, backing off). */
  private async send(client: LookupClient, lookup: PendingLookup): Promise<boolean> {
    try {
      // the list is a moment old: a lookup discarded or changed since is not sent
      if ((await this.repo.getById(lookup.id))?.status !== "waiting-to-send") return true;
      const txid = await client.send({
        barcode: lookup.barcode,
        mode: lookup.mode ?? "new-item",
        categories: [...GROCERY_CATEGORIES],
        photos: await Promise.all(lookup.photos.map(toPhoto)),
        clientId: lookup.id,
      });
      await this.repo.markSent(lookup.id, txid);
      this.failures = 0;
      return true;
    } catch (err) {
      if (err instanceof grist.GristInputError || door.isPermanentRefusal(err)) {
        await this.repo.markFailed(lookup.id, err.message || DEFAULT_REASON);
        return true;
      }
      // a network error, or a door that is not open after all: the lookup stays waiting
      this.backOff();
      return false;
    }
  }

  private wait(client: LookupClient, id: string, txid: string): void {
    const controller = new AbortController();
    this.waiters.set(id, controller);
    client.awaitAnswer(txid, controller.signal).then(
      async (record) => {
        if (this.waiters.get(id) === controller) this.waiters.delete(id);
        this.failures = 0;
        await this.settle(id, record);
      },
      (err: unknown) => {
        if (this.waiters.get(id) === controller) this.waiters.delete(id);
        if (controller.signal.aborted || isAbort(err)) return;
        this.backOff();
      },
    );
  }

  private async settle(id: string, record: grist.GristAnswer): Promise<void> {
    try {
      if (record.status !== "answered") {
        await this.repo.markFailed(id, record.reason?.trim() || DEFAULT_REASON);
        return;
      }
      const parsed = parseItemAnswer(record.answer);
      if (!parsed.ok) {
        await this.repo.markFailed(id, parsed.error);
        return;
      }
      await this.repo.applyAnswer(id, parsed.answer);
    } catch (err) {
      await this.repo.markFailed(
        id,
        err instanceof Error && err.message ? err.message : DEFAULT_REASON,
      );
    }
  }

  private abortWaiters(): void {
    for (const controller of this.waiters.values()) controller.abort();
    this.waiters.clear();
  }

  /** Exponential backoff after a network error: the queue idles until the delay passes, then looks again. */
  private backOff(): void {
    this.failures++;
    const delay = Math.min(
      this.backoffBaseMs * 2 ** (this.failures - 1),
      this.backoffMaxMs,
    );
    this.retryAt = Date.now() + delay;
    this.armRetryTimer();
  }

  /** (Re)starts the timer that looks at the queue again when the backoff ends. */
  private armRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, Math.max(0, this.retryAt - Date.now()));
  }
}
