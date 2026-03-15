# CLAUDE.md

## Quick Reference

```bash
npm run dev      # Start dev server (Vite)
npm run build    # Typecheck + production build (tsc -b && vite build)
npm run lint     # ESLint (flat config)
npm test         # Vitest (single run)
npx tsc -b       # Typecheck only
```

CI runs lint, typecheck, and test in parallel — all three must pass.

## Tech Stack

- **React 19** with **TypeScript** (strict mode, no unused locals/params)
- **Vite 7** build tool with **Tailwind CSS 4** (via `@tailwindcss/vite`)
- **React Router 7** for client-side routing
- **Dexie** (IndexedDB) for all data storage — fully offline, no backend
- **Vitest** + **Testing Library** for tests (`fake-indexeddb` for DB in tests)
- **PWA** via `vite-plugin-pwa` with Workbox caching

## Project Structure

```
src/
├── components/          # UI components organized by function
│   ├── data-display/    #   Cards, charts, list rows
│   ├── feedback/        #   Toast, loading, dialogs, error boundary
│   ├── forms/           #   Inputs, pickers, selectors
│   ├── layout/          #   App shell, navigation, headers
│   └── scanner/         #   Barcode viewfinder, permissions, manual entry
├── contracts/types.ts   # All TypeScript interfaces and types
├── contexts/            # React Context providers (active-trip, theme, toast)
├── core/pricing/        # Pure pricing functions (line totals, trends, formatting)
├── db/
│   ├── database.ts      # Dexie DB class and singleton `db` export
│   └── repositories/    # Repository classes for each table (CRUD operations)
├── hooks/               # Custom hooks (barcode-scanner, toast, navigation-guard)
├── pages/               # Route-level page components
├── scanner/             # Camera scanner + manual entry utilities
├── services/            # Business logic (CSV export, data import/export)
├── test/setup.ts        # Test setup (fake-indexeddb, jest-dom matchers)
├── App.tsx              # Router config + provider tree
└── main.tsx             # Entry point with PWA registration
```

## Architecture & Patterns

**Data layer:** Repository pattern over Dexie. Each table has a repository class in `src/db/repositories/`. Use `useLiveQuery` from `dexie-react-hooks` for reactive queries in components.

**State management:** React Context only (no Redux). Three contexts:
- `ActiveTripContext` — current shopping trip state and items
- `ThemeContext` — dark/light mode
- `ToastContext` — notification system

**Routing:** All routes defined in `src/App.tsx`. The `AppShell` layout component wraps all pages. Routes use `basename` derived from `import.meta.env.BASE_URL`.

**Types:** All entity types and input types live in `src/contracts/types.ts`. Use `Create*Input` types (which `Omit` auto-generated fields) when creating new records.

**Path alias:** `@/*` maps to `src/*` — use this for all imports (e.g., `import { db } from "@/db/database"`).

## Database

IndexedDB via Dexie with 5 tables: `stores`, `items`, `trips`, `tripItems`, `priceHistory`.

- Schema defined in `src/db/database.ts` with versioned migrations
- The `db` singleton is exported and used everywhere
- `items.barcode` has a unique index (`&barcode`)
- Composite indexes exist for common query patterns (e.g., `[storeId+status]`, `[tripId+itemId]`)
- When adding fields: add a new `this.version(N).stores({})` call (empty if no index changes needed)

## Writing Tests

- Test files go next to source: `src/**/*.test.{ts,tsx}`
- Vitest globals are available (`describe`, `it`, `expect` — no imports needed)
- `@testing-library/jest-dom` matchers are available (e.g., `toBeInTheDocument()`)
- IndexedDB resets automatically before each test via `fake-indexeddb`
- Use `@testing-library/react` for component rendering and `@testing-library/user-event` for interactions

## Code Conventions

- TypeScript strict mode — no `any` types, no unused variables
- Named exports for components (except some default-exported pages)
- Functional components with hooks — no class components
- Tailwind CSS utility classes for styling — no CSS modules or styled-components
- ESLint flat config (`eslint.config.js`) — includes React Hooks exhaustive-deps rule
- Timestamps stored as `number` (epoch ms) — not Date objects
- IDs are `string` type (UUIDs)
