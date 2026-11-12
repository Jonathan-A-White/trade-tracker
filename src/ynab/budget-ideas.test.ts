import {
  CATCH_ALL_NAME,
  DEFAULT_IDEA_SETTINGS,
  IDEA_SETTINGS_KEY,
  KINDS_KEY,
  MAX_NEW_A_MONTH,
  NOT_NOW_DAYS,
  chargesTo,
  chooseShown,
  dismiss,
  forgetBudgetIdeas,
  isDismissed,
  proposeIdeas,
  refreshIdeaCharges,
  readDismissed,
  readIdeaSettings,
  readKinds,
  roundUpTo5,
  writeIdeaSettings,
  writeKind,
  type IdeaCharge,
} from "./budget-ideas";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { createYnabClient } from "./api";
import { fakeYnab, groupOf, type FakeYnab } from "./fake-ynab";
import type { YnabTransactionWire } from "./types";

const TODAY = "2026-08-15";
let n = 0;
const c = (date: string, payee: string, amount: number): IdeaCharge => ({ id: `t${++n}`, date, payee, amount });
const kinds = (entries: Record<string, string>) => (payee: string) => entries[payee.trim().toLowerCase()];
const propose = (charges: IdeaCharge[], more: Partial<Parameters<typeof proposeIdeas>[1]> = {}) =>
  proposeIdeas(charges, { today: TODAY, kindOf: () => undefined, settings: DEFAULT_IDEA_SETTINGS, ...more });

describe("roundUpTo5", () => {
  it("rounds up to the next five dollars, and never below five", () => {
    expect(roundUpTo5(38.25)).toBe(40);
    expect(roundUpTo5(40)).toBe(40);
    expect(roundUpTo5(40.01)).toBe(45);
    expect(roundUpTo5(0.5)).toBe(5);
  });
});

describe("chargesTo", () => {
  const row = (over: Partial<YnabTransactionWire>): YnabTransactionWire => ({ id: "x", account_id: "a", date: "2026-07-01", amount: -10_000, payee_name: "Blueland", category_id: "forgot", ...over });
  it("takes the outflows to the category, dollars positive, a split's part by its own amount", () => {
    const rows = [
      row({ id: "1" }),
      row({ id: "2", category_id: "other" }),
      row({ id: "3", amount: 5_000 }),
      row({ id: "4", deleted: true }),
      row({ id: "5", transfer_account_id: "acct" }),
      row({ id: "6", category_id: null, amount: -30_000, subtransactions: [{ amount: -10_000, category_id: "forgot" }, { amount: -20_000, category_id: "food" }] }),
      row({ id: "7", payee_name: null }),
    ];
    expect(chargesTo(rows, "forgot").map((x) => [x.id, x.amount])).toEqual([["1", 10], ["6", 10]]);
  });
});

