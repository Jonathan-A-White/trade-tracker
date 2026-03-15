import type { CreateItemInput } from "../contracts/types";

/**
 * Items parsed from a Trader Joe's receipt (Danbury, CT - Store #525).
 * Date: 03/14/2026
 *
 * Barcodes sourced from Open Food Facts where available.
 * Items with "TJR" prefix barcodes are placeholders — scan the actual
 * product to update the barcode in the item library.
 */
export const tjReceiptSeedData: CreateItemInput[] = [
  // ── Meat ────────────────────────────────────────────────
  { barcode: "00508271", name: "Shaved Steak", currentPrice: 11.34, unitType: "per_lb", category: "Meat" },
  { barcode: "TJR00002", name: "Sliced Turkey Dark Meat", currentPrice: 5.49, unitType: "each", category: "Meat" },
  { barcode: "TJR00003", name: "Black Forest Meat Sourdough Sandwich", currentPrice: 2.49, unitType: "each", category: "Deli" },

  // ── Poultry & Prepared Chicken ──────────────────────────
  { barcode: "00665636", name: "Mandarin Orange Chicken", currentPrice: 5.49, unitType: "each", category: "Frozen" },
  { barcode: "TJR00005", name: "Organic Cremini Orange Chicken", currentPrice: 3.79, unitType: "each", category: "Frozen" },
  { barcode: "TJR00006", name: "Premium Chunk White Chicken", currentPrice: 3.99, unitType: "each", category: "Canned" },
  { barcode: "TJR00007", name: "Premium Chunk White Chicken (2 LB)", currentPrice: 3.99, unitType: "each", category: "Canned" },
  { barcode: "TJR00008", name: "Fresh Cut Chicken Breast (3 LB)", currentPrice: 2.99, unitType: "per_lb", category: "Meat" },
  { barcode: "TJR00009", name: "Mozzarella Chicken Sausage", currentPrice: 3.99, unitType: "each", category: "Meat" },
  { barcode: "TJR00010", name: "Loaded Turkey Cheese", currentPrice: 5.49, unitType: "each", category: "Deli" },
  { barcode: "TJR00011", name: "Chicken Sausage", currentPrice: 5.49, unitType: "each", category: "Meat" },

  // ── Dairy & Cheese ──────────────────────────────────────
  { barcode: "TJR00012", name: "Shredded Mozzarella", currentPrice: 4.99, unitType: "each", category: "Dairy" },
  { barcode: "TJR00013", name: "Sliced Pepper Jack Cheese", currentPrice: 3.99, unitType: "each", category: "Dairy" },
  { barcode: "TJR00014", name: "Crustless Pepper Jack", currentPrice: 4.49, unitType: "each", category: "Dairy" },

  // ── Produce ─────────────────────────────────────────────
  { barcode: "TJR00015", name: "Mixed Mini Peppers", currentPrice: 3.49, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00016", name: "Fire Roasted Diced Green Chiles", currentPrice: 1.49, unitType: "each", category: "Canned" },
  { barcode: "TJR00017", name: "Cut Brussels Sprouts", currentPrice: 2.49, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00018", name: "Shaved Brussels Sprouts (10 oz)", currentPrice: 3.49, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00019", name: "Carrots Many Colors (0.68 lb)", currentPrice: 2.99, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00020", name: "Celery Hearts (2 ct)", currentPrice: 2.99, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00021", name: "Organic Strawberries (2 ct)", currentPrice: 5.49, unitType: "each", category: "Fruits" },
  { barcode: "TJR00022", name: "Green Onions (6 ct)", currentPrice: 4.49, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00023", name: "Green Beans Tender", currentPrice: 4.49, unitType: "each", category: "Vegetables" },
  { barcode: "TJR00024", name: "Apple Red/Green Grapes (2 LB)", currentPrice: 3.99, unitType: "each", category: "Fruits" },
  { barcode: "TJR00025", name: "Cucumber", currentPrice: 3.49, unitType: "each", category: "Vegetables" },

  // ── Frozen ──────────────────────────────────────────────
  { barcode: "TJR00026", name: "Boneless Skinless Cream Mint", currentPrice: 3.49, unitType: "each", category: "Frozen" },
  { barcode: "TJR00027", name: "Brazilian Style Chocolate", currentPrice: 0.79, unitType: "each", category: "Frozen" },
  { barcode: "TJR00028", name: "Brazilian Waffles", currentPrice: 3.99, unitType: "each", category: "Frozen" },

  // ── Soup & Broth ────────────────────────────────────────
  { barcode: "TJR00029", name: "Lime Roasted Tomato Soup", currentPrice: 3.79, unitType: "each", category: "Soup" },
  { barcode: "TJR00030", name: "Miso Ginger Broth", currentPrice: 4.98, unitType: "each", category: "Soup" },
  { barcode: "TJR00031", name: "Ginger Butter Onion Soup", currentPrice: 4.49, unitType: "each", category: "Soup" },

  // ── Beverages ───────────────────────────────────────────
  { barcode: "TJR00032", name: "Organic Pomegranate Juice", currentPrice: 1.29, unitType: "each", category: "Beverages" },

  // ── Snacks & Sweets ─────────────────────────────────────
  { barcode: "TJR00033", name: "Midnight Moon Chocolate Cookies", currentPrice: 4.99, unitType: "each", category: "Snacks" },
  { barcode: "TJR00034", name: "Blueberry Sandwich Pie", currentPrice: 3.99, unitType: "each", category: "Snacks" },

  // ── Dips & Spreads ──────────────────────────────────────
  { barcode: "TJR00035", name: "Guacamole", currentPrice: 5.99, unitType: "each", category: "Dips" },

  // ── Salads & Prepared ───────────────────────────────────
  { barcode: "TJR00036", name: "Salad Complete with Artichokes", currentPrice: 3.99, unitType: "each", category: "Deli" },
  { barcode: "TJR00037", name: "Salad Avocado", currentPrice: 5.49, unitType: "each", category: "Deli" },
  { barcode: "TJR00038", name: "Garlic Artichokes", currentPrice: 3.99, unitType: "each", category: "Canned" },
  { barcode: "TJR00039", name: "Onion Basil", currentPrice: 3.49, unitType: "each", category: "Deli" },

  // ── Other ───────────────────────────────────────────────
  { barcode: "TJR00040", name: "Organic Coconut", currentPrice: 4.49, unitType: "each", category: "Snacks" },
  { barcode: "TJR00041", name: "Bread in Glass Vase", currentPrice: 1.98, unitType: "each", category: "Bakery" },
];
