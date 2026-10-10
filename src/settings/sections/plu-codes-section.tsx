import { pluSeedData } from "@/db/plu-seed-data";
import { SeedListCard } from "../seed-list-card";
import type { SeedList } from "../seed-lists";

const PLU_CODES: SeedList = {
  id: "plu-codes",
  title: "Produce PLU Codes",
  items: pluSeedData,
};

export function PluCodesSection() {
  return (
    <SeedListCard
      list={PLU_CODES}
      buttonLabel="Load PLU Codes"
      description="Load ~120 common fruit and vegetable PLU codes (including organics) with approximate Trader Joe's prices. Existing items won't be overwritten."
    />
  );
}
