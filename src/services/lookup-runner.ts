import { liveQuery, type Subscription } from "dexie";
import { door } from "bsv-kit/bsv";
import { AwaitAbortedError, GristInputError } from "@/factory/mill";
import type { GristAnswer, Photo } from "@/factory/mill";
import type { LookupMode, PendingLookup } from "@/contracts/types";
import { GROCERY_CATEGORIES } from "@/core/categories";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { parseItemAnswer } from "@/services/lookup-answer";

/** What one lookup sends: the app's input (schemas/item-from-photos-input-1.0) plus its photos. */
export interface LookupRequest {
  barcode: string;
  mode: LookupMode;
  categories: string[];
  photos: Photo[];
  /** The lookup's id, so the backend stores a retried send once. */
  clientId: string;
}

/** The two things the runner needs of the mill; a fake in tests. */
export interface LookupClient {
  /** Uploads the photos and posts the grist; resolves with its txid. */
  send(request: LookupRequest): Promise<string>;
  /** Polls (every 20 s) until the mill's answer arrives; rejects with an AbortError when the signal aborts. */
  awaitAnswer(txid: string, signal: AbortSignal): Promise<GristAnswer>;
}

export interface LookupRunnerOptions {
  /** First wait after a network error, doubled for each failure in a row. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** How long a sent lookup may wait for its answer, with the phone able to listen, before it is sent once more. */
  resendAfterMs?: number;
  /** How long after that second send the line gives up and says the answer did not come back. */
  giveUpAfterMs?: number;
}

/** Postern may hold a grist for minutes while the factory is busy, so the limits are generous. */
const RESEND_AFTER_MS = 3 * 60_000;
const GIVE_UP_AFTER_MS = 3 * 60_000;

