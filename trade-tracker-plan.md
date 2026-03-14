# TradeTracker — Implementation Plan

A local-first grocery tracking app for scanning items, tracking prices over time, managing shopping trips, and running spending reports. Built with React, TypeScript, and IndexedDB.

---

## Table of Contents

1. [Tech Stack Details](#tech-stack-details)
2. [Project Initialization](#project-initialization)
3. [Core Features](#core-features)
4. [Source Layout](#source-layout)
5. [TypeScript Interfaces](#typescript-interfaces)
6. [Database Schema (Dexie)](#database-schema-dexie)
7. [Repository Pattern](#repository-pattern)
8. [Data Migration Strategy](#data-migration-strategy)
9. [Route Map](#route-map)
10. [Component Architecture](#component-architecture)
11. [State Management Strategy](#state-management-strategy)
12. [Screen-by-Screen UX Flow](#screen-by-screen-ux-flow)
13. [Barcode Scanning Strategy](#barcode-scanning-strategy)
14. [PWA Configuration](#pwa-configuration)
15. [Testing Strategy](#testing-strategy)
16. [Development Scripts](#development-scripts)
17. [Error Handling Patterns](#error-handling-patterns)
18. [Implementation Phases (Detailed)](#implementation-phases-detailed)

---

## Tech Stack Details

### Production Dependencies

**React 18**
```bash
npm install react@^18.3.1 react-dom@^18.3.1
```
React 18 provides concurrent rendering, automatic batching, and Suspense. It is the latest stable major version with broad ecosystem compatibility.

**TypeScript 5.9**
```bash
npm install -D typescript@~5.9.3
```
TypeScript 5.9 (released August 2025) introduces `import defer` for lazy module evaluation and an 11% type-checking speed improvement. Use tilde pinning to accept patch releases only.

**React Router 7**
```bash
npm install react-router@^7.13.1
```
In v7, `react-router-dom` was consolidated into a single `react-router` package. Provides type-safe route definitions, nested layouts, and data loading patterns.

**Dexie.js 4**
```bash
npm install dexie@^4.3.0 dexie-react-hooks@^4.2.0
```
Minimal, promise-based wrapper around IndexedDB with schema management, migrations, and querying. The `dexie-react-hooks` package provides `useLiveQuery` for reactive data binding.

**Tailwind CSS 4**
```bash
npm install tailwindcss@^4.1.0 @tailwindcss/vite@^4.1.0
```
Tailwind CSS 4 introduces zero-config content detection, a first-party Vite plugin, and a 5x faster build engine. Configuration is done entirely in CSS (`@theme`) — no `tailwind.config.js` needed.

**Barcode Detection Polyfill**
```bash
npm install barcode-detector@^3.1.0
```
A ponyfill/polyfill for the W3C Barcode Detection API backed by ZXing-C++ compiled to WebAssembly. Provides native-API-compatible `BarcodeDetector` on all browsers.

### Dev Dependencies

**Vite 7**
```bash
npm install -D vite@^7.3.0 @vitejs/plugin-react@^4.5.0
```
Vite 7 requires Node.js 20.19+ or 22.12+, ships as ESM-only, and provides sub-second HMR and native TypeScript/JSX support.

**Vitest + Testing Library + fake-indexeddb**
```bash
npm install -D vitest@^4.1.0 @testing-library/react@^16.3.0 @testing-library/jest-dom@^6.6.0 @testing-library/user-event@^14.6.0 jsdom@^26.1.0 fake-indexeddb@^6.2.5
```
Vitest 4.x is required for Vite 7 compatibility. `fake-indexeddb` provides a pure-JS in-memory IndexedDB implementation for testing Dexie operations without a browser.

**PWA Plugin**
```bash
npm install -D vite-plugin-pwa@^1.1.0
```
Zero-config PWA support for Vite with Workbox integration. Generates the service worker, web manifest, and caching strategies automatically.

**Type Definitions**
```bash
npm install -D @types/react@^18.3.18 @types/react-dom@^18.3.5
```

---

## Project Initialization

### Step 1: Scaffold with Vite

```bash
npm create vite@latest trade-tracker -- --template react-ts
cd trade-tracker
```

### Step 2: Install all dependencies

```bash
# Production
npm install react-router@^7.13.1 dexie@^4.3.0 dexie-react-hooks@^4.2.0 barcode-detector@^3.1.0

# Tailwind (production — ships runtime CSS)
npm install tailwindcss@^4.1.0 @tailwindcss/vite@^4.1.0

# Dev
npm install -D vitest@^4.1.0 @testing-library/react@^16.3.0 @testing-library/jest-dom@^6.6.0 @testing-library/user-event@^14.6.0 jsdom@^26.1.0 fake-indexeddb@^6.2.5 vite-plugin-pwa@^1.1.0
```

### Step 3: Configure `vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm}"],
        runtimeCaching: [
          {
            urlPattern: /\.wasm$/,
            handler: "CacheFirst",
            options: {
              cacheName: "wasm-cache",
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: "TradeTracker",
        short_name: "TradeTracker",
        description: "Local-first grocery price tracking",
        theme_color: "#0f172a",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

### Step 4: Configure `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "vite-env.d.ts"]
}
```

### Step 5: Set up Tailwind CSS 4

Replace `src/index.css` with:

```css
@import "tailwindcss";

@theme {
  --color-primary: #0f766e;
  --color-primary-light: #14b8a6;
  --color-surface: #f8fafc;
  --color-danger: #dc2626;
}
```

### Step 6: Set up Vitest

Create `src/test/setup.ts`:

```ts
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

import { IDBFactory } from "fake-indexeddb";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
```

### Step 7: Verify

```bash
npm run dev        # Dev server starts on localhost:5173
npm run test       # Vitest runs (passes with zero tests)
npm run build      # Production build succeeds
```

---

## Core Features

### 1. Barcode Scanning
- Use device camera to scan barcodes in real-time via the W3C Barcode Detection API
- Manual barcode entry fallback (type the number)
- PLU code entry for weight-based produce items (4-5 digit codes)
- On scan: look up item in local DB → auto-populate last known price → confirm or edit

### 2. Item Library
- Each item has: barcode/PLU, name, picture (camera or gallery), current price, unit type
- Two unit types: **per item** (fixed price) and **per pound** (price/lb × weight)
- Edit any field at any time
- Search items by name
- Items are linked to price history across all trips

### 3. Shopping Trips
- Start a trip: select a store (or create new store)
- Scan/add items to the trip → each entry gets quantity (default 1) or weight in lbs
- Running subtotal displayed as items are added
- Edit price inline if it differs from last known price (updates item's current price)
- End trip: enter actual receipt total for comparison against scanned subtotal
- Trip saved with: store, date, items, scanned subtotal, actual receipt total, difference

### 4. Price Tracking
- Every time an item is added to a trip, a price history entry is recorded (price, store, date)
- View price history chart for any item (filterable by store)
- See price trend: up, down, stable

### 5. Store Management
- Create/edit stores (name, optional location/notes)
- Filter reports and price history by store

### 6. Reports
- **Spending by time period**: weekly, monthly, custom range totals
- **Price history for an item**: chart showing price over time, per store
- **Most frequently bought items**: ranked list
- **Trip history**: list of all past trips with totals, searchable/filterable by store
- **Scanned vs. actual comparison**: see how accurate your scanning was per trip

### 7. Trip Editing
- Edit past trips: add forgotten items, remove items, correct prices
- Recalculates scanned subtotal on edit

### 8. Data Export
- Export all data as JSON (full backup/restore)
- Export as CSV (items, trips, price history — separate files or combined)

---

## Source Layout

```
src/
├── contracts/
│   └── types.ts              # All entity types and DTOs
├── core/
│   └── pricing/              # Price comparison logic, trend calculation
├── db/
│   ├── database.ts           # Dexie database schema
│   └── repositories/
│       ├── item-repository.ts
│       ├── store-repository.ts
│       ├── trip-repository.ts
│       ├── trip-item-repository.ts
│       ├── price-history-repository.ts
│       └── index.ts
├── scanner/
│   ├── camera-scanner.ts     # Camera-based barcode scanning via BarcodeDetector
│   ├── manual-entry.ts       # Manual barcode/PLU input
│   └── index.ts
├── services/
│   ├── export-service.ts     # JSON full export
│   ├── import-service.ts     # JSON import with validation
│   └── csv-export-service.ts # CSV export
├── hooks/
│   ├── use-barcode-scanner.ts
│   ├── use-navigation-guard.ts
│   └── use-toast.ts
├── contexts/
│   ├── active-trip-context.tsx
│   └── toast-context.tsx
├── pages/
│   ├── home-page.tsx
│   ├── new-trip-page.tsx
│   ├── active-trip-page.tsx
│   ├── scanner-page.tsx
│   ├── add-item-page.tsx
│   ├── end-trip-page.tsx
│   ├── trip-history-page.tsx
│   ├── trip-detail-page.tsx
│   ├── trip-edit-page.tsx
│   ├── item-library-page.tsx
│   ├── item-detail-page.tsx
│   ├── new-item-page.tsx
│   ├── reports-page.tsx
│   ├── spending-report-page.tsx
│   ├── frequency-report-page.tsx
│   ├── price-history-report-page.tsx
│   ├── trip-comparison-page.tsx
│   ├── stores-page.tsx
│   ├── new-store-page.tsx
│   ├── edit-store-page.tsx
│   ├── export-page.tsx
│   └── settings-page.tsx
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx
│   │   ├── bottom-nav.tsx
│   │   └── page-header.tsx
│   ├── data-display/
│   │   ├── item-card.tsx
│   │   ├── trip-card.tsx
│   │   ├── price-chart.tsx
│   │   ├── stat-card.tsx
│   │   ├── trip-item-row.tsx
│   │   └── subtotal-bar.tsx
│   ├── forms/
│   │   ├── item-form.tsx
│   │   ├── store-form.tsx
│   │   ├── barcode-input.tsx
│   │   ├── inline-editor.tsx
│   │   ├── store-selector.tsx
│   │   └── date-range-picker.tsx
│   ├── scanner/
│   │   ├── scanner-viewfinder.tsx
│   │   ├── manual-entry-fallback.tsx
│   │   └── permission-prompt.tsx
│   └── feedback/
│       ├── empty-state.tsx
│       ├── loading-spinner.tsx
│       ├── confirm-dialog.tsx
│       ├── toast.tsx
│       └── error-boundary.tsx
├── test/
│   └── setup.ts
├── App.tsx
├── main.tsx
└── index.css
```

---

## TypeScript Interfaces

```typescript
// src/contracts/types.ts

/** Units of measurement for item pricing */
export type UnitType = "each" | "per_lb";

/** Lifecycle state of a shopping trip */
export type TripStatus = "active" | "completed";

export interface Store {
  id: string;
  name: string;
  /** Optional location or notes */
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Item {
  id: string;
  /** Barcode number or PLU code (indexed, unique) */
  barcode: string;
  name: string;
  /** Photo from camera or gallery, stored as Blob */
  picture?: Blob;
  /** Last known price */
  currentPrice: number;
  /** Pricing model: fixed per-item or price-per-pound */
  unitType: UnitType;
  /** User-defined grouping, e.g. "Dairy", "Produce" */
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Trip {
  id: string;
  storeId: string;
  status: TripStatus;
  startedAt: number;
  /** Undefined while trip is active */
  endedAt?: number;
  /** Sum of all trip item line totals */
  scannedSubtotal: number;
  /** Receipt total entered by user */
  actualTotal?: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TripItem {
  id: string;
  tripId: string;
  itemId: string;
  /** Price at time of purchase */
  price: number;
  /** Default 1 for "each" items */
  quantity: number;
  /** For "per_lb" items: weight in pounds */
  weightLbs?: number;
  /** price × quantity, or price × weightLbs */
  lineTotal: number;
  /** Whether the item was on sale */
  onSale: boolean;
  addedAt: number;
}

export interface PriceHistoryEntry {
  id: string;
  itemId: string;
  storeId: string;
  /** The tripItem that sourced this record */
  tripItemId: string;
  price: number;
  /** Timestamp of the trip, denormalized for faster queries */
  recordedAt: number;
}

// ── Creation DTOs ──────────────────────────────────────────────

export type CreateStoreInput = Omit<Store, "id" | "createdAt" | "updatedAt">;
export type CreateItemInput = Omit<Item, "id" | "createdAt" | "updatedAt">;
export type CreateTripInput = Omit<Trip, "id" | "status" | "endedAt" | "scannedSubtotal" | "actualTotal" | "createdAt" | "updatedAt">;
export type CreateTripItemInput = Omit<TripItem, "id" | "lineTotal" | "addedAt">;
export type CreatePriceHistoryInput = Omit<PriceHistoryEntry, "id">;
```

---

## Database Schema (Dexie)

```typescript
// src/db/database.ts

import Dexie, { type EntityTable } from "dexie";
import type { Store, Item, Trip, TripItem, PriceHistoryEntry } from "../contracts/types";

export class TradeTrackerDB extends Dexie {
  stores!: EntityTable<Store, "id">;
  items!: EntityTable<Item, "id">;
  trips!: EntityTable<Trip, "id">;
  tripItems!: EntityTable<TripItem, "id">;
  priceHistory!: EntityTable<PriceHistoryEntry, "id">;

  constructor() {
    super("TradeTrackerDB");

    this.version(1).stores({
      // Primary key first, then indexed fields.
      // Only fields you query on need to appear here —
      // Dexie stores the full object regardless.
      stores: "id, name, createdAt",
      items: "id, &barcode, name, category, createdAt",
      trips: "id, storeId, status, startedAt, [storeId+status], createdAt",
      tripItems: "id, tripId, itemId, [tripId+itemId], addedAt",
      priceHistory: "id, itemId, storeId, [itemId+storeId], recordedAt",
    });
  }
}

export const db = new TradeTrackerDB();
```

---

## Repository Pattern

```typescript
// src/db/repositories/interfaces.ts

import type {
  Store, Item, Trip, TripItem, PriceHistoryEntry,
  CreateStoreInput, CreateItemInput, CreateTripInput, CreateTripItemInput,
  TripStatus,
} from "../../contracts/types";

// ── Store ──────────────────────────────────────────────────────

export interface IStoreRepository {
  create(input: CreateStoreInput): Promise<Store>;
  getById(id: string): Promise<Store | undefined>;
  update(id: string, changes: Partial<CreateStoreInput>): Promise<void>;
  delete(id: string): Promise<void>;
  listAll(): Promise<Store[]>;
}

// ── Item ───────────────────────────────────────────────────────

export interface IItemRepository {
  create(input: CreateItemInput): Promise<Item>;
  getById(id: string): Promise<Item | undefined>;
  update(id: string, changes: Partial<CreateItemInput>): Promise<void>;
  delete(id: string): Promise<void>;
  /** Case-insensitive substring search on item name */
  searchByName(query: string): Promise<Item[]>;
  findByBarcode(barcode: string): Promise<Item | undefined>;
  listByCategory(category: string): Promise<Item[]>;
}

// ── Trip ───────────────────────────────────────────────────────

export interface TripFilters {
  storeId?: string;
  status?: TripStatus;
  from?: number;
  to?: number;
}

export interface ITripRepository {
  create(input: CreateTripInput): Promise<Trip>;
  getById(id: string): Promise<Trip | undefined>;
  complete(id: string, actualTotal: number): Promise<void>;
  getActive(): Promise<Trip | undefined>;
  list(filters?: TripFilters): Promise<Trip[]>;
}

// ── TripItem ───────────────────────────────────────────────────

export interface ITripItemRepository {
  /** Adds item to trip and records a PriceHistoryEntry in a single transaction */
  addToTrip(input: CreateTripItemInput): Promise<TripItem>;
  remove(id: string): Promise<void>;
  update(id: string, changes: Partial<Pick<TripItem, "price" | "quantity" | "weightLbs" | "onSale">>): Promise<void>;
  getByTrip(tripId: string): Promise<TripItem[]>;
}

// ── PriceHistory ───────────────────────────────────────────────

export interface PriceHistoryFilters {
  storeId?: string;
  from?: number;
  to?: number;
  limit?: number;
}

export interface IPriceHistoryRepository {
  record(entry: PriceHistoryEntry): Promise<void>;
  getByItem(itemId: string, filters?: PriceHistoryFilters): Promise<PriceHistoryEntry[]>;
  getLatestPrice(itemId: string, storeId?: string): Promise<PriceHistoryEntry | undefined>;
  getBestPrice(itemId: string): Promise<PriceHistoryEntry | undefined>;
}
```

---

## Data Migration Strategy

Dexie handles schema migrations through incrementing version numbers. Each new version receives an `upgrade` callback that runs once per client.

```typescript
// Example: Adding a "brand" field to items in v2

this.version(1).stores({ /* original schema */ });

this.version(2)
  .stores({
    items: "id, &barcode, name, category, brand, createdAt",
  })
  .upgrade((tx) => {
    return tx.table("items").toCollection().modify((item) => {
      if (item.brand === undefined) item.brand = null;
    });
  });
```

**Key rules:**
- **Never delete a version block** once shipped — Dexie replays them sequentially.
- **Adding a non-indexed field** requires no schema change; just start writing it.
- **Adding an index** requires a new version with the updated index string.
- **Renaming/removing a field** should be done in an `upgrade` callback.
- **Keep upgrade functions idempotent** — a crash mid-upgrade causes Dexie to re-run the upgrader.

---

## Route Map

All routes use React Router 7. The app uses a single root layout (`AppLayout`) that provides bottom navigation and top header. Nested routes render inside `<Outlet />`.

```
Path                           Component                  Notes
────────────────────────────── ────────────────────────── ─────────────────────────────────
/                              HomePage                   Dashboard — stats, active trip resume, recents
/trips/new                     NewTripPage                Select or create store, start trip
/trips/active                  ActiveTripPage             Scanning/adding items, running subtotal
/trips/active/scan             ScannerPage                Camera viewfinder overlay (nested)
/trips/active/add              AddItemPage                Manual item add / new item form (nested)
/trips/active/end              EndTripPage                Enter receipt total, see comparison
/trips/history                 TripHistoryPage            All past trips, filterable
/trips/:id                     TripDetailPage             View completed trip details
/trips/:id/edit                TripEditPage               Edit past trip items
/items                         ItemLibraryPage            Search and browse all items
/items/new                     NewItemPage                Create item manually
/items/:id                     ItemDetailPage             Item info + price history chart
/reports                       ReportsPage                Report selector hub
/reports/spending              SpendingReportPage         Weekly/monthly spending totals
/reports/frequency             FrequencyReportPage        Most frequently bought items
/reports/price/:itemId         PriceHistoryReportPage     Price trend chart for single item
/reports/comparison            TripComparisonPage         Scanned vs. actual across trips
/stores                        StoresPage                 List all stores
/stores/new                    NewStorePage               Create a store
/stores/:id/edit               EditStorePage              Edit store name/notes
/export                        ExportPage                 JSON/CSV export and JSON import
```

### Router Structure

```tsx
createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "trips/new", element: <NewTripPage /> },
      {
        path: "trips/active",
        element: <ActiveTripPage />,
        children: [
          { path: "scan", element: <ScannerPage /> },
          { path: "add", element: <AddItemPage /> },
        ],
      },
      { path: "trips/active/end", element: <EndTripPage /> },
      { path: "trips/history", element: <TripHistoryPage /> },
      { path: "trips/:id", element: <TripDetailPage /> },
      { path: "trips/:id/edit", element: <TripEditPage /> },
      { path: "items", element: <ItemLibraryPage /> },
      { path: "items/new", element: <NewItemPage /> },
      { path: "items/:id", element: <ItemDetailPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "reports/spending", element: <SpendingReportPage /> },
      { path: "reports/frequency", element: <FrequencyReportPage /> },
      { path: "reports/price/:itemId", element: <PriceHistoryReportPage /> },
      { path: "reports/comparison", element: <TripComparisonPage /> },
      { path: "stores", element: <StoresPage /> },
      { path: "stores/new", element: <NewStorePage /> },
      { path: "stores/:id/edit", element: <EditStorePage /> },
      { path: "export", element: <ExportPage /> },
    ],
  },
]);
```

---

## Component Architecture

### Layout Components

```tsx
interface AppShellProps {
  children: React.ReactNode;
}

// Fixed bottom nav — 5 tabs: Home, Trips, Items, Reports, More
interface BottomNavProps {
  // Reads current route via useLocation() to highlight active tab
}

interface PageHeaderProps {
  title: string;
  backTo?: string;               // Renders back arrow linking here
  rightAction?: React.ReactNode; // Optional action button ("Edit", "Export")
}
```

### Data Display Components

```tsx
interface ItemCardProps {
  item: Item;
  onPress?: (item: Item) => void;
  trailing?: React.ReactNode;    // Price badge, chevron, or delete button
}

interface TripCardProps {
  trip: Trip;
  storeName: string;
  onPress?: (trip: Trip) => void;
}

interface PriceChartProps {
  data: Array<{ date: Date; price: number; storeName: string }>;
  storeFilter?: string;
  height?: number;               // Default 200px
}

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "stable";
  icon?: React.ReactNode;
}

interface TripItemRowProps {
  tripItem: TripItem;
  itemName: string;
  unitType: UnitType;
  onEditPrice?: (tripItemId: string) => void;
  onEditQuantity?: (tripItemId: string) => void;
  onRemove?: (tripItemId: string) => void;
  editable?: boolean;
}

interface SubtotalBarProps {
  subtotal: number;
  itemCount: number;
  onEndTrip: () => void;
}
```

### Form Components

```tsx
interface ItemFormProps {
  initialValues?: Partial<Item>;
  onSubmit: (values: CreateItemInput) => void;
  onCancel: () => void;
  submitLabel?: string;          // "Save" or "Add to Trip"
}

interface StoreFormProps {
  initialValues?: Partial<Store>;
  onSubmit: (values: CreateStoreInput) => void;
  onCancel: () => void;
}

interface BarcodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onScanPress: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

interface InlineEditorProps {
  label: string;
  value: number;
  onSave: (newValue: number) => void;
  onCancel: () => void;
  inputType?: "currency" | "decimal" | "integer";
}

interface StoreSelectorProps {
  stores: Store[];
  onSelect: (store: Store) => void;
  onCreateNew: () => void;
}

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (start: Date, end: Date) => void;
  presets?: Array<{ label: string; start: Date; end: Date }>;
}
```

### Scanner Components

```tsx
interface ScannerViewfinderProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
  isActive: boolean;
}

interface ManualEntryFallbackProps {
  onSubmit: (barcode: string) => void;
  onSwitchToCamera: () => void;
  cameraAvailable: boolean;
}
```

### Feedback Components

```tsx
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
}

interface LoadingSpinnerProps {
  message?: string;
  size?: "sm" | "md" | "lg";
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

interface ToastProps {
  message: string;
  variant: "success" | "error" | "info";
  duration?: number;
  onDismiss: () => void;
}
```

---

## State Management Strategy

The app uses **React Context for ephemeral/UI state** and **Dexie `useLiveQuery` for all persisted data**. No global store (no Redux/Zustand). Each page subscribes directly to database tables via live queries, which automatically re-render when IndexedDB data changes.

### Principle: Database as the Source of Truth

Every entity lives in IndexedDB via Dexie. Components read with `useLiveQuery()` and write by calling repository functions. This eliminates sync between UI state and persisted state.

```tsx
function ItemLibraryPage() {
  const items = useLiveQuery(() => db.items.orderBy("name").toArray());
  // items is undefined while loading, then auto-updates on DB changes.
}
```

### Contexts (Only Two Needed)

#### 1. `ActiveTripContext`

Manages the active shopping trip. This is the only cross-page state needed.

```tsx
interface ActiveTripContextValue {
  activeTrip: Trip | null;
  activeTripItems: TripItem[];
  subtotal: number;
  itemCount: number;

  startTrip: (storeId: string) => Promise<string>;
  addItemToTrip: (entry: CreateTripItemInput) => Promise<void>;
  updateTripItem: (id: string, updates: Partial<TripItem>) => Promise<void>;
  removeTripItem: (id: string) => Promise<void>;
  endTrip: (actualTotal: number) => Promise<void>;

  lastScannedBarcode: string | null;
  setLastScannedBarcode: (barcode: string | null) => void;
}
```

Wraps the app at root level so the bottom nav can show an active trip indicator.

#### 2. `ToastContext`

Lightweight context for transient notifications from anywhere.

```tsx
interface ToastContextValue {
  showToast: (message: string, variant: "success" | "error" | "info") => void;
}
```

### Data Flow

```
┌──────────────────────────────────────────────────────┐
│                     IndexedDB (Dexie)                │
│  stores | items | trips | tripItems | priceHistory   │
└────────────────────────┬─────────────────────────────┘
                         │  useLiveQuery (auto-subscribe)
                         ▼
┌──────────────────────────────────────────────────────┐
│              React Component Tree                    │
│                                                      │
│  <ActiveTripProvider>      ← reads active trip live  │
│    <ToastProvider>                                   │
│      <AppLayout>                                     │
│        <BottomNav />       ← active trip badge       │
│        <Outlet />                                    │
│      </AppLayout>                                    │
│    </ToastProvider>                                  │
│  </ActiveTripProvider>                               │
└──────────────────────────────────────────────────────┘
```

---

## Screen-by-Screen UX Flow

### Home (Dashboard)

**What the user sees:** A clean dashboard with a prominent "Start New Trip" button. Below it, 2-4 stat cards (total spent this month, number of trips, most-bought item, average trip total). A "Recent Trips" section shows the last 3 trips. If an active trip exists, "Start New Trip" becomes "Resume Trip" in the primary color.

**Key interactions:**
- "Start New Trip" → `/trips/new`
- "Resume Trip" → `/trips/active`
- Trip card tap → `/trips/:id`
- Bottom nav → all other sections

### Start Trip (Store Selection)

**What the user sees:** Search bar to filter stores. Tappable store rows. "Create New Store" option at bottom.

**Key interactions:**
- Tap store → create active trip → `/trips/active`
- "Create New Store" → inline `StoreForm` bottom sheet → auto-select and start trip
- If active trip exists → `ConfirmDialog`: "End current trip and start new one?"

### Active Trip

**What the user sees:** Header with store name and elapsed time. Scrollable list of `TripItemRow` components with inline edit/remove controls. Fixed `SubtotalBar` at bottom with running total, item count, "Scan" button, and "End Trip."

**Key interactions:**
- "Scan" → `/trips/active/scan` (camera viewfinder overlay)
- Barcode found in DB → confirmation sheet with name, last price, quantity input → add to trip
- Barcode unknown → `/trips/active/add?barcode=<code>` (pre-filled item creation)
- "Add Manually" → `/trips/active/add` (search library or create new)
- Tap price → `InlineEditor` to change price (updates item's `currentPrice` too)
- "End Trip" → `/trips/active/end`

### Scanner Overlay

**What the user sees:** Full-screen camera viewfinder with targeting box. "Manual Entry" link at bottom. Close button (X) in corner.

**Key interactions:**
- Auto-detect fires on barcode → scanner pauses → confirmation sheet
- Camera denied → automatically show `ManualEntryFallback`
- Manual submit → same lookup flow

### End Trip

**What the user sees:** Summary (store, date, items, scanned subtotal). Large numeric input for "Receipt Total." Live difference calculation. Color-coded: green (match), yellow (small diff), red (large diff).

**Key interactions:**
- Enter receipt total → "Save Trip" → trip finalized → toast → `/`
- "Keep Shopping" → `/trips/active`

### Trip History

**What the user sees:** Filter bar (store dropdown, date range). Scrollable `TripCard` list sorted by date. `EmptyState` if no trips.

**Key interactions:**
- Tap trip card → `/trips/:id`
- Filter by store/date → live query updates

### Trip Detail

**What the user sees:** Store name and date header with "Edit" button. Summary section (scanned subtotal, actual total, difference). Read-only `TripItemRow` list.

**Key interactions:**
- "Edit" → `/trips/:id/edit`
- Tap item name → `/items/:itemId`

### Trip Edit

**What the user sees:** Same as detail but editable rows. "Add Item" button. "Save Changes" at bottom.

**Key interactions:**
- Edit price/quantity → `InlineEditor`
- Remove item → `ConfirmDialog` → subtotal recalculates
- "Save Changes" → persist → toast → `/trips/:id`

### Item Library

**What the user sees:** Search bar. Alphabetical `ItemCard` list (thumbnail, name, barcode, price, unit badge). "+" button in header.

**Key interactions:**
- Search → real-time filter via Dexie query
- Tap item → `/items/:id`
- "+" → `/items/new`

### Item Detail

**What the user sees:** Item photo, barcode, unit type, current price. `PriceChart` below with store filter dropdown. Recent price entries list.

**Key interactions:**
- "Edit" → inline fields become editable
- Tap photo → camera/gallery picker
- Store filter → isolate one store's price line

### Reports Hub

**What the user sees:** Four large tappable cards: Spending, Most Bought, Price Trends, Trip Accuracy.

### Stores

**What the user sees:** Store rows (name, notes, trip count). "Add" button.

**Key interactions:**
- Tap → `/stores/:id/edit`
- "+" → `/stores/new`
- Delete → `ConfirmDialog` (only if no trips reference store)

### Export

**What the user sees:** Two sections — Export (JSON and CSV buttons) and Import (file picker with warning). Data count summary.

**Key interactions:**
- "Export as JSON" → file download
- "Export as CSV" → file download
- "Restore from JSON" → file picker → `ConfirmDialog` → import → toast

---

## Barcode Scanning Strategy

### Recommendation: `barcode-detector` (W3C Barcode Detection API polyfill)

**Why not `html5-qrcode`?** Unmaintained for 3+ years, built on unmaintained ZXing-js, inconsistent iOS behavior.

**Why `barcode-detector`?**
1. **Actively maintained** — backed by ZXing-C++ compiled to WASM
2. **Standards-aligned** — W3C Barcode Detection API, auto-uses native support when available
3. **Better accuracy** — WASM-based decoding outperforms the JS ZXing port
4. **Smaller active JS bundle** — WASM loaded lazily and cached by service worker

### Implementation

```ts
// src/scanner/camera-scanner.ts
import { BarcodeDetector } from "barcode-detector/ponyfill";

const GROCERY_FORMATS: BarcodeFormat[] = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39",
];

let detector: InstanceType<typeof BarcodeDetector> | null = null;

export async function initScanner(): Promise<void> {
  detector = new BarcodeDetector({ formats: GROCERY_FORMATS });
}

export async function detectFromVideoFrame(
  video: HTMLVideoElement,
): Promise<string | null> {
  if (!detector) throw new Error("Scanner not initialized");
  const barcodes = await detector.detect(video);
  return barcodes.length > 0 ? barcodes[0].rawValue : null;
}
```

Wire to a `<video>` element fed by `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })`. Run `detectFromVideoFrame` on a 200ms interval.

### WASM Self-Hosting (for offline)

```ts
import { prepareZXingModule } from "barcode-detector/ponyfill";

prepareZXingModule({
  overrideLocateFile: () => `/wasm/zxing_reader.wasm`,
});
```

Copy WASM from `node_modules/zxing-wasm/dist/` into `public/wasm/`. The PWA service worker caches `.wasm` files with CacheFirst strategy.

### Fallback Strategy

1. **Primary: Live camera scan** — `getUserMedia` + BarcodeDetector
2. **Secondary: Image file upload** — If camera unavailable, show `<input type="file" accept="image/*">`. Pass `ImageBitmap` to `detector.detect()`.
3. **Tertiary: Manual entry** — Always visible "Type barcode" button. Handles PLU codes and scanning failures.

```ts
export async function isCameraAvailable(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
}
```

---

## PWA Configuration

### What `vite-plugin-pwa` provides

1. **Service worker generation** via Workbox — pre-caches all build assets, serves cache-first
2. **Web app manifest** generated from config and injected into `index.html`
3. **Auto-update** via `registerType: "autoUpdate"`

### Required Assets

```
public/
├── icon-192.png    # 192×192 app icon
├── icon-512.png    # 512×512 app icon
└── favicon.ico
```

### Service Worker Strategy

- **Pre-cache** all static assets (JS, CSS, HTML, icons) at install time
- **CacheFirst** for `.wasm` files (barcode scanner polyfill)
- **No API caching** — all data lives in IndexedDB

### Registration

```ts
// src/main.tsx
import { registerSW } from "virtual:pwa-register";

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm("New version available. Reload?")) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log("App ready for offline use");
  },
});
```

Type declaration in `src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

### Testing Offline

1. `npm run build && npm run preview`
2. DevTools → Application → Service Workers → confirm SW active
3. Network tab → toggle "Offline"
4. Verify app loads and barcode scanning functions

---

## Testing Strategy

### Unit Tests

**What to test:** Repositories (CRUD via Dexie), pricing logic, utility functions.

**fake-indexeddb setup:**

```ts
// src/test/setup.ts
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { IDBFactory } from "fake-indexeddb";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
```

**Example repository test:**

```ts
describe("ItemRepository", () => {
  let repo: ItemRepository;

  beforeEach(() => {
    repo = new ItemRepository(db);
  });

  it("creates and retrieves an item by barcode", async () => {
    await repo.create({
      barcode: "0012345678905",
      name: "Whole Milk 1gal",
      currentPrice: 4.99,
      unitType: "each",
    });
    const found = await repo.findByBarcode("0012345678905");
    expect(found).toMatchObject({ name: "Whole Milk 1gal" });
  });

  it("returns undefined for unknown barcode", async () => {
    expect(await repo.findByBarcode("0000000000000")).toBeUndefined();
  });
});
```

### Component Tests

Mock Dexie hooks at module level:

```ts
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: vi.fn(),
}));

vi.mock("@/hooks/use-barcode-scanner", () => ({
  useBarcodeScanner: vi.fn(() => ({
    startScanning: vi.fn(),
    stopScanning: vi.fn(),
    lastResult: null,
    error: null,
    hasPermission: true,
  })),
}));
```

**Test:** Conditional rendering, user interactions, form submission, accessibility.

### Integration Tests

Render top-level route components with real Dexie + fake-indexeddb. No mocking of data layer.

**Key flows to test:**
1. Manual item entry → verify item in library
2. Scan → add to trip → end trip → verify price history
3. Add same item across multiple trips → verify price chart data
4. Export JSON → clear DB → import → verify all data restored

### Vitest Configuration

```ts
// vitest.config.ts (or inline in vite.config.ts)
{
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/**/*.d.ts", "src/main.tsx"],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
    css: false,
  },
}
```

---

## Development Scripts

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint 'src/**/*.{ts,tsx}'",
    "format": "prettier --write 'src/**/*.{ts,tsx,css,json}'",
    "type-check": "tsc --noEmit"
  }
}
```

**ESLint:** Use flat config (`eslint.config.js`) with `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, and `eslint-config-prettier`.

**Prettier:** Minimal config — `singleQuote: true`, `trailingComma: "all"`, `printWidth: 80`.

---

## Error Handling Patterns

### Camera Permission Denied

```ts
type ScannerState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "active"; stream: MediaStream }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "error"; message: string };
```

When `denied`: render a non-blocking banner explaining how to re-enable camera in browser settings. Provide "Try Again" button. Always offer manual barcode entry regardless of camera state.

### IndexedDB Storage Quota

```ts
async function safeWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      showToast("Storage full. Export data and clear old trips.", "error");
    }
    throw err;
  }
}
```

Show persistent warning in settings when `navigator.storage.estimate()` shows >80% usage.

### Invalid Barcode Scans

- Validate against known formats (EAN-13, UPC-A, EAN-8) with checksum validation
- Debounce: ignore repeated identical results within 2 seconds
- Show brief inline toast on failure ("Barcode not recognized — try again or enter manually")

### Network Errors (Future Sync)

Prepare by isolating future network calls behind a `SyncService` interface:
- Retry with exponential backoff (3 attempts, 1s/2s/4s)
- Offline queue in a Dexie `syncQueue` table
- Never block the UI — sync is fire-and-forget
- Small status icon in header (synced / syncing / offline)

---

## Implementation Phases (Detailed)

### Phase 1: Foundation

**Goal:** Scaffold project, configure tooling, define database schema, implement base CRUD.

| Task | Files | Size |
|---|---|---|
| Scaffold Vite + React + TS, install deps | `package.json`, `vite.config.ts`, `tsconfig.json` | S |
| Configure Tailwind CSS 4 | `src/index.css` | S |
| Configure Vitest, ESLint, Prettier | `vitest.config.ts`, `eslint.config.js`, `.prettierrc` | S |
| Define TypeScript domain types | `src/contracts/types.ts` | S |
| Create Dexie database with schema | `src/db/database.ts` | M |
| Implement repository layer | `src/db/repositories/*.ts` | M |
| Write repository unit tests | `src/db/repositories/__tests__/*.test.ts` | M |
| Set up React Router with shell layout | `src/App.tsx`, `src/components/layout/*.tsx`, page stubs | S |
| Create test setup with fake-indexeddb | `src/test/setup.ts` | S |
| Store CRUD UI | `src/pages/stores-page.tsx`, `src/components/forms/store-form.tsx` | M |

**Acceptance criteria:**
- `npm run dev` starts app with navigable shell (bottom nav)
- `npm test` passes — repositories CRUD against fake-indexeddb
- `npm run type-check` and `npm run lint` pass cleanly
- Store management UI works end-to-end

---

### Phase 2: Item Management

**Goal:** Users can manually add, edit, delete, and search grocery items.

| Task | Files | Size |
|---|---|---|
| Build ItemForm component | `src/components/forms/item-form.tsx` | M |
| Build ItemLibraryPage with search | `src/pages/item-library-page.tsx`, `src/components/data-display/item-card.tsx` | M |
| Build ItemDetailPage with edit | `src/pages/item-detail-page.tsx` | S |
| Build NewItemPage | `src/pages/new-item-page.tsx` | S |
| Wire pages to Dexie via `useLiveQuery` | Update page components | S |
| Write component tests | `__tests__/*.test.tsx` | M |

**Acceptance criteria:**
- Add item with name, barcode, price, unit type
- Item library filterable by search text
- Edit updates in real time (live queries)
- Delete with confirmation dialog

---

### Phase 3: Barcode Scanning

**Goal:** Camera-based barcode scanning that looks up or creates items.

| Task | Files | Size |
|---|---|---|
| Integrate barcode-detector polyfill | `src/scanner/camera-scanner.ts`, `src/hooks/use-barcode-scanner.ts` | L |
| Build scanner overlay UI | `src/components/scanner/scanner-viewfinder.tsx` | M |
| Implement barcode lookup flow | `src/components/scanner/manual-entry-fallback.tsx` | M |
| Handle camera permission states | `src/components/scanner/permission-prompt.tsx` | S |
| Copy WASM to public/ and configure | Build script, `public/wasm/` | S |
| Write tests with mocked BarcodeDetector | `__tests__/*.test.ts` | M |

**Acceptance criteria:**
- Camera viewfinder opens, detects barcodes
- Known barcode → item selected/shown
- Unknown barcode → add-item form with barcode pre-filled
- Camera denied → clear message + manual entry fallback
- No camera → scanner hidden, manual entry prominent

---

### Phase 4: Shopping Trips

**Goal:** Start trip, add items (scan or manual), record prices, end trip.

| Task | Files | Size |
|---|---|---|
| Create ActiveTripContext | `src/contexts/active-trip-context.tsx` | M |
| Build NewTripPage (store selection) | `src/pages/new-trip-page.tsx`, `src/components/forms/store-selector.tsx` | S |
| Build ActiveTripPage | `src/pages/active-trip-page.tsx`, `src/components/data-display/subtotal-bar.tsx` | L |
| Build AddItemPage for trips | `src/pages/add-item-page.tsx` | M |
| Build EndTripPage | `src/pages/end-trip-page.tsx` | M |
| Implement navigation guard | `src/hooks/use-navigation-guard.ts` | S |
| Write integration test: full trip lifecycle | `__tests__/active-trip-flow.test.tsx` | M |

**Acceptance criteria:**
- Start trip by selecting store; date defaults to today
- Items added by scan or library selection; price and quantity required
- Running subtotal updates in real time
- End trip saves data + creates PriceHistoryEntry for each item
- Cannot start new trip while one is active

---

### Phase 5: Trip History & Editing

**Goal:** Browse past trips, view details, edit entries.

| Task | Files | Size |
|---|---|---|
| Build TripHistoryPage | `src/pages/trip-history-page.tsx` | M |
| Build TripDetailPage | `src/pages/trip-detail-page.tsx` | M |
| Build TripEditPage | `src/pages/trip-edit-page.tsx` | M |
| Implement edit/delete with cascade | Update repositories | M |
| Write cascade tests | `__tests__/trip-cascade.test.ts` | M |

**Acceptance criteria:**
- Trip history shows all completed trips, newest first
- Trip detail shows full item list with prices
- Edit price/quantity of past trip items; price records update
- Delete trip removes items and associated price records

---

### Phase 6: Price Tracking & Reports

**Goal:** Visualize price trends, spending summaries, purchase frequency.

| Task | Files | Size |
|---|---|---|
| Integrate chart library (Recharts or Chart.js) | `package.json` | S |
| Build PriceChart component | `src/components/data-display/price-chart.tsx` | M |
| Build SpendingReportPage | `src/pages/spending-report-page.tsx` | L |
| Build FrequencyReportPage | `src/pages/frequency-report-page.tsx` | M |
| Build TripComparisonPage | `src/pages/trip-comparison-page.tsx` | M |
| Implement best-price-per-item query | `src/db/repositories/price-history-repository.ts` | M |
| Write query/aggregation tests | `__tests__/*.test.ts` | S |

**Acceptance criteria:**
- Item detail shows price history line chart (one series per store)
- Reports page shows monthly spending with bar chart
- Best price per item across stores
- Reports work with varying date ranges

---

### Phase 7: Data Export

**Goal:** JSON backup/restore and CSV export.

| Task | Files | Size |
|---|---|---|
| Implement JSON export (all tables) | `src/services/export-service.ts` | M |
| Implement JSON import with validation | `src/services/import-service.ts` | L |
| Implement CSV export | `src/services/csv-export-service.ts` | S |
| Build ExportPage UI | `src/pages/export-page.tsx` | M |
| Write round-trip integration test | `__tests__/export-import.test.ts` | M |

**Acceptance criteria:**
- "Export Backup" produces `.json` with all data
- "Import Backup" validates schema, prompts on conflicts
- "Export CSV" produces `.csv` with columns: date, store, item, barcode, quantity, unit, price
- Malformed files rejected with clear error

---

### Phase 8: Polish

**Goal:** PWA support, offline reliability, responsive design, error handling.

| Task | Files | Size |
|---|---|---|
| Add PWA manifest and service worker | `vite.config.ts`, `public/manifest.json` | M |
| Add install-app prompt | `src/components/feedback/install-prompt.tsx` | S |
| Add global error boundary | `src/components/feedback/error-boundary.tsx` | S |
| Add toast notification system | `src/components/feedback/toast.tsx`, `src/contexts/toast-context.tsx` | M |
| Audit responsive design (320px–1440px) | All components | M |
| Accessibility audit (keyboard nav, ARIA, contrast) | All components | M |
| Add loading skeletons | `src/components/feedback/skeleton.tsx` | S |
| Final test pass — ensure coverage thresholds | All test files | M |

**Acceptance criteria:**
- App installable as PWA on mobile and desktop
- All features work fully offline
- UI responsive from 320px to 1440px
- Errors caught by boundaries; no white screens
- Toast notifications for destructive actions and errors
- Coverage thresholds pass
