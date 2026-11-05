import { db } from "../database";
import type { FamilyCard } from "../../contracts/types";

export interface AddCardInput {
  lastFour: string;
  owner: string;
  accountId?: string;
}

/** The family's cards: a last four is one card, so adding one the repository already has replaces it. */
export class FamilyRepository {
  async listCards(): Promise<FamilyCard[]> {
    return db.familyCards.orderBy("lastFour").toArray();
  }

  async addCard(input: AddCardInput): Promise<FamilyCard> {
    const lastFour = input.lastFour.trim();
    const owner = input.owner.trim();
    if (!/^\d{4}$/.test(lastFour)) throw new Error("The last four is four digits.");
    if (owner === "") throw new Error("Say whose card it is.");
    return db.transaction("rw", db.familyCards, async () => {
      const existing = await db.familyCards.where("lastFour").equals(lastFour).first();
      const card: FamilyCard = {
        id: existing?.id ?? crypto.randomUUID(),
        lastFour,
        owner,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        createdAt: existing?.createdAt ?? Date.now(),
      };
      await db.familyCards.put(card);
      return card;
    });
  }

  /**
   * Remembers the YNAB account for a last four: a card the repository has keeps its owner and takes the account; a last four it
   * does not have is added with `owner` (who the book answers for an unknown card).
   */
  async setAccount(lastFour: string, accountId: string, owner: string): Promise<FamilyCard> {
    const four = lastFour.trim();
    const existing = await db.familyCards.where("lastFour").equals(four).first();
    return this.addCard({ lastFour: four, owner: existing?.owner ?? owner, accountId });
  }

  async removeCard(id: string): Promise<void> {
    await db.familyCards.delete(id);
  }
}
