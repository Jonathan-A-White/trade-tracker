import { defineRegistry } from "voice-kit/talks";
import { argsOf } from "voice-kit/forms";
import {
  IDENTIFY_FORM,
  IDENTIFY_ITEM,
  ITEM_FORM,
  ITEM_SAVE,
  STORE_FORM,
  STORE_SAVE,
  identifyItemCommand,
  identifyStrings,
  itemSaveCommand,
  itemStrings,
  storeSaveCommand,
  storeStrings,
} from "./form-commands";

describe("the commands' args schemas", () => {
  it("item-save requires Name and Price, and Unit Type is one of Each, Per Pound", () => {
    const command = itemSaveCommand(vi.fn());
    expect(command.kind).toBe("confirm");
    expect(command.name).toBe(ITEM_SAVE);
    expect(command.args?.required).toEqual(["name", "price"]);
    expect(Object.keys(command.args?.properties ?? {})).toEqual(["barcode", "name", "price", "unitType", "category"]);
    expect(command.args?.properties?.unitType?.enum).toEqual(["Each", "Per Pound"]);
    expect(command.args?.additionalProperties).toBe(false);
  });

  it("store-save requires Store Name", () => {
    const command = storeSaveCommand(vi.fn());
    expect(command.name).toBe(STORE_SAVE);
    expect(command.args?.required).toEqual(["name"]);
    expect(Object.keys(command.args?.properties ?? {})).toEqual(["name", "city", "state", "notes"]);
  });

  it("identify-item requires Name", () => {
    const command = identifyItemCommand(vi.fn());
    expect(command.name).toBe(IDENTIFY_ITEM);
    expect(command.args?.required).toEqual(["name"]);
    expect(Object.keys(command.args?.properties ?? {})).toEqual(["name", "barcode", "unitType", "category"]);
  });

  it("the registry refuses a call without the required values, and a Unit Type that is not an option", () => {
    const registry = defineRegistry({
      commands: [itemSaveCommand(vi.fn()), storeSaveCommand(vi.fn()), identifyItemCommand(vi.fn())],
    });
    expect(registry.refuses(ITEM_SAVE, { name: "Milk" })).toMatch(/price/);
    expect(registry.refuses(ITEM_SAVE, { price: "3.49" })).toMatch(/name/);
    expect(registry.refuses(ITEM_SAVE, { name: "Milk", price: "3.49", unitType: "Dozen" })).toMatch(/unitType/);
    expect(registry.refuses(ITEM_SAVE, { name: "Milk", price: "3.49", unitType: "Per Pound" })).toBeUndefined();
    expect(registry.refuses(STORE_SAVE, { city: "Danbury" })).toMatch(/name/);
    expect(registry.refuses(STORE_SAVE, { name: "Stop & Shop" })).toBeUndefined();
    expect(registry.refuses(IDENTIFY_ITEM, {})).toMatch(/name/);
    expect(registry.refuses(IDENTIFY_ITEM, { name: "Bananas" })).toBeUndefined();
  });
});

describe("a command's run is the form's Save", () => {
  it("item-save calls onSubmit once with the values the ItemForm's Save passes", async () => {
    const bySave = { barcode: "94011", name: "Organic Bananas", currentPrice: 0.79, unitType: "per_lb", category: "Produce" };
    const spy = vi.fn();
    const registry = defineRegistry({ commands: [itemSaveCommand(spy)] });
    const ran = await registry.run(ITEM_SAVE, argsOf(ITEM_FORM, itemStrings(bySave)));
    expect(ran.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(bySave);
  });

  it("item-save leaves an empty optional field empty, as the form's Save does", async () => {
    const bySave = { barcode: "", name: "Milk", currentPrice: 3, unitType: "each", category: "" };
    const spy = vi.fn();
    const registry = defineRegistry({ commands: [itemSaveCommand(spy)] });
    await registry.run(ITEM_SAVE, argsOf(ITEM_FORM, itemStrings(bySave)));
    expect(spy).toHaveBeenCalledWith(bySave);
  });

  it("store-save calls onSubmit once with the values the StoreForm's Save passes", async () => {
    const bySave = { name: "Stop & Shop", city: "Danbury", state: "CT", notes: "Open late" };
    const spy = vi.fn();
    const registry = defineRegistry({ commands: [storeSaveCommand(spy)] });
    const ran = await registry.run(STORE_SAVE, argsOf(STORE_FORM, storeStrings(bySave)));
    expect(ran.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(bySave);
  });

  it("identify-item gives the page's save the values the modal's Save passes, and says why when the save refuses", async () => {
    const values = { name: "Organic Coleslaw", barcode: "00558242", unitType: "per_lb", category: "Produce" };
    const save = vi.fn(async () => null);
    const registry = defineRegistry({ commands: [identifyItemCommand(save)] });
    const ran = await registry.run(IDENTIFY_ITEM, argsOf(IDENTIFY_FORM, identifyStrings(values)));
    expect(ran.ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(values);

    const refusing = defineRegistry({
      commands: [identifyItemCommand(async () => 'Barcode already used by "Coleslaw".')],
    });
    const refused = await refusing.run(IDENTIFY_ITEM, { name: "x" });
    expect(refused).toEqual({ ok: false, why: expect.stringContaining("Barcode already used") });
  });

  it("item-save refuses a price that is not a number", async () => {
    const spy = vi.fn();
    const registry = defineRegistry({ commands: [itemSaveCommand(spy)] });
    const ran = await registry.run(ITEM_SAVE, { name: "Milk", price: "cheap" });
    expect(ran.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
