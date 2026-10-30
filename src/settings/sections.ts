import type { JSX } from "react";
import { SECTIONS } from "./registry";
import type { SectionId } from "./registry";
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
import { YnabSection } from "./sections/ynab-section";

/** One block on the Settings screen. */
export interface SettingsSection {
  id: SectionId;
  title: string;
  Component: () => JSX.Element;
}

const COMPONENTS: Record<SectionId, () => JSX.Element> = {
  appearance: AppearanceSection,
  factory: FactorySection,
  ynab: YnabSection,
  storage: StorageSection,
  "plu-codes": PluCodesSection,
  "tj-barcodes": TjBarcodesSection,
  "tj-receipt": TjReceiptSection,
  "items-transfer": ItemsTransferSection,
  "trips-transfer": TripsTransferSection,
  "ai-trip": AiTripSection,
  "danger-zone": DangerZoneSection,
  about: AboutSection,
};

/** Every block, in the order the registry lists its sections. A new block is a file, a section and its rows in registry.ts, and one line above. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SECTIONS.map(({ id, title }) => ({
  id,
  title,
  Component: COMPONENTS[id],
}));
