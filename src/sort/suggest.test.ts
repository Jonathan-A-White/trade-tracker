import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { fakePostern } from "bsv-kit/testing";
import type { YnabCategory } from "@/contracts/types";
import { MAX_PAYLOAD_BYTES, NotAllowed, sealedRecordBytes } from "@/factory/mill";
import {
  HEADROOM_BYTES,
  HISTORY_KEY,
  LEARNED_KEY,
  SUGGEST_DEADLINE_MS,
  SORT_CHARGE_KIND,
  SORT_CHARGE_VERSION,
  buildRequest,
  fitToBudget,
  learnChoice,
  makeSortChargeAsk,
  readHistory,
  recordCharge,
  resolveGrouping,
  resolveSuggestion,
  suggestAtOnce,
  tallyFor,
  type SortChargeRequest,
} from "./suggest";
import { tallyTransactions, type Tally } from "@/ynab/tally";

const key = new Uint8Array(32).fill(5);
const schema = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), "schemas", name), "utf8")) as object;

const category = (id: string, name: string, balance?: number): YnabCategory => ({
  id,
  groupId: "g",
  groupName: "Food",
  name,
  hidden: false,
  ...(balance === undefined ? {} : { balance }),
});

const cats = [category("c1", "Groceries", 212), category("c2", "Eating Out", 8), category("c3", "Household", 60.5)];
const spending = category("c4", "Jonathan's Spending", 40);
const all = [...cats, spending];

/** A tally kept from YNAB's transactions: [payee, category id, date] each one charge. */
function tallyOf(rows: [string, string, string?][]): Tally {
  const payees = tallyTransactions(
    rows.map(([payee, categoryId, date], i) => ({ id: `t${i}`, account_id: "a1", date: date ?? "2026-01-01", amount: -10_000, payee_name: payee, category_id: categoryId })),
    new Set(),
  );
  return { budgetId: "b1", since: "2024-11-05", readAt: 0, payees };
}
const times = (count: number, payee: string, categoryId: string, date?: string): [string, string, string?][] =>
  Array.from({ length: count }, () => [payee, categoryId, date]);

beforeEach(() => localStorage.clear());

describe("the history of sorted charges", () => {
  it("keeps what each charge was sorted into, newest first, per merchant (case and spaces aside)", () => {
    recordCharge("Trader Joe's", 40, [{ category: "Groceries", amount: 40 }]);
    recordCharge("  trader joe's ", 22.5, [{ category: "Eating Out", amount: 22.5 }]);
    recordCharge("Target", 30, [{ category: "Household", amount: 30 }]);
    expect(readHistory("TRADER JOE'S")).toEqual([
      { amount: 22.5, category: "Eating Out" },
      { amount: 40, category: "Groceries" },
    ]);
    expect(readHistory("Nobody")).toEqual([]);
  });

  it("keeps a split charge as its parts", () => {
    recordCharge("Costco", 200, [{ category: "Groceries", amount: 140 }, { category: "Household", amount: 60 }]);
    expect(readHistory("Costco")).toEqual([
      { amount: 200, split: [{ category: "Groceries", amount: 140 }, { category: "Household", amount: 60 }] },
    ]);
  });

  it("gives at most the last 20 of a merchant and survives what is not JSON", () => {
    for (let i = 0; i < 30; i++) recordCharge("Shell", 10 + i, [{ category: "Gas", amount: 10 + i }]);
    const lines = readHistory("Shell");
    expect(lines).toHaveLength(20);
    expect(lines[0]).toEqual({ amount: 39, category: "Gas" });
    localStorage.setItem(HISTORY_KEY, "{not json");
    expect(readHistory("Shell")).toEqual([]);
  });
});

