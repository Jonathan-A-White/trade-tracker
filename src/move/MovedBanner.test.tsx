import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MovedBanner } from "./MovedBanner";

describe("MovedBanner", () => {
  it("says where the app has moved to when the build names the new address", () => {
    render(<MovedBanner movedTo="https://trade.allmymind.org" onPackUp={() => {}} />);
    expect(
      screen.getByText("Trade Tracker has moved to trade.allmymind.org. Pack up this phone, then open the new address."),
    ).toBeInTheDocument();
  });

  it("is absent when the build names no new address", () => {
    const { container } = render(<MovedBanner movedTo={undefined} onPackUp={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is absent when the address is empty or is not an https URL", () => {
    for (const bad of ["", "trade.allmymind.org", "http://trade.allmymind.org"]) {
      const { container, unmount } = render(<MovedBanner movedTo={bad} onPackUp={() => {}} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("opens Settings > Move from a 44 px Pack up", async () => {
    const onPackUp = vi.fn();
    render(<MovedBanner movedTo="https://trade.allmymind.org" onPackUp={onPackUp} />);
    const button = screen.getByRole("button", { name: "Pack up" });
    expect(button).toHaveClass("min-h-[44px]");
    await userEvent.click(button);
    expect(onPackUp).toHaveBeenCalledTimes(1);
  });

  it("hides on Later, and is back at the next launch", async () => {
    const { unmount } = render(<MovedBanner movedTo="https://trade.allmymind.org" onPackUp={() => {}} />);
    const later = screen.getByRole("button", { name: "Later" });
    expect(later).toHaveClass("min-h-[44px]");
    await userEvent.click(later);
    expect(screen.queryByText(/has moved to/)).not.toBeInTheDocument();
    unmount();
    render(<MovedBanner movedTo="https://trade.allmymind.org" onPackUp={() => {}} />);
    expect(screen.getByText(/has moved to trade.allmymind.org/)).toBeInTheDocument();
  });
});
