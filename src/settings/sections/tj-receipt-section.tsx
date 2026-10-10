import { tjReceiptSeedData } from "@/db/tj-receipt-seed-data";
import { SeedListCard } from "../seed-list-card";
import type { SeedList } from "../seed-lists";

const TJ_RECEIPT: SeedList = {
  id: "tj-receipt",
  title: "TJ's Receipt (03/14/2026)",
  items: tjReceiptSeedData,
};

export function TjReceiptSection() {
  return (
    <SeedListCard
      list={TJ_RECEIPT}
      buttonLabel="Load Receipt Items"
      description="Load ~40 items from the Trader Joe's Danbury receipt (03/14/2026) with prices as purchased. Items with placeholder barcodes (TJR prefix) can be updated by scanning the actual product. Existing items won't be overwritten."
    />
  );
}
