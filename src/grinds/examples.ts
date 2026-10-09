import Ajv from "ajv";

/**
 * Support for the grind scenarios under grinds/examples/<kind>/<name>.json
 * (format: grinds/examples/README.md). Test-side only: the app never imports it.
 */

/** An example photo has to stay public-safe and small. */
export const EXAMPLE_PHOTO_MAX_BYTES = 200 * 1024;

/** What one answer field must show. Every key given must hold. */
export interface FieldCheck {
  equals?: unknown;
  isNull?: boolean;
  oneOf?: unknown[];
  contains?: string;
  matches?: string;
  present?: boolean;
}

/** Answer path (a field name, dots for nested fields) to what it must show. */
export type ExpectBlock = Record<string, FieldCheck>;

export interface GrindExample {
  description: string;
  schemaVersion: string;
  request: Record<string, unknown>;
  /** File names beside the example. */
  photos?: string[];
  expect: ExpectBlock;
}

const CHECKS = ["equals", "isNull", "oneOf", "contains", "matches", "present"];

type Schema = Record<string, unknown>;

function schemaAt(root: Schema, path: string): Schema | undefined {
  let node: Schema | undefined = root;
  for (const part of path.split(".")) {
    const properties = node?.properties as Record<string, Schema> | undefined;
    node = properties?.[part];
    if (!node) return undefined;
  }
  return node;
}

function allowsType(schema: Schema, type: string): boolean {
  const t = schema.type;
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** What is wrong with an expect block against the grind's answer schema; empty when it is sound. */
export function expectProblems(expectBlock: unknown, answerSchema: Schema): string[] {
  if (typeof expectBlock !== "object" || expectBlock === null || Array.isArray(expectBlock)) {
    return ["expect: must be an object of answer path to checks"];
  }
  const entries = Object.entries(expectBlock as Record<string, unknown>);
  if (entries.length === 0) return ["expect: has no checks"];

  const problems: string[] = [];
  const ajv = new Ajv({ strict: false });
  for (const [path, check] of entries) {
    const schema = schemaAt(answerSchema, path);
    if (!schema) {
      problems.push(`${path}: not a field of the answer schema`);
      continue;
    }
    if (typeof check !== "object" || check === null || Array.isArray(check)) {
      problems.push(`${path}: must be an object of checks`);
      continue;
    }
    const keys = Object.keys(check);
    if (keys.length === 0) problems.push(`${path}: has no checks`);
    for (const key of keys) {
      if (!CHECKS.includes(key)) problems.push(`${path}: unknown check "${key}"`);
    }
    const c = check as FieldCheck;
    const valid = ajv.compile(schema);
    if ("equals" in c && !valid(c.equals)) {
      problems.push(`${path}: equals ${JSON.stringify(c.equals)} is never a valid answer`);
    }
    if ("oneOf" in c) {
      if (!Array.isArray(c.oneOf) || c.oneOf.length === 0) {
        problems.push(`${path}: oneOf must be a non-empty list`);
      } else {
        for (const value of c.oneOf) {
          if (!valid(value)) {
            problems.push(`${path}: oneOf ${JSON.stringify(value)} is never a valid answer`);
          }
        }
      }
    }
    if ("isNull" in c) {
      if (typeof c.isNull !== "boolean") problems.push(`${path}: isNull must be true or false`);
      else if (c.isNull && !allowsType(schema, "null")) {
        problems.push(`${path}: is never null in the answer schema`);
      }
    }
    if ("present" in c && typeof c.present !== "boolean") {
      problems.push(`${path}: present must be true or false`);
    }
    for (const key of ["contains", "matches"] as const) {
      if (!(key in c)) continue;
      if (typeof c[key] !== "string") problems.push(`${path}: ${key} must be a string`);
      else if (!allowsType(schema, "string")) problems.push(`${path}: ${key} needs a string field`);
    }
    if (typeof c.matches === "string") {
      try {
        new RegExp(c.matches);
      } catch {
        problems.push(`${path}: matches is not a valid pattern`);
      }
    }
  }
  return problems;
}

function valueAt(answer: unknown, path: string): unknown {
  let node = answer;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** What an answer fails to show of an expect block; empty when every check holds. */
export function checkExpect(expectBlock: ExpectBlock, answer: unknown): string[] {
  const failures: string[] = [];
  for (const [path, c] of Object.entries(expectBlock)) {
    const value = valueAt(answer, path);
    const shown = JSON.stringify(value) ?? "absent";
    if ("equals" in c && JSON.stringify(value) !== JSON.stringify(c.equals)) {
      failures.push(`${path}: expected ${JSON.stringify(c.equals)}, got ${shown}`);
    }
    if (c.isNull !== undefined && (value === null) !== c.isNull) {
      failures.push(`${path}: expected ${c.isNull ? "null" : "not null"}, got ${shown}`);
    }
    if (c.oneOf && !c.oneOf.some((o) => JSON.stringify(o) === JSON.stringify(value))) {
      failures.push(`${path}: expected one of ${JSON.stringify(c.oneOf)}, got ${shown}`);
    }
    if (c.contains !== undefined && !(typeof value === "string" && value.includes(c.contains))) {
      failures.push(`${path}: expected to contain ${JSON.stringify(c.contains)}, got ${shown}`);
    }
    if (c.matches !== undefined && !(typeof value === "string" && new RegExp(c.matches).test(value))) {
      failures.push(`${path}: expected to match /${c.matches}/, got ${shown}`);
    }
    if (c.present !== undefined && (value !== undefined) !== c.present) {
      failures.push(`${path}: expected ${c.present ? "present" : "absent"}, got ${shown}`);
    }
  }
  return failures;
}
