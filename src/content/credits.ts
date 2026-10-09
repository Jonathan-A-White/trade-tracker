/**
 * Everything TradeTracker stands on. The About page and the README's Credits section
 * both list this, and a test keeps the list in step with what the app ships
 * (src/content/credits-check.test.ts):
 * - a runtime dependency in package.json that is in no credit's `packages` fails;
 * - a `package` credit naming a package that is no longer in package.json fails;
 * - a font file or a seed data file that is in no credit's `files` fails, and so
 *   does a credit naming a file that is gone.
 * So adding or removing a source means changing its credit in the same commit.
 * Credits whose `kind` is not "package" (data, services, ideas, fonts) are left alone
 * by the package check.
 */

export type CreditKind = "package" | "data" | "font" | "service" | "idea";

export interface Credit {
  name: string;
  /** What sort of thing this is; only "package" credits are checked against package.json. */
  kind: CreditKind;
  url: string;
  /** What we use it for. */
  use: string;
  /** Licence name, shown as the licence link's text. */
  licence: string;
  licenceUrl: string;
  /** What we changed; "None" when nothing. */
  changes: string;
  /** npm package names this credit covers. */
  packages?: string[];
  /** Bundled font or data files (repo-relative paths) this credit covers. */
  files?: string[];
}

export interface CreditGroup {
  title: string;
  credits: Credit[];
}

export const NEWTON_QUOTE = {
  text: "If I have seen further it is by standing on the shoulders of Giants.",
  attribution: "Isaac Newton, letter to Robert Hooke, 1675",
  why: "TradeTracker is built on other people's work, so we name every source, say what we use it for and under what licence, and say what we changed.",
};

const MIT = "https://opensource.org/license/mit";
const APACHE = "https://www.apache.org/licenses/LICENSE-2.0";

