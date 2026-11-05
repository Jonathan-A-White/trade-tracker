import { db } from "@/db/database";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { ANYONE, cardBook, loadCardBook, rememberAccount } from "./cards";

describe("cardBook", () => {
  const now = 1;
  const book = cardBook([
    { id: "c1", lastFour: "1234", owner: "Jonathan", accountId: "chase", createdAt: now },
    { id: "c2", lastFour: "9876", owner: "shared", createdAt: now },
  ]);

  it("answers whose a card is and which YNAB account it maps to", () => {
    expect(book.owner("1234")).toBe("Jonathan");
    expect(book.account("1234")).toBe("chase");
    expect(book.owner("9876")).toBe("shared");
    expect(book.account("9876")).toBeNull();
  });

  it("answers 'anyone' for a last four it does not know, and no account", () => {
    expect(ANYONE).toBe("anyone");
    expect(book.owner("0000")).toBe("anyone");
    expect(book.account("0000")).toBeNull();
    expect(book.owner(undefined)).toBe("anyone");
  });

  it("reads the cards from the repository", async () => {
    await db.familyCards.clear();
    await new FamilyRepository().addCard({ lastFour: "1234", owner: "Jonathan", accountId: "chase" });
    const loaded = await loadCardBook();
    expect(loaded.owner("1234")).toBe("Jonathan");
    expect(loaded.account("1234")).toBe("chase");
    expect(loaded.owner("5555")).toBe("anyone");
  });
});

describe("rememberAccount", () => {
  it("puts the account on a card's row and keeps its owner", async () => {
    await db.familyCards.clear();
    const repo = new FamilyRepository();
    const before = await repo.addCard({ lastFour: "4321", owner: "Sarah" });
    await rememberAccount("4321", "citi", repo);
    const book = await loadCardBook(repo);
    expect(book.account("4321")).toBe("citi");
    expect(book.owner("4321")).toBe("Sarah");
    expect((await repo.listCards())[0]?.id).toBe(before.id);
  });

  it("adds a row owned by 'anyone' for a last four with none", async () => {
    await db.familyCards.clear();
    const repo = new FamilyRepository();
    await rememberAccount("8235", "chase", repo);
    const book = await loadCardBook(repo);
    expect(book.account("8235")).toBe("chase");
    expect(book.owner("8235")).toBe(ANYONE);
    expect(await repo.listCards()).toHaveLength(1);
  });
});
