import type { Command } from "voice-kit/talks";
import { formCommand } from "voice-kit/forms";
import type { FormArgs, FormSpec } from "voice-kit/forms";
import { US_STATES } from "@/core/tax/us-states";

/**
 * The three forms as the tutor sees them, and the confirm command of each. A form's Save and the
 * tutor's Send are one path: the command's send hands the page's own onSubmit (or the modal's own
 * save) the values the form's Save would have passed. The forms keep their state as the app does;
 * the *Strings functions give it as the text of each field, the *ValuesOf functions turn a command's
 * args back into the values.
 */

export const ITEM_SAVE = "item-save";
export const STORE_SAVE = "store-save";
export const IDENTIFY_ITEM = "identify-item";

/** What ItemForm's Save passes to the page. */
export interface ItemFormValues {
  barcode: string;
  name: string;
  currentPrice: number;
  unitType: string;
  category: string;
}

/** What StoreForm's Save passes to the page. */
export interface StoreFormValues {
  name: string;
  city: string;
  state: string;
  notes: string;
}

/** What the Identify Item modal saves, besides the item's id and price that the page gave it. */
export interface IdentifyValues {
  name: string;
  barcode: string;
  unitType: string;
  category: string;
}

/** Unit Type as the form shows it, and as the item stores it. */
const UNIT_LABELS: Record<string, string> = { each: "Each", per_lb: "Per Pound" };
const UNIT_TYPES: Record<string, string> = { Each: "each", "Per Pound": "per_lb" };
const UNIT_OPTIONS = Object.keys(UNIT_TYPES);

const CATEGORY_HINT = "Usually one of the app's own, like Produce or Dairy & Eggs.";
const BARCODE_HINT = "For produce, the 4-5 digit PLU from the sticker.";

export const ITEM_FORM: FormSpec = {
  name: "Item",
  fields: [
    { name: "barcode", label: "Barcode or PLU Code", hint: BARCODE_HINT, required: false, kind: "text", maxLength: 64 },
    { name: "name", label: "Name", required: true, kind: "text", maxLength: 200 },
    { name: "price", label: "Price", hint: "In dollars, like 3.49.", required: true, kind: "text", maxLength: 12 },
    { name: "unitType", label: "Unit Type", required: false, kind: "choice", options: UNIT_OPTIONS },
    { name: "category", label: "Category", hint: CATEGORY_HINT, required: false, kind: "text", maxLength: 60 },
  ],
};

export const STORE_FORM: FormSpec = {
  name: "Store",
  fields: [
    { name: "name", label: "Store Name", required: true, kind: "text", maxLength: 120 },
    { name: "city", label: "City", required: false, kind: "text", maxLength: 80 },
    {
      name: "state",
      label: "State",
      hint: "The two-letter state code.",
      required: false,
      kind: "choice",
      options: US_STATES.map(({ code }) => code),
    },
    { name: "notes", label: "Notes", required: false, kind: "text", maxLength: 600 },
  ],
};

export const IDENTIFY_FORM: FormSpec = {
  name: "Identify item",
  fields: [
    { name: "name", label: "Name", required: true, kind: "text", maxLength: 200 },
    { name: "barcode", label: "Barcode or PLU", hint: "Leave blank if there is no barcode.", required: false, kind: "text", maxLength: 64 },
    { name: "unitType", label: "Unit Type", required: false, kind: "choice", options: UNIT_OPTIONS },
    { name: "category", label: "Category", hint: CATEGORY_HINT, required: false, kind: "text", maxLength: 60 },
  ],
};

/** A price as text: "" until one is set (0 is the form's empty price), so the tutor asks for it. */
function priceText(price: number): string {
  return price > 0 ? String(price) : "";
}

/** A price the tutor or he wrote ("3.49", "$3.49", "1,299.00") as a number; null when it is no price. */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const price = Number(cleaned);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function unitLabel(unitType: string): string {
  return UNIT_LABELS[unitType] ?? "Each";
}

/** A Unit Type option the tutor chose, as the item stores it; null when it is none of the options. */
export function unitTypeOf(label: string): string | null {
  return UNIT_TYPES[label] ?? null;
}

export function itemStrings(values: ItemFormValues): Record<string, string> {
  return {
    barcode: values.barcode,
    name: values.name,
    price: priceText(values.currentPrice),
    unitType: unitLabel(values.unitType),
    category: values.category,
  };
}

export function storeStrings(values: StoreFormValues): Record<string, string> {
  return { name: values.name, city: values.city, state: values.state, notes: values.notes };
}

export function identifyStrings(values: IdentifyValues): Record<string, string> {
  return {
    name: values.name,
    barcode: values.barcode,
    unitType: unitLabel(values.unitType),
    category: values.category,
  };
}

export function itemValuesOf(args: FormArgs): ItemFormValues {
  const currentPrice = parsePrice(args.price ?? "");
  if (currentPrice === null) throw new Error("The price must be a number, like 3.49.");
  return {
    barcode: args.barcode ?? "",
    name: args.name ?? "",
    currentPrice,
    unitType: unitTypeOf(args.unitType ?? "Each") ?? "each",
    category: args.category ?? "",
  };
}

export function storeValuesOf(args: FormArgs): StoreFormValues {
  return { name: args.name ?? "", city: args.city ?? "", state: args.state ?? "", notes: args.notes ?? "" };
}

export function identifyValuesOf(args: FormArgs): IdentifyValues {
  return {
    name: args.name ?? "",
    barcode: args.barcode ?? "",
    unitType: unitTypeOf(args.unitType ?? "Each") ?? "each",
    category: args.category ?? "",
  };
}

/** The command that saves an item: `onSubmit` is the page's own handler, the one the form's Save calls. */
export function itemSaveCommand(onSubmit: (values: ItemFormValues) => void | Promise<void>): Command {
  return formCommand(ITEM_FORM, {
    name: ITEM_SAVE,
    tell: "Saves the item form with the values given",
    send: async (args) => {
      await onSubmit(itemValuesOf(args));
      return { said: "Saved the item." };
    },
  });
}

/** The command that saves a store: `onSubmit` is the page's own handler, the one the form's Save calls. */
export function storeSaveCommand(onSubmit: (values: StoreFormValues) => void | Promise<void>): Command {
  return formCommand(STORE_FORM, {
    name: STORE_SAVE,
    tell: "Saves the store form with the values given",
    send: async (args) => {
      await onSubmit(storeValuesOf(args));
      return { said: "Saved the store." };
    },
  });
}

/**
 * The command that saves what Identify Item holds. `save` is the modal's own save, the one its Save calls:
 * it resolves with null when the item was saved, or with the plain sentence saying why not.
 */
export function identifyItemCommand(save: (values: IdentifyValues) => Promise<string | null>): Command {
  return formCommand(IDENTIFY_FORM, {
    name: IDENTIFY_ITEM,
    tell: "Saves the Identify Item form with the values given",
    send: async (args) => {
      const problem = await save(identifyValuesOf(args));
      if (problem) throw new Error(problem);
      return { said: "Saved the item." };
    },
  });
}
