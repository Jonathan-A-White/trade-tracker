import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// Every camera in the app opens through src/scanner/camera-controls.ts (openCameraStream), so the rear camera is
// asked for the same way everywhere. A bare getUserMedia elsewhere is how the receipt camera ended up with no
// resolution and no focus control (mw-31qug1.11).
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("camera sweep", () => {
  it("no getUserMedia call outside src/scanner/", () => {
    const offenders = sourceFiles("src")
      .filter((path) => !path.startsWith(`src${sep}scanner${sep}`))
      .filter((path) => /\bgetUserMedia\b/.test(readFileSync(path, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("the shared opener is the one place in src/scanner/ that calls it", () => {
    const callers = sourceFiles(join("src", "scanner")).filter((path) =>
      /\bgetUserMedia\b/.test(readFileSync(path, "utf-8")),
    );
    expect(callers).toEqual([join("src", "scanner", "camera-controls.ts")]);
  });
});
