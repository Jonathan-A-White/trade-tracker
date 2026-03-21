# PWA App Scaffold Specification

> **Purpose:** This document defines the reusable scaffold for building offline-first, installable Progressive Web Apps. It captures architectural decisions, infrastructure patterns, and cross-cutting concerns that are app-agnostic. A separate `spec.md` (not included here) will define the domain-specific features, entities, pages, and business logic for a particular app.
>
> **Audience:** An agent team implementing a new app from this scaffold.

---

## 1. Tech Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| UI framework | React | 19+ | Functional components, hooks only |
| Language | TypeScript | 5+ | Strict mode, no `any`, no unused vars/params |
| Build tool | Vite | 7+ | Fast HMR, ESM-native |
| Styling | Tailwind CSS | 4+ | Via `@tailwindcss/vite` plugin, utility-first |
| Routing | React Router | 7+ | Client-side, `createBrowserRouter` |
| Local database | Dexie (IndexedDB) | 4+ | Offline-first, no backend |
| Reactive queries | dexie-react-hooks | — | `useLiveQuery` for live UI updates |
| PWA | vite-plugin-pwa | 1+ | Workbox service worker, auto-update |
| Testing | Vitest + Testing Library | — | Unit/component tests with `fake-indexeddb` |
| Linting | ESLint | 9+ | Flat config, React Hooks rules |

### Path Alias

Configure `@/*` → `src/*` in both `tsconfig.json` and `vite.config.ts`:

```ts
// vite.config.ts
resolve: {
  alias: { "@": "/src" }
}
```

All imports must use `@/` paths (e.g., `import { db } from "@/db/database"`).

---

## 2. Project Structure

```
src/
├── components/
│   ├── data-display/    # Cards, lists, charts, summary widgets
│   ├── feedback/        # Toast, loading spinners, dialogs, error boundary
│   ├── forms/           # Inputs, selectors, pickers, toggles
│   └── layout/          # App shell, navigation, page headers
├── contracts/
│   └── types.ts         # All TypeScript interfaces and types (single source of truth)
├── contexts/            # React Context providers
├── core/                # Pure business logic functions (no React, no side effects)
├── db/
│   ├── database.ts      # Dexie DB class, schema, singleton export
│   └── repositories/    # Repository class per table (CRUD operations)
├── hooks/               # Custom React hooks
├── pages/               # Route-level page components (one per route)
├── services/            # Orchestration logic (export, import, data seeding)
├── test/
│   └── setup.ts         # Test setup (fake-indexeddb, jest-dom matchers)
├── App.tsx              # Router config + context provider tree
├── index.css            # Tailwind import, CSS custom properties, safe-area padding
├── main.tsx             # Entry point with PWA service worker registration
└── vite-env.d.ts        # Vite + PWA type references
```

**Conventions:**
- Test files live next to their source: `component.tsx` → `component.test.tsx`
- Named exports for components (default exports acceptable for pages)
- One component per file
- Group components by function (data-display, feedback, forms, layout), not by feature

---

## 3. PWA Configuration

### 3.1 Installability & Fullscreen

The app must be installable to a device home screen and run without browser chrome.

**vite.config.ts — PWA plugin:**

```ts
VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
  workbox: {
    globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm}"],
    navigateFallback: "index.html",
    navigateFallbackAllowlist: [/^(?!\/__).*/],
  },
  manifest: {
    name: "APP_FULL_NAME",
    short_name: "APP_SHORT_NAME",
    description: "APP_DESCRIPTION",
    theme_color: "#THEME_HEX",
    background_color: "#BG_HEX",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "portrait",
    scope: "/",
    start_url: "/",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
})
```

**Requirements:**
- `display: "fullscreen"` with `display_override: ["fullscreen", "standalone"]` fallback
- `orientation: "portrait"` for mobile-first
- Three icon variants: 192px standard, 512px standard, 512px maskable
- **Icon must visually relate to the app name/purpose** — generate or source an appropriate icon, do not use a generic placeholder
- Service worker registers with `immediate: true` for auto-updates

