import type { FamilyAlert } from "@/family/alerts-client";
import { MEMO_LIMIT, amazonMemo, matchOrder, orderMemo } from "./amazon-memo";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T15:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

function order(over: Partial<FamilyAlert> & { seq: number }): FamilyAlert {
  return { id: `a${over.seq}`, kind: "amazon", merchant: "Amazon", ...over };
}

const noCut = (memo: string) => {
  // every word of the memo is a whole word of the source items
  expect(memo).not.toMatch(/\s{2,}/);
  expect(memo.length).toBeLessThanOrEqual(MEMO_LIMIT);
};

describe("amazonMemo", () => {
  it("writes one item as it is named", () => {
    expect(amazonMemo("Return Address Labels")).toBe("Return Address Labels");
  });

  it("joins three items with '; ' in the mail's order, each cut to its first words", () => {
    const memo = amazonMemo("2 Widgets, 1 Kitchen Gadgets, 1 Stainless Steel Insulated Water Bottle With Straw Lid And Handle");
    expect(memo).toBe("2 Widgets; 1 Kitchen Gadgets; 1 Stainless Steel Insulated Water");
    noCut(memo);
  });

  it("fits ten long items to 150 characters, ends '& N more' with N right, and never cuts a word", () => {
    const items = Array.from({ length: 10 }, (_, i) => `1 Extraordinarily${i} Comfortable Ergonomic Wireless Keyboard`);
    const memo = amazonMemo(items.join(", "));
    noCut(memo);
    const shown = memo.replace(/; & \d+ more$/, "").split("; ");
    const more = /& (\d+) more$/.exec(memo);
    expect(more).not.toBeNull();
    expect(shown.length + Number(more![1])).toBe(10);
    for (const s of shown) expect(s).toMatch(/^1 Extraordinarily\d( Comfortable)?( Ergonomic)?( Wireless)?( Keyboard)?$/);
    expect(shown[0]).toMatch(/^1 Extraordinarily0/);
  });

  it("starts 'Part of: ' for a slice of a bigger order, still within 150", () => {
    const items = Array.from({ length: 10 }, (_, i) => `Gizmo number${i} with a long name`);
    const memo = amazonMemo(items.join(", "), true);
    expect(memo.startsWith("Part of: ")).toBe(true);
    noCut(memo);
    expect(memo).toMatch(/& \d+ more$/);
  });

  it("is empty when there are no items", () => {
    expect(amazonMemo("")).toBe("");
    expect(amazonMemo("  ")).toBe("");
  });
});

describe("matchOrder", () => {
  const when = iso(0);
  it("takes the newest amazon alert with the charge's amount in the 14 days before it", () => {
    const alerts = [
      order({ seq: 1, amount: "92.05", items: "Old", when: iso(5) }),
      order({ seq: 2, amount: "92.05", items: "Newer", when: iso(3) }),
      order({ seq: 3, amount: "10.00", items: "Other", when: iso(1) }),
    ];
    expect(matchOrder(alerts, 92.05, when)).toEqual({ items: "Newer", part: false });
  });

  it("ignores an order older than 14 days, one after the charge, and one with no items", () => {
    const alerts = [
      order({ seq: 1, amount: "92.05", items: "Too old", when: iso(15) }),
      order({ seq: 2, amount: "92.05", items: "Later", when: new Date(NOW + DAY).toISOString() }),
      order({ seq: 3, amount: "92.05", when: iso(1) }),
    ];
    expect(matchOrder(alerts, 92.05, iso(0))).toBeNull();
  });

  it("falls back to the newest larger order, as a part of it", () => {
    const alerts = [
      order({ seq: 1, amount: "150.00", items: "Big", when: iso(6) }),
      order({ seq: 2, amount: "200.00", items: "Bigger", when: iso(2) }),
      order({ seq: 3, amount: "20.00", items: "Small", when: iso(1) }),
    ];
    expect(matchOrder(alerts, 92.05, when)).toEqual({ items: "Bigger", part: true });
  });

  it("ignores charges and other kinds", () => {
    const alerts: FamilyAlert[] = [{ id: "c", seq: 1, kind: "charge", amount: "92.05", items: "x", when: iso(1) }];
    expect(matchOrder(alerts, 92.05, when)).toBeNull();
  });
});

describe("orderMemo", () => {
  const alerts = [order({ seq: 1, amount: "92.05", items: "3 Widgets, Gadget", when: iso(2) })];
  it("is written for an Amazon charge only", () => {
    expect(orderMemo(alerts, "AMAZON MKTPLACE PMTS", 92.05, iso(0))).toBe("3 Widgets; Gadget");
    expect(orderMemo(alerts, "Amazon.com", 92.05, iso(0))).toBe("3 Widgets; Gadget");
    expect(orderMemo(alerts, "Trader Joe's", 92.05, iso(0))).toBe("");
  });
  it("is empty with no match", () => {
    expect(orderMemo(alerts, "AMAZON MKTPLACE PMTS", 100, iso(0))).toBe("");
  });
});
