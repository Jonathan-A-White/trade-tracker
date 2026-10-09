import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import AboutPage from "@/pages/about-page";
import { CREDITS, NEWTON_QUOTE } from "@/content/credits";

function renderAbout() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );
}

describe("credits list", () => {
  it("lists every credit in the README's Credits section", () => {
    const readme = readFileSync("./README.md", "utf-8");
    const section = readme.slice(readme.indexOf("\n## Credits"));
    for (const c of CREDITS) {
      expect(section).toContain(`[${c.name}](${c.url})`);
      expect(section).toContain(`[${c.licence}](${c.licenceUrl})`);
    }
  });

  it("gives every credit a name, use, link, licence link and changes", () => {
    for (const c of CREDITS) {
      expect(c.name).not.toBe("");
      expect(c.use).not.toBe("");
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.licence).not.toBe("");
      expect(c.licenceUrl).toMatch(/^https:\/\//);
      expect(c.changes).not.toBe("");
    }
  });
});

describe("AboutPage", () => {
  it("opens with Newton's line, attributed, before the credits", () => {
    renderAbout();
    const quote = screen.getByText(/standing on the shoulders of Giants/);
    expect(quote).toHaveTextContent(NEWTON_QUOTE.text);
    expect(screen.getByText(/Isaac Newton, letter to Robert Hooke, 1675/)).toBeInTheDocument();
    const firstCredit = screen.getByRole("link", { name: CREDITS[0].name });
    expect(
      quote.compareDocumentPosition(firstCredit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists each credit with its name as link text, licence link and changes", () => {
    renderAbout();
    for (const c of CREDITS) {
      const link = screen.getByRole("link", { name: c.name });
      expect(link).toHaveAttribute("href", c.url);
      const item = link.closest("li");
      expect(item).not.toBeNull();
      const licence = within(item as HTMLElement).getByRole("link", { name: c.licence });
      expect(licence).toHaveAttribute("href", c.licenceUrl);
      expect(item).toHaveTextContent(c.changes);
    }
  });

  it("never shows a raw URL as link text", () => {
    renderAbout();
    for (const a of screen.getAllByRole("link")) {
      expect(a.textContent).not.toMatch(/https?:\/\//);
    }
  });
});
