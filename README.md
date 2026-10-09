# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

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
- [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit): The factory key, the licence check and the signed requests to the factory door. Licence: [MIT](https://opensource.org/license/mit). Changes: Our own library, pinned to a commit.

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
