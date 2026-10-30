import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import SettingsPage from "@/pages/settings-page";
import type { PasskeyPort } from "@/services/passkey";
import { YNAB_TOKEN_KEY } from "@/ynab/token";
import { accountOf, fakeYnab, groupOf, payeeOf } from "@/ynab/fake-ynab";

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

const TOKEN = "good-token-123";

function budgets() {
  return [
    {
      id: "b1",
      name: "Our Budget",
      categoryGroups: [groupOf("g1", "Food", [["c1", "Groceries"]])],
      accounts: [accountOf("a1", "Checking")],
      payees: [payeeOf("p1", "Trader Joe's")],
    },
    {
      id: "b2",
      name: "Side Budget",
      categoryGroups: [groupOf("g9", "Fun", [["c9", "Movies"]])],
      accounts: [accountOf("a9", "Savings")],
      payees: [payeeOf("p9", "Cinema")],
    },
  ];
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FactoryProvider checkLicence={async () => ({ state: "none", checkedAt: "x" })} passkeyPort={noWebAuthn}>
          <SettingsPage />
        </FactoryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function turnOn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("switch", { name: "Connect YNAB" }));
}

describe("Settings > YNAB", () => {
  let ynab: ReturnType<typeof fakeYnab>;
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    ynab = fakeYnab(TOKEN, budgets());
    vi.stubGlobal("fetch", ynab.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("with no key yet, turning it on says to make the key first, and Check waits", async () => {
    const user = userEvent.setup();
    renderSettings();
    await turnOn(user);
    expect(screen.getByText(/Make the key under/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
    expect(ynab.calls).toEqual([]);
  });

  it("tells where to get a token, takes it, lists the budgets, and connects the chosen one", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText("Key unlocked for today.");
    await turnOn(user);
    expect(screen.getByText(/app\.ynab\.com > Account Settings > Developer Settings > New Token/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Personal Access Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Check" }));
    const list = await screen.findByRole("list", { name: "Your budgets" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Our Budget", "Side Budget"]);
    expect(ynab.calls.every((c) => c.authorization === `Bearer ${TOKEN}`)).toBe(true);

    await user.click(within(list).getByRole("button", { name: "Side Budget" }));
    expect(await screen.findByText("Connected as Side Budget")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Connect YNAB" })).toHaveAttribute("aria-checked", "true");

    const repo = new YnabRepository();
    expect((await repo.listCategories()).map((c) => c.name)).toEqual(["Movies"]);
    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(["Savings"]);
    expect((await repo.listPayees()).map((p) => p.name)).toEqual(["Cinema"]);

    // the token is sealed: nowhere in localStorage in the clear
    expect(localStorage.getItem(YNAB_TOKEN_KEY)).not.toBeNull();
    const everything = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(JSON.stringify(await db.ynabConnection.toArray())).not.toContain(TOKEN);
  });

  it("answers 'YNAB did not accept this token' to a 401, stays Off and keeps no token", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText("Key unlocked for today.");
    await turnOn(user);
    await user.type(screen.getByLabelText("Personal Access Token"), "wrong-token");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("YNAB did not accept this token.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Connect YNAB" })).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem(YNAB_TOKEN_KEY)).toBeNull();
    expect(await db.ynabConnection.count()).toBe(0);
    expect(screen.queryByRole("list", { name: "Your budgets" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Personal Access Token")).not.toBeInTheDocument();
  });

  it("stays connected after a reload, shows the budget, and turning it off forgets token and cache", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText("Key unlocked for today.");
    await turnOn(user);
    await user.type(screen.getByLabelText("Personal Access Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Check" }));
    await user.click(await screen.findByRole("button", { name: "Our Budget" }));
    await screen.findByText("Connected as Our Budget");
    first.unmount();

    renderSettings();
    expect(await screen.findByText("Connected as Our Budget")).toBeInTheDocument();
    expect(screen.queryByLabelText("Personal Access Token")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Connect YNAB" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Connect YNAB" })).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument();
    expect(localStorage.getItem(YNAB_TOKEN_KEY)).toBeNull();
    expect(await db.ynabPayees.count()).toBe(0);
    expect(await db.ynabConnection.count()).toBe(0);
  });

  it("refreshes the cache with a delta once connected", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText("Key unlocked for today.");
    await turnOn(user);
    await user.type(screen.getByLabelText("Personal Access Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Check" }));
    await user.click(await screen.findByRole("button", { name: "Our Budget" }));
    await screen.findByText("Connected as Our Budget");
    ynab.calls.length = 0;
    ynab.knowledge = 130;
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(ynab.calls.length).toBe(3));
    expect(ynab.calls.every((c) => c.path.endsWith("last_knowledge_of_server=100"))).toBe(true);
    await waitFor(async () => expect((await new YnabRepository().getConnection())?.payeesKnowledge).toBe(130));
  });

  it("Clear All Data turns it Off and forgets the token and the cache", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Make key" }));
    await screen.findByText("Key unlocked for today.");
    await turnOn(user);
    await user.type(screen.getByLabelText("Personal Access Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Check" }));
    await user.click(await screen.findByRole("button", { name: "Our Budget" }));
    await screen.findByText("Connected as Our Budget");

    await user.click(screen.getByRole("button", { name: "Clear All Data" }));
    await user.click(screen.getByRole("button", { name: "Delete Everything" }));
    await screen.findByText("All data has been cleared.");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Connect YNAB" })).toHaveAttribute("aria-checked", "false"));
    expect(localStorage.getItem(YNAB_TOKEN_KEY)).toBeNull();
    expect(await db.ynabCategories.count()).toBe(0);
  });
});
