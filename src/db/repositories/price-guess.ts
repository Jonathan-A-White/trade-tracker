import { db } from "../database";
import type { Item } from "../../contracts/types";

/**
 * The best guess from what the shopper already paid, for a line whose price is not known: the
 * item's own last price at this store, else its stored price, else its last price anywhere; null
 * when there is none. A price of 0 is unknown, never a price. A guess is never written to the item.
 */
export async function pastPriceGuess(
  item: Pick<Item, "id" | "currentPrice">,
  storeId: string | undefined,
  storeName: string | undefined,
): Promise<{ price: number; basis: string } | null> {
  const history = (await db.priceHistory.where("itemId").equals(item.id).toArray())
    .filter((entry) => entry.price > 0)
    .sort((a, b) => b.recordedAt - a.recordedAt);
  const here = storeId ? history.find((entry) => entry.storeId === storeId) : undefined;
  if (here) {
    return {
      price: here.price,
      basis: `Last price here${storeName ? ` at ${storeName}` : ""}.`,
    };
  }
  if (item.currentPrice > 0) {
    return { price: item.currentPrice, basis: "Last price you paid." };
  }
  if (history[0]) return { price: history[0].price, basis: "Last price you paid." };
  return null;
}
