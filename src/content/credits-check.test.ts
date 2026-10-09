import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { CREDITS, type Credit } from "@/content/credits";
import {
  FONT_EXTENSIONS,
  stalePackages,
  staleFiles,
  uncreditedFiles,
  uncreditedPackages,
} from "@/content/credits-check";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const installed = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every font file the app bundles: anything in public/ or src/ with a font extension. */
function bundledFonts(): string[] {
  return [...walk("public"), ...walk("src")]
    .filter((f) => FONT_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    .map((f) => relative(".", f));
}

/** Every data source the app ships: the seed data files the Settings screen loads. */
function bundledDataFiles(): string[] {
  return walk("src/db")
    .filter((f) => f.endsWith("-seed-data.ts"))
    .map((f) => relative(".", f));
}

const credit = (over: Partial<Credit>): Credit => ({
  name: "X",
  kind: "package",
  url: "https://x.example",
  use: "u",
  licence: "MIT",
  licenceUrl: "https://x.example/licence",
  changes: "None.",
  ...over,
});

describe("credits follow the packages (checker, fed fake lists)", () => {
  it("fails a credit for a package that is no longer a dependency", () => {
    const credits = [credit({ packages: ["left-pad", "react"] })];
    expect(stalePackages(credits, ["react"])).toEqual(["left-pad"]);
  });

  it("passes when every credited package is still a dependency", () => {
    const credits = [credit({ packages: ["react"] })];
    expect(stalePackages(credits, ["react", "vite"])).toEqual([]);
  });

  it("fails a dependency that no credit names", () => {
    const credits = [credit({ packages: ["react"] })];
    expect(uncreditedPackages(credits, ["react", "vite"])).toEqual(["vite"]);
  });

  it("leaves credits that are not packages alone, by kind", () => {
    const credits = [
      credit({ name: "A dataset", kind: "data", packages: ["not-a-dependency"] }),
      credit({ name: "A service", kind: "service" }),
      credit({ name: "An idea", kind: "idea" }),
      credit({ name: "A font", kind: "font" }),
    ];
    expect(stalePackages(credits, [])).toEqual([]);
  });
});

describe("credits follow the bundled files (checker, fed fake lists)", () => {
  it("fails a bundled file that no credit names", () => {
    const credits = [credit({ kind: "data", files: ["src/db/a-seed-data.ts"] })];
    expect(uncreditedFiles(credits, ["src/db/a-seed-data.ts", "src/db/b-seed-data.ts"])).toEqual([
      "src/db/b-seed-data.ts",
    ]);
  });

  it("fails a credit for a file that is no longer bundled", () => {
    const credits = [credit({ kind: "data", files: ["src/db/gone-seed-data.ts"] })];
    expect(staleFiles(credits, [])).toEqual(["src/db/gone-seed-data.ts"]);
  });
});

describe("the real credits list", () => {
  it("names no package that is not a dependency (dependencies or devDependencies)", () => {
    expect(stalePackages(CREDITS, installed)).toEqual([]);
  });

  it("credits every runtime dependency in package.json", () => {
    expect(uncreditedPackages(CREDITS, Object.keys(pkg.dependencies))).toEqual([]);
  });

  it("credits every font file the app bundles", () => {
    expect(uncreditedFiles(CREDITS, bundledFonts())).toEqual([]);
  });

  it("credits every data source the app bundles", () => {
    const files = bundledDataFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(uncreditedFiles(CREDITS, files)).toEqual([]);
  });

  it("names no bundled file that is gone", () => {
    expect(staleFiles(CREDITS, [...bundledFonts(), ...bundledDataFiles()])).toEqual([]);
  });
});
