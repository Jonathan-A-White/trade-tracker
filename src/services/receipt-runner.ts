import { liveQuery, type Subscription } from "dexie";
import type { grist } from "bsv-kit/grist";
import { db } from "@/db/database";
import {
  RECEIPT_TIMEOUT_MS,
  receiptTimedOut,
  settleReceipt,
  type ReceiptClient,
} from "@/services/receipt-reconcile";

export interface ReceiptRunnerOptions {
  /** First wait after a network error, doubled for each failure in a row. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || err.name === "AwaitAbortedError")
  );
}

interface Waiter {
  txid: string;
  controller: AbortController;
}

/**
 * Fetches the factory's answer to every receipt a trip is waiting on and applies it, whether or not
 * the trip's page is open. The wait lives on the trip (receiptPending), so a reload resumes it. It
 * waits only while it has a client (the door is licensed), the device is online and the page is
 * visible, and gives up on a receipt RECEIPT_TIMEOUT_MS after it was sent.
 */
export class ReceiptRunner {
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private client: ReceiptClient | null = null;
  private online = true;
  private visible = true;
  private subscription: Subscription | null = null;
  private stopped = true;
  private pumping = false;
  private again = false;
  private failures = 0;
  private retryAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiters = new Map<string, Waiter>();

  constructor(options: ReceiptRunnerOptions = {}) {
    this.backoffBaseMs = options.backoffBaseMs ?? 5_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 5 * 60_000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.subscription = liveQuery(() => this.waitingTrips()).subscribe({
      next: () => this.kick(),
      error: () => undefined,
    });
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abortWaiters();
  }

  setClient(client: ReceiptClient | null): void {
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

  /** Looks at the waiting receipts again; runs are serialised, a call during a run asks for one more pass. */
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

  /** Trips with a receipt sent and neither answered nor refused. */
  private async waitingTrips() {
    return (await db.trips.toArray()).filter((trip) => trip.receiptPending && !trip.receiptPending.error);
  }

  private async pump(): Promise<void> {
    const client = this.client;
    if (!client || !this.online || !this.visible) {
      this.abortWaiters();
      return;
    }
    let trips;
    try {
      trips = await this.waitingTrips();
    } catch {
      return;
    }

    // forget waits for receipts that are gone (sent again, answered, refused)
    const current = new Map(trips.map((trip) => [trip.id, trip.receiptPending!.txid]));
    for (const [tripId, waiter] of this.waiters) {
      if (current.get(tripId) !== waiter.txid) {
        waiter.controller.abort();
        this.waiters.delete(tripId);
      }
    }

    const now = Date.now();
    let next = Infinity;
    if (now < this.retryAt) next = this.retryAt - now;
    for (const trip of trips) {
      const pending = trip.receiptPending!;
      if (receiptTimedOut(pending, now)) continue;
      if (this.waiters.has(trip.id)) continue;
      if (now >= this.retryAt) this.wait(client, trip.id, pending.txid, pending.sentAt);
    }
    if (next < Infinity) this.armTimer(next);
  }

  private wait(client: ReceiptClient, tripId: string, txid: string, sentAt: number): void {
    const controller = new AbortController();
    this.waiters.set(tripId, { txid, controller });
    // the factory has RECEIPT_TIMEOUT_MS from the send; the card then says it did not answer
    const giveUp = setTimeout(
      () => controller.abort(),
      Math.max(0, sentAt + RECEIPT_TIMEOUT_MS - Date.now()),
    );
    const forget = () => {
      clearTimeout(giveUp);
      if (this.waiters.get(tripId)?.controller === controller) this.waiters.delete(tripId);
    };
    client.awaitAnswer(txid, controller.signal).then(
      async (record: grist.GristAnswer) => {
        forget();
        this.failures = 0;
        try {
          await settleReceipt(tripId, txid, record);
        } catch (err) {
          console.error("Failed to settle the receipt:", err);
        }
      },
      (err: unknown) => {
        forget();
        if (controller.signal.aborted || isAbort(err)) return;
        this.backOff();
      },
    );
  }

  private abortWaiters(): void {
    for (const waiter of this.waiters.values()) waiter.controller.abort();
    this.waiters.clear();
  }

  /** Exponential backoff after a network error: nothing is polled until the delay passes, then it looks again. */
  private backOff(): void {
    this.failures++;
    const delay = Math.min(this.backoffBaseMs * 2 ** (this.failures - 1), this.backoffMaxMs);
    this.retryAt = Date.now() + delay;
    this.armTimer(delay);
  }

  private armTimer(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, Math.max(0, delay));
  }
}
