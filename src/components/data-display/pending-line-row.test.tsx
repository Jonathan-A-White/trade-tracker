import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingLineRow } from "./pending-line-row";
import type { PendingLookup } from "@/contracts/types";

function lookup(status: PendingLookup["status"] = "waiting-to-send"): PendingLookup {
  return {
    id: "l1",
    barcode: "0099887766",
    tripId: "t1",
    itemId: "pending:l1",
    photos: [],
    status,
    createdAt: 1,
  };
}

describe("PendingLineRow quantity", () => {
  it("shows the quantity with - and + buttons", () => {
    render(<PendingLineRow lookup={lookup()} quantity={2} onQuantityChange={() => {}} />);
    expect(screen.getByTestId("pending-quantity")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeEnabled();
  });

  it("+ asks for one more and - for one less", async () => {
    const user = userEvent.setup();
    const onQuantityChange = vi.fn();
    render(
      <PendingLineRow lookup={lookup()} quantity={2} onQuantityChange={onQuantityChange} />,
    );

    await user.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(onQuantityChange).toHaveBeenLastCalledWith("l1", 3);
    await user.click(screen.getByRole("button", { name: "Decrease quantity" }));
    expect(onQuantityChange).toHaveBeenLastCalledWith("l1", 1);
  });

  it("- is disabled at 1", () => {
    render(<PendingLineRow lookup={lookup()} quantity={1} onQuantityChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
  });

  it("is available while the line is at the factory", () => {
    render(
      <PendingLineRow lookup={lookup("at-the-factory")} quantity={1} onQuantityChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeInTheDocument();
  });

  it("without a handler shows the quantity read-only", () => {
    render(<PendingLineRow lookup={lookup()} quantity={3} />);
    expect(screen.getByTestId("pending-quantity")).toHaveTextContent("3");
    expect(screen.queryByRole("button", { name: "Increase quantity" })).not.toBeInTheDocument();
  });
});
