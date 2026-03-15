import type { CreateItemInput } from "../contracts/types";

/**
 * Popular Trader Joe's private-label product barcodes.
 * Barcodes sourced from Open Food Facts (world.openfoodfacts.org).
 * Prices are approximate and based on typical TJ's pricing.
 */
export const tjBarcodeSeedData: CreateItemInput[] = [
  // ── Frozen ────────────────────────────────────────────
  { barcode: "00615242", name: "Cauliflower Gnocchi", currentPrice: 3.49, unitType: "each", category: "Frozen" },
  { barcode: "00665636", name: "Mandarin Orange Chicken", currentPrice: 5.99, unitType: "each", category: "Frozen" },
  { barcode: "00969697", name: "Hash Browns", currentPrice: 2.49, unitType: "each", category: "Frozen" },
  { barcode: "00185226", name: "Premium Salmon Burgers", currentPrice: 5.49, unitType: "each", category: "Frozen" },
  { barcode: "00430203", name: "Just Chicken", currentPrice: 4.49, unitType: "each", category: "Frozen" },

  // ── Dairy & Eggs ──────────────────────────────────────
  { barcode: "00905886", name: "European Style Organic Plain Yogurt (32oz)", currentPrice: 4.49, unitType: "each", category: "Dairy" },
  { barcode: "00542326", name: "Organic Plain Whole Milk Yogurt (16oz)", currentPrice: 2.99, unitType: "each", category: "Dairy" },
  { barcode: "00770095", name: "Organic Whole Milk Yogurt French Vanilla (32oz)", currentPrice: 4.99, unitType: "each", category: "Dairy" },
  { barcode: "00905893", name: "European Style Organic Nonfat Yogurt (32oz)", currentPrice: 4.49, unitType: "each", category: "Dairy" },
  { barcode: "00643139", name: "Organic Creamy Cashew Yogurt", currentPrice: 1.49, unitType: "each", category: "Dairy" },
  { barcode: "00414340", name: "Organic Lowfat Yogurt", currentPrice: 1.29, unitType: "each", category: "Dairy" },
  { barcode: "00777674", name: "Sliced Yogurt Cultured Cheese", currentPrice: 3.99, unitType: "each", category: "Dairy" },
  { barcode: "00560825", name: "Organic Butter, Unsalted (1 lb)", currentPrice: 4.99, unitType: "each", category: "Dairy" },

  // ── Dips & Spreads ────────────────────────────────────
  { barcode: "00204118", name: "Hummus Dip (16oz)", currentPrice: 3.49, unitType: "each", category: "Dips" },
  { barcode: "00906425", name: "Mediterranean Style Hummus (16oz)", currentPrice: 3.99, unitType: "each", category: "Dips" },
  { barcode: "00764728", name: "Roasted Red Pepper Hummus (10oz)", currentPrice: 2.99, unitType: "each", category: "Dips" },
  { barcode: "00592482", name: "Organic Hummus (8oz)", currentPrice: 2.99, unitType: "each", category: "Dips" },
  { barcode: "00380560", name: "Spicy Hummus Dip (7oz)", currentPrice: 2.49, unitType: "each", category: "Dips" },
  { barcode: "00561228", name: "Sriracha Hummus", currentPrice: 2.99, unitType: "each", category: "Dips" },
  { barcode: "00935937", name: "Cilantro and Jalapeno Hummus (10oz)", currentPrice: 2.99, unitType: "each", category: "Dips" },
  { barcode: "00799010", name: "Olive Tapenade Hummus (10oz)", currentPrice: 3.49, unitType: "each", category: "Dips" },

  // ── Sauces & Condiments ───────────────────────────────
  { barcode: "00014977", name: "Salsa Verde (12oz)", currentPrice: 2.99, unitType: "each", category: "Sauces" },
  { barcode: "00187572", name: "Seafood Cocktail Sauce", currentPrice: 2.49, unitType: "each", category: "Sauces" },

  // ── Spices & Seasonings ───────────────────────────────
  { barcode: "00591379", name: "Everything But the Bagel Sesame Seasoning", currentPrice: 2.49, unitType: "each", category: "Spices" },
  { barcode: "00684972", name: "Organic Cumin Seed", currentPrice: 2.49, unitType: "each", category: "Spices" },

  // ── Snacks & Sweets ───────────────────────────────────
  { barcode: "00368254", name: "Rainbow's End Trail Mix (16oz)", currentPrice: 5.99, unitType: "each", category: "Snacks" },
  { barcode: "00756303", name: "Enchanted Jangle", currentPrice: 4.99, unitType: "each", category: "Snacks" },
  { barcode: "00792127", name: "Dark Chocolate Covered Caramels", currentPrice: 3.99, unitType: "each", category: "Snacks" },
  { barcode: "00826020", name: "Cocoa Truffles with Maple Sugar", currentPrice: 4.49, unitType: "each", category: "Snacks" },
  { barcode: "00644716", name: "Oatmeal Cookies (14oz)", currentPrice: 3.99, unitType: "each", category: "Snacks" },

  // ── Meat ──────────────────────────────────────────────
  { barcode: "00263665", name: "Ground Beef (16oz)", currentPrice: 6.99, unitType: "each", category: "Meat" },
];
