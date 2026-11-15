// Whether the phone's own navigation bar can be drawn over the foot of the page (mw-6ww.148.49). Where it can, everything fixed to the foot
// stands on a 48 px floor (--tt-bar-floor in src/index.css, mw-umpkr9); where it cannot, that floor is an empty band under the nav's labels
// (about 104 px of nav in all instead of 56 + the inset, mw-6ww.148.46). The page cannot see the bar itself, so it reads what it can:
//  - display mode: only the installed app (standalone, minimal-ui) draws edge to edge under the bar; a browser tab keeps its own bars outside
//    the page, and fullscreen hides the system bars;
//  - the reported inset: any env(safe-area-inset-bottom) above 0 is the phone's own word for what the bar covers, and is used as it is;
//  - the window against the screen: a window shorter than the screen has the bar outside it, so nothing is drawn over its foot.
// What is left (installed, the whole screen is the window, no inset reported) is Legend's three-button case, and keeps the floor.

export interface BarReading {
  displayMode: "browser" | "standalone" | "minimal-ui" | "fullscreen" | "other";
  /** env(safe-area-inset-bottom) in px. */
  inset: number;
  /** screen.height less the window's innerHeight, in px (CSS). */
  gap: number;
}

/** Slack for rounding between screen.height and innerHeight, in px. */
const GAP_SLACK = 2;

export function barOverlapsPage(r: BarReading): boolean {
  if (r.displayMode !== "standalone" && r.displayMode !== "minimal-ui") return false;
  if (r.inset > 0) return false;
  return r.gap <= GAP_SLACK;
}

function displayMode(win: Window): BarReading["displayMode"] {
  for (const mode of ["fullscreen", "standalone", "minimal-ui", "browser"] as const) {
    if (win.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  return "other";
}

/** The inset the phone reports, read through an element so the same env() the CSS uses is what is measured. */
function reportedInset(doc: Document): number {
  const probe = doc.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)";
  doc.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return px;
}

function keyboardMayBeUp(doc: Document): boolean {
  const el = doc.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Sets data-bar-overlap on <html> from what the page can read now (index.css turns it into the 48 px floor). */
export function readBarFloor(win: Window = window): void {
  const doc = win.document;
  // a soft keyboard shortens the window and would read as a bar outside the page: keep the last reading while a field has focus
  if (keyboardMayBeUp(doc) && doc.documentElement.hasAttribute("data-bar-checked")) return;
  const overlaps = barOverlapsPage({ displayMode: displayMode(win), inset: reportedInset(doc), gap: win.screen.height - win.innerHeight });
  doc.documentElement.toggleAttribute("data-bar-overlap", overlaps);
  doc.documentElement.setAttribute("data-bar-checked", "");
}

/** Reads now and again when the window, the orientation or the display mode changes; returns the stop. */
export function watchBarFloor(win: Window = window): () => void {
  const read = () => readBarFloor(win);
  read();
  win.addEventListener("resize", read);
  win.addEventListener("orientationchange", read);
  win.addEventListener("focusout", read);
  const modes = ["standalone", "fullscreen", "minimal-ui", "browser"].map((m) => win.matchMedia(`(display-mode: ${m})`));
  for (const m of modes) m.addEventListener?.("change", read);
  return () => {
    win.removeEventListener("resize", read);
    win.removeEventListener("orientationchange", read);
    win.removeEventListener("focusout", read);
    for (const m of modes) m.removeEventListener?.("change", read);
  };
}
