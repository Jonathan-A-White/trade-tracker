import { db } from "../database";
import type { YnabLink, YnabOutboxItem } from "../../contracts/types";

/** The YNAB outbox's table (the shape pwa-kit/outbox keeps) and the links from a local transaction to its YNAB id. */
export class YnabOutboxRepository {
  /** The Dexie table the outbox queues in. */
  get table() {
    return db.ynabOutbox;
  }

  async list(): Promise<YnabOutboxItem[]> {
    return db.ynabOutbox.orderBy("queuedAt").toArray();
  }

  /** Writes that are not yet sent (waiting, sending or failed). */
  async pendingCount(): Promise<number> {
    return (await db.ynabOutbox.toArray()).filter((i) => i.stage !== "sent").length;
  }

  async getLink(localId: string): Promise<YnabLink | undefined> {
    return db.ynabLinks.get(localId);
  }

  async ynabIdOf(localId: string): Promise<string | undefined> {
    return (await db.ynabLinks.get(localId))?.ynabId;
  }

  /** Notes that the create is about to be posted: from here on, a retry looks in YNAB before it posts again. */
  async markStarted(localId: string): Promise<void> {
    const there = await db.ynabLinks.get(localId);
    if (!there) await db.ynabLinks.put({ localId, startedAt: Date.now() });
  }

  async setYnabId(localId: string, ynabId: string): Promise<void> {
    const there = await db.ynabLinks.get(localId);
    await db.ynabLinks.put({ localId, startedAt: there?.startedAt ?? Date.now(), ynabId });
  }

  async removeLink(localId: string): Promise<void> {
    await db.ynabLinks.delete(localId);
  }

  /** Forgets every queued write and link. */
  async clearAll(): Promise<void> {
    await db.transaction("rw", [db.ynabOutbox, db.ynabLinks], async () => {
      await db.ynabOutbox.clear();
      await db.ynabLinks.clear();
    });
  }
}