### 3.2 Meta Tags (index.html)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#THEME_HEX" />
<link rel="apple-touch-icon" href="icon-192.png" />
```

### 3.3 Fullscreen CSS

```css
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

#root {
  height: 100svh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

- Use `100svh` (small viewport height) to handle mobile browser toolbars
- `env(safe-area-inset-*)` handles notches, home indicators, and rounded corners
- `overflow: hidden` on body prevents double-scroll; `#root` handles all scrolling

### 3.4 Service Worker Registration (main.tsx)

```tsx
import { registerSW } from "virtual:pwa-register";
registerSW({ immediate: true });
```

---

## 4. App Shell & Navigation

### 4.1 Provider Tree (App.tsx)

Wrap the router in providers, ordered from outermost to innermost:

```
ErrorBoundary
  └── ThemeProvider
        └── [App-Specific Context Providers]
              └── ToastProvider (or chosen feedback provider)
                    └── RouterProvider
```

### 4.2 Navigation Patterns

The scaffold supports multiple navigation patterns. The app spec should choose one:

| Pattern | Best for | Implementation |
|---|---|---|
| **Bottom tabs** | Mobile-first apps with 3–5 primary sections | Fixed bottom bar, icon + label per tab, active state styling |
| **Sidebar** | Desktop-first or content-heavy apps | Collapsible side navigation, responsive to hamburger on mobile |
| **Top tabs** | Apps with few peer-level sections | Horizontal tab bar below header |

**Regardless of pattern, implement these behaviors:**

- **Active state indication** — visually distinguish the current section (color, fill, weight)
- **Page headers** — sticky header with title and optional back button
- **Back button behavior** — in-app back navigation must align with the OS back button / browser back. Use `backTo` prop on page headers pointing to the logical parent route (not `history.back()`)
- **Navigation guard** — warn before navigating away from unsaved changes using `useBlocker` (React Router) + `beforeunload` listener
- **Catch-all 404 route** — `path: "*"` renders a Not Found page with a link home

### 4.3 Page Header Component

Every sub-page should use a consistent header:

```tsx
interface PageHeaderProps {
  title: string;
  backTo?: string;       // Route path for back button (omit on top-level pages)
  rightAction?: ReactNode; // Optional action button(s) in header
}
```

- Sticky (`sticky top-0 z-10`)
- Dark mode aware
- Back arrow navigates via `<Link to={backTo}>` (not browser history)

---

## 5. Dark Mode / Theming

### 5.1 Implementation

- **CSS strategy:** Tailwind's class-based dark mode with custom variant: `@custom-variant dark (&:where(.dark, .dark *));`
- **Toggle mechanism:** Add/remove `dark` class on `document.documentElement`
- **Persistence:** `localStorage` with key `{appname}-theme`
- **Initial theme:** Check localStorage → fall back to `prefers-color-scheme: dark` media query → default to `light`

### 5.2 Theme Context

```ts
interface ThemeContextType {
  theme: "light" | "dark";
  toggleTheme: () => void;
}
```

- Provide via `ThemeProvider` wrapping the entire app
- Access via `useTheme()` hook
- Toggle available in Settings page

### 5.3 Tailwind Custom Colors

Define app-specific semantic colors in `index.css`:

```css
@theme {
  --color-primary: #HEX;
  --color-primary-light: #HEX;
  --color-surface: #HEX;
  --color-danger: #HEX;
}
```

Every component must support both light and dark variants (e.g., `bg-white dark:bg-gray-800`).

---

## 6. Data Layer

### 6.1 Database (Dexie + IndexedDB)

**Schema definition** in `src/db/database.ts`:

```ts
class AppDatabase extends Dexie {
  // Declare tables as typed properties
  constructor() {
    super("AppDatabaseName");
    this.version(1).stores({
      // Define indexes here — Dexie auto-creates `id` as primary key
      // Use & for unique indexes, + for multi-entry, [a+b] for compound
    });
  }
}

export const db = new AppDatabase();
```

**Schema migration rules:**
- Never modify an existing `version()` call
- Add a new `this.version(N).stores({})` for schema changes
- Pass empty object `{}` if only adding non-indexed fields
- Use `.upgrade(tx => ...)` for data migrations

