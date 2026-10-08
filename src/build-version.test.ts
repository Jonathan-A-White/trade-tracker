import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildVersion, shortCommit } from "../build-version";

describe("buildVersion", () => {
  it("joins v<version>, the UTC build time and the short commit", () => {
    const when = new Date(Date.UTC(2026, 9, 1, 16, 5, 59));
    expect(buildVersion("0.1.0", when, "abc1234")).toBe(
      "v0.1.0 · 2026-10-01 16:05Z · abc1234",
    );
  });

  it("differs for two commits and for two build times", () => {
    const t = new Date(Date.UTC(2026, 9, 1, 16, 5));
    expect(buildVersion("0.1.0", t, "abc1234")).not.toBe(buildVersion("0.1.0", t, "def5678"));
    expect(buildVersion("0.1.0", t, "abc1234")).not.toBe(
      buildVersion("0.1.0", new Date(t.getTime() + 60_000), "abc1234"),
    );
  });
});

describe("shortCommit", () => {
  it("is this checkout's short HEAD inside a git checkout", () => {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).trim();
    expect(shortCommit(process.cwd())).toBe(head);
  });

  it("is 'dev' outside a git checkout, and never throws", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tt-nogit-"));
    try {
      expect(shortCommit(dir)).toBe("dev");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is 'dev' when git itself is absent", () => {
    expect(shortCommit(process.cwd(), "/nonexistent/git")).toBe("dev");
  });
});

describe("the stamp the build defines", () => {
  it("has the form v<package version> · <UTC time>Z · <commit>", () => {
    expect(__APP_VERSION__).toMatch(/^v\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z · \S+$/);
  });
});
