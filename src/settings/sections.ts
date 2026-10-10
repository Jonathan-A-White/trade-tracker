import type { JSX } from "react";
import { AboutSection } from "./sections/about-section";
import { AiTripSection } from "./sections/ai-trip-section";
import { AppearanceSection } from "./sections/appearance-section";
import { DangerZoneSection } from "./sections/danger-zone-section";
import { FactorySection } from "./sections/factory-section";
import { ItemsTransferSection } from "./sections/items-transfer-section";
import { PluCodesSection } from "./sections/plu-codes-section";
import { StorageSection } from "./sections/storage-section";
import { TjBarcodesSection } from "./sections/tj-barcodes-section";
import { TjReceiptSection } from "./sections/tj-receipt-section";
import { TripsTransferSection } from "./sections/trips-transfer-section";

/** One block on the Settings screen. */
export interface SettingsSection {
  id: string;
  title: string;
  /** Lower comes first; ties break on id. */
  order: number;
  Component: () => JSX.Element;
}

const REGISTERED: SettingsSection[] = [
  { id: "appearance", title: "Appearance", order: 10, Component: AppearanceSection },
  { id: "factory", title: "Factory", order: 20, Component: FactorySection },
  { id: "storage", title: "Storage Usage", order: 30, Component: StorageSection },
  { id: "plu-codes", title: "Produce PLU Codes", order: 40, Component: PluCodesSection },
  { id: "tj-barcodes", title: "Trader Joe's Barcodes", order: 50, Component: TjBarcodesSection },
  { id: "tj-receipt", title: "TJ's Receipt (03/14/2026)", order: 60, Component: TjReceiptSection },
  { id: "items-transfer", title: "Export / Import Items", order: 70, Component: ItemsTransferSection },
  { id: "trips-transfer", title: "Export / Import Trips", order: 80, Component: TripsTransferSection },
  { id: "ai-trip", title: "Import Trip from AI", order: 90, Component: AiTripSection },
  { id: "danger-zone", title: "Danger Zone", order: 100, Component: DangerZoneSection },
  { id: "about", title: "About", order: 110, Component: AboutSection },
];

/** Every section, in the order the screen shows them. A new setting is a new file plus one line above. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [...REGISTERED].sort(
  (a, b) => a.order - b.order || a.id.localeCompare(b.id),
);
