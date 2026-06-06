import { render, screen } from "@testing-library/react";
import { SubtotalBar } from "./subtotal-bar";

function renderBar(subtotal: number, budget?: number) {
  const { container } = render(
    <SubtotalBar subtotal={subtotal} itemCount={1} budget={budget} onEndTrip={() => {}} />,
  );
  // The outermost fixed bar carries the state background color.
  return container.firstElementChild as HTMLElement;
}

describe("SubtotalBar budget states", () => {
  it("is green when well under budget", () => {
    expect(renderBar(50, 200).className).toContain("bg-green-600");
  });

  it("turns yellow as spending approaches the budget (>= 90%)", () => {
    expect(renderBar(180, 200).className).toContain("bg-yellow-500");
    expect(renderBar(199.59, 200).className).toContain("bg-yellow-500");
  });

  it("turns red when over budget", () => {
    expect(renderBar(210, 200).className).toContain("bg-red-600");
  });

  it("stays green just below the near-budget threshold", () => {
    expect(renderBar(179, 200).className).toContain("bg-green-600");
  });

  it("is green when no budget is set", () => {
    expect(renderBar(500).className).toContain("bg-green-600");
  });

  it("shows over-budget label and remaining amount", () => {
    renderBar(210, 200);
    expect(screen.getByText(/Over budget by/)).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
  });
});
