import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { FORM_START } from "voice-kit/forms";
import {
  FORM_TALK_KIND,
  FORM_TALK_VERSION,
  FormTalkError,
  MAX_HISTORY_TURNS,
  buildFormTalkRequest,
  makeFormTalkAsk,
} from "./form-talk";
import {
  IDENTIFY_FORM,
  ITEM_FORM,
  ITEM_SAVE,
  STORE_FORM,
  identifyStrings,
  itemStrings,
  storeStrings,
} from "./form-commands";

const sendGrist = vi.fn();
const awaitAnswer = vi.fn();
vi.mock("bsv-kit/grist", () => ({
  grist: {
    sendGrist: (...args: unknown[]) => sendGrist(...args),
    awaitAnswer: (...args: unknown[]) => awaitAnswer(...args),
  },
}));

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateInput = ajv.compile(readJson("schemas/form-talk-input-1.0.schema.json"));
const validateAnswer = ajv.compile(readJson("schemas/form-talk-answer-1.0.schema.json"));

const noItem = { barcode: "", name: "", currentPrice: 0, unitType: "each", category: "" };

describe("the form-talk request", () => {
  it("for ItemForm carries five fields, Unit Type a choice of Each and Per Pound, and fits the input schema", () => {
    const request = buildFormTalkRequest(ITEM_FORM, itemStrings(noItem), FORM_START, [], ITEM_SAVE);
    expect(request.question).toBe(FORM_START);
    expect(request.form.command).toBe(ITEM_SAVE);
    expect(request.form.fields.map((f) => f.label)).toEqual([
      "Barcode or PLU Code",
      "Name",
      "Price",
      "Unit Type",
      "Category",
    ]);
    const unit = request.form.fields.find((f) => f.name === "unitType");
    expect(unit).toMatchObject({ kind: "choice", options: ["Each", "Per Pound"], value: "Each" });
    expect(request.form.fields.filter((f) => f.required).map((f) => f.name)).toEqual(["name", "price"]);
    expect(validateInput(request), JSON.stringify(validateInput.errors)).toBe(true);
  });

  it("tells the tutor an untouched price is empty, and a set one as typed", () => {
    const empty = buildFormTalkRequest(ITEM_FORM, itemStrings(noItem), FORM_START, []);
    expect(empty.form.fields.find((f) => f.name === "price")?.value).toBe("");
    const set = buildFormTalkRequest(ITEM_FORM, itemStrings({ ...noItem, currentPrice: 3.49 }), "ok", []);
    expect(set.form.fields.find((f) => f.name === "price")?.value).toBe("3.49");
  });

  it("for StoreForm and Identify Item fits the input schema too", () => {
    const store = buildFormTalkRequest(
      STORE_FORM,
      storeStrings({ name: "Stop & Shop", city: "", state: "CT", notes: "" }),
      "Danbury",
      [{ q: FORM_START, a: "Where is it?" }],
    );
    expect(store.form.fields.map((f) => f.label)).toEqual(["Store Name", "City", "State", "Notes"]);
    expect(store.form.fields.find((f) => f.name === "state")?.kind).toBe("choice");
    expect(validateInput(store), JSON.stringify(validateInput.errors)).toBe(true);

    const identify = buildFormTalkRequest(
      IDENTIFY_FORM,
      identifyStrings({ name: "", barcode: "", unitType: "each", category: "" }),
      FORM_START,
      [],
    );
    expect(identify.form.fields.map((f) => f.label)).toEqual(["Name", "Barcode or PLU", "Unit Type", "Category"]);
    expect(validateInput(identify), JSON.stringify(validateInput.errors)).toBe(true);
  });

  it("keeps the last turns only, and stays small", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    const request = buildFormTalkRequest(ITEM_FORM, itemStrings(noItem), "next", history);
    expect(request.history).toHaveLength(MAX_HISTORY_TURNS);
    expect(request.history[MAX_HISTORY_TURNS - 1]).toEqual({ q: "q19", a: "a19" });
    expect(JSON.stringify(request).length).toBeLessThan(4000);
  });
});

describe("the form-talk grind", () => {
  const grind = readJson("grinds/form-talk.json");

  it("names the app, kind, version, schema and no attachments", () => {
    expect(grind).toMatchObject({
      grind: 1,
      app: "trade-tracker",
      kind: FORM_TALK_KIND,
      versions: [FORM_TALK_VERSION],
      instructions: "grinds/form-talk.md",
      answerSchema: "schemas/form-talk-answer-1.0.schema.json",
      attachments: { min: 0, max: 0, mime: [], maxBytes: 0 },
    });
  });

  it("has instructions that name the app and carry the kit's fragment whole", () => {
    const instructions = readFileSync(resolve(process.cwd(), "grinds/form-talk.md"), "utf8");
    const fragment = readFileSync(
      resolve(process.cwd(), "node_modules/voice-kit/packages/forms/grind/helping-with-a-form.md"),
      "utf8",
    ).trim();
    expect(instructions).toContain("Trade Tracker");
    expect(instructions).toContain(fragment);
  });

  it("has an answer schema that takes the fields the panel reads", () => {
    const answer = {
      answer: "What is it called?",
      form_values: [{ field: "name", value: "Whole Milk" }],
      form_ask: "price",
    };
    expect(validateAnswer(answer), JSON.stringify(validateAnswer.errors)).toBe(true);
    expect(validateAnswer({ answer: "All set." })).toBe(true);
    expect(validateAnswer({ form_ask: "price" })).toBe(false);
    expect(validateAnswer({ answer: "x", form_values: Array.from({ length: 9 }, () => ({ field: "a", value: "b" })) })).toBe(false);
  });
});

describe("makeFormTalkAsk", () => {
  const key = new Uint8Array(32).fill(7);
  const request = buildFormTalkRequest(ITEM_FORM, itemStrings(noItem), FORM_START, []);

  beforeEach(() => {
    sendGrist.mockReset();
    awaitAnswer.mockReset();
  });

  it("sends the request as a form-talk grist and returns the answer", async () => {
    sendGrist.mockResolvedValue("direct:abc");
    awaitAnswer.mockResolvedValue({ status: "answered", answer: { answer: "What is it called?", form_ask: "name" } });
    const ask = makeFormTalkAsk("https://backend.example", key);
    const answer = await ask(request);
    expect(answer).toEqual({ answer: "What is it called?", form_ask: "name" });
    expect(sendGrist).toHaveBeenCalledWith(
      expect.objectContaining({ app: "trade-tracker", kind: "form-talk", v: "1.0", input: request, key }),
    );
    expect(awaitAnswer).toHaveBeenCalledWith("direct:abc", expect.objectContaining({ key }));
  });

  it("names a refused or failed answer", async () => {
    sendGrist.mockResolvedValue("direct:abc");
    awaitAnswer.mockResolvedValue({ status: "refused", reason: "Not licensed." });
    const ask = makeFormTalkAsk("https://backend.example", key);
    await expect(ask(request)).rejects.toThrow(FormTalkError);
    await expect(ask(request)).rejects.toThrow("Not licensed.");
  });
});