interface Waiter {
  controller: AbortController;
  /** The limit on this wait; none once the line has said the answer did not come back. */
  limit: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_REASON = "The factory could not read this one.";

function isAbort(err: unknown): boolean {
  return (
    err instanceof AwaitAbortedError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

async function toPhoto(blob: Blob): Promise<Photo> {
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

/** The request for a lookup; always the same request id (the lookup's own), so a send repeated reaches the factory once. */
async function requestOf(lookup: PendingLookup): Promise<LookupRequest> {
  return {
    barcode: lookup.barcode,
    mode: lookup.mode ?? "new-item",
    categories: [...GROCERY_CATEGORIES],
    photos: await Promise.all(lookup.photos.map(toPhoto)),
    clientId: lookup.id,
  };
}

/**
 * Runs the lookup queue while the app is open: sends waiting lookups one at a
 * time (oldest first) and waits for the answer of each one at the factory, but
 * only while it has a client (the door is licensed), the device is online, and,
 * for the waiting, the page is visible. State lives in the stored lookups, so a
 * reload resumes from the stored status.
 *
 * A lookup waits for its answer at most `resendAfterMs` of listening before it is sent once more
 * (under the same request id, so the factory grinds it once), and a further `giveUpAfterMs` before
 * the line says it did not come back. The clock runs only while a wait is running: it starts again
 * whenever the page was hidden, the device offline or the door shut. The runner goes on listening
 * for a lookup that did not come back, so a late answer still fills its line.
 */
export class LookupRunner {
  private readonly repo = new PendingLookupRepository();
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly resendAfterMs: number;
  private readonly giveUpAfterMs: number;
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
  private readonly waiters = new Map<string, Waiter>();
  /** Lookups whose limit is being dealt with (sent again, or marked not come back): not waited on until that is done. */
  private readonly atLimit = new Set<string>();
  private backingOff = false;
  private onBackoffChange: ((backingOff: boolean) => void) | null = null;

  constructor(options: LookupRunnerOptions = {}) {
    this.backoffBaseMs = options.backoffBaseMs ?? 5_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 5 * 60_000;
    this.resendAfterMs = options.resendAfterMs ?? RESEND_AFTER_MS;
    this.giveUpAfterMs = options.giveUpAfterMs ?? GIVE_UP_AFTER_MS;
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

  /** Tells `listener` whenever the queue starts or stops waiting out a failed send (it is told the current state at once). */
  watchBackoff(listener: ((backingOff: boolean) => void) | null): void {
    this.onBackoffChange = listener;
    listener?.(this.backingOff);
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
    for (const id of [...this.waiters.keys()]) {
      if (!atFactory.has(id) || !this.visible) this.dropWaiter(id);
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
        if (this.waiters.has(lookup.id) || this.atLimit.has(lookup.id)) continue;
        this.wait(client, lookup);
      }
    }
  }

  /** Sends one lookup; false when the queue should stop for now (a network error, backing off). */
  private async send(client: LookupClient, lookup: PendingLookup): Promise<boolean> {
    try {
      // the list is a moment old: a lookup discarded or changed since is not sent
      if ((await this.repo.getById(lookup.id))?.status !== "waiting-to-send") return true;
      const txid = await client.send(await requestOf(lookup));
      await this.repo.markSent(lookup.id, txid);
      this.failures = 0;
      this.setBackingOff(false);
      return true;
    } catch (err) {
      if (err instanceof GristInputError || door.isPermanentRefusal(err)) {
        await this.repo.markFailed(lookup.id, err.message || DEFAULT_REASON);
        return true;
      }
      // a network error, or a door that is not open after all: the lookup stays waiting
      this.backOff();
      return false;
    }
  }

  private wait(client: LookupClient, lookup: PendingLookup): void {
    const { id } = lookup;
    const txid = lookup.gristTxid!;
    const controller = new AbortController();
    const limit = lookup.notBack
      ? null
      : setTimeout(
          () => void this.pastLimit(client, id),
          lookup.resentAt ? this.giveUpAfterMs : this.resendAfterMs,
        );
    const waiter: Waiter = { controller, limit };
    this.waiters.set(id, waiter);
    const forget = () => {
      if (waiter.limit) clearTimeout(waiter.limit);
      if (this.waiters.get(id) === waiter) this.waiters.delete(id);
    };
    client.awaitAnswer(txid, controller.signal).then(
      async (record) => {
        forget();
        this.failures = 0;
        this.setBackingOff(false);
        await this.settle(id, record);
      },
      (err: unknown) => {
        forget();
        if (controller.signal.aborted || isAbort(err)) return;
        this.backOff();
      },
    );
  }

  /**
   * The wait for an answer ran out: the first time the lookup is sent again, the second time the line
   * says the answer did not come back. Listening goes on either way (the pass after this one starts it).
   */
  private async pastLimit(client: LookupClient, id: string): Promise<void> {
    this.dropWaiter(id);
    this.atLimit.add(id);
    try {
      const lookup = await this.repo.getById(id);
      if (this.stopped || this.client !== client) return;
      if (!lookup || lookup.status !== "at-the-factory" || lookup.notBack) return;
      if (lookup.resentAt) {
        await this.repo.markNotBack(id);
        return;
      }
      const txid = await client.send(await requestOf(lookup));
      await this.repo.markResent(id, txid);
    } catch (err) {
      if (err instanceof GristInputError || door.isPermanentRefusal(err)) {
        await this.repo.markFailed(id, err.message || DEFAULT_REASON);
      } else {
        this.backOff();
      }
    } finally {
      this.atLimit.delete(id);
      this.kick();
    }
  }

  private dropWaiter(id: string): void {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    waiter.controller.abort();
    if (waiter.limit) clearTimeout(waiter.limit);
    this.waiters.delete(id);
  }

  private async settle(id: string, record: GristAnswer): Promise<void> {
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
    for (const id of [...this.waiters.keys()]) this.dropWaiter(id);
  }

  /** Exponential backoff after a network error: the queue idles until the delay passes, then looks again. */
  private backOff(): void {
    this.failures++;
    const delay = Math.min(
      this.backoffBaseMs * 2 ** (this.failures - 1),
      this.backoffMaxMs,
    );
    this.retryAt = Date.now() + delay;
    this.setBackingOff(true);
    this.armRetryTimer();
  }

  private setBackingOff(backingOff: boolean): void {
    if (backingOff === this.backingOff) return;
    this.backingOff = backingOff;
    this.onBackoffChange?.(backingOff);
  }

  /** (Re)starts the timer that looks at the queue again when the backoff ends. */
  private armRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (Date.now() >= this.retryAt) this.setBackingOff(false);
      this.kick();
    }, Math.max(0, this.retryAt - Date.now()));
  }
}
