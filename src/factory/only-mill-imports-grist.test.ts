import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(__dirname, "..");
const MILL = ["factory", "mill.ts"].join(sep);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** An import, re-export or dynamic import of the kit's grist entry. */
const IMPORTS_GRIST = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']bsv-kit\/grist["']/;

describe("the one gated mill client", () => {
  it("is the only file in src/ that imports bsv-kit/grist", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== __filename)
      .filter((file) => IMPORTS_GRIST.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file))
      .filter((file) => file !== MILL);
    expect(offenders).toEqual([]);
  });

  it("is itself an importer, so the check above has something to find", () => {
    expect(IMPORTS_GRIST.test(readFileSync(join(SRC, MILL), "utf8"))).toBe(true);
  });
});
