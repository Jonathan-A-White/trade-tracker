import { readFileSync } from "node:fs";

// The sticky page header (PageHeader, and the library/history filter bars) sticks to the top of #root, the one scroll
// container. Any top padding on #root (the status bar's safe-area inset, say) makes it stick that far below the screen
// edge with the page scrolling through the gap above it (mw-iy99ci.16, .25). The real-browser check is
// tests/e2e/sticky-title.spec.ts; this pins the CSS rule in the gate, which jsdom cannot lay out.
const css = readFileSync("src/index.css", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector: string): string {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].split(",").map((s) => s.trim()).includes(selector))
    .map((m) => m[2]);
  return blocks.join("\n");
}

describe("status-bar safe area", () => {
  it("is padding on the body, which never scrolls", () => {
    expect(declarations("body")).toContain("padding-top: env(safe-area-inset-top)");
  });

  it("is not padding on the scroll container the sticky header sticks inside", () => {
    const root = declarations("#root");
    expect(root).toContain("overflow-y: auto");
    expect(root).not.toMatch(/padding|safe-area/);
  });
});