export const CREDIT_GROUPS: CreditGroup[] = [
  {
    title: "Libraries in the app",
    credits: [
      {
        name: "React",
        kind: "package",
        url: "https://react.dev",
        use: "The user interface (react and react-dom).",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["react", "react-dom"],
      },
      {
        name: "React Router",
        kind: "package",
        url: "https://reactrouter.com",
        use: "Moving between screens.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["react-router"],
      },
      {
        name: "Dexie.js",
        kind: "package",
        url: "https://dexie.org",
        use: "Storing every trip, item and price on your phone in IndexedDB, and keeping the screens in step with it (dexie and dexie-react-hooks).",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
        packages: ["dexie", "dexie-react-hooks"],
      },
      {
        name: "Recharts",
        kind: "package",
        url: "https://recharts.org",
        use: "The price and spending charts in Reports.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["recharts"],
      },
      {
        name: "Tailwind CSS",
        kind: "package",
        url: "https://tailwindcss.com",
        use: "All the styling (tailwindcss and its Vite plugin).",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["tailwindcss", "@tailwindcss/vite"],
      },
      {
        name: "barcode-detector",
        kind: "package",
        url: "https://github.com/Sec-ant/barcode-detector",
        use: "Reading barcodes with the camera on phones that have no built-in barcode reader.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["barcode-detector"],
      },
      {
        name: "zxing-wasm",
        kind: "package",
        url: "https://github.com/Sec-ant/zxing-wasm",
        use: "The barcode reading engine inside barcode-detector (a WebAssembly build of ZXing-C++).",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "ZXing-C++",
        kind: "package",
        url: "https://github.com/zxing-cpp/zxing-cpp",
        use: "The barcode decoder that zxing-wasm is built from.",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
      },
      {
        name: "bsv-kit",
        kind: "package",
        url: "https://github.com/Jonathan-A-White/bsv-kit",
        use: "The factory key, the licence check and the signed requests to the factory door.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "Our own library, pinned to a commit.",
        packages: ["bsv-kit"],
      },
    ],
  },
  {
    title: "Tools that build and test the app",
    credits: [
      {
        name: "Vite",
        kind: "package",
        url: "https://vite.dev",
        use: "The build and the dev server.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["vite"],
      },
      {
        name: "vite-plugin-pwa",
        kind: "package",
        url: "https://vite-pwa-org.netlify.app",
        use: "Makes the app installable and keeps it working offline.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["vite-plugin-pwa"],
      },
      {
        name: "Workbox",
        kind: "package",
        url: "https://developer.chrome.com/docs/workbox",
        use: "The service worker that caches the app for offline use.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "TypeScript",
        kind: "package",
        url: "https://www.typescriptlang.org",
        use: "The language the app is written in.",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
        packages: ["typescript"],
      },
      {
        name: "Vitest",
        kind: "package",
        url: "https://vitest.dev",
        use: "Running the tests.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["vitest"],
      },
      {
        name: "Testing Library",
        kind: "package",
        url: "https://testing-library.com",
        use: "Testing the screens the way a person uses them.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["@testing-library/react", "@testing-library/jest-dom", "@testing-library/user-event"],
      },
      {
        name: "fake-indexeddb",
        kind: "package",
        url: "https://github.com/dumbmatter/fakeIndexedDB",
        use: "A stand-in for the phone's database in tests.",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
        packages: ["fake-indexeddb"],
      },
    ],
  },
  {
    title: "Data",
    credits: [
      {
        name: "Open Food Facts",
        kind: "data",
        url: "https://world.openfoodfacts.org",
        use: "The Trader Joe's barcodes you can add from Settings were taken from it.",
        licence: "ODbL 1.0",
        licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
        changes: "Kept only the barcode and product name, and added our own category and typical price.",
        files: ["src/db/tj-barcode-seed-data.ts", "src/db/tj-receipt-seed-data.ts"],
      },
      {
        name: "IFPS PLU codes",
        kind: "data",
        url: "https://www.ifpsglobal.com/plu-codes",
        use: "The produce PLU codes you can add from Settings come from the International Federation for Produce Standards' list.",
        licence: "Public reference codes",
        licenceUrl: "https://www.ifpsglobal.com/plu-codes",
        changes: "Kept a common subset, and added our own category, unit and typical price.",
        files: ["src/db/plu-seed-data.ts"],
      },
    ],
  },
  {
    title: "Services",
    credits: [
      {
        name: "Postern",
        kind: "service",
        url: "https://postern.allmymind.org",
        use: "The factory door: checks your licence and carries photo lookups to the factory when you use them. Nothing is sent unless you do.",
        licence: "Our own service",
        licenceUrl: "https://github.com/Jonathan-A-White",
        changes: "None.",
      },
      {
        name: "WhatsOnChain",
        kind: "service",
        url: "https://whatsonchain.com",
        use: "Reads the public chain to check that your factory licence is held.",
        licence: "WhatsOnChain terms",
        licenceUrl: "https://whatsonchain.com/terms",
        changes: "None; read only.",
      },
      {
        name: "Claude",
        kind: "service",
        url: "https://www.anthropic.com/claude",
        use: "Reads the package and shelf-tag photos in a lookup and answers with the item's name, category and price.",
        licence: "Anthropic terms",
        licenceUrl: "https://www.anthropic.com/legal/commercial-terms",
        changes: "None.",
      },
    ],
  },
  {
    title: "Ideas and the tools that built the app",
    credits: [
      {
        name: "Claude Code",
        kind: "idea",
        url: "https://www.anthropic.com/claude-code",
        use: "Wrote much of this app's code, under our direction.",
        licence: "Anthropic terms",
        licenceUrl: "https://www.anthropic.com/legal/commercial-terms",
        changes: "None.",
      },
      {
        name: "Beads, by Steve Yegge",
        kind: "idea",
        url: "https://github.com/steveyegge/beads",
        use: "The way our factory tracks work as small linked tasks.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "An idea we borrowed, not code we ship.",
      },
      {
        name: "Gas Town, by Steve Yegge",
        kind: "idea",
        url: "https://github.com/steveyegge/gastown",
        use: "The idea of a factory of agents with roles, which shaped how we build.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "An idea we borrowed, not code we ship.",
      },
    ],
  },
];

export const CREDITS: Credit[] = CREDIT_GROUPS.flatMap((g) => g.credits);