describe("what a merchant NORMALLY goes to, from YNAB's tally", () => {
  it("Logos, 9 in Jonathan's Spending: the suggestion is Jonathan's Spending, with the count", () => {
    const tally = tallyOf(times(9, "Logos", "c4"));
    expect(suggestAtOnce("LOGOS BIBLE SOFTWARE", all, tally)).toEqual({ source: "tally", categoryId: "c4", why: "9 of 9 here went to Jonathan's Spending." });
  });

  it("Amazon, 12 in Household and then 1 in Jonathan's Spending as the newest: the suggestion is Household; the newest never outweighs the count", () => {
    const tally = tallyOf([...times(12, "Amazon", "c3", "2026-03-01"), ["Amazon", "c4", "2026-11-01"]]);
    expect(suggestAtOnce("AMAZON MKTPL*2X3Y4", all, tally)).toEqual({ source: "tally", categoryId: "c3", why: "12 of 13 here went to Household." });
  });

  it("meets the payee though the alert writes the merchant differently, and keeps another payee's charges apart", () => {
    const tally = tallyOf([...times(3, "Jones Family Farms", "c1"), ...times(5, "Family Dollar", "c3")]);
    expect(tallyFor("JONES FAMILY FARMS, LL SHELTON USA", tally, all)).toEqual({
      payee: "Jones Family Farms",
      counts: [{ categoryId: "c1", name: "Groceries", count: 3 }],
      total: 3,
    });
    expect(suggestAtOnce("JONES FAMILY FARMS, LL SHELTON USA", all, tally)?.categoryId).toBe("c1");
  });

  it("joins the payees YNAB writes two ways, and counts only the categories the sheet offers", () => {
    const tally = tallyOf([...times(2, "Trader Joe's", "c1"), ...times(2, "TRADER JOES", "c1"), ...times(9, "Trader Joe's", "gone")]);
    expect(tallyFor("TRADER JOE S #552", tally, all)?.counts).toEqual([{ categoryId: "c1", name: "Groceries", count: 4 }]);
  });

  it.each([
    ["one charge only", [["Logos", "c4"]]],
    ["half and half", [...times(2, "Logos", "c4"), ...times(2, "Logos", "c3")]],
    ["the most, but not over half", [...times(2, "Logos", "c4"), ...times(1, "Logos", "c3"), ...times(1, "Logos", "c1")]],
    ["no history", []],
  ] as [string, [string, string][]][])("with %s nothing is suggested at once (the mill is asked)", (_what, rows) => {
    expect(suggestAtOnce("Logos", all, tallyOf(rows))).toBeNull();
  });

  it("at least 2 charges and over half is enough", () => {
    expect(suggestAtOnce("Logos", all, tallyOf(times(2, "Logos", "c4")))?.categoryId).toBe("c4");
    expect(suggestAtOnce("Logos", all, tallyOf([...times(3, "Logos", "c4"), ...times(2, "Logos", "c3")]))?.why).toBe("3 of 5 here went to Jonathan's Spending.");
  });

  it("with no tally kept nothing is suggested at once", () => {
    expect(suggestAtOnce("Logos", all, null)).toBeNull();
  });
});

describe("what he taught by changing the suggestion", () => {
  it("is suggested ahead of the tally, from then on, until he changes it again", () => {
    const tally = tallyOf(times(12, "Amazon", "c3"));
    learnChoice("AMAZON MKTPL*2X3Y4", spending);
    expect(suggestAtOnce("AMAZON MKTPL*9Z8Q1", all, tally)).toEqual({ source: "learned", categoryId: "c4", why: "You chose Jonathan's Spending for this merchant." });
    learnChoice("Amazon Mktpl*AB12", cats[0]!);
    expect(suggestAtOnce("AMAZON MKTPL*9Z8Q1", all, tally)?.categoryId).toBe("c1");
  });

  it("is kept on the phone, and found by the category's name when its id is gone", () => {
    learnChoice("Logos", spending);
    expect(JSON.parse(localStorage.getItem(LEARNED_KEY) ?? "{}")).toMatchObject({ logos: { categoryId: "c4", name: "Jonathan's Spending" } });
    expect(suggestAtOnce("LOGOS", [...cats, { ...spending, id: "c44" }], null)?.categoryId).toBe("c44");
    expect(suggestAtOnce("LOGOS", cats, null)).toBeNull();
  });

  it("is kept for the merchant, not for another that meets it by one common word", () => {
    learnChoice("JONES FAMILY FARMS, LL SHELTON USA", cats[0]!);
    expect(suggestAtOnce("FAMILY DOLLAR #12", all, null)).toBeNull();
    expect(suggestAtOnce("Jones Family Farms", all, null)?.categoryId).toBe("c1");
  });

  it("is nothing for a charge with no merchant, or only a code", () => {
    learnChoice("", spending);
    learnChoice("#4471", spending);
    expect(localStorage.getItem(LEARNED_KEY)).toBeNull();
    expect(suggestAtOnce("", all, null)).toBeNull();
  });

  it("survives what is not JSON", () => {
    localStorage.setItem(LEARNED_KEY, "{not json");
    expect(suggestAtOnce("Logos", all, null)).toBeNull();
    learnChoice("Logos", spending);
    expect(suggestAtOnce("Logos", all, null)?.categoryId).toBe("c4");
  });
});

