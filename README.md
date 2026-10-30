# React + TypeScript + Vite

The app's vision: [VISION.md](VISION.md).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

<!-- toc -->

- [The forms tutor: Let the tutor do it](#the-forms-tutor-let-the-tutor-do-it)
- [React Compiler](#react-compiler)
- [Expanding the ESLint configuration](#expanding-the-eslint-configuration)
- [Docs](#docs)
- [Credits](#credits)
  - [Libraries in the app](#libraries-in-the-app)
  - [Tools that build and test the app](#tools-that-build-and-test-the-app)
  - [Data](#data)
  - [Services](#services)
  - [Ideas and the tools that built the app](#ideas-and-the-tools-that-built-the-app)

<!-- /toc -->

## The forms tutor: Let the tutor do it

No form without a tutor. Each of the app's three forms has a **Let the tutor do it** button at its top: the tutor asks for one field at a time in plain words, fills the field he answers, and when every required field holds something offers **Send**, which he taps himself (the tutor never sends).

| Form | Fields | Pages | Command |
| --- | --- | --- | --- |
| `ItemForm` (`src/components/forms/item-form.tsx`) | Barcode or PLU Code, Name, Price, Unit Type (Each, Per Pound), Category | new item, item detail, add item, active trip | `item-save` |
| `StoreForm` (`src/components/forms/store-form.tsx`) | Store Name, City, State, Notes | new store, edit store, new trip | `store-save` |
| Identify Item (`src/components/forms/fix-unknown-item-modal.tsx`) | Name, Barcode or PLU, Unit Type, Category | the trip pages that fix an unknown item | `identify-item` |

- The door is `src/tutor/form-door.tsx` (`FormDoor`); the forms and commands live in `src/tutor/form-commands.ts`, the request and the factory client in `src/tutor/form-talk.ts`. The forms come from `@voice-kit/forms` (the `voice-kit` package, pinned by commit).
- Each command is a `confirm` command: its `send` is the page's own `onSubmit` (the modal's own save), so the form's Save and the door's Send run the same handler with the same values.
- The tutor is the grind `grinds/form-talk.json` (instructions `grinds/form-talk.md`, schemas `schemas/form-talk-input-1.0.schema.json` and `schemas/form-talk-answer-1.0.schema.json`, examples under `grinds/examples/form-talk/`). It is reached through the factory (`FactoryProvider` gives the forms their way to ask only while the door is licensed); with no factory the button says so and the form works as it always did.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
npm warn exec The following package was not found and will be installed: tsx@4.23.15

## Docs

- [Module map](docs/module-map.md): each module's one responsibility and API, the files most stories collide on, and the refactors and shared libraries that would let stories run in parallel.
- [Best-practices audit](docs/best-practices-audit.md): every line of the factory's PWA checklist and the newer rules, pass / fail / not applicable with evidence, and the failures ranked into fix stories.

## Credits

> “If I have seen further it is by standing on the shoulders of Giants.” — Isaac Newton, letter to Robert Hooke, 1675

TradeTracker is built on other people's work, so we name every source, say what we use it for and under what licence, and say what we changed. The same list is in the app, under Settings > About > Credits and thanks (source: `src/content/credits.ts`).

A source added or removed changes its credit in the same commit, and the test (`src/content/credits-check.test.ts`) says so: it fails on a runtime dependency with no credit, a credit for a package that is no longer a dependency, and a bundled font or data file with no credit.

### Libraries in the app

- [React](https://react.dev): The user interface (react and react-dom). Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [React Router](https://reactrouter.com): Moving between screens. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [Dexie.js](https://dexie.org): Storing every trip, item and price on your phone in IndexedDB, and keeping the screens in step with it (dexie and dexie-react-hooks). Licence: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0). Changes: None.
- [Recharts](https://recharts.org): The price and spending charts in Reports. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [Tailwind CSS](https://tailwindcss.com): All the styling (tailwindcss and its Vite plugin). Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [barcode-detector](https://github.com/Sec-ant/barcode-detector): Reading barcodes with the camera on phones that have no built-in barcode reader. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm): The barcode reading engine inside barcode-detector (a WebAssembly build of ZXing-C++). Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp): The barcode decoder that zxing-wasm is built from. Licence: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0). Changes: None.
- [qrcode](https://github.com/soldair/node-qrcode): Drawing this phone's key as a QR code in Settings, so Postern can scan it. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit): The factory key, the licence check and the signed requests to the factory door. Licence: [MIT](https://opensource.org/license/mit). Changes: Our own library, pinned to a commit.
- [voice-kit](https://github.com/Jonathan-A-White/voice-kit): Lets the tutor ask for a form's fields one at a time and fill them in. Licence: [MIT](https://opensource.org/license/mit). Changes: Our own library, pinned to a commit.
- [pwa-kit](https://github.com/Jonathan-A-White/pwa-kit): Finds a new build and offers the Update ready bar, and shows What's new from the change list. Licence: [MIT](https://opensource.org/license/mit). Changes: Our own library, pinned to a commit.

### Tools that build and test the app

- [Vite](https://vite.dev): The build and the dev server. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app): Makes the app installable and keeps it working offline. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [Workbox](https://developer.chrome.com/docs/workbox): The service worker that caches the app for offline use. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [TypeScript](https://www.typescriptlang.org): The language the app is written in. Licence: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0). Changes: None.
- [Vitest](https://vitest.dev): Running the tests. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [Testing Library](https://testing-library.com): Testing the screens the way a person uses them. Licence: [MIT](https://opensource.org/license/mit). Changes: None.
- [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB): A stand-in for the phone's database in tests. Licence: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0). Changes: None.

### Data

- [Open Food Facts](https://world.openfoodfacts.org): The Trader Joe's barcodes you can add from Settings were taken from it. Licence: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Changes: Kept only the barcode and product name, and added our own category and typical price.
- [IFPS PLU codes](https://www.ifpsglobal.com/plu-codes): The produce PLU codes you can add from Settings come from the International Federation for Produce Standards' list. Licence: [Public reference codes](https://www.ifpsglobal.com/plu-codes). Changes: Kept a common subset, and added our own category, unit and typical price.

### Services

- [Postern](https://postern.allmymind.org): The factory door: checks your licence and carries photo lookups to the factory when you use them. Nothing is sent unless you do. Licence: [Our own service](https://github.com/Jonathan-A-White). Changes: None.
- [WhatsOnChain](https://whatsonchain.com): Reads the public chain to check that your factory licence is held. Licence: [WhatsOnChain terms](https://whatsonchain.com/terms). Changes: None; read only.
- [Claude](https://www.anthropic.com/claude): Reads the package and shelf-tag photos in a lookup and answers with the item's name, category and price. Licence: [Anthropic terms](https://www.anthropic.com/legal/commercial-terms). Changes: None.

### Ideas and the tools that built the app

- [Claude Code](https://www.anthropic.com/claude-code): Wrote much of this app's code, under our direction. Licence: [Anthropic terms](https://www.anthropic.com/legal/commercial-terms). Changes: None.
- [Beads, by Steve Yegge](https://github.com/steveyegge/beads): The way our factory tracks work as small linked tasks. Licence: [MIT](https://opensource.org/license/mit). Changes: An idea we borrowed, not code we ship.
- [Gas Town, by Steve Yegge](https://github.com/steveyegge/gastown): The idea of a factory of agents with roles, which shaped how we build. Licence: [MIT](https://opensource.org/license/mit). Changes: An idea we borrowed, not code we ship.
