import { changelogEntries } from "./changelog-entries";

const SAMPLE = `# What's new

## 0.1.32
_2026-10-10_
- New: Settings shows this phone's key as a QR code.

### A note under the entry

Words that are not a line of the version.

## 0.1.31
_2026-10-10_
- No visible change

## 0.1.27
_2026-10-09_
- Fixed: A photo no longer leaves the item at $0.00.

## 0.1.0
Notes written before the entries.
`;

describe("changelogEntries", () => {
  it("reads each New: and Fixed: line of a version as an entry, newest first", () => {
    expect(changelogEntries(SAMPLE)).toEqual([
      { version: "0.1.32", date: "2026-10-10", story: "", kind: "new", text: "Settings shows this phone's key as a QR code." },
      { version: "0.1.27", date: "2026-10-09", story: "", kind: "fixed", text: "A photo no longer leaves the item at $0.00." },
    ]);
  });

  it("leaves out a version with no visible change and the notes under an entry", () => {
    const versions = changelogEntries(SAMPLE).map((e) => e.version);
    expect(versions).not.toContain("0.1.31");
    expect(versions).not.toContain("0.1.0");
  });

  it("reads the real CHANGELOG.md into at least one entry", async () => {
    const { default: real } = await import("../../CHANGELOG.md?raw");
    expect(changelogEntries(real).length).toBeGreaterThan(0);
  });
});