describe("the request", () => {
  it("is version 1.1 of the grind's input, the version that carries the tally, and the grind takes it", () => {
    expect(SORT_CHARGE_VERSION).toBe("1.1");
    const grind = JSON.parse(readFileSync(resolve(process.cwd(), "grinds", "sort-charge.json"), "utf8")) as { versions: string[] };
    expect(grind.versions).toContain("1.1");
  });

  it("names the charge, the categories with what is left and the history, with no YNAB ids", () => {
    const request = buildRequest({ merchant: "Dunkin'", amount: 8.5, owner: "Jonathan" }, cats, [{ amount: 5, category: "Eating Out" }]);
    expect(request).toEqual({
      merchant: "Dunkin'",
      amount: 8.5,
      owner: "Jonathan",
      categories: [{ name: "Groceries", left: 212 }, { name: "Eating Out", left: 8 }, { name: "Household", left: 60.5 }],
      history: [{ amount: 5, category: "Eating Out" }],
      tally: [],
    });
    expect(JSON.stringify(request)).not.toMatch(/\bc[123]\b/);
  });

  it("leaves out the owner when none is named and the balance when it is not known", () => {
    const request = buildRequest({ merchant: "Shell", amount: 20 }, [category("c9", "Gas")], []);
    expect(request).toEqual({ merchant: "Shell", amount: 20, categories: [{ name: "Gas" }], history: [], tally: [] });
  });

  it("carries the merchant's tally by category name, most first, and then leaves out this phone's newest-first history", () => {
    const tally = tallyOf([...times(2, "Costco", "c1"), ...times(2, "Costco", "c3"), ["Costco", "c2"]]);
    const request = buildRequest({ merchant: "COSTCO WHSE #0123", amount: 99.1 }, cats, [{ amount: 5, category: "Eating Out" }], undefined, tallyFor("COSTCO WHSE #0123", tally, cats));
    expect(request.tally).toEqual([
      { category: "Groceries", count: 2 },
      { category: "Household", count: 2 },
      { category: "Eating Out", count: 1 },
    ]);
    expect(request.history).toEqual([]);
    const validate = new Ajv({ strict: true }).compile(schema("sort-charge-input-1.1.schema.json"));
    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
  });

  it("is valid against the grind's input schema", () => {
    const validate = new Ajv({ strict: true }).compile(schema(`sort-charge-input-${SORT_CHARGE_VERSION}.schema.json`));
    const request = buildRequest({ merchant: "Costco", amount: 99.1, owner: "shared" }, cats, [
      { amount: 80, split: [{ category: "Groceries", amount: 50 }, { category: "Household", amount: 30 }] },
    ]);
    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("the request with a receipt's lines", () => {
  const lines = [{ text: "ORG BNNA", price: 1.99 }, { text: "PAPER TWL", price: 12.99 }];

  it("carries the lines, valid against the grind's input schema, and none when there are none", () => {
    const validate = new Ajv({ strict: true }).compile(schema(`sort-charge-input-${SORT_CHARGE_VERSION}.schema.json`));
    const request = buildRequest({ merchant: "Costco", amount: 20 }, cats, [], lines);
    expect(request.lines).toEqual(lines);
    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
    expect(buildRequest({ merchant: "Costco", amount: 20 }, cats, [], [])).not.toHaveProperty("lines");
  });

  it("resolves the grouping, whose amounts are the lines' sums and need not add up to the charge", () => {
    const answer = { split: [{ category: "groceries", amount: 1.99 }, { category: "Household", amount: 12.99 }], why: "Food, then the house." };
    expect(resolveGrouping(answer, cats)).toEqual({
      why: "Food, then the house.",
      grouping: { split: [{ categoryId: "c1", amount: 1.99 }, { categoryId: "c3", amount: 12.99 }] },
    });
    expect(resolveGrouping({ category: "Groceries", why: "All food." }, cats)).toEqual({ why: "All food.", grouping: { categoryId: "c1" } });
  });

  it.each([
    ["a category the budget does not have", { category: "Boats", why: "x" }],
    ["a split naming one", { split: [{ category: "Groceries", amount: 1 }, { category: "Boats", amount: 2 }], why: "x" }],
    ["no why", { category: "Groceries" }],
  ])("is no grouping when it names %s", (_what, answer) => {
    expect(resolveGrouping(answer as never, cats)).toBeNull();
  });
});

describe("the byte budget", () => {
  const long = (i: number) => "Category with a long name number ".padEnd(56, "x") + String(i % 10);
  const worst = (): SortChargeRequest => ({
    merchant: "M".repeat(120),
    amount: 123456.78,
    owner: "O".repeat(40),
    categories: Array.from({ length: 150 }, (_, i) => ({ name: long(i).slice(0, 60), left: -123456.78 })),
    history: Array.from({ length: 20 }, (_, i) => ({
      amount: 99999.99,
      split: Array.from({ length: 8 }, () => ({ category: long(i).slice(0, 60), amount: 99999.99 })),
    })),
    tally: Array.from({ length: 20 }, (_, i) => ({ category: long(i).slice(0, 60), count: 99999 })),
  });
  const bytes = (request: SortChargeRequest) => sealedRecordBytes(key, SORT_CHARGE_KIND, SORT_CHARGE_VERSION, request, 0);

  it("keeps 1,000 bytes of headroom under the mill's cap", () => {
    expect(HEADROOM_BYTES).toBe(1000);
    const fitted = fitToBudget(worst(), bytes, MAX_PAYLOAD_BYTES - HEADROOM_BYTES);
    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES - HEADROOM_BYTES);
    expect(fitted.categories).toHaveLength(150);
  });

  it("a long history of a plain size is sent whole, 20 charges", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ amount: 10 + i, category: "Groceries" }));
    const request = buildRequest({ merchant: "Aldi", amount: 30 }, cats, history);
    expect(fitToBudget(request, bytes, MAX_PAYLOAD_BYTES - HEADROOM_BYTES).history).toEqual(history);
  });

  it("sheds the oldest history first, one charge at a time, until the request fits", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ amount: 100 + i, category: "Groceries" })); // newest first
    const request = buildRequest({ merchant: "Aldi", amount: 30 }, cats, history);
    const limit = bytes({ ...request, history: history.slice(0, 7) });
    const fitted = fitToBudget(request, bytes, limit);
    expect(fitted.history).toEqual(history.slice(0, 7));
    expect(bytes(fitted)).toBeLessThanOrEqual(limit);
    expect(bytes({ ...request, history: history.slice(0, 8) })).toBeGreaterThan(limit);
  });

  it("with no room even for the categories, sends them with no history rather than none", () => {
    const request = buildRequest({ merchant: "Aldi", amount: 30 }, cats, [{ amount: 5, category: "Groceries" }]);
    expect(fitToBudget(request, () => 1_000_000, 10)).toEqual({ ...request, history: [] });
  });

  it("sheds the tally's least-counted categories after the history, most-counted kept", () => {
    const tally = { payee: "Costco", total: 6, counts: [{ categoryId: "c1", name: "Groceries", count: 3 }, { categoryId: "c3", name: "Household", count: 2 }, { categoryId: "c2", name: "Eating Out", count: 1 }] };
    const request = buildRequest({ merchant: "Costco", amount: 30 }, cats, [], undefined, tally);
    const limit = bytes({ ...request, tally: request.tally.slice(0, 1) });
    expect(fitToBudget(request, bytes, limit).tally).toEqual([{ category: "Groceries", count: 3 }]);
  });
});

