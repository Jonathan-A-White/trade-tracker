# TradeTracker — Implementation Plan

A local-first grocery tracking app for scanning items, tracking prices over time, managing shopping trips, and running spending reports.

## Tech Stack

- React 18 + TypeScript 5.9 + Vite 7
- Tailwind CSS 4 (via `@tailwindcss/vite` plugin)
- Dexie.js 4 for IndexedDB (offline-first data layer)
- React Router DOM 7 for routing
- Vitest + React Testing Library + fake-indexeddb for testing
- Device camera barcode scanning (e.g., `html5-qrcode` or `@nicolo-ribaudo/barcode-reader` via Barcode Detection API)

## Core Features

### 1. Barcode Scanning
- Use device camera to scan barcodes in real-time
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

## Source Layout

```
src/
├── contracts/
│   ├── types.ts            # All entity types
│   └── events.ts           # Event bus (item:scanned, trip:started, trip:ended, etc.)
├── core/
│   └── pricing/            # Price comparison logic, trend calculation
├── data/
│   ├── db.ts               # Dexie database schema
│   ├── export.ts           # JSON/CSV export
│   └── repositories/
│       ├── item.ts          # Item CRUD + search
│       ├── store.ts         # Store CRUD
│       ├── trip.ts          # Trip CRUD + item entries
│       ├── price-history.ts # Price history queries
│       └── index.ts
├── scanner/
│   ├── camera-scanner.ts    # Camera-based barcode scanning
│   ├── manual-entry.ts      # Manual barcode/PLU input
│   └── index.ts
├── features/
│   ├── scanner/             # Scan screen UI (camera viewfinder, manual entry toggle)
│   ├── trip/                # Active trip view (item list, running total, end trip)
│   ├── trip-history/        # Past trips list + detail view
│   ├── items/               # Item library (search, browse, detail with price chart)
│   ├── item-edit/           # Add/edit item (name, picture, price, unit type)
│   ├── stores/              # Store management
│   ├── reports/             # Report views (spending, frequency, price trends)
│   └── export/              # Export UI
└── components/
    ├── price-chart.ts       # Reusable price history chart
    ├── item-card.ts         # Item display card
    └── layout.ts            # App shell, nav
```

## Database Schema (Dexie)

### `stores`
| Field | Type | Notes |
|-------|------|-------|
| id | string (auto) | Primary key |
| name | string | e.g., "Trader Joe's on Main St" |
| notes | string? | Optional |
| createdAt | Date | |

### `items`
| Field | Type | Notes |
|-------|------|-------|
| id | string (auto) | Primary key |
| barcode | string | Barcode number or PLU code (indexed, unique) |
| name | string | Product name (indexed for search) |
| picture | Blob? | Photo from camera or gallery |
| currentPrice | number | Last known price |
| unitType | "each" \| "per_lb" | Pricing model |
| createdAt | Date | |
| updatedAt | Date | |

### `trips`
| Field | Type | Notes |
|-------|------|-------|
| id | string (auto) | Primary key |
| storeId | string | FK to stores (indexed) |
| startedAt | Date | |
| endedAt | Date? | Null while trip is active |
| scannedSubtotal | number | Sum of all trip items |
| actualTotal | number? | Receipt total entered by user |
| status | "active" \| "completed" | |

### `tripItems`
| Field | Type | Notes |
|-------|------|-------|
| id | string (auto) | Primary key |
| tripId | string | FK to trips (indexed) |
| itemId | string | FK to items (indexed) |
| price | number | Price at time of purchase |
| quantity | number | Default 1 (for "each" items) |
| weightLbs | number? | For "per_lb" items |
| lineTotal | number | price × quantity, or price × weightLbs |
| addedAt | Date | |

### `priceHistory`
| Field | Type | Notes |
|-------|------|-------|
| id | string (auto) | Primary key |
| itemId | string | FK to items (indexed) |
| storeId | string | FK to stores (indexed) |
| price | number | |
| date | Date | Compound index: [itemId+date], [itemId+storeId] |

## Screen Flow

```
Home
├── Start New Trip → Select Store → Active Trip (scan/add/running total) → End Trip (enter receipt total)
├── Trip History → Trip Detail (edit items, see totals)
├── Item Library → Search/Browse → Item Detail (price chart, edit)
├── Reports → Spending | Frequency | Price Trends | Trip Comparison
├── Stores → Add/Edit stores
└── Export → JSON / CSV download
```

## Implementation Phases

### Phase 1: Foundation
- [ ] Project scaffold (Vite + React + TS + Tailwind + Dexie + Router)
- [ ] Database schema + repositories (items, stores, trips, tripItems, priceHistory)
- [ ] Contract types + event bus
- [ ] Store CRUD UI

### Phase 2: Item Management
- [ ] Manual item creation (name, barcode/PLU, price, unit type, picture from camera/gallery)
- [ ] Item library with search
- [ ] Item detail/edit view

### Phase 3: Barcode Scanning
- [ ] Camera-based barcode scanning integration
- [ ] Manual barcode/PLU entry
- [ ] Scan → lookup → auto-populate flow

### Phase 4: Shopping Trips
- [ ] Start trip (select store)
- [ ] Active trip screen: scan items, set quantity/weight, running subtotal
- [ ] Auto-populate last price, allow inline edit
- [ ] End trip: enter actual receipt total, save comparison
- [ ] New item flow when barcode not found (inline creation)

### Phase 5: Trip History & Editing
- [ ] Trip history list (filterable by store, date range)
- [ ] Trip detail view
- [ ] Edit past trips (add/remove/correct items)

### Phase 6: Price Tracking & Reports
- [ ] Price history recording on every trip item add
- [ ] Price history chart per item (filterable by store)
- [ ] Spending reports (weekly/monthly/custom)
- [ ] Most frequently bought items
- [ ] Trip comparison (scanned vs. actual)

### Phase 7: Data Export
- [ ] JSON full export/import
- [ ] CSV export (items, trips, price history)

### Phase 8: Polish
- [ ] Offline reliability testing
- [ ] Responsive design for mobile-first use (in-store scanning)
- [ ] Error handling and edge cases
- [ ] PWA setup (service worker for full offline support)
