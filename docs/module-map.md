# TradeTracker module map

Written 2026-10-09 at base commit e1c4bac (story mw-vtjxh4.22). Docs only: nothing in `src/` moved.

**Why it exists.** The factory runs the stories of one rig in series when they touch the same file, because a shared file is a merge conflict. The rule it follows is 27-modular-boundaries (builder seat, pwa-best-practices): draw the boundaries so two stories can change two modules at once, and keep refactoring toward that. This map says where TradeTracker's boundaries are, where they are missing, and what to carve next so more stories can run side by side.

**How to read the paths.** A path in inline backticks exists in this repo today (the script docs/check-module-map.sh tests each one). A module that does not exist yet is shown only inside a fenced code block. Files in other repos (Postern, Lampas, Cairn, SpellForge, bsv-kit) are named in plain words, not backticks.

Contents: 1 Modules, 2 Collisions, 3 Proposed refactors, 4 Rule breaks, 5 Library candidates.

## 1. Modules

Line counts exclude tests. "Imports" lists what the module reaches for, outside itself. Imports flow downward: pages use components, contexts, hooks, services and repositories; repositories use the database; nothing below a page imports a page.

| Module | One responsibility | Entry file and API | Imports |
| --- | --- | --- | --- |
| Entry and routing | Boot the app, register the service worker, mount the provider tree, route every URL to a page. | `src/main.tsx`, `src/App.tsx` (the route table and provider order). | react-router, `src/contexts/`, `src/pages/`, `src/services/app-update.ts`, `src/services/preload-reload.ts` |
| Contracts | Name every entity and input type once. | `src/contracts/types.ts` (144 lines): `Store`, `Item`, `Trip`, `TripItem`, `PendingLookup`, `PriceHistoryEntry`, `Create*Input`, `FactoryDoorState`, `FactoryLicence`. | nothing |
| Database | Own the IndexedDB schema and its versions. | `src/db/database.ts`: `db` singleton (`TradeTrackerDB`, version 7, six tables). | dexie, contracts |
| Repositories | One class per table, so a screen asks for a trip or an item instead of writing a Dexie query. | `src/db/repositories/index.ts`: `StoreRepository`, `ItemRepository`, `TripRepository`, `TripItemRepository`, `PriceHistoryRepository`, `PendingLookupRepository`. | database, contracts, `src/core/pricing/index.ts` (trip items only) |
| Seed data | Load the optional starter items (produce PLU codes, Trader Joe's barcodes and receipt). | `src/db/seed-plu-codes.ts`, `src/db/seed-tj-barcodes.ts`, `src/db/seed-tj-receipt.ts`, each `seedX(): Promise<{added, skipped}>`, fed by the three seed-data files beside them. | database, contracts |
| Pricing core | Pure money maths. | `src/core/pricing/index.ts`: `calculateLineTotal`, `calculateTrend`, `formatCurrency`, `countsTowardTotal`. | nothing |
| Tax core | A registry of per-state tax modules behind one interface. | `src/core/tax/index.ts`: `registerTaxModule`, `getTaxModule`, `getRegisteredStates`, type `TaxModule`; the one module is `src/core/tax/modules/connecticut.ts`. | nothing |
| Core data and helpers | Fixed lists and small pure helpers. | `src/core/categories.ts` (`GROCERY_CATEGORIES`), `src/core/photo-price.ts` (`photoPricePath`, `priceLookupNote`). | contracts |
| Contexts | App-wide React state. | `src/contexts/active-trip-context.tsx` (`ActiveTripProvider`, trip, items, subtotal and actions), `src/contexts/theme-context.tsx` (`useTheme`), `src/contexts/toast-context.tsx` (`ToastProvider`), `src/contexts/factory-context.tsx` (`FactoryProvider`, `useFactory`). | repositories, pricing, factory services (factory only) |
| Factory | Everything between the app and the factory: the key, the licence, the lookup queue and its runner. | No single entry today; the pieces are `src/services/factory-service.ts` (key storage, 12 words, fingerprint copy, backend URL), `src/services/passkey.ts` (WebAuthn PRF), `src/services/door-licence.ts` (`askDoorLicence`), `src/services/lookup-client.ts` (`makeLookupClient`), `src/services/lookup-runner.ts` (`LookupRunner`), `src/services/lookup-answer.ts` (`parseItemAnswer`), `src/components/factory/factory-settings.tsx`, `src/hooks/use-pending-lookups.ts`. | bsv-kit (bsv and grist), contracts, `PendingLookupRepository`, `schemas/` |
| Scanner | Read a barcode, validate a typed one, grab a still photo. | `src/scanner/index.ts` (`initScanner`, `detectFromVideoFrame`, `isCameraAvailable`, `validateBarcode`, `isPLUCode`, `formatBarcode`); `src/scanner/capture-still.ts` (`captureStill`) is not re-exported; `src/hooks/use-barcode-scanner.ts`, `src/components/scanner/`. | barcode-detector |
| Data exchange | Move data in and out: JSON backup, CSV, and the trip-for-AI round trip. | `src/services/export-service.ts`, `src/services/import-service.ts`, `src/services/csv-export-service.ts`, `src/services/trip-exchange-service.ts` (742 lines; `exportTripForAI`, `importTripFromAI`, `reimportTripFromAI`, `nameSimilarity`). No shared entry. | database directly (not the repositories), contracts, pricing |
| App update | Offer "Update ready, tap to reload" and reload on the shopper's tap. | `src/services/app-update.ts` (`startAppUpdates`, `useUpdateState`, `applyUpdate`), `src/components/feedback/update-banner.tsx`, `src/services/preload-reload.ts`, test helper `src/test/fake-registration.ts`. | react |
| Credits | The list of everything the app stands on, and the checks that keep it honest. | `src/content/credits.ts` (`CREDIT_GROUPS`, `CREDITS`), `src/content/credits-check.ts`. | nothing |
| Components | Reusable UI, grouped by kind. | `src/components/layout/` (shell, bottom nav, page header), `src/components/data-display/` (rows, cards, chart, subtotal bar), `src/components/feedback/` (toast, dialog, spinner, error boundary), `src/components/forms/` (inputs, item and store forms, fix-unknown-item modal), `src/components/scanner/`, `src/components/factory/`. No barrel files: each is imported by path. | contexts, core, a few services |
| Hooks | Small React hooks. | `src/hooks/use-toast.ts`, `src/hooks/use-navigation-guard.ts`, `src/hooks/use-barcode-scanner.ts`, `src/hooks/use-pending-lookups.ts`. | contexts, scanner, repositories |
| Pages | One file per route; load data, compose components, call services. | `src/pages/` (25 pages, one page file each; default exports, routed in `src/App.tsx`). | nearly everything, including `src/db/database.ts` in 20 of them |
| Test support | Fake IndexedDB, jest-dom, a fake service worker. | `src/test/setup.ts`, `src/test/fake-registration.ts`; feature files in `tests/features/`. | vitest |

Two things the table shows plainly. First, the repositories exist but the screens mostly go round them (see section 4). Second, the factory is the app's youngest and fastest-changing module and has no folder or entry file: it is spread over the services, contexts, components and hooks folders.

## 2. Collisions

The 15 source files changed by the most commits in the last 30 days, from `git log --since=30.days --name-only --format= -- src | sort | uniq -c | sort -rn | head -15`, run on 2026-10-09 at base commit e1c4bac (33 commits in the window). The command is the story's own, so test files are in it; rows marked "test" are test files. The 30-day window is relative to the day the command is run, so a rerun later gives different counts.

| Commits | File | Lines |
| ---: | --- | ---: |
| 5 | `src/contexts/factory-context.tsx` | 282 |
| 4 | `src/contracts/types.ts` | 144 |
| 3 | `src/services/factory-service.ts` | 190 |
| 3 | `src/pages/settings-page.tsx` | 699 |
| 3 | `src/pages/photo-capture-page.test.tsx` (test) | 184 |
| 3 | `src/pages/active-trip-page.tsx` | 458 |
| 3 | `src/pages/active-trip-page.test.tsx` (test) | 326 |
| 3 | `src/db/repositories/pending-lookup-repository.ts` | 289 |
| 3 | `src/contexts/factory-fingerprint.test.tsx` (test) | 297 |
| 3 | `src/contexts/factory-context.test.tsx` (test) | 386 |
| 3 | `src/components/factory/factory-settings.tsx` | 234 |
| 3 | `src/components/data-display/pending-line-row.tsx` | 109 |
| 3 | `src/App.tsx` | 93 |
| 2 | `src/services/trip-exchange-service.ts` | 742 |
| 2 | `src/services/pending-lines.test.ts` (test) | 112 |

The cut at 15 splits a tie: `src/services/passkey.ts`, `src/services/lookup-runner.ts` and `src/services/lookup-runner.test.ts` also have 2.

What the list says:

- **The factory is the hot spot.** `src/contexts/factory-context.tsx` alone took 5 commits, and `src/services/factory-service.ts`, `src/components/factory/factory-settings.tsx` and `src/pages/settings-page.tsx` (which mounts the factory panel) took 3 each; `src/services/passkey.ts` and `src/services/lookup-runner.ts` sit just under the cut. Every key, licence and fingerprint story edits the same context, so they ran in series.
- **`src/pages/settings-page.tsx` (699 lines) is the "everything" screen.** Each story that adds a setting, an import or a seed list edits it; it is past the 500-line mark where the rule asks for a split.
- **`src/contracts/types.ts` collides by design** (4 commits): it is the one place all types live, and a new field always lands there. That is cheap when additions are small; it does not need a split.
- **The pending-lookup chain** (`src/db/repositories/pending-lookup-repository.ts`, `src/components/data-display/pending-line-row.tsx`, `src/pages/active-trip-page.tsx`, with `src/services/lookup-runner.ts` just below the cut) changes together whenever a lookup behaves differently on the trip screen.
- **`src/App.tsx`** (3) changes whenever a page or provider is added; one route table is fine and needs no split.
- Big files that are not yet hot but will be the next jam: `src/services/trip-exchange-service.ts` (742), `src/pages/trip-detail-page.tsx` (552), `src/pages/export-page.tsx` (377), `src/components/data-display/trip-item-row.tsx` (342).

## 3. Proposed refactors

Ranked by how much parallel work each frees, using the collision list. Every one is behaviour-preserving: the existing tests must pass unchanged, and the old import paths keep working through a re-export until the last caller moves. "Fits one story" means one Builder session; where it does not, the first step is named.

### R1. Factory behind one folder and one hook set

The responsibility to carve out: the factory. `src/contexts/factory-context.tsx` (282 lines) holds the key session, the fingerprint copy, the chain check, the door check, the merge of the two licence answers and the lookup runner wiring in one provider. Three kinds of story (key and unlock, licence, lookups) all edit it.

New module and API (a folder, `factory`, with three parts and a facade so `useFactory()` callers do not change):

```ts
// new: factory/key-session.ts (the 12 words, fingerprint copy, day-long session)
export interface KeySession {
  state: FactoryDoorState;
  publicKeyHex: string | null;
  makeKey(): Promise<MadeKeyResult>;
  unlockWithWords(input: string): Promise<void>;
  unlockWithFingerprint(): Promise<void>;
  enableFingerprint(): Promise<void>;
  removeFingerprint(): Promise<void>;
  getKey(): Uint8Array | null;
}
export function useKeySession(opts: { storage: vault.Storage; passkeyPort?: PasskeyPort }): KeySession;

// new: factory/licence.ts (chain check, door check, merge)
export function useFactoryLicence(opts: {
  publicKeyHex: string | null;
  key: Uint8Array | null;
  backendUrl: string;
  collection: string;
  checkLicence?: FactoryLicenceChecker;
  askDoor?: DoorLicenceAsker;
}): FactoryLicence | null;

// new: factory/lookups.ts (the runner and its client, started when the door is licensed)
export function useLookupRunning(opts: {
  licence: FactoryLicence | null;
  key: Uint8Array | null;
  backendUrl: string;
}): void;

// new: factory/index.ts (the one entry file; callers import only this)
export { FactoryProvider, useFactory } from "./factory-context";
```

Files it touches: `src/contexts/factory-context.tsx`, `src/services/factory-service.ts`, `src/services/passkey.ts`, `src/services/door-licence.ts`, `src/services/lookup-client.ts`, `src/services/lookup-runner.ts`, `src/components/factory/factory-settings.tsx` (moves under the new folder; its tests `src/contexts/factory-context.test.tsx` and `src/contexts/factory-fingerprint.test.tsx` follow). `src/App.tsx`, `src/pages/photo-capture-page.tsx` and `src/pages/settings-page.tsx` change one import line each.

**Risk:** medium. The provider's effects depend on one another (the door is asked at unlock and when the backend URL changes; the runner starts only when licensed). Splitting hooks changes effect order if done carelessly. The two existing context tests pin that behaviour; run them after every move.

**Size:** fits one story if it stops at the three hooks plus the facade and moves no screen. Moving the files into the folder and the library lift (section 5, L4 and L5) are later stories.

### R2. Settings as a list of sections

The responsibility to carve out: each block on the Settings screen. `src/pages/settings-page.tsx` (699 lines) holds Appearance, Storage, three seed lists, Export/Import Items, Export/Import Trips, Import Trip from AI, Danger Zone, About and three confirm dialogs, with all their handlers in one function.

New module and API (a folder, `settings`, one file per section, a registry, and the page only walks the registry):

```ts
// new: settings/sections.ts
export interface SettingsSection {
  id: string;
  title: string;
  /** Lower comes first; ties break on id. */
  order: number;
  Component: () => JSX.Element;
}
export const SETTINGS_SECTIONS: readonly SettingsSection[];

// new: settings/seed-lists.ts (replaces three near-identical seed files)
export interface SeedList {
  id: string;
  title: string;
  items: readonly CreateItemInput[];
}
export function seedItems(list: SeedList): Promise<{ added: number; skipped: number }>;
```

Files it touches: `src/pages/settings-page.tsx` (shrinks to the registry loop), `src/db/seed-plu-codes.ts`, `src/db/seed-tj-barcodes.ts`, `src/db/seed-tj-receipt.ts` (collapse into `seedItems`), `src/App.tsx` (no change if the page keeps its path), and the settings tests. After it, "a new option is a new section file plus one registry line", which is what the rule asks.

**Risk:** low to medium. It is a move of JSX and handlers, but there is no test file for the Settings screen itself (only `src/contexts/factory-context.test.tsx` and `src/contexts/factory-fingerprint.test.tsx` render it, for the factory panel), so the first commit of the story is a test that pins every section heading and button label, and the move comes after. Watch the three confirm dialogs: they share state with sections, so each section takes its own dialog.

**Size:** fits one story. The seed collapse can be a second commit in the same story.

### R3. One hook for "a trip and its lines"

The responsibility to carve out: loading a trip with its items, the item lookup, the store and the open lookups. The same block (`useLiveQuery` for the trip, the trip items, then `db.items.where("id").anyOf(itemIds)` into a map) is copied into `src/pages/active-trip-page.tsx`, `src/pages/trip-detail-page.tsx`, `src/pages/trip-edit-page.tsx`, `src/pages/end-trip-page.tsx` and `src/pages/trip-comparison-page.tsx`; the pending-lookup map is written twice (`src/hooks/use-pending-lookups.ts` and again inline in the active trip page). Trip totals are summed in at least four places (`src/contexts/active-trip-context.tsx`, `src/db/repositories/trip-item-repository.ts`, `src/pages/end-trip-page.tsx`, `src/pages/trip-edit-page.tsx`).

New module and API:

```ts
// new: trips/use-trip-lines.ts
export interface TripLines {
  trip: Trip | undefined;
  store: Store | undefined;
  lines: TripItem[];
  itemsById: Record<string, Item>;
  /** Open pending-line lookups, keyed by the itemId their pending line carries. */
  pendingByItemId: Record<string, PendingLookup>;
  /** Latest price-only lookup of each known item on the trip. */
  priceLookupsByItemId: Record<string, PendingLookup>;
  loading: boolean;
}
export function useTripLines(tripId: string | undefined): TripLines;

// new: core/trip-totals.ts (pure; countsTowardTotal moves in beside it)
export interface TripTotals {
  subtotal: number;
  itemCount: number;
  bottleDeposits: number;
}
export function tripTotals(lines: readonly TripItem[]): TripTotals;
```

Files it touches: the five pages above, `src/hooks/use-pending-lookups.ts`, `src/core/pricing/index.ts`, `src/contexts/active-trip-context.tsx`, `src/db/repositories/trip-item-repository.ts`. Pages stop importing `src/db/database.ts` for this (see section 4).

**Risk:** medium. The pages differ in small ways (the active page keys by the active trip, the detail page by the URL id; "Unknown Item" shows briefly while `itemsById` loads, and the page tests assert around that tick). Keep `loading` honest and keep the existing tests unchanged.

**Size:** does not fit one story if all five pages move. Story one: add `useTripLines` and `tripTotals` with their own tests and move the active trip page and the trip detail page; story two moves the other three.

### R4. Lookup queue apart from applying a lookup

The responsibility to carve out: what a lookup's answer does to the trip. `src/db/repositories/pending-lookup-repository.ts` (289 lines) is a queue (create, list runnable, mark sent or failed, retry, discard) and also the code that turns an answer or a hand-filled item into an item row, a trip line and a price-history entry across five tables in one transaction (`applyAnswer`, `fillByHand`, price-only variant). So a change to the queue's states and a change to how a price lands both edit it, and it imports `TripItemRepository`.

New module and API:

```ts
// new: lookups/queue.ts (state only; stays in the repositories folder)
export class PendingLookupQueue {
  create(input: CreatePendingLookupInput): Promise<PendingLookup>;
  getById(id: string): Promise<PendingLookup | undefined>;
  listByTrip(tripId: string): Promise<PendingLookup[]>;
  listRunnable(): Promise<PendingLookup[]>;
  markSent(id: string, gristTxid: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
}

// new: lookups/apply.ts (writes the trip: items, lines, price history, in one transaction)
export function applyAnswer(lookupId: string, answer: ItemFromPhotosAnswer): Promise<void>;
export function fillByHand(lookupId: string, item: Item): Promise<void>;
```

Files it touches: `src/db/repositories/pending-lookup-repository.ts`, `src/db/repositories/index.ts` (keeps exporting `PendingLookupRepository` as a thin wrapper until callers move), `src/services/lookup-runner.ts`, `src/pages/active-trip-page.tsx`, `src/components/data-display/pending-line-row.tsx`.

**Risk:** medium. The transactions must stay whole (a half-applied answer is a worse bug than a slow one). The test `src/services/pending-lines.test.ts` and the repository tests pin the cases.

**Size:** fits one story.

### R5. Split the trip exchange service

The responsibility to carve out: four jobs in `src/services/trip-exchange-service.ts` (742 lines, the biggest file): writing the AI prompt and export, validating the AI's reply, matching an imported line to an item by name and price, and writing the trip (import and re-import). Two paths replace a trip's items (this service's `reimportTripFromAI` and `importAllData`), so a rule about trip items touches both.

New module and API:

```ts
// new: exchange/ai-export.ts
export function exportTripForAI(tripId: string): Promise<string>;
// new: exchange/ai-validate.ts
export function validateTripImportData(data: unknown): { valid: boolean; errors: string[] };
// new: exchange/item-matching.ts (pure)
export function nameSimilarity(a: string, b: string): number;
export function findItemByDescriptionAndPrice(name: string, price: number): Promise<Item | undefined>;
// new: exchange/ai-import.ts
export function importTripFromAI(jsonString: string): Promise<TripImportResult>;
export function reimportTripFromAI(existingTripId: string, jsonString: string): Promise<TripImportResult>;
// TripImportResult (tripId, storeCreated, itemsCreated, itemsMatched, itemsMissingBarcode) is exported from here; today it is private
// new: exchange/index.ts re-exports all of the above
```

Files it touches: `src/services/trip-exchange-service.ts` (becomes a re-export of the new folder, then is deleted), `src/pages/trip-detail-page.tsx`, `src/pages/trip-history-page.tsx`, `src/pages/export-page.tsx`, `src/pages/settings-page.tsx`, `src/components/forms/fix-unknown-item-modal.tsx` (import lines only).

**Risk:** low; it is a move with a re-export. The signatures above are the existing ones (checked against the file on 2026-10-09). The re-import path replaces a trip's items, as does `importAllData`; a test of each must pass before and after.

**Size:** fits one story.

### R6. One camera seam

The responsibility to carve out: opening the camera. Three places call `navigator.mediaDevices.getUserMedia` themselves: `src/hooks/use-barcode-scanner.ts`, `src/components/scanner/scanner-viewfinder.tsx` and `src/pages/photo-capture-page.tsx`, each with its own constraints, permission handling and stream clean-up; `src/scanner/camera-scanner.ts` and `src/scanner/capture-still.ts` sit beside them.

New module and API:

```ts
// new: camera/index.ts
export interface CameraSession {
  stream: MediaStream;
  /** Stops every track. */
  stop(): void;
}
export type CameraError = "denied" | "unavailable" | "busy";
export function openCamera(opts?: {
  facing?: "environment" | "user";
  idealWidth?: number;
}): Promise<CameraSession>;
export function describeCameraError(err: unknown): CameraError;
// camera/index.ts also re-exports the scanner and capture-still functions
```

Files it touches: the three callers above, `src/scanner/index.ts`, `src/scanner/camera-scanner.ts`, `src/scanner/capture-still.ts`, `src/components/scanner/permission-prompt.tsx`. The camera tests stub `getUserMedia`, so they keep working through the seam.

**Risk:** medium: the permission and stop-on-unmount behaviour is easy to break on a real phone and tests in jsdom do not show it. Check by hand on a device.

**Size:** fits one story.

### R7. Language and currency as settings, not constants

The responsibility to carve out: how a number or a date reads. `src/core/pricing/index.ts` (`formatCurrency`) fixes "en-US" and "USD"; eight `toLocale*` calls in pages and components fix "en-US" too.

New module and API:

```ts
// new: core/format.ts
export interface FormatSettings {
  locale: string;
  currency: string;
}
export const DEFAULT_FORMAT: FormatSettings; // en-US, USD: a public default, overridable
export function formatMoney(amount: number, settings?: FormatSettings): string;
export function formatDate(
  timestamp: number,
  style: "short" | "long",
  settings?: FormatSettings,
): string;
// new: contexts/format-context.tsx exposes useFormat() reading the stored setting
```

Files it touches: `src/core/pricing/index.ts` (keeps `formatCurrency` as a wrapper), `src/pages/end-trip-page.tsx`, `src/pages/trip-detail-page.tsx`, `src/pages/trip-comparison-page.tsx`, `src/pages/spending-report-page.tsx`, `src/pages/price-history-report-page.tsx`, `src/components/data-display/trip-card.tsx`, `src/components/data-display/price-chart.tsx`, and a Settings section from R2.

**Risk:** low, but wide: it touches many pages, so schedule it when few other stories are open. The default keeps every string identical.

**Size:** fits one story (the setting screen can be a second one).

### R8. Charts behind components

The responsibility to carve out: drawing a chart. `src/components/data-display/price-chart.tsx` wraps recharts, but `src/pages/spending-report-page.tsx` and `src/pages/trip-comparison-page.tsx` import recharts themselves and build their own chart markup inside the page.

New module and API:

```ts
// new: components/charts/index.ts
export function SpendingBarChart(props: { points: Array<{ label: string; total: number }> }): JSX.Element;
export function ComparisonBarChart(props: {
  rows: Array<{ label: string; estimated: number; actual: number }>;
}): JSX.Element;
// PriceChart moves here unchanged
```

Files it touches: the two report pages, `src/components/data-display/price-chart.tsx`.

**Risk:** low.

**Size:** fits one story.

## 4. Rule breaks

Where the code departs from 27-modular-boundaries. Each is a fact in the repo today, not a verdict.

1. **Screens reach the database, not the repositories.** CLAUDE.md names the repository pattern, but 20 of the 25 pages and the active trip context import `src/db/database.ts` and query `db.*` inside `useLiveQuery` (for example `src/pages/home-page.tsx`, `src/pages/stores-page.tsx`, `src/pages/item-library-page.tsx`, `src/pages/spending-report-page.tsx`). A schema change touches every one. R3 closes the trip-lines part; a reports read module would close the rest.
2. **Services also go round the repositories.** `src/services/export-service.ts`, `src/services/import-service.ts`, `src/services/csv-export-service.ts` and `src/services/trip-exchange-service.ts` use `db` directly. That one is partly right (a whole-database export is not a repository job), but import rules about trip items then live in two places.
3. **A screen calls a vendor directly.** `src/pages/photo-capture-page.tsx` and `src/components/scanner/scanner-viewfinder.tsx` call `navigator.mediaDevices.getUserMedia`; `src/pages/spending-report-page.tsx` and `src/pages/trip-comparison-page.tsx` import recharts; `src/pages/settings-page.tsx` calls `navigator.storage.estimate`; `src/components/factory/factory-settings.tsx` calls `navigator.clipboard`. R6 and R8 address the first two.
4. **A constant language and currency.** `src/core/pricing/index.ts` fixes "en-US" and "USD", and eight date formats in pages and components fix "en-US". R7.
5. **App name baked into storage keys.** `src/services/factory-service.ts` holds `FACTORY_COLLECTION`, the `tradetracker-factory-*` localStorage keys and the default backend URL as constants, and `src/services/passkey.ts` a PRF salt that names the app. These are public defaults, not his data, so they do not break the "keep the owner's data out" rule; but they must become arguments before the code can leave the app (section 5).
6. **A duplicate of bsv-kit code.** `src/services/door-licence.ts` re-parses the door's signed me reply because bsv-kit's `Me` type drops the `apps` field (the file's own comment says so). The fix belongs in bsv-kit (L3 below), then this file is deleted.
7. **Copies of code that other apps also carry** (not bsv-kit, but the same "second copy" rule): `src/services/app-update.ts` is the same logic as the appUpdate files of Lampas (services folder), Postern (services folder) and Cairn (app folder) (146, 146 and 151 lines; they differ in quote style and the app's name in comments); `src/services/passkey.ts` is adapted from Postern's webauthnPrf service; `src/content/credits-check.ts` has near twins in Cairn (its creditsCheck file) and in SpellForge's test fixtures; `src/scanner/capture-still.ts` does a job Lampas (its images/shrink file) and SpellForge (its grist/shrink-photo file) also do, each with its own limits. Section 5.
8. **A pure helper in the wrong place, and a duplicated loader.** `src/core/photo-price.ts` builds a route path and display text (a UI concern) under the core folder; the lookups-by-item map is written in `src/hooks/use-pending-lookups.ts` and again inline in `src/pages/active-trip-page.tsx`. R3 covers the second.
9. **No bus, no settings store.** The rule's seam list names an in-app event bus and one settings store. TradeTracker has neither: modules talk through Dexie live queries, which works for a single-screen app but means a lookup finishing is seen only by whoever queries for it. A settings store arrives with R2 and R7; a bus is not worth adding until a second module needs to hear about an event.

## 5. Library candidates

Code another app could use or already copies. Library rules are in the library-best-practices folder of the builder seat: a public repo with nothing personal, semver from 0.1.0, a CHANGELOG naming every breaking change and its migration, and consumers pin a full commit or a tag (bsv-kit has no tags yet). No library may touch the DOM unless it is a browser-only package named so, and bsv-kit's packages must stay DOM-free, so browser pieces go to a new library.

| | Code (here) | Copies elsewhere | Belongs in |
| --- | --- | --- | --- |
| L1 | `src/services/app-update.ts` and `src/components/feedback/update-banner.tsx` (146 + 18 lines), `src/test/fake-registration.ts` | Lampas, Postern and Cairn each carry the same logic (146, 146 and 151 lines) | NEW public library **pwa-kit**, package `update` |
| L2 | `src/content/credits-check.ts` and the `Credit` type in `src/content/credits.ts` | Cairn (67 lines), SpellForge test fixture (66), Postern has its own credits file | pwa-kit, package `credits` |
| L3 | `src/services/door-licence.ts` (36 lines) | none, but it exists only because bsv-kit drops a field | bsv-kit `bsv` package (door `Me`) |
| L4 | `src/services/passkey.ts` (123 lines) | adapted from Postern's webauthnPrf service | the port in bsv-kit `bsv`; the browser implementation in pwa-kit, package `passkey` |
| L5 | The factory, after R1: `src/contexts/factory-context.tsx`, `src/services/factory-service.ts`, `src/components/factory/factory-settings.tsx` | Lampas has its own gate folder (a Gate and an Unlock screen) | NEW public library **factory-gate** (React), or a `gate` package in pwa-kit |
| L6 | `src/scanner/capture-still.ts` (58 lines) | Lampas images/shrink file, SpellForge grist/shrink-photo file | pwa-kit, package `photo` |

Proposed public API and versioning for each:

**L1. pwa-kit/update**: pure logic plus one hook, the banner stays the app's (it is styled per app).

```ts
// new: pwa-kit/update
export interface UpdateOptions {
  checkEveryMs?: number;       // default 30 minutes
  takeOverPatienceMs?: number; // default 10 seconds
}
export type UpdateState = "none" | "ready" | "updating";
export function startAppUpdates(deps: {
  container: UpdateContainer;
  registration: UpdateRegistration;
  reload: () => void;
  options?: UpdateOptions;
}): AppUpdates;
export function useUpdateState(): UpdateState;
export function applyUpdate(): void;
```

Versioning: starts at 0.1.0. The two timing constants move from exports to options; changing a default is a minor bump in 0.x and goes in the CHANGELOG as a behaviour change. Four apps move onto it one story each, deleting the local copy in the same story, and each adds a contract test on "reload only on the shopper's tap" (the behaviour they break on).

**L2. pwa-kit/credits**: the checks that fail a build when a runtime dependency has no credit, a credit names a removed dependency, or a bundled font or data file is uncredited.

```ts
// new: pwa-kit/credits
export type CreditKind = "package" | "data" | "font" | "service" | "idea";
export interface Credit { name: string; kind: CreditKind; packages?: string[]; files?: string[] }
export function stalePackages(credits: Credit[], dependencies: string[]): string[];
export function uncreditedPackages(credits: Credit[], dependencies: string[]): string[];
export function uncreditedFiles(credits: Credit[], files: string[]): string[];
export function staleFiles(credits: Credit[], files: string[]): string[];
export const FONT_EXTENSIONS: readonly string[];
```

Versioning: 0.1.0. The `Credit` shape is a wire format between the app's list and the checks, so adding a `kind` was already a breaking change once; from the first release a new `kind` is a minor bump and a removed or renamed field is a major (0.x: minor) bump with the migration written in the CHANGELOG.

**L3. bsv-kit `bsv` package, door `Me`**: add the field that `src/services/door-licence.ts` reads by hand.

```ts
// change in bsv-kit/bsv
export interface Me { /* existing fields */ apps?: string[] }
```

Versioning: additive and optional, so a minor bump (0.3.0). Then the app deletes `src/services/door-licence.ts` and pins the new commit in the same commit as the test that proves a held licence still reads (the bump rule). Tag 0.3.0 and, from then on, pin by tag.

**L4. Passkey**: split so the DOM stays out of bsv-kit.

```ts
// bsv-kit/bsv (no DOM): the port and the use of its secret with the vault
export interface PasskeyPort {
  isAvailable(): boolean;
  create(userId: string, userName: string): Promise<PrfPasskey>;
  getPrfSecret(credentialId: ArrayBuffer): Promise<ArrayBuffer | null>;
}
// pwa-kit/passkey (browser only)
export function browserPasskeyPort(opts: { prfSalt: string; rpName: string }): PasskeyPort;
export function describeUnlockError(err: unknown): string;
```

Versioning: the salt becomes an argument, so an app that already has a passkey must pass its current salt unchanged or its stored fingerprint copy stops opening; that must be in the CHANGELOG and tested with a fixture made by the old code. Postern and TradeTracker each pass their own salt.

**L5. factory-gate**: the app's relationship to the factory as a React provider and a Settings panel, parameterised so no app name is inside.

```ts
// new: factory-gate
export interface FactoryGateConfig {
  collection: string;
  storageKeyPrefix: string;
  defaultBackendUrl: string;
  passkeySalt: string;
}
export function FactoryProvider(props: { config: FactoryGateConfig; children: ReactNode }): JSX.Element;
export function useFactory(): FactoryContextValue;
export function FactorySettings(): JSX.Element;
```

Versioning: do R1 first, so the lift moves three small hooks and not one big provider. The storage-key prefix is a stored-data contract: changing it strands users' keys, so a change is major and needs a migration that reads the old key. Compare Lampas's gate before fixing the API; do not guess the second app's needs.

**L6. pwa-kit/photo**:

```ts
// new: pwa-kit/photo
export interface ShrinkLimits { maxLongSide: number; maxBytes: number }
export const DEFAULT_LIMITS: ShrinkLimits; // 1600 px, 1,000,000 bytes
export function fitWithin(width: number, height: number, maxLongSide: number): { width: number; height: number };
export function shrinkToLimit(source: CanvasImageSource, limits?: ShrinkLimits): Promise<Blob>;
export function captureStill(video: HTMLVideoElement, limits?: ShrinkLimits): Promise<Blob>;
```

Versioning: 0.1.0; the limits are arguments with the current values as defaults. The three copies already differ (here: 1600 px long side and under 1,000,000 bytes; Lampas: 1280 px and 300 KB; SpellForge: 4 MiB cap and a 2560 px first attempt), so the library takes limits as arguments and each app passes its own; the defaults are a decision for him, not a detail.

What stays in the app: the tax registry and the Connecticut module (a real candidate for a "sales-tax" library only if a second app needs state tax; there is none today), the pricing maths (too small to publish), and `nameSimilarity` (a few lines, no second user).

Order for the Mayor: L3 first (smallest, unblocks deleting a file); then the new pwa-kit repo with L1 (four copies already, the strongest case); then L2, L6, L4; L5 last, after R1.
