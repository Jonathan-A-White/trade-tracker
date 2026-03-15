export type UnitType = "each" | "per_lb";
export type TripStatus = "active" | "completed";

export interface Store {
  id: string;
  name: string;
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
  addedAt: number;
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
export type CreatePriceHistoryInput = Omit<PriceHistoryEntry, "id">;
