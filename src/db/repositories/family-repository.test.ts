import { db } from "../database";
import { FamilyRepository } from "./family-repository";

describe("FamilyRepository", () => {
  const repo = new FamilyRepository();
  beforeEach(() => db.familyCards.clear());

  it("stores a card: its last four, whose it is and the YNAB account it maps to", async () => {
    const card = await repo.addCard({ lastFour: "1234", owner: "Jonathan", accountId: "chase-account" });
    expect(card.id).toBeTruthy();
    expect(await repo.listCards()).toEqual([
      { id: card.id, lastFour: "1234", owner: "Jonathan", accountId: "chase-account", createdAt: card.createdAt },
    ]);
  });

  it("keeps a card with no account", async () => {
    await repo.addCard({ lastFour: "4321", owner: "shared" });
    const [card] = await repo.listCards();
    expect(card?.accountId).toBeUndefined();
  });

  it("adding a last four it already has replaces that card, keeping its id", async () => {
    const first = await repo.addCard({ lastFour: "1234", owner: "Jonathan" });
    const again = await repo.addCard({ lastFour: "1234", owner: "Sam", accountId: "a2" });
    expect(again.id).toBe(first.id);
    expect(await repo.listCards()).toHaveLength(1);
    expect((await repo.listCards())[0]).toMatchObject({ owner: "Sam", accountId: "a2" });
  });

  it("refuses a last four that is not four digits and an empty name", async () => {
    await expect(repo.addCard({ lastFour: "12", owner: "Jonathan" })).rejects.toThrow("The last four is four digits.");
    await expect(repo.addCard({ lastFour: "12a4", owner: "Jonathan" })).rejects.toThrow("The last four is four digits.");
    await expect(repo.addCard({ lastFour: "1234", owner: "  " })).rejects.toThrow("Say whose card it is.");
    expect(await repo.listCards()).toEqual([]);
  });

  it("removes a card, and lists cards by last four", async () => {
    const b = await repo.addCard({ lastFour: "2222", owner: "B" });
    await repo.addCard({ lastFour: "1111", owner: "A" });
    expect((await repo.listCards()).map((c) => c.lastFour)).toEqual(["1111", "2222"]);
    await repo.removeCard(b.id);
    expect((await repo.listCards()).map((c) => c.lastFour)).toEqual(["1111"]);
  });
});
