import { tjBarcodeSeedData } from "@/db/tj-barcode-seed-data";
import { SeedListCard } from "../seed-list-card";
import type { SeedList } from "../seed-lists";

const TJ_BARCODES: SeedList = {
  id: "tj-barcodes",
  title: "Trader Joe's Barcodes",
  items: tjBarcodeSeedData,
};

export function TjBarcodesSection() {
  return (
    <SeedListCard
      list={TJ_BARCODES}
      buttonLabel="Load TJ Barcodes"
      description="Load ~30 popular Trader Joe's product barcodes (frozen, dairy, snacks, dips, and more) with approximate prices. Existing items won't be overwritten."
    />
  );
}