### 6.2 Repository Pattern

Each table gets a repository class in `src/db/repositories/`:

```ts
class EntityRepository {
  async getAll(): Promise<Entity[]>
  async getById(id: string): Promise<Entity | undefined>
  async create(input: CreateEntityInput): Promise<string>
  async update(id: string, changes: Partial<Entity>): Promise<void>
  async delete(id: string): Promise<void>
}
```

- IDs are `string` type (UUIDs), generated via `crypto.randomUUID()`
- Timestamps stored as `number` (epoch milliseconds), not `Date` objects
- Use `Create*Input` types that `Omit` auto-generated fields (`id`, `createdAt`, etc.)

### 6.3 Reactive Queries

Use `useLiveQuery` from `dexie-react-hooks` in components for data that auto-updates:

```tsx
const items = useLiveQuery(() => db.items.toArray());
```

### 6.4 Types

All entity types and input types live in `src/contracts/types.ts` — single source of truth. Example pattern:

```ts
interface Entity {
  id: string;
  name: string;
  createdAt: number;
}

type CreateEntityInput = Omit<Entity, "id" | "createdAt">;
```

---

## 7. Data Export / Import

### 7.1 Export Format

All exports use JSON with a versioned envelope:

```json
{
  "appName": "APP_NAME",
  "version": 1,
  "exportedAt": 1710000000000,
  "type": "full" | "partial",
  "data": {
    "tableName1": [...],
    "tableName2": [...]
  }
}
```

- `version` is a schema version integer that increments when the export format changes
- `type` distinguishes full backups from partial exports (e.g., a single table)
- `exportedAt` is epoch milliseconds
- File naming: `{appname}-{type}-{YYYY-MM-DD}.json`

### 7.2 Import with Migration

On import, check the `version` field and apply migrations if needed:

```ts
function migrateExport(data: ExportEnvelope): ExportEnvelope {
  let current = data;
  if (current.version === 1) {
    current = migrateV1toV2(current);
  }
  // ... chain migrations
  return current;
}
```

**Import rules:**
- Validate JSON structure before import (required keys, array types)
- Show confirmation dialog before importing (warn about data replacement)
- Skip records that already exist (match by ID) or let the user choose overwrite behavior
- Show success summary (added count, skipped count)
- Show clear error message if validation fails — do not partially import

### 7.3 CSV Export (Optional)

For tabular data, also support CSV export via a service that converts entity arrays to CSV strings with proper header rows. Trigger download via `Blob` + `URL.createObjectURL` + programmatic anchor click.

---

## 8. Settings Page

The settings page is a standard scaffold feature. It must include:

### 8.1 Required Sections

| Section | Contents |
|---|---|
| **Appearance** | Dark/light mode toggle (sun/moon icons) |
| **Storage** | Display estimated storage usage via `navigator.storage.estimate()` with visual bar |
| **Data Management** | Export/import buttons (full backup + per-table), clear all data with confirmation |
| **About** | App name, version, storage technology |

### 8.2 Danger Zone

- "Clear All Data" button styled as destructive (red)
- Requires confirmation dialog before executing
- Clears all Dexie tables
- Resets app to initial state

---

## 9. Error Handling

### 9.1 Error Boundary

Wrap the entire app in a React error boundary (class component):

- Catches rendering errors via `getDerivedStateFromError`
- Logs to console via `componentDidCatch`
- Displays friendly error UI with:
  - Error icon
  - "Something went wrong" message
  - Error message text (for debugging)
  - "Try Again" button that resets error state
- Supports dark mode

### 9.2 User Feedback System

The app must provide a mechanism for transient user feedback (success, error, info, warning). The app spec chooses the specific pattern (toast, snackbar, banner, etc.), but it must:

- Support at least success and error states
- Auto-dismiss after a timeout
- Be accessible (proper ARIA roles)
- Be available app-wide via context or hook
- Support dark mode

---

## 10. Mobile Interaction Patterns (Optional)

These gesture patterns are available for the app spec to adopt:

