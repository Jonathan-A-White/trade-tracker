import type { FamilyCard } from "@/contracts/types";
import { ownLastFours } from "./waiting";

const card = (lastFour: string, owner: string): FamilyCard => ({ id: lastFour, lastFour, owner, createdAt: 1 });

describe("ownLastFours", () => {
  const cards = [card("1234", "Jonathan"), card("5678", "Sam"), card("9876", "shared"), card("4321", "anyone"), card("1111", "jonathan")];

  it("lists this phone's person's cards and the shared ones, never the other person's", () => {
    expect(ownLastFours(cards, "Jonathan")).toEqual(["1111", "1234", "9876"]);
    expect(ownLastFours(cards, "Sam")).toEqual(["5678", "9876"]);
  });

  it("leaves out a card owned by 'anyone', which follows the backend's rule for an unlisted card", () => {
    expect(ownLastFours(cards, "Sam")).not.toContain("4321");
  });

  it("lists nothing for a phone with no person set", () => {
    expect(ownLastFours(cards, null)).toEqual([]);
  });
});
