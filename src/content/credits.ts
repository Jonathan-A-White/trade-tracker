/**
 * Everything TradeTracker stands on. The About page and the README's Credits section
 * both list this. `packages` names the npm dependencies a credit covers: a test fails
 * when a runtime dependency in package.json is in no credit's `packages`, so adding a
 * library means crediting it in the same commit.
 */

export interface Credit {
  name: string;
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
        url: "https://react.dev",
        use: "The user interface (react and react-dom).",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["react", "react-dom"],
      },
      {
        name: "React Router",
        url: "https://reactrouter.com",
        use: "Moving between screens.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["react-router"],
      },
      {
        name: "Dexie.js",
        url: "https://dexie.org",
        use: "Storing every trip, item and price on your phone in IndexedDB, and keeping the screens in step with it (dexie and dexie-react-hooks).",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
        packages: ["dexie", "dexie-react-hooks"],
      },
      {
        name: "Recharts",
        url: "https://recharts.org",
        use: "The price and spending charts in Reports.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["recharts"],
      },
      {
        name: "Tailwind CSS",
        url: "https://tailwindcss.com",
        use: "All the styling (tailwindcss and its Vite plugin).",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["tailwindcss", "@tailwindcss/vite"],
      },
      {
        name: "barcode-detector",
        url: "https://github.com/Sec-ant/barcode-detector",
        use: "Reading barcodes with the camera on phones that have no built-in barcode reader.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
        packages: ["barcode-detector"],
      },
      {
        name: "zxing-wasm",
        url: "https://github.com/Sec-ant/zxing-wasm",
        use: "The barcode reading engine inside barcode-detector (a WebAssembly build of ZXing-C++).",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "ZXing-C++",
        url: "https://github.com/zxing-cpp/zxing-cpp",
        use: "The barcode decoder that zxing-wasm is built from.",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
      },
      {
        name: "bsv-kit",
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
        url: "https://vite.dev",
        use: "The build and the dev server.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "vite-plugin-pwa",
        url: "https://vite-pwa-org.netlify.app",
        use: "Makes the app installable and keeps it working offline.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "Workbox",
        url: "https://developer.chrome.com/docs/workbox",
        use: "The service worker that caches the app for offline use.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "TypeScript",
        url: "https://www.typescriptlang.org",
        use: "The language the app is written in.",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
      },
      {
        name: "Vitest",
        url: "https://vitest.dev",
        use: "Running the tests.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "Testing Library",
        url: "https://testing-library.com",
        use: "Testing the screens the way a person uses them.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "None.",
      },
      {
        name: "fake-indexeddb",
        url: "https://github.com/dumbmatter/fakeIndexedDB",
        use: "A stand-in for the phone's database in tests.",
        licence: "Apache-2.0",
        licenceUrl: APACHE,
        changes: "None.",
      },
    ],
  },
  {
    title: "Data",
    credits: [
      {
        name: "Open Food Facts",
        url: "https://world.openfoodfacts.org",
        use: "The Trader Joe's barcodes you can add from Settings were taken from it.",
        licence: "ODbL 1.0",
        licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
        changes: "Kept only the barcode and product name, and added our own category and typical price.",
      },
      {
        name: "IFPS PLU codes",
        url: "https://www.ifpsglobal.com/plu-codes",
        use: "The produce PLU codes you can add from Settings come from the International Federation for Produce Standards' list.",
        licence: "Public reference codes",
        licenceUrl: "https://www.ifpsglobal.com/plu-codes",
        changes: "Kept a common subset, and added our own category, unit and typical price.",
      },
    ],
  },
  {
    title: "Services",
    credits: [
      {
        name: "Postern",
        url: "https://postern.allmymind.org",
        use: "The factory door: checks your licence and carries photo lookups to the factory when you use them. Nothing is sent unless you do.",
        licence: "Our own service",
        licenceUrl: "https://github.com/Jonathan-A-White",
        changes: "None.",
      },
      {
        name: "WhatsOnChain",
        url: "https://whatsonchain.com",
        use: "Reads the public chain to check that your factory licence is held.",
        licence: "WhatsOnChain terms",
        licenceUrl: "https://whatsonchain.com/terms",
        changes: "None; read only.",
      },
      {
        name: "Claude",
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
        url: "https://www.anthropic.com/claude-code",
        use: "Wrote much of this app's code, under our direction.",
        licence: "Anthropic terms",
        licenceUrl: "https://www.anthropic.com/legal/commercial-terms",
        changes: "None.",
      },
      {
        name: "Beads, by Steve Yegge",
        url: "https://github.com/steveyegge/beads",
        use: "The way our factory tracks work as small linked tasks.",
        licence: "MIT",
        licenceUrl: MIT,
        changes: "An idea we borrowed, not code we ship.",
      },
      {
        name: "Gas Town, by Steve Yegge",
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