| Gesture | Use case | Implementation notes |
|---|---|---|
| **Swipe to reveal actions** | Delete, archive, or mark items in lists | Reveal action buttons on horizontal swipe; include visual affordance |
| **Long press** | Secondary actions (edit, select multiple) | Use `onPointerDown` + timer; provide haptic feedback if available |
| **Pull to refresh** | Refresh data views | Only if the app has data that can become stale |
| **Swipe between tabs** | Navigate peer sections | Requires gesture library or custom touch handling |

---

## 11. Testing Strategy

### 11.1 BDD Feature Files (Acceptance Criteria)

Write Gherkin `.feature` files in `tests/features/` as the acceptance criteria specification:

```
tests/features/
├── navigation.feature
├── settings.feature
├── dark-mode.feature
├── pwa.feature
├── export-import.feature
└── [domain-specific].feature
```

Each feature file documents user-facing behavior in Given/When/Then format. These serve as:
- Acceptance criteria for the implementation team
- Living documentation of app behavior
- Reference for writing automated tests

**Scaffold features that should always have feature files:**
- PWA (installability, offline, fullscreen)
- Navigation (bottom nav, back button, 404)
- Settings (dark mode, storage, data management)
- Export/Import (all flows including error cases)
- Dark mode (toggle, persistence, OS preference)

### 11.2 Unit / Component Tests (Vitest)

**Setup (`src/test/setup.ts`):**

```ts
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
```

**vitest.config.ts:**

```ts
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

**Conventions:**
- `fake-indexeddb` provides IndexedDB in Node — resets automatically between tests
- Use `@testing-library/react` for rendering, `@testing-library/user-event` for interactions
- Vitest globals (`describe`, `it`, `expect`) are available without imports
- `@testing-library/jest-dom` matchers are available (e.g., `toBeInTheDocument()`)
- Test files co-located with source: `foo.test.tsx` next to `foo.tsx`

---

## 12. CI/CD & Deployment (GitHub Pages)

### 12.1 CI Workflow (`.github/workflows/ci.yml`)

Runs on push to `main` and on pull requests:

```yaml
jobs:
  # 1. Detect changed paths to skip unnecessary jobs
  changes:
    # Use dorny/paths-filter to check src/, config files, deps

  # 2. Run in parallel (all depend on changes):
  lint:        # npm run lint
  typecheck:   # npx tsc -b
  test:        # npm test

  # 3. Build (depends on all three passing):
  build:
    needs: [lint, typecheck, test]
    # npm run build → upload artifact
```

### 12.2 Deploy Workflow (`.github/workflows/deploy.yml`)

Deploys to GitHub Pages on push to `main`:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    # npm ci → npm run build → upload-pages-artifact (dist/)
  deploy:
    needs: build
    # deploy-pages action
```

### 12.3 GitHub Pages SPA Routing

GitHub Pages doesn't support SPA routing natively. Two fixes are required:

1. **`public/404.html`** — Redirect script that stores the path in `sessionStorage` and redirects to `/`:

```html
<script>
  var pathSegmentsToKeep = 1; // 1 for project sites, 0 for user sites
  var l = window.location;
  l.replace(
    l.protocol + '//' + l.hostname + (l.port ? ':' + l.port : '') +
    l.pathname.split('/').slice(0, 1 + pathSegmentsToKeep).join('/') + '/?/' +
    l.pathname.slice(1).split('/').slice(pathSegmentsToKeep).join('/').replace(/&/g, '~and~') +
    (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') +
    l.hash
  );
</script>
```

2. **`index.html`** — Inline script that reads `sessionStorage` and replaces the URL:

```html
<script>
  (function(l) {
    if (l.search[1] === '/') {
      var decoded = l.search.slice(1).split('&').map(function(s) {
        return s.replace(/~and~/g, '&')
      }).join('?');
      window.history.replaceState(null, null,
        l.pathname.slice(0, -1) + decoded + l.hash
      );
    }
  }(window.location))
</script>
```

3. **Dynamic base URL** in `vite.config.ts`:

```ts
base: process.env.GITHUB_ACTIONS ? "/REPO_NAME/" : "/",
```

