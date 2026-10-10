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
  /** What the last receipt reconcile found, kept so End Trip shows the same lists when he comes back. */
  receiptReconcile?: ReceiptReconcileRecord;
  /** A receipt sent to the factory and not yet answered; kept so the wait survives leaving the page or restarting the app. */
  receiptPending?: ReceiptPending;
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
  /**
   * Set when the line's price is a best guess (the item's past price, or the factory's
   * estimate) because no tag price came; it counts in totals. `basis` says what it rests on.
   * Cleared when a receipt or a hand edit gives the real price.
   */
  guess?: { basis: string };
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
  /** The tag price only; null when no readable tag. */
  price: number | null;
  /** Best guess in dollars (per unitType) from what the item is; given whenever price is null. */
  estimatedPrice?: number;
  /** One short line: what estimatedPrice is based on. */
  estimateNote?: string;
  size?: string;
  /** Net weight in lb read from a per-pound label; only for a per_lb item whose label shows it. */
  weightLbs?: number;
  confidence: "high" | "medium" | "low";
  notes?: string;
}

/**
 * One trip line as the receipt-reconcile request sends it, a short row to fit the 10 KB record
 * (schemas/receipt-reconcile-input-2.0.schema.json): [tripItemId, name, price, quantity, weightLbs].
 * The barcode, unit type, sale flag and bottle deposit stay on the app's own lines.
 */
export type ReceiptReconcileRequestLine = [
  tripItemId: string,
  name: string,
  price: number,
  quantity: number,
  weightLbs: number | null,
];

/** The receipt-reconcile input 2.0 (schemas/receipt-reconcile-input-2.0.schema.json). */
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

/** One trip line the receipt changed: the unit price (and count or weight) before and after. */
export interface ReceiptChange {
  tripItemId: string;
  name: string;
  oldPrice: number;
  newPrice: number;
  oldQuantity: number;
  newQuantity: number;
  oldWeightLbs: number | null;
  newWeightLbs: number | null;
  /** True when the old price was a best guess, not a tag or earlier receipt price. */
  wasGuess?: true;
}

/** A receipt line he placed as a new item: the trip line it became. */
export interface ReceiptAddedLine {
  tripItemId: string;
  name: string;
  price: number;
}

/** A receipt-reconcile grist in flight: what the app needs to fetch its answer and check it later. */
export interface ReceiptPending {
  /** The grist's txid, to ask the factory for the answer. */
  txid: string;
  /** When it was sent (epoch ms). */
  sentAt: number;
  /** What was sent, so the answer is checked against the same trip lines. */
  request: ReceiptReconcileRequest;
  /** Set when the factory refused or could not read it; nothing more is awaited. */
  error?: string;
}

/** A trip's receipt reconcile, as applied: kept on the trip (no index) so End Trip can be left and reopened. */
export interface ReceiptReconcileRecord {
  changes: ReceiptChange[];
  /** Receipt lines not (yet) placed on a trip line; he matches each to a line or adds it as a new item. */
  unmatched: ReceiptReconcileAnswerLine[];
  /** Receipt lines he added as new items. */
  added: ReceiptAddedLine[];
  /** The trip lines a receipt line is, so the others are 'Not on receipt'. */
  matchedTripItemIds: string[];
  total: number | null;
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
