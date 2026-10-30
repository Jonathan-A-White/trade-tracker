import { SECTIONS } from "./registry";
import { SETTINGS_SECTIONS } from "./sections";

describe("SETTINGS_SECTIONS", () => {
  it("has unique ids", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws the registry's sections, in the registry's order, under the registry's titles", () => {
    expect(SETTINGS_SECTIONS.map((s) => [s.id, s.title])).toEqual(SECTIONS.map((s) => [s.id, s.title]));
  });
});