Also set `scope` and `start_url` in the PWA manifest conditionally.

---

## 13. Code Conventions

| Rule | Detail |
|---|---|
| TypeScript strict mode | Enabled in `tsconfig.json` — no `any`, no unused locals/params |
| Functional components | Hooks only, no class components (except ErrorBoundary) |
| Named exports | For all components; default exports acceptable for pages |
| Tailwind utility classes | No CSS modules, no styled-components, no inline styles |
| IDs | `string` (UUID via `crypto.randomUUID()`) |
| Timestamps | `number` (epoch ms) — never `Date` objects in storage |
| Imports | Always use `@/` path alias |
| ESLint | Flat config (`eslint.config.js`), includes `react-hooks/exhaustive-deps` |
| No over-engineering | No abstractions for single-use logic; no feature flags; no backwards-compat shims |

---

## 14. npm Scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "test": "vitest run",
  "preview": "vite preview"
}
```

CI runs `lint`, `typecheck` (`tsc -b`), and `test` in parallel — all three must pass before build.

---

## 15. Scaffold Checklist

Use this checklist when creating a new app from this scaffold. Each item should be completed before moving to domain-specific features.

- [ ] Initialize Vite + React + TypeScript project
- [ ] Configure Tailwind CSS 4 via `@tailwindcss/vite`
- [ ] Set up path alias (`@/` → `src/`)
- [ ] Set up ESLint flat config with React Hooks plugin
- [ ] Create project structure (all directories from Section 2)
- [ ] Configure PWA plugin with app-specific name, description, colors
- [ ] **Generate app icon** (192px + 512px + maskable) that relates to the app name/purpose
- [ ] Add favicon.svg
- [ ] Configure `index.html` meta tags (viewport, apple-mobile-web-app, theme-color)
- [ ] Add fullscreen CSS (safe areas, `100svh`, overflow handling)
- [ ] Register service worker in `main.tsx`
- [ ] Create Dexie database class with initial schema version
- [ ] Create `contracts/types.ts` with base entity types
- [ ] Implement ThemeContext with localStorage persistence + OS preference detection
- [ ] Add `@custom-variant dark` and semantic color theme to `index.css`
- [ ] Implement ErrorBoundary component
- [ ] Implement user feedback system (toast or chosen pattern)
- [ ] Create AppShell layout component with chosen navigation pattern
- [ ] Create PageHeader component with back navigation
- [ ] Implement navigation guard hook (`useBlocker` + `beforeunload`)
- [ ] Set up React Router with catch-all 404 route
- [ ] Wire up provider tree in `App.tsx`
- [ ] Build Settings page (appearance, storage, data management, about)
- [ ] Implement versioned JSON export
- [ ] Implement JSON import with validation, confirmation, and migration support
- [ ] Add `public/404.html` for GitHub Pages SPA routing
- [ ] Add SPA redirect script to `index.html`
- [ ] Configure dynamic `base` URL for GitHub Pages
- [ ] Set up CI workflow (lint + typecheck + test in parallel → build)
- [ ] Set up deploy workflow (GitHub Pages)
- [ ] Configure Vitest with `fake-indexeddb` and Testing Library
- [ ] Write scaffold BDD feature files (PWA, navigation, settings, export/import, dark mode)
- [ ] Verify PWA installability (Lighthouse or browser DevTools)
- [ ] Verify fullscreen mode works on mobile
- [ ] Verify dark mode toggle + persistence + OS preference fallback
- [ ] Verify export → import round-trip

---

## 16. What This Scaffold Does NOT Cover

The following are left to the app-specific `spec.md`:

- Domain entities, business logic, and data relationships
- Specific page designs and user flows
- Which navigation pattern to use (bottom tabs, sidebar, etc.)
- Number and names of navigation sections
- Domain-specific features (camera, scanning, maps, etc.)
- Specific feedback pattern (toast vs. snackbar vs. banner)
- Data seeding / sample data
- Onboarding flows
- Analytics or crash reporting
- Accessibility beyond basic ARIA
- Internationalization / localization
- Push notifications
