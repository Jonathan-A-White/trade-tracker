import { useNavigate } from "react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StoreForm } from "@/components/forms/store-form";
import { StoreRepository } from "@/db/repositories/store-repository";

export function NewStorePage() {
  const navigate = useNavigate();
  const storeRepo = new StoreRepository();

  async function handleSubmit(values: { name: string; city: string; state: string; notes: string }) {
    await storeRepo.create({
      name: values.name,
      city: values.city || undefined,
      state: values.state || undefined,
      notes: values.notes || undefined,
    });
    navigate("/stores");
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="New Store" backTo="/stores" />
      <div className="flex-1 px-4 py-4">
        <StoreForm
          onSubmit={handleSubmit}
          onCancel={() => navigate("/stores")}
        />
      </div>
    </div>
  );
}
