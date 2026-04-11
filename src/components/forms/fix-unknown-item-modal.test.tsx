import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixUnknownItemModal } from "./fix-unknown-item-modal";
import { db } from "@/db/database";

describe("FixUnknownItemModal", () => {
  it("shows an inline error and stays open when the barcode is already used by another item", async () => {
    // Seed a pre-existing item that already owns the barcode the user will try to add.
    await db.items.put({
      id: "other-item",
      name: "Existing Coleslaw",
      barcode: "00558242",
      currentPrice: 1.99,
      unitType: "each",
      createdAt: 0,
      updatedAt: 0,
    });

    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <FixUnknownItemModal
        itemId="target-item"
        currentPrice={2.49}
        existingName="Organic coleslaw mix"
        existingBarcode="manual-abc"
        existingUnitType="each"
        existingCategory="Produce"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    const user = userEvent.setup();
    const barcodeInput = screen.getByPlaceholderText(/scan or enter barcode/i);
    await user.type(barcodeInput, "00558242");
    await user.click(screen.getByRole("button", { name: /save/i }));

    // The modal must surface a clear error rather than hanging silently.
    await waitFor(() => {
      expect(
        screen.getByText(/already used by "Existing Coleslaw"/i),
      ).toBeInTheDocument();
    });

    // onSave must not have been invoked — the pre-check blocked it.
    expect(onSave).not.toHaveBeenCalled();

    // The Save button is re-enabled so the user can correct the input.
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("awaits onSave and shows a thrown error instead of leaving the modal stuck", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    const onCancel = vi.fn();

    render(
      <FixUnknownItemModal
        itemId="target-item"
        currentPrice={2.49}
        existingName="Organic coleslaw mix"
        existingBarcode="manual-abc"
        existingUnitType="each"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("calls onSave and does not error when the barcode is unique", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <FixUnknownItemModal
        itemId="target-item"
        currentPrice={2.49}
        existingName="Organic coleslaw mix"
        existingBarcode="manual-abc"
        existingUnitType="each"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/scan or enter barcode/i),
      "99887766",
    );
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "target-item",
        name: "Organic coleslaw mix",
        barcode: "99887766",
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
