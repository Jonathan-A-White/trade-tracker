import { groupProblems } from "pwa-kit/settings";
import { GROUPS, ROWS, SECTIONS, SETTINGS_PATH } from "./registry";

describe("the settings registry", () => {
  it("puts every section in exactly one group", () => {
    expect(groupProblems(SECTIONS, GROUPS)).toEqual([]);
  });

  it("declares each setting once, with a name and a hint", () => {
    const keys = ROWS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of ROWS) {
      expect(row.label.trim()).not.toBe("");
      expect(row.hint.trim()).not.toBe("");
    }
  });

  it("gives every section at least one row, and lists the rows section by section", () => {
    const order = SECTIONS.map((s) => s.id);
    for (const id of order) expect(ROWS.some((r) => r.section === id)).toBe(true);
    const sectionIndexes = ROWS.map((r) => order.indexOf(r.section));
    expect(sectionIndexes).toEqual([...sectionIndexes].sort((a, b) => a - b));
  });

  it("keeps the Factory and Backend rows in the Factory section", () => {
    expect(ROWS.filter((r) => r.section === "factory").map((r) => r.key)).toEqual(["factory", "backend"]);
  });

  it("is mounted at /settings", () => {
    expect(SETTINGS_PATH).toBe("/settings");
  });
});
