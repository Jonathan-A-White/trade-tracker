import { rowsInOrder } from "pwa-kit/settings";
import type { SettingsGroup, SettingsRow, SettingsSection } from "pwa-kit/settings";

// Every setting the Settings screen has, declared once (pwa-kit/settings). The screen draws exactly these rows, the search finds them by
// name, hint and help, and a link (link(key, SETTINGS_PATH)) opens the screen at one. A new setting is a row here plus the block or
// field that draws it inside a <SettingRow settingKey>; src/pages/settings-page.test.tsx fails when a row is drawn twice or not at all.

/** The blocks of the screen, each a section of the kit. */
export type SectionId =
  | "appearance"
  | "factory"
  | "storage"
  | "plu-codes"
  | "tj-barcodes"
  | "tj-receipt"
  | "items-transfer"
  | "trips-transfer"
  | "ai-trip"
  | "danger-zone"
  | "about";

export type GroupId = "display" | "factory" | "data" | "about";

/** The route the screen is mounted at (a link to a row is `${SETTINGS_PATH}?setting=<key>`). */
export const SETTINGS_PATH = "/settings";

/** In the order the screen draws them. */
export const SECTIONS: readonly SettingsSection<SectionId>[] = [
  { id: "appearance", title: "Appearance" },
  { id: "factory", title: "Factory" },
  { id: "storage", title: "Storage Usage" },
  { id: "plu-codes", title: "Produce PLU Codes" },
  { id: "tj-barcodes", title: "Trader Joe's Barcodes" },
  { id: "tj-receipt", title: "TJ's Receipt (03/14/2026)" },
  { id: "items-transfer", title: "Export / Import Items" },
  { id: "trips-transfer", title: "Export / Import Trips" },
  { id: "ai-trip", title: "Import Trip from AI" },
  { id: "danger-zone", title: "Danger Zone" },
  { id: "about", title: "About" },
];

/** Each group holds sections that sit next to each other in SECTIONS. */
export const GROUPS: readonly SettingsGroup<SectionId, GroupId>[] = [
  { id: "display", title: "Display", hint: "Dark or light mode.", sections: ["appearance"] },
  { id: "factory", title: "Factory", hint: "This phone's key, licence and backend.", sections: ["factory"] },
  {
    id: "data",
    title: "Your data",
    hint: "Storage, price lists, backups, imports and clearing.",
    sections: ["storage", "plu-codes", "tj-barcodes", "tj-receipt", "items-transfer", "trips-transfer", "ai-trip", "danger-zone"],
  },
  { id: "about", title: "About", hint: "Version and credits.", sections: ["about"] },
];

/** A row whose key is its section's id is drawn around the whole block; any other is a field inside a block. */
export const ROWS: readonly SettingsRow<SectionId>[] = rowsInOrder<SectionId, SettingsRow<SectionId>>(SECTIONS, [
  {
    key: "appearance",
    section: "appearance",
    label: "Appearance",
    hint: "Dark or light mode.",
    help: "Switch the app between dark mode and light mode. The choice is kept on this device.",
  },
  {
    key: "factory",
    section: "factory",
    label: "Factory",
    hint: "Make, unlock and check this phone's key and licence.",
    help: "The key is made and kept on this device only. Unlock it with your fingerprint or your 12 words. The licence says whether the factory will answer this phone.",
  },
  {
    key: "backend",
    section: "factory",
    label: "Backend",
    hint: "The address of the factory this phone sends lookups to.",
    help: "Leave it as it is unless you run your own backend. It is kept on this device.",
  },
  {
    key: "storage",
    section: "storage",
    label: "Storage Usage",
    hint: "How much space the app uses on this device.",
  },
  {
    key: "plu-codes",
    section: "plu-codes",
    label: "Produce PLU Codes",
    hint: "Load common fruit and vegetable PLU codes with approximate prices.",
    help: "Existing items are not overwritten.",
  },
  {
    key: "tj-barcodes",
    section: "tj-barcodes",
    label: "Trader Joe's Barcodes",
    hint: "Load popular Trader Joe's product barcodes with approximate prices.",
    help: "Existing items are not overwritten.",
  },
  {
    key: "tj-receipt",
    section: "tj-receipt",
    label: "TJ's Receipt (03/14/2026)",
    hint: "Load the items from the Trader Joe's Danbury receipt with prices as purchased.",
    help: "Items with placeholder barcodes (TJR prefix) can be updated by scanning the actual product. Existing items are not overwritten.",
  },
  {
    key: "items-transfer",
    section: "items-transfer",
    label: "Export / Import Items",
    hint: "Save all items to a JSON file, or add items from one.",
    help: "Importing adds new items without overwriting existing ones.",
  },
  {
    key: "trips-transfer",
    section: "trips-transfer",
    label: "Export / Import Trips",
    hint: "Save all trips, stores and price history to a JSON file, or add them from one.",
    help: "Importing adds new trips without overwriting existing ones.",
  },
  {
    key: "ai-trip",
    section: "ai-trip",
    label: "Import Trip from AI",
    hint: "Import a trip JSON made by AI from an Export for AI and a receipt.",
    help: "Creates a new completed trip with all its items. It needs a factory licence.",
  },
  {
    key: "danger-zone",
    section: "danger-zone",
    label: "Danger Zone",
    hint: "Clear all data on this device.",
    help: "Permanently deletes all stores, items, trips and price history. It cannot be undone.",
  },
  {
    key: "about",
    section: "about",
    label: "About",
    hint: "The app's version, where it keeps data, and credits.",
  },
]);
