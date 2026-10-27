import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { appRoutes } from "@/routes";

vi.mock("@/pages/home-page", () => ({
  HomePage: () => {
    throw new Error("kaboom");
  },
}));

describe("route error page", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a friendly page, not the router's developer page, when a screen throws", async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go Home" })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/i)).not.toBeInTheDocument();
  });

  it("keeps the bottom nav when only the screen fails", async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    await screen.findByText("Something went wrong");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("puts an errorElement on the shell route and on the screens inside it", () => {
    const shell = appRoutes[0];
    expect(shell.errorElement).toBeTruthy();
    expect(shell.children?.length).toBe(1);
    expect(shell.children?.[0].errorElement).toBeTruthy();
  });
});