describe("proposals: what keeps landing in Stuff I Forgot to Budget For", () => {
  it("proposes one 'Cleaning supplies' category for Puracy Naturals and Blueland, with the average a month rounded up to $5", () => {
    const charges = [
      c("2026-03-24", "Puracy Naturals", 149.91),
      c("2026-05-08", "Blueland", 38.4),
      c("2026-07-02", "Blueland", 41.2),
    ];
    const ideas = propose(charges, { kindOf: kinds({ "puracy naturals": "Cleaning supplies", blueland: "Cleaning supplies" }) });
    expect(ideas).toHaveLength(1);
    const idea = ideas[0]!;
    expect(idea.name).toBe("Cleaning supplies");
    expect(idea.cadence).toBe("monthly");
    // 229.51 over March..August (6 months) = 38.25 a month, up to 40
    expect(idea.amount).toBe(40);
    expect(idea.charges.map((x) => x.id)).toEqual(charges.map((x) => x.id));
    expect(idea.payees.sort()).toEqual(["Blueland", "Puracy Naturals"]);
  });

  it("does not join the two payees when their kind is not known: each is on its own and neither alone has enough", () => {
    const charges = [c("2026-03-24", "Puracy Naturals", 149.91), c("2026-05-08", "Blueland", 38.4), c("2026-07-02", "Blueland", 41.2)];
    expect(propose(charges)).toEqual([]);
  });

  it("proposes one payee that went there 3 times in six months, named for the payee", () => {
    const charges = [c("2026-03-01", "Hardware Hank", 20), c("2026-04-03", "Hardware Hank", 25), c("2026-06-20", "Hardware Hank", 30), c("2026-07-20", "Hardware Hank", 31)];
    const [idea] = propose(charges);
    expect(idea!.name).toBe("Hardware Hank");
    expect(idea!.cadence).toBe("monthly");
    expect(idea!.charges).toHaveLength(4);
  });

  it("proposes a payee seen in two months running even with two charges, when the year's spend passes", () => {
    const [idea] = propose([c("2026-06-10", "Pet Supplies Plus", 80), c("2026-07-10", "Pet Supplies Plus", 80)]);
    expect(idea!.name).toBe("Pet Supplies Plus");
    // 160 over June..August (3 months)
    expect(idea!.amount).toBe(55);
  });

  it("does not propose two charges two months apart, and charges older than six months make no monthly idea", () => {
    expect(propose([c("2026-05-20", "Gap Store", 200), c("2026-07-20", "Gap Store", 200)])).toEqual([]);
    const old = propose([c("2026-01-05", "Old Place", 100), c("2026-01-20", "Old Place", 100), c("2026-02-02", "Old Place", 100)]);
    expect(old.map((i) => i.cadence)).toEqual(["yearly"]);
  });

  it("uses no charge from over twelve months back", () => {
    expect(propose([c("2025-08-10", "Ancient", 900), c("2025-08-12", "Ancient", 900), c("2025-08-14", "Ancient", 900)])).toEqual([]);
  });

  it("leaves out a proposal whose name is a category the budget already has", () => {
    const charges = [c("2026-03-24", "Puracy Naturals", 149.91), c("2026-05-08", "Blueland", 38.4), c("2026-07-02", "Blueland", 41.2)];
    const kindOf = kinds({ "puracy naturals": "Cleaning supplies", blueland: "Cleaning supplies" });
    expect(propose(charges, { kindOf, existingNames: ["cleaning SUPPLIES"] })).toEqual([]);
  });

  it("groups by what a payee is for, not by brand: a fixture of the two brands yields ONE household-supplies proposal", () => {
    const charges = [c("2026-06-01", "Puracy Naturals", 60), c("2026-06-20", "Blueland", 50), c("2026-07-05", "Puracy Naturals", 45)];
    const ideas = propose(charges, { kindOf: kinds({ "puracy naturals": "Household supplies", blueland: "Household supplies" }) });
    expect(ideas.map((i) => i.name)).toEqual(["Household supplies"]);
  });
});

describe("the thresholds ($150 over twelve months or 3 charges), at each edge", () => {
  it("passes two months running at exactly $150 and not at $149.99", () => {
    expect(propose([c("2026-06-10", "Edge A", 75), c("2026-07-10", "Edge A", 75)])).toHaveLength(1);
    expect(propose([c("2026-06-10", "Edge A", 75), c("2026-07-10", "Edge A", 74.99)])).toEqual([]);
  });

  it("passes three charges however small, and not two", () => {
    expect(propose([c("2026-05-20", "Tiny", 2), c("2026-06-20", "Tiny", 2), c("2026-07-30", "Tiny", 2)])).toHaveLength(1);
    expect(propose([c("2026-07-10", "Tiny", 2), c("2026-07-30", "Tiny", 2)])).toEqual([]);
  });

  it("takes both from settings", () => {
    const pair = [c("2026-06-10", "Edge B", 40), c("2026-07-10", "Edge B", 40)];
    expect(propose(pair)).toEqual([]);
    expect(propose(pair, { settings: { minSpend: 80, minCharges: 3 } })).toHaveLength(1);
    expect(propose(pair, { settings: { minSpend: 150, minCharges: 2 } })).toHaveLength(1);
    const three = [c("2026-05-20", "Tiny", 2), c("2026-06-20", "Tiny", 2), c("2026-07-30", "Tiny", 2)];
    expect(propose(three, { settings: { minSpend: 150, minCharges: 4 } })).toEqual([]);
  });
});

