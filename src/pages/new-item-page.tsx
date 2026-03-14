import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "@/components/layout/page-header";
import { ItemForm } from "@/components/forms/item-form";
import { ItemRepository } from "@/db/repositories/item-repository";
import type { UnitType } from "@/contracts/types";

export function NewItemPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const barcodeFromUrl = searchParams.get("barcode") ?? "";
  const itemRepo = new ItemRepository();

  async function handleSubmit(values: {
    barcode: string;
    name: string;
    currentPrice: number;
    unitType: string;
    category: string;
  }) {
    await itemRepo.create({
      barcode: values.barcode,
      name: values.name,
      currentPrice: values.currentPrice,
      unitType: values.unitType as UnitType,
      category: values.category || undefined,
    });
    navigate("/items");
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="New Item" backTo="/items" />
      <div className="flex-1 px-4 py-4">
        <ItemForm
          initialValues={
            barcodeFromUrl ? { barcode: barcodeFromUrl } : undefined
          }
          onSubmit={handleSubmit}
          onCancel={() => navigate("/items")}
        />
      </div>
    </div>
  );
}
