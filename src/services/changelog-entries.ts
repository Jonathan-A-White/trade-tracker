// CHANGELOG.md (written at each landing by mw next) read as the entries pwa-kit/whats-new draws: per "## <version>"
// the "_date_" line and its "- New: ..." / "- Fixed: ..." lines, newest first as the file has them. A version that says
// "No visible change", the notes under "###" headings and the notes before 0.1.1 are not lines of a version.
import type { ChangelogEntry } from "pwa-kit/whats-new";

export function changelogEntries(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  for (const section of markdown.split(/^## /m).slice(1)) {
    const [heading, ...body] = section.split("\n");
    const version = heading.trim();
    if (!/^\d+(\.\d+)*$/.test(version)) continue;
    const date = body.map((l) => /^_(\d{4}-\d{2}-\d{2})_$/.exec(l.trim())?.[1]).find(Boolean) ?? "";
    for (const line of body) {
      const match = /^- (New|Fixed): (.+)$/.exec(line.trim());
      if (match) entries.push({ version, date, story: "", kind: match[1] === "New" ? "new" : "fixed", text: match[2] });
    }
  }
  return entries;
}