describe("once a year", () => {
  const mulch = c("2026-03-28", "Ferris Landscape Supply", 591.97);

  it("proposes last year's once-a-year spend with a yearly target due before the month it recurs", () => {
    const [idea] = propose([mulch], { kindOf: kinds({ "ferris landscape supply": "Home & yard" }) });
    expect(idea).toMatchObject({ name: "Home & yard", cadence: "yearly", amount: 595, dueDate: "2027-02-01" });
    expect(idea!.charges).toEqual([mulch]);
  });

  it("gives a big once-a-year spend its own category and folds the small ones into one yearly catch-all", () => {
    const small = [c("2026-05-04", "Pool Opening Co", 60), c("2026-10-01", "Gutter Guys", 80), c("2026-01-15", "Chimney Sweep", 40)];
    const ideas = propose([mulch, ...small], { today: "2026-10-20" });
    expect(ideas.map((i) => i.name).sort()).toEqual(["Ferris Landscape Supply", CATCH_ALL_NAME].sort());
    const own = ideas.find((i) => i.name === "Ferris Landscape Supply")!;
    expect(own.cadence).toBe("yearly");
    expect(own.amount).toBe(595);
    const folded = ideas.find((i) => i.name === CATCH_ALL_NAME)!;
    expect(folded.cadence).toBe("yearly");
    // 180 in all, to the next five; due before the earliest of them to recur (Chimney Sweep in January: 2027-01-15 -> 2026-12-01)
    expect(folded.amount).toBe(180);
    expect(folded.dueDate).toBe("2026-12-01");
    expect(folded.payees.sort()).toEqual(["Chimney Sweep", "Gutter Guys", "Pool Opening Co"]);
  });

  it("proposes no catch-all when the small ones together are under the threshold", () => {
    expect(propose([c("2026-05-04", "Pool Opening Co", 60), c("2026-01-15", "Chimney Sweep", 40)])).toEqual([]);
  });

  it("does not make a yearly idea of what already makes a monthly one", () => {
    const charges = [c("2026-05-20", "Tiny", 2), c("2026-06-20", "Tiny", 2), c("2026-07-30", "Tiny", 2)];
    expect(propose(charges).map((i) => i.cadence)).toEqual(["monthly"]);
  });
});

describe("at most three new ideas a month, the biggest first", () => {
  const idea = (name: string, total: number) => ({
    key: `payee:${name}`,
    name,
    cadence: "monthly" as const,
    amount: total,
    total,
    payees: [name],
    charges: [],
  });
  const five = [idea("A", 100), idea("B", 500), idea("C", 300), idea("D", 400), idea("E", 200)];

  it("shows the three biggest and keeps the rest waiting", () => {
    const { shown, introduced } = chooseShown(five, [], new Set());
    expect(shown.map((i) => i.name)).toEqual(["B", "D", "C"]);
    expect(introduced).toEqual(["payee:B", "payee:D", "payee:C"]);
    expect(MAX_NEW_A_MONTH).toBe(3);
  });

  it("does not make room when one is dismissed: it was one of this month's three", () => {
    const first = chooseShown(five, [], new Set());
    const after = chooseShown(five, first.introduced, new Set(["payee:B"]));
    expect(after.shown.map((i) => i.name)).toEqual(["D", "C"]);
    expect(after.introduced).toEqual(first.introduced);
  });

  it("brings the next ones in a new month, from an empty introduced list", () => {
    const next = chooseShown(five, [], new Set(["payee:B", "payee:D", "payee:C"]));
    expect(next.shown.map((i) => i.name)).toEqual(["E", "A"]);
  });
});

describe("Not now and Never", () => {
  beforeEach(() => localStorage.clear());
  const DAY = 24 * 60 * 60_000;

  it("hides Not now for 90 days and Never for good", () => {
    const now = Date.UTC(2026, 7, 15);
    dismiss("payee:a", "not-now", now);
    dismiss("payee:b", "never", now);
    const kept = readDismissed();
    expect(NOT_NOW_DAYS).toBe(90);
    expect(isDismissed(kept, "payee:a", now + 89 * DAY)).toBe(true);
    expect(isDismissed(kept, "payee:a", now + 91 * DAY)).toBe(false);
    expect(isDismissed(kept, "payee:b", now + 3000 * DAY)).toBe(true);
    expect(isDismissed(kept, "payee:c", now)).toBe(false);
  });
});

