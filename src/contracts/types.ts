export type UnitType = "each" | "per_lb";
export type TripStatus = "active" | "completed";

export interface Store {
  id: string;
  name: string;
  city?: string;
  state?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Item {
  id: string;
  barcode: string;
  name: string;
  currentPrice: number;
  unitType: UnitType;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Trip {
  id: string;
  storeId: string;
  status: TripStatus;
  startedAt: number;
  endedAt?: number;
  scannedSubtotal: number;
  actualTotal?: number;
  budget?: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TripItem {
  id: string;
  tripId: string;
  itemId: string;
  price: number;
  quantity: number;
  weightLbs?: number;
  lineTotal: number;
  onSale: boolean;
  /** Tax override: true = force taxable, false = force exempt, undefined = use heuristic */
  taxOverride?: boolean;
  /** Bottle/container deposit total for this line (e.g., CT $0.05/can × 12 = 0.60). Added on top of lineTotal. */
  bottleDeposit?: number;
  /** True while the line is only a pending factory lookup (no price yet); such a line is left out of totals. */
  pending?: true;
  /**
   * Set when a factory answer filled the line: "check" when the tag gave a price
   * the shopper should look at, "add" when it gave none. Cleared by a tap or an edit.
   */
  priceFlag?: "check" | "add";
  addedAt: number;
}

export type PendingLookupStatus =
  | "waiting-to-send"
  | "at-the-factory"
  | "ready"
  | "applied"
  | "failed";

/** What a lookup asks of the factory: the whole item from a new product, or only the price of a known item from its shelf tag. */
export type LookupMode = "new-item" | "price-only";

/** A photographed product waiting for the factory to name and price it. */
export interface PendingLookup {
  id: string;
  barcode: string;
  tripId: string;
  /** The itemId its pending TripItem carries: a placeholder until the line is filled, then the real item. A price-only lookup carries the known item's id and has no pending line. */
  itemId: string;
  /** Absent on lookups made before price-only existed: those are "new-item". */
  mode?: LookupMode;
  photos: Blob[];
  status: PendingLookupStatus;
  gristTxid?: string;
  answer?: string;
  error?: string;
  /** A price-only lookup the factory answered without a price: nothing changed, and the shopper is told until they dismiss it. */
  noPrice?: true;
  createdAt: number;
}

/** The item-from-photos answer 1.0 (schemas/item-from-photos-answer-1.0.schema.json). */
export interface ItemFromPhotosAnswer {
  name: string;
  category: string;
  unitType: UnitType;
  price: number | null;
  size?: string;
  /** Net weight in lb read from a per-pound label; only for a per_lb item whose label shows it. */
  weightLbs?: number;
  confidence: "high" | "medium" | "low";
  notes?: string;
}

/** One trip line as the receipt-reconcile request sends it (schemas/receipt-reconcile-input-1.0.schema.json). */
export interface ReceiptReconcileRequestLine {
  tripItemId: string;
  name: string;
  barcode: string;
  price: number;
  quantity: number;
  weightLbs: number | null;
  unitType: UnitType;
  onSale: boolean;
  bottleDeposit: number | null;
}

/** The receipt-reconcile input 1.0 (schemas/receipt-reconcile-input-1.0.schema.json). */
export interface ReceiptReconcileRequest {
  store: string;
  lines: ReceiptReconcileRequestLine[];
}

/** One printed receipt line of the receipt-reconcile answer. */
export interface ReceiptReconcileAnswerLine {
  text: string;
  price: number;
  quantity: number;
  weightLbs: number | null;
  /** The request line this receipt line is, or null when unmatched or unsure. */
  tripItemId: string | null;
  confidence: "high" | "medium" | "low";
}

/** The receipt-reconcile answer 1.0 (schemas/receipt-reconcile-answer-1.0.schema.json). */
export interface ReceiptReconcileAnswer {
  store: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lines: ReceiptReconcileAnswerLine[];
  unreadable: string | null;
}

export interface PriceHistoryEntry {
  id: string;
  itemId: string;
  storeId: string;
  tripItemId: string;
  price: number;
  recordedAt: number;
}

export type CreateStoreInput = Omit<Store, "id" | "createdAt" | "updatedAt">;
export type CreateItemInput = Omit<Item, "id" | "createdAt" | "updatedAt">;
export type CreateTripInput = Omit<
  Trip,
  | "id"
  | "status"
  | "endedAt"
  | "scannedSubtotal"
  | "actualTotal"
  | "createdAt"
  | "updatedAt"
>;
export type CreateTripItemInput = Omit<TripItem, "id" | "lineTotal" | "addedAt">;
export type CreatePendingLookupInput = Pick<
  PendingLookup,
  "barcode" | "tripId" | "photos"
> &
  (
    | { mode?: "new-item"; itemId?: undefined }
    | { mode: "price-only"; itemId: string }
  );
export type CreatePriceHistoryInput = Omit<PriceHistoryEntry, "id">;

/** Where the app's factory key stands: none made, wrapped but locked, unlocked, or unlocked and licensed. */
export type FactoryDoorState = "no-key" | "locked" | "unlocked" | "licensed";

/** What the app knows of its licence in the collection trade-tracker. */
export type FactoryLicence =
  | "checking"
  | "held"
  | "none"
  | "revoked"
  | "indexing"
  | "unknown";
