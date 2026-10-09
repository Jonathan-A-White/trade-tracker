import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import {
  EXAMPLE_PHOTO_MAX_BYTES,
  checkExpect,
  expectProblems,
  type GrindExample,
} from "@/grinds/examples";

type Json = Record<string, unknown>;

const ROOT = process.cwd();

function readJson(path: string): Json {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as Json;
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const ajv = new Ajv({ allErrors: true, strict: true });

const inputValidators = new Map<string, ValidateFunction>();

function inputValidator(kind: string, version: string): ValidateFunction {
  const path = `schemas/${kind}-input-${version}.schema.json`;
  let validate = inputValidators.get(path);
  if (!validate) {
    validate = ajv.compile(readJson(path));
    inputValidators.set(path, validate);
  }
  return validate;
}

const grindFiles = readdirSync(resolve(ROOT, "grinds")).filter((f) =>
  f.endsWith(".json")
);

describe("grind examples", () => {
  it("finds the rig's grinds", () => {
    expect(grindFiles.length).toBeGreaterThan(0);
  });

  describe.each(grindFiles)("grinds/%s", (grindFile) => {
    const grind = readJson(`grinds/${grindFile}`);
    const kind = grind.kind as string;
    const versions = grind.versions as string[];
    const attachments = grind.attachments as {
      min: number;
      max: number;
      mime: string[];
      maxBytes: number;
    };
    const dir = `grinds/examples/${kind}`;
    const exampleFiles = (() => {
      try {
        return readdirSync(resolve(ROOT, dir)).filter((f) =>
          f.endsWith(".json")
        );
      } catch {
        return [];
      }
    })();
    const answerSchema = readJson(grind.answerSchema as string);

    it("has at least one example under grinds/examples/<kind>/", () => {
      expect(
        exampleFiles,
        `${grindFile} has no example: add ${dir}/<name>.json (see grinds/examples/README.md)`
      ).not.toHaveLength(0);
    });

    it.each(exampleFiles)("%s is a valid scenario", (file) => {
      const example = readJson(`${dir}/${file}`) as unknown as GrindExample;

      expect(Object.keys(example).sort()).toEqual(
        ["description", "expect", "photos", "request", "schemaVersion"].filter(
          (k) => k !== "photos" || "photos" in example
        )
      );
      expect(typeof example.description).toBe("string");
      expect(versions).toContain(example.schemaVersion);

      const validateInput = inputValidator(kind, example.schemaVersion);
      expect(
        validateInput(example.request),
        JSON.stringify(validateInput.errors)
      ).toBe(true);

      const photos = example.photos ?? [];
      expect(photos.length).toBeGreaterThanOrEqual(attachments.min);
      expect(photos.length).toBeLessThanOrEqual(attachments.max);
      for (const photo of photos) {
        expect(attachments.mime).toContain(MIME_BY_EXT[extname(photo)]);
        const size = statSync(resolve(ROOT, dir, photo)).size;
        expect(size).toBeLessThan(EXAMPLE_PHOTO_MAX_BYTES);
        expect(size).toBeLessThanOrEqual(attachments.maxBytes);
      }

      expect(expectProblems(example.expect, answerSchema)).toEqual([]);
    });
  });
});

describe("expectProblems", () => {
  const answerSchema = readJson("schemas/item-from-photos-answer-1.0.schema.json");

  it("accepts checks on real answer fields", () => {
    expect(
      expectProblems(
        {
          price: { isNull: true },
          confidence: { oneOf: ["low", "medium"] },
          name: { contains: "Butter", matches: "^K" },
          notes: { present: true },
          size: { present: false },
          category: { equals: "other" },
        },
        answerSchema
      )
    ).toEqual([]);
  });

  it("names a path that is not in the answer schema", () => {
    expect(expectProblems({ cost: { equals: 1 } }, answerSchema)).toEqual([
      "cost: not a field of the answer schema",
    ]);
  });

  it("names a value the answer schema would never allow", () => {
    expect(expectProblems({ confidence: { equals: "certain" } }, answerSchema))
      .toHaveLength(1);
    expect(expectProblems({ category: { oneOf: ["Gadgets"] } }, answerSchema))
      .toHaveLength(1);
    expect(expectProblems({ price: { equals: "4.99" } }, answerSchema))
      .toHaveLength(1);
  });

  it("names an unknown check, a bad pattern and a contains on a non-string", () => {
    expect(expectProblems({ price: { around: 4 } }, answerSchema)).toHaveLength(1);
    expect(expectProblems({ name: { matches: "(" } }, answerSchema)).toHaveLength(1);
    expect(expectProblems({ price: { contains: "4" } }, answerSchema)).toHaveLength(1);
  });

  it("names an empty expect block and an empty check", () => {
    expect(expectProblems({}, answerSchema)).toHaveLength(1);
    expect(expectProblems({ price: {} }, answerSchema)).toHaveLength(1);
  });
});

describe("checkExpect", () => {
  const answer = {
    name: "Kerrygold Salted Butter",
    category: "Dairy & Eggs",
    unitType: "each",
    price: 4.99,
    size: "8 oz",
    confidence: "high",
  };

  it("passes when every check holds", () => {
    expect(
      checkExpect(
        {
          price: { equals: 4.99 },
          unitType: { oneOf: ["each", "per_lb"] },
          name: { contains: "Butter", matches: "^Kerrygold" },
          size: { present: true },
          notes: { present: false },
        },
        answer
      )
    ).toEqual([]);
  });

  it("names each check that fails", () => {
    expect(
      checkExpect(
        {
          price: { isNull: true },
          confidence: { equals: "low" },
          notes: { present: true },
          category: { oneOf: ["Produce"] },
          name: { contains: "Milk" },
          size: { matches: "^1 gal$" },
        },
        answer
      )
    ).toHaveLength(6);
  });

  it("treats a null price as present and null", () => {
    const noPrice = { ...answer, price: null };
    expect(
      checkExpect({ price: { isNull: true, present: true } }, noPrice)
    ).toEqual([]);
    expect(checkExpect({ price: { isNull: false } }, noPrice)).toHaveLength(1);
  });
});
