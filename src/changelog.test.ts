import { readFileSync } from "node:fs";

// CHANGELOG.md is what mw next writes a What's new line into at each landing (rigs/trade-tracker.toml names it in
// changelog_files). Format as in Lampas: "# What's new", then per version "## 0.1.N", "_date_", one "- New:" /
// "- Fixed:" sentence or "- No visible change", newest first (mw-yo44a6).
const text = readFileSync("CHANGELOG.md", "utf-8");

const sections = text
  .split(/^## /m)
  .slice(1)
  .map((s) => {
    const [heading, ...rest] = s.split("\n");
    return { version: heading.trim(), body: rest.join("\n") };
  })
  .filter((s) => /^0\.1\.\d+$/.test(s.version));

describe("CHANGELOG.md", () => {
  it("opens with the What's new heading", () => {
    expect(text.startsWith("# What's new\n")).toBe(true);
  });

  it("has an entry for every version from 0.1.1 up to the newest one, none missing, newest first", () => {
    const versions = sections.map((s) => s.version).filter((v) => v !== "0.1.0");
    const latest = Number((versions[0] ?? "0.1.0").split(".")[2]);
    expect(latest).toBeGreaterThanOrEqual(26);
    expect(versions).toEqual(Array.from({ length: latest }, (_, i) => `0.1.${latest - i}`));
  });

  it("gives each entry a date and a New:, Fixed: or No visible change line", () => {
    for (const s of sections.filter((s) => s.version !== "0.1.0")) {
      const lines = s.body.split("\n").filter((l) => l.trim() !== "");
      expect(lines[0], s.version).toMatch(/^_\d{4}-\d{2}-\d{2}_$/);
      expect(lines[1], s.version).toMatch(/^- (New: .+|Fixed: .+|No visible change)$/);
    }
  });

  it("keeps the notes written before 0.1.1", () => {
    expect(text).toContain("### Photo lookups through the factory");
    expect(text).toContain("### Credits and thanks");
  });
});
