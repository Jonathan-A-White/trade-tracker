import { SETTINGS_SECTIONS } from "./sections";

describe("SETTINGS_SECTIONS", () => {
  it("has unique ids", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is sorted by order, ties by id", () => {
    const sorted = [...SETTINGS_SECTIONS].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(sorted.map((s) => s.id));
  });
});
