import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { licence } from "bsv-kit/bsv";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { FamilyRepository } from "@/db/repositories/family-repository";
import SettingsPage from "@/pages/settings-page";
import type { PasskeyPort } from "@/services/passkey";
import { ALERT_POLL_MS } from "@/family/alerts-client";
import { fakeAlerts } from "@/family/fake-alerts";
import type { FakeAlerts } from "@/family/fake-alerts";
import { setFamilyOn, setYnabOn } from "../connections";

const checkedAt = "2026-10-30T00:00:00.000Z";
const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};
const none: licence.LicenceStatus = { state: "none", checkedAt };

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

const ADDRESS = "abcdefg234567@alerts.example.test";

function renderSettings(status: licence.LicenceStatus = held) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={async () => status} passkeyPort={noWebAuthn}>
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function family(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-setting="family"]') as HTMLElement;
}

async function makeKeyAndTurnOn(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.click(screen.getByRole("button", { name: "Make key" }));
  await screen.findByText("Held");
  await user.click(within(family(container)).getByRole("switch", { name: "Family alerts" }));
}

describe("Settings > Family", () => {
  let backend: FakeAlerts;
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    backend = fakeAlerts(ADDRESS);
    vi.stubGlobal("fetch", backend.fetch);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("Off draws only its one switch: no address, recipe, cards or people, and asks the backend nothing", async () => {
    const { container } = renderSettings();
    const row = family(container);
    const toggle = await within(row).findByRole("switch", { name: "Family alerts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(within(row).queryByText(ADDRESS)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Gmail/)).not.toBeInTheDocument();
    expect(within(row).queryByText("My cards")).not.toBeInTheDocument();
    expect(within(row).queryByText("People")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Copy/ })).not.toBeInTheDocument();
    expect(backend.requests).toEqual([]);
  });

  it("with no key, turning it on says to make the key first and stays Off", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    await user.click(await within(family(container)).findByRole("switch", { name: "Family alerts" }));
    expect(within(family(container)).getByText(/Make the key under/)).toBeInTheDocument();
    expect(within(family(container)).getByRole("switch", { name: "Family alerts" })).toHaveAttribute("aria-checked", "false");
    expect(backend.requests).toEqual([]);
  });

  it("On shows the address from POST /api/alerts/address with Copy, and the recipe in five lines", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    await makeKeyAndTurnOn(user, container);
    const row = family(container);

    expect(await within(row).findByText(ADDRESS)).toBeInTheDocument();
    expect(backend.requests.some((r) => r.method === "POST" && r.path === "/api/alerts/address")).toBe(true);
    expect(within(row).getByRole("switch", { name: "Family alerts" })).toHaveAttribute("aria-checked", "true");

    const recipe = within(row).getByRole("list", { name: "Gmail filter recipe" });
    expect(within(recipe).getAllByRole("listitem")).toHaveLength(5);
    expect(recipe).toHaveTextContent("Filters and Blocked Addresses");
    expect(recipe).toHaveTextContent("Chase and Citi");

    await user.click(within(row).getByRole("button", { name: "Copy address" }));
    expect(await navigator.clipboard.readText()).toBe(ADDRESS);
  });

  it("waits for Gmail's confirmation, then shows the code with Copy when the forward-confirm alert arrives", async () => {
    // only the poll's interval is a fake clock; the door's timeouts and the user's typing run on real ones
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const user = userEvent.setup();
    const { container } = renderSettings();
    await makeKeyAndTurnOn(user, container);
    const row = family(container);
    expect(await within(row).findByText("Waiting for Gmail's confirmation")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();

    backend.receive({ kind: "charge", amount: "9.99", merchant: "Somewhere", last4: "1234" });
    backend.receive({ kind: "forward-confirm", code: "493827" });
    await vi.advanceTimersByTimeAsync(ALERT_POLL_MS);

    expect(await within(row).findByText("493827")).toBeInTheDocument();
    expect(within(row).queryByText("Waiting for Gmail's confirmation")).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Copy code" }));
    expect(await navigator.clipboard.readText()).toBe("493827");
    // reading the feed claims nothing: the other phones see the code too
    expect(backend.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(backend.feed).toHaveLength(2);
  });

  it("shows the code at once when the feed already holds a forward-confirm alert", async () => {
    backend.receive({ kind: "forward-confirm", code: "112233" });
    const user = userEvent.setup();
    const { container } = renderSettings();
    await makeKeyAndTurnOn(user, container);
    expect(await within(family(container)).findByText("112233")).toBeInTheDocument();
    expect(within(family(container)).getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });

  it("stays On after a reload; with the key locked it still shows the cards and says to unlock for the address", async () => {
    await setFamilyOn(true);
    await new FamilyRepository().addCard({ lastFour: "1234", owner: "Jonathan" });
    const { container } = renderSettings(none);
    const row = family(container);
    expect(await within(row).findByText("Jonathan")).toBeInTheDocument();
    expect(row).toHaveTextContent(/under Factory to see the address and Gmail's confirmation/);
    expect(within(row).getByRole("link", { name: "Factory" })).toBeInTheDocument();
    expect(within(row).getByRole("switch", { name: "Family alerts" })).toHaveAttribute("aria-checked", "true");
    expect(backend.requests).toEqual([]);
  });

  it("turning it Off draws nothing again but keeps the cards", async () => {
    await setFamilyOn(true);
    await new FamilyRepository().addCard({ lastFour: "1234", owner: "Jonathan" });
    const user = userEvent.setup();
    const { container } = renderSettings(none);
    const row = family(container);
    await user.click(await within(row).findByRole("switch", { name: "Family alerts" }));
    await waitFor(() => expect(within(row).queryByText("My cards")).not.toBeInTheDocument());
    expect(await db.familyCards.count()).toBe(1);
  });

  describe("My cards", () => {
    async function openCards() {
      await setFamilyOn(true);
      const user = userEvent.setup();
      const rendered = renderSettings(none);
      const row = family(rendered.container);
      await within(row).findByRole("heading", { name: "My cards" });
      return { user, row };
    }

    it("adds a card by its last four and whose it is, lists it, and removes it", async () => {
      const { user, row } = await openCards();
      await user.type(within(row).getByLabelText("Last four"), "1234");
      await user.type(within(row).getByLabelText("Whose card"), "Jonathan");
      await user.click(within(row).getByRole("button", { name: "Add card" }));

      const list = await within(row).findByRole("list", { name: "Cards" });
      expect(within(list).getByText("Jonathan")).toBeInTheDocument();
      expect(within(list).getByText(/1234/)).toBeInTheDocument();
      expect(within(row).getByLabelText("Last four")).toHaveValue("");
      expect((await new FamilyRepository().listCards()).map((c) => [c.lastFour, c.owner])).toEqual([["1234", "Jonathan"]]);

      await user.click(within(list).getByRole("button", { name: "Remove card 1234" }));
      await waitFor(() => expect(within(row).queryByRole("list", { name: "Cards" })).not.toBeInTheDocument());
      expect(await db.familyCards.count()).toBe(0);
    });

    it("says what is wrong with a last four that is not four digits", async () => {
      const { user, row } = await openCards();
      await user.type(within(row).getByLabelText("Last four"), "12");
      await user.type(within(row).getByLabelText("Whose card"), "Jonathan");
      await user.click(within(row).getByRole("button", { name: "Add card" }));
      expect(await within(row).findByText("The last four is four digits.")).toBeInTheDocument();
      expect(await db.familyCards.count()).toBe(0);
    });

    it("offers no account to map to while YNAB is Off", async () => {
      const { row } = await openCards();
      expect(within(row).queryByLabelText("YNAB account")).not.toBeInTheDocument();
    });

    it("maps a card to one of YNAB's cached accounts when YNAB is On", async () => {
      await db.ynabAccounts.bulkPut([
        { id: "a-chase", name: "Chase Freedom", type: "creditCard", onBudget: true, closed: false },
        { id: "a-old", name: "Old Card", type: "creditCard", onBudget: true, closed: true },
        { id: "a-chk", name: "Checking", type: "checking", onBudget: true, closed: false },
      ]);
      await setYnabOn(true);
      const { user, row } = await openCards();
      const select = await within(row).findByLabelText("YNAB account");
      // closed accounts are not offered; the rest by name
      expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["No account", "Chase Freedom", "Checking"]);

      await user.type(within(row).getByLabelText("Last four"), "1234");
      await user.type(within(row).getByLabelText("Whose card"), "Jonathan");
      await user.selectOptions(select, "Chase Freedom");
      await user.click(within(row).getByRole("button", { name: "Add card" }));

      const list = await within(row).findByRole("list", { name: "Cards" });
      expect(within(list).getByText("Chase Freedom")).toBeInTheDocument();
      expect((await new FamilyRepository().listCards())[0]).toMatchObject({ lastFour: "1234", owner: "Jonathan", accountId: "a-chase" });
    });
  });

  it("People lists this phone's key", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();
    await makeKeyAndTurnOn(user, container);
    const row = family(container);
    const people = await within(row).findByRole("heading", { name: "People" });
    expect(people).toBeInTheDocument();
    expect(within(row).getByText("This phone")).toBeInTheDocument();
  });

  it("says in plain words when the backend refuses, and stays Off", async () => {
    backend.refuse = { status: 501 };
    const user = userEvent.setup();
    const { container } = renderSettings();
    await makeKeyAndTurnOn(user, container);
    expect(await within(family(container)).findByText("This backend does not keep alerts yet.")).toBeInTheDocument();
    expect(within(family(container)).getByRole("switch", { name: "Family alerts" })).toHaveAttribute("aria-checked", "false");
  });
});
