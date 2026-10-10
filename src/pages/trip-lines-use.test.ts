import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Module map R3: a trip's lines and their items are read through useTripLines
// and summed through tripTotals, not copied into each page.
const pagesDir = __dirname;
const pageSources = readdirSync(pagesDir)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => ({ name, source: readFileSync(join(pagesDir, name), "utf8") }));

describe("pages read a trip's lines through the shared loader", () => {
  it("has pages to check", () => {
    expect(pageSources.length).toBeGreaterThan(10);
  });

  it("no page queries db.items with anyOf for a trip's lines", () => {
    const offenders = pageSources
      .filter(({ source }) => /db\.items[\s\S]{0,40}\.anyOf\(/.test(source))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("no page sums a trip's lines itself", () => {
    const offenders = pageSources
      .filter(({ source }) => /\.reduce\([\s\S]{0,80}\b(lineTotal|bottleDeposit)\b/.test(source))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
