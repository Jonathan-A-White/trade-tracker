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

describe("PendingLineRow when the factory did not send an answer back", () => {
  function notBack(): PendingLookup {
    return { ...lookup("at-the-factory"), gristTxid: "direct:x", notBack: true };
  }

  it("says plainly that it did not come back, not 'Waiting on the factory'", () => {
    render(<PendingLineRow lookup={notBack()} onRetry={() => {}} onFillByHand={() => {}} />);
    expect(screen.getByText("The factory did not send this back")).toBeInTheDocument();
    expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
  });

  it("offers Try again beside Fill by hand and Discard, and Try again asks for the lookup again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <PendingLineRow
        lookup={notBack()}
        onRetry={onRetry}
        onFillByHand={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Fill by hand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith("l1");
  });

  it("a lookup still waiting has no Try again", () => {
    render(<PendingLineRow lookup={lookup("at-the-factory")} onRetry={() => {}} />);
    expect(screen.getByText("Waiting on the factory")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
