import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineEditor } from "./inline-editor";

describe("InlineEditor", () => {
  it("keeps a fractional value typed in a decimal editor, in steps of 0.01", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<InlineEditor label="Weight (lb)" value={1} onSave={onSave} onCancel={() => {}} inputType="decimal" />);

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("step", "0.01");
    await user.clear(input);
    await user.type(input, "2.03");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(2.03);
  });

  it("keeps whole numbers in an integer editor", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<InlineEditor label="Qty" value={1} onSave={onSave} onCancel={() => {}} inputType="integer" />);

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(3);
  });
});
