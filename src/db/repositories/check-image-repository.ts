import { db } from "../database";
import type { CheckImage, CheckReadAnswer } from "../../contracts/types";

/** The check images Clean up keeps on the device, one per YNAB transaction. They never go to YNAB. */
export class CheckImageRepository {
  async get(transactionId: string): Promise<CheckImage | undefined> {
    return db.checkImages.get(transactionId);
  }

  /** The ones kept for these transactions, by transaction id. */
  async many(transactionIds: readonly string[]): Promise<Map<string, CheckImage>> {
    const rows = await db.checkImages.bulkGet([...transactionIds]);
    return new Map(rows.flatMap((row) => (row ? [[row.transactionId, row] as const] : [])));
  }

  /** Keeps a new image for the transaction; an earlier image and its read are replaced. */
  async put(transactionId: string, image: Blob): Promise<CheckImage> {
    const row: CheckImage = { transactionId, image, addedAt: Date.now() };
    await db.checkImages.put(row);
    return row;
  }

  /** Keeps what the mill read from the image added at `addedAt`; nothing when the image has since been replaced. */
  async setRead(transactionId: string, addedAt: number, read: CheckReadAnswer): Promise<void> {
    await db.transaction("rw", db.checkImages, async () => {
      const row = await db.checkImages.get(transactionId);
      if (row && row.addedAt === addedAt) await db.checkImages.put({ ...row, read });
    });
  }

  async remove(transactionId: string): Promise<void> {
    await db.checkImages.delete(transactionId);
  }
}
