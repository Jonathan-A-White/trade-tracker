import {
  REASONS_KEY,
  REVISIONS_KEY,
  addReason,
  applyRevisions,
  buildReplyRequest,
  readReasons,
  readRevisions,
  removeReason,
  resolveReply,
  ruledOutPayees,
  writeRevision,
} from "./budget-idea-reply";
import { DEFAULT_IDEA_SETTINGS, proposeIdeas, type BudgetIdea, type IdeaCharge } from "./budget-ideas";

beforeEach(() => localStorage.clear());

const TODAY = "2026-11-12";
const nac = (date: string, amount = 1112.5): IdeaCharge => ({ id: `n${date}`, date, payee: "New Apostolic Church", amount });
const NAC_CHARGES = [nac("2026-09-14"), nac("2026-10-14"), nac("2026-11-02")];

const idea = (over: Partial<BudgetIdea> = {}): BudgetIdea => ({
  key: "payee:new apostolic church",
  name: "New Apostolic Church",
  cadence: "monthly",
  amount: 670,
  total: 3337.5,
  payees: ["New Apostolic Church"],
  charges: NAC_CHARGES,
  ...over,
});
const propose = (charges: IdeaCharge[], ruledOut?: ReadonlySet<string>) =>
  proposeIdeas(charges, { today: TODAY, kindOf: () => undefined, settings: DEFAULT_IDEA_SETTINGS, ruledOut });

describe("the request", () => {
  it("carries the idea, his words, his earlier reasons and the budget's category names", () => {
    addReason({ words: "We gave up the gym.", payees: ["Planet Fitness"] }, 5);
    const request = buildReplyRequest(idea({ dueDate: undefined }), "Fold these into Giving", ["Giving", "Groceries"]);
    expect(request.words).toBe("Fold these into Giving");
    expect(request.idea.name).toBe("New Apostolic Church");
    expect(request.idea.charges).toHaveLength(3);
    expect(request.reasons).toEqual([{ words: "We gave up the gym.", payees: ["Planet Fitness"] }]);
    expect(request.categories).toEqual([{ name: "Giving" }, { name: "Groceries" }]);
  });

  it("sends at most the 40 latest charges", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, date: `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(1 + i % 28).padStart(2, "0")}`, payee: "X", amount: 1 }));
    expect(buildReplyRequest(idea({ charges: many }), "hi", []).idea.charges).toHaveLength(40);
  });
});

describe("resolving the answer: one outcome each", () => {
  it("revise: the card changes in place (name, amount, cadence), saying what changed", () => {
    const r = resolveReply({ outcome: "revise", say: "Now $400 a month.", amount: 400 }, idea(), ["Groceries"]);
    expect(r).toEqual({ kind: "revise", say: "Now $400 a month.", revision: { amount: 400 }, rulesOut: [] });
  });

  it("revise to yearly gets a due date when the answer gives none", () => {
    const r = resolveReply({ outcome: "revise", say: "Yearly instead.", cadence: "yearly", amount: 3000 }, idea(), []);
    expect(r?.kind).toBe("revise");
    if (r?.kind === "revise") {
      expect(r.revision.cadence).toBe("yearly");
      expect(r.revision.dueDate).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });

  it("revise to a category the budget already has folds the idea in: it goes, with his reason", () => {
    const r = resolveReply({ outcome: "revise", say: "These belong in Giving.", name: "giving", remember: "Fold church gifts into Giving." }, idea(), ["Groceries", "Giving"]);
    expect(r).toEqual({ kind: "retire", say: "These belong in Giving.", note: "Fold church gifts into Giving.", rulesOut: [] });
  });

  it("retire: the idea goes, with the payees his words rule out and his reason", () => {
    const r = resolveReply({ outcome: "retire", say: "Understood.", rulesOut: ["New Apostolic Church"], remember: "We moved our tithe to Brookfield First." }, idea(), []);
    expect(r).toEqual({ kind: "retire", say: "Understood.", note: "We moved our tithe to Brookfield First.", rulesOut: ["New Apostolic Church"] });
  });

  it("explain: a short answer, nothing changes", () => {
    expect(resolveReply({ outcome: "explain", say: "It is the average of the last 3 months." }, idea(), [])).toEqual({ kind: "explain", say: "It is the average of the last 3 months." });
  });

  it("an answer with no say, or an outcome it does not know, is no answer", () => {
    expect(resolveReply({ outcome: "explain", say: "  " }, idea(), [])).toBeNull();
    expect(resolveReply({ outcome: "dance", say: "x" } as never, idea(), [])).toBeNull();
    expect(resolveReply({ outcome: "revise", say: "Changed.", amount: -5 }, idea(), [])).toBeNull();
  });
});

describe("revisions keep a revised card revised", () => {
  it("applies a kept revision to the idea with that key", () => {
    writeRevision("payee:new apostolic church", { amount: 400, name: "Tithe" });
    expect(readRevisions()).toEqual({ "payee:new apostolic church": { amount: 400, name: "Tithe" } });
    const [revised] = applyRevisions([idea()], readRevisions());
    expect(revised).toMatchObject({ name: "Tithe", amount: 400, cadence: "monthly" });
  });

  it("a revision to monthly drops the due date", () => {
    const [revised] = applyRevisions([idea({ cadence: "yearly", dueDate: "2027-01-01" })], { "payee:new apostolic church": { cadence: "monthly" } });
    expect(revised!.dueDate).toBeUndefined();
  });

  it("ignores junk kept in storage", () => {
    localStorage.setItem(REVISIONS_KEY, "{not json");
    expect(readRevisions()).toEqual({});
  });
});

describe("his reasons are remembered and given to later ideas", () => {
  it("keeps a reason with its payees until he removes it", () => {
    const first = addReason({ words: "We moved our tithe to Brookfield First.", payees: ["New Apostolic Church"] }, 1);
    addReason({ words: "No more Hulu.", payees: [] }, 2);
    expect(readReasons().map((r) => r.words)).toEqual(["We moved our tithe to Brookfield First.", "No more Hulu."]);
    removeReason(first.id);
    expect(readReasons().map((r) => r.words)).toEqual(["No more Hulu."]);
    expect(JSON.parse(localStorage.getItem(REASONS_KEY)!)).toHaveLength(1);
  });

  it("the NAC case: the church he said he no longer gives to is not offered again, its past charges are history", () => {
    expect(propose(NAC_CHARGES).map((i) => i.name)).toEqual(["New Apostolic Church"]);
    addReason({ words: "We won't be donating there anymore.", payees: [" new apostolic CHURCH "] }, 1);
    const ruledOut = ruledOutPayees(readReasons());
    expect(propose(NAC_CHARGES, ruledOut)).toEqual([]);
    // removing the reason brings it back
    removeReason(readReasons()[0]!.id);
    expect(propose(NAC_CHARGES, ruledOutPayees(readReasons())).map((i) => i.name)).toEqual(["New Apostolic Church"]);
  });

  it("a ruled-out payee leaves the others of its group standing", () => {
    const other = (date: string): IdeaCharge => ({ id: `o${date}`, date, payee: "Brookfield Giving", amount: 50 });
    const ideas = proposeIdeas([...NAC_CHARGES, other("2026-09-20"), other("2026-10-20"), other("2026-11-05")], {
      today: TODAY,
      kindOf: () => "Giving",
      settings: DEFAULT_IDEA_SETTINGS,
      ruledOut: new Set(["new apostolic church"]),
    });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.total).toBe(150);
    expect(ideas[0]!.payees).toEqual(["Brookfield Giving"]);
  });
});