describe("the answer", () => {
  it("is valid against the answer schema for a category and for a split", () => {
    const validate = new Ajv({ strict: false }).compile(schema("sort-charge-answer-1.0.schema.json"));
    expect(validate({ category: "Groceries", why: "x" })).toBe(true);
    expect(validate({ split: [{ category: "Groceries", amount: 5 }, { category: "Household", amount: 5 }], why: "x" })).toBe(true);
    expect(validate({ category: "Groceries" })).toBe(false);
  });

  it("is left unused by the sheet when it names neither a category nor a split (the live mill refuses a top-level anyOf, so the app checks)", () => {
    expect(resolveSuggestion({ why: "Usual." }, cats, 40)).toBeNull();
  });

  it("resolves a category's name to the YNAB category, whatever the case", () => {
    expect(resolveSuggestion({ category: "groceries", why: "Usual." }, cats, 40)).toEqual({ why: "Usual.", categoryId: "c1" });
  });

  it("resolves a split whose parts add up to the charge", () => {
    const answer = { split: [{ category: "Groceries", amount: 30 }, { category: "Household", amount: 10.12 }], why: "Warehouse." };
    expect(resolveSuggestion(answer, cats, 40.12)).toEqual({
      why: "Warehouse.",
      parts: [{ categoryId: "c1", amount: 30 }, { categoryId: "c3", amount: 10.12 }],
    });
  });

  it.each([
    ["a category the budget does not have", { category: "Boats", why: "x" }],
    ["a split that does not add up", { split: [{ category: "Groceries", amount: 30 }, { category: "Household", amount: 5 }], why: "x" }],
    ["a split naming a category the budget does not have", { split: [{ category: "Groceries", amount: 30 }, { category: "Boats", amount: 10.12 }], why: "x" }],
    ["no category and no split", { why: "x" }],
    ["no why", { category: "Groceries" }],
  ])("is no suggestion when it names %s", (_what, answer) => {
    expect(resolveSuggestion(answer as never, cats, 40.12)).toBeNull();
  });

  it("keeps the why to one line", () => {
    const suggestion = resolveSuggestion({ category: "Groceries", why: "Line one.\nLine two." }, cats, 5);
    expect(suggestion?.why).toBe("Line one. Line two.");
  });
});