describe("what the phone keeps", () => {
  beforeEach(() => localStorage.clear());

  it("reads the thresholds as set, and falls back to 150 dollars and 3 charges", () => {
    expect(readIdeaSettings()).toEqual({ minSpend: 150, minCharges: 3 });
    writeIdeaSettings({ minSpend: 200, minCharges: 5 });
    expect(readIdeaSettings()).toEqual({ minSpend: 200, minCharges: 5 });
    localStorage.setItem(IDEA_SETTINGS_KEY, "nonsense");
    expect(readIdeaSettings()).toEqual(DEFAULT_IDEA_SETTINGS);
    localStorage.setItem(IDEA_SETTINGS_KEY, JSON.stringify({ minSpend: -4, minCharges: 0 }));
    expect(readIdeaSettings()).toEqual(DEFAULT_IDEA_SETTINGS);
  });

  it("caches a payee's kind, case aside, and forgets the kinds and the charges read when YNAB goes off, keeping his choices", () => {
    writeKind("Blueland", "Cleaning supplies");
    expect(readKinds().get("blueland")).toBe("Cleaning supplies");
    dismiss("payee:x", "never", 1);
    localStorage.setItem(IDEA_SETTINGS_KEY, JSON.stringify({ minSpend: 200, minCharges: 5 }));
    forgetBudgetIdeas();
    expect(localStorage.getItem(KINDS_KEY)).toBeNull();
    expect(readKinds().size).toBe(0);
    expect(Object.keys(readDismissed())).toEqual(["payee:x"]);
    expect(readIdeaSettings().minSpend).toBe(200);
  });
});

describe("refreshIdeaCharges: the year's charges read from YNAB", () => {
  const NOW = Date.parse("2026-08-15T12:00:00");
  let ynab: FakeYnab;
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    ynab = fakeYnab("tok", [{ id: "b1", name: "Our Budget", categoryGroups: [groupOf("g1", "Everyday", [["f1", "Stuff I Forgot to Budget For"], ["c2", "Groceries"]])], accounts: [], payees: [] }]);
    await new YnabRepository().saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await new YnabRepository().applyCategories(ynab.budgets[0]!.categoryGroups, 1);
    ynab.transactions.push(
      { id: "a", account_id: "a1", date: "2026-07-01", amount: -25_000, payee_name: "Blueland", category_id: "f1" },
      { id: "b", account_id: "a1", date: "2026-07-02", amount: -9_000, payee_name: "Costco", category_id: "c2" },
      { id: "old", account_id: "a1", date: "2025-01-02", amount: -9_000, payee_name: "Blueland", category_id: "f1" },
    );
  });

  it("asks for the last twelve months once, keeps the charges to the fallback, and reads again only when they are 12 hours old", async () => {
    const client = createYnabClient("tok", ynab.fetch);
    const read = await refreshIdeaCharges(client, { now: NOW });
    expect(read?.charges).toEqual([{ id: "a", date: "2026-07-01", payee: "Blueland", amount: 25 }]);
    expect(ynab.requests.map((r) => r.path)).toEqual(["/v1/budgets/b1/transactions?since_date=2025-08-15"]);
    await refreshIdeaCharges(client, { now: NOW + 60_000 });
    expect(ynab.requests).toHaveLength(1);
    await refreshIdeaCharges(client, { now: NOW + 13 * 60 * 60_000 });
    expect(ynab.requests).toHaveLength(2);
  });

  it("reads nothing from a budget with no such category", async () => {
    await new YnabRepository().applyCategories([groupOf("g1", "Everyday", [["c2", "Groceries"]])], 2);
    await db.ynabCategories.where("id").equals("f1").delete();
    expect(await refreshIdeaCharges(createYnabClient("tok", ynab.fetch), { now: NOW })).toBeNull();
    expect(ynab.requests).toEqual([]);
  });
});
