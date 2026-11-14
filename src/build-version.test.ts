import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildVersion, packageVersion, shortCommit } from "../build-version";

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

// mw-6ww.175.55: the version was read from the working package.json beside HEAD's commit, so a working file
// older than HEAD (a checkout that moved HEAD without rewriting the file) stamped the old version.
describe("packageVersion", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function checkout(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "tt-version-"));
    dirs.push(dir);
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
        { cwd: dir, stdio: "ignore" },
      );
    git("init", "-q");
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.1.111" }));
    git("add", "package.json");
    git("commit", "-q", "-m", "one");
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.1.112" }));
    git("commit", "-q", "-am", "two");
    return dir;
  }

  it("is the version HEAD holds when the working package.json is older and uncommitted", () => {
    const dir = checkout();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.1.111" }));
    expect(packageVersion(dir)).toBe("0.1.112");
  });

  it("is the working file's version outside a git checkout", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tt-version-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(packageVersion(dir)).toBe("1.2.3");
  });

  it("is the working file's version when git itself is absent", () => {
    const dir = checkout();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.1.111" }));
    expect(packageVersion(dir, "/nonexistent/git")).toBe("0.1.111");
  });
});

describe("the stamp the build defines", () => {
  it("has the form v<package version> · <UTC time>Z · <commit>", () => {
    expect(__APP_VERSION__).toMatch(/^v\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z · \S+$/);
  });
});
