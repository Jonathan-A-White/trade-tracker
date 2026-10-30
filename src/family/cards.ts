import { FamilyRepository } from "@/db/repositories/family-repository";
import type { FamilyCard } from "@/contracts/types";

/** What owner() answers for a last four that is no card of the family's. */
export const ANYONE = "anyone";

/** The family's cards, asked by a card's last four (as an alert names it). */
export interface CardBook {
  /** Whose the card is: the name it was added with, or 'anyone' for a last four it does not know. */
  owner(lastFour: string | undefined): string;
  /** The id of the YNAB account the card maps to; null when it maps to none or is not a card of the family's. */
  account(lastFour: string | undefined): string | null;
}

export function cardBook(cards: readonly FamilyCard[]): CardBook {
  const byLastFour = new Map(cards.map((card) => [card.lastFour, card]));
  return {
    owner: (lastFour) => (lastFour === undefined ? ANYONE : (byLastFour.get(lastFour)?.owner ?? ANYONE)),
    account: (lastFour) => (lastFour === undefined ? null : (byLastFour.get(lastFour)?.accountId ?? null)),
  };
}

/** The card book as the repository holds it now. */
export async function loadCardBook(repo: FamilyRepository = new FamilyRepository()): Promise<CardBook> {
  return cardBook(await repo.listCards());
}
