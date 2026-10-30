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

  async removeCard(id: string): Promise<void> {
    await db.familyCards.delete(id);
  }
}
