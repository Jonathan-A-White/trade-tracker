import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import type { YnabCategory } from "@/contracts/types";
import { MAX_PAYLOAD_BYTES, NotAllowed, sealedRecordBytes } from "@/factory/mill";
import {
  HEADROOM_BYTES,
  HISTORY_KEY,
  SORT_CHARGE_KIND,
  SORT_CHARGE_VERSION,
  buildRequest,
  fitToBudget,
  makeSortChargeAsk,
  readHistory,
  recordCharge,
  resolveSuggestion,
  type SortChargeRequest,
} from "./suggest";

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

describe("the request", () => {
  it("names the charge, the categories with what is left and the history, with no YNAB ids", () => {
    const request = buildRequest({ merchant: "Dunkin'", amount: 8.5, owner: "Jonathan" }, cats, [{ amount: 5, category: "Eating Out" }]);
    expect(request).toEqual({
      merchant: "Dunkin'",
      amount: 8.5,
      owner: "Jonathan",
      categories: [{ name: "Groceries", left: 212 }, { name: "Eating Out", left: 8 }, { name: "Household", left: 60.5 }],
      history: [{ amount: 5, category: "Eating Out" }],
    });
    expect(JSON.stringify(request)).not.toMatch(/\bc[123]\b/);
  });

  it("leaves out the owner when none is named and the balance when it is not known", () => {
    const request = buildRequest({ merchant: "Shell", amount: 20 }, [category("c9", "Gas")], []);
    expect(request).toEqual({ merchant: "Shell", amount: 20, categories: [{ name: "Gas" }], history: [] });
  });

  it("is valid against the grind's input schema", () => {
    const validate = new Ajv({ strict: true }).compile(schema("sort-charge-input-1.0.schema.json"));
    const request = buildRequest({ merchant: "Costco", amount: 99.1, owner: "shared" }, cats, [
      { amount: 80, split: [{ category: "Groceries", amount: 50 }, { category: "Household", amount: 30 }] },
    ]);
    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
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
