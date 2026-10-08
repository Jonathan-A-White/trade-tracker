import { applyUpdate, useUpdateState } from "@/services/app-update";

/** 'Update ready, tap to reload' above the content while a newer build waits; the tap goes dead and says 'Updating…' until the page reloads. */
export function UpdateBanner() {
  const state = useUpdateState();
  if (state === "none") return null;
  const updating = state === "updating";
  return (
    <button
      type="button"
      onClick={applyUpdate}
      disabled={updating}
      className="flex w-full items-center justify-center bg-blue-600 px-3 py-3 text-base font-medium text-white disabled:opacity-70"
    >
      {updating ? "Updating…" : "Update ready, tap to reload"}
    </button>
  );
}