describe("the gated ask", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["checking", "unlicensed"] as const)("with the licence %s the mill refuses with NotAllowed and nothing goes out", async (state) => {
    const ask = makeSortChargeAsk("https://backend.example", key, () => state);
    const request = buildRequest({ merchant: "Shell", amount: 20 }, cats, []);
    await expect(ask(request)).rejects.toBeInstanceOf(NotAllowed);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// mw-mr4xgrw.40: 'The suggestion is taking too long' on a charge the mill answered in 4 s. The wait polled every 20 s (bsv-kit's
// POLL_INTERVAL_MS) and the sheet's deadline is 20 s: a first read just after the send found nothing, and the next one fell
// after the deadline, so an answer the mill sent 6 s in was never looked for in time.
describe("the wait for the mill's answer (mw-mr4xgrw.40)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("picks up an answer the mill sent 6 s after the send well inside the sheet's deadline", async () => {
    const fake = fakePostern();
    vi.stubGlobal("fetch", fake.fetch);
    const ask = makeSortChargeAsk(fake.base, fake.appKey, () => "licensed");
    const request = buildRequest({ merchant: "JONES FAMILY FARMS, LL SHELTON USA", amount: 131.22 }, cats, []);
    const begun = Date.now();
    let answeredAt: number | null = null;
    const asked = ask(request).then((a) => {
      answeredAt = Date.now() - begun;
      return a;
    });
    // the mill's answer lands 6 s in, as the 17:39:52 one did after a 17:39:46 send
    setTimeout(() => {
      fake.reply({
        re: `direct:${"a".repeat(64)}`,
        status: "answered",
        answer: { category: "Groceries", why: "A farm; food." },
        grind: { app: "trade-tracker", kind: SORT_CHARGE_KIND, v: SORT_CHARGE_VERSION },
      });
    }, 6_000);
    for (let t = 0; t < SUGGEST_DEADLINE_MS && answeredAt === null; t += 500) await vi.advanceTimersByTimeAsync(500);
    expect(answeredAt).not.toBeNull();
    expect(answeredAt!).toBeLessThan(SUGGEST_DEADLINE_MS);
    expect((await asked).category).toBe("Groceries");
  });
});
