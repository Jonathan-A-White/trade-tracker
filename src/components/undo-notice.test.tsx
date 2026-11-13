import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UndoNotice } from "./undo-notice";

describe("UndoNotice", () => {
  it("says what happened with an Undo that calls onUndo", async () => {
    const onUndo = vi.fn();
    render(<UndoNotice onUndo={onUndo}>Removed Milk.</UndoNotice>);

    expect(screen.getByText("Removed Milk.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("has no Undo when nothing is kept, and a disabled one while busy", () => {
    const { rerender } = render(<UndoNotice>Done.</UndoNotice>);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();

    rerender(<UndoNotice onUndo={() => {}} disabled>Done.</UndoNotice>);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
