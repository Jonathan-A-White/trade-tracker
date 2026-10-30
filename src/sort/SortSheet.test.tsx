import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useRoutes } from "react-router";
import { tapSettings } from "pwa-kit/tap";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { makeAlertsClient, type AlertsClient } from "@/family/alerts-client";
import { fakeAlerts, type FakeAlerts } from "@/family/fake-alerts";
import { appRoutes } from "@/routes";
import type { PasskeyPort } from "@/services/passkey";
import { setFamilyOn, setYnabOn } from "@/settings/connections";
import { accountOf, groupOf } from "@/ynab/fake-ynab";
import { SortProvider, type SortSeams } from "./sort-context";
import { PENDING_CLAIMS_KEY } from "./useAlerts";

const BACKEND = "https://backend.example.test";
const key = new Uint8Array(32).fill(7);
const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};
// 2:14 PM on Oct 30, this phone's time
const WHEN = new Date(2026, 9, 30, 14, 14).toISOString();

function Routed() {
  const location = useLocation();
  const routes = useRoutes(appRoutes[0].children ?? []);
  return (
    <>
      <p data-testid="where" hidden>
        {location.pathname}
      </p>
      {routes}
    </>
  );
}

const where = () => screen.getByTestId("where").textContent;

let backend: FakeAlerts;
let client: AlertsClient;
let create: ReturnType<typeof vi.fn>;

function renderPhone(path = "/", seams: Partial<SortSeams> = {}) {
  return render(
    <ThemeProvider>
      <FactoryProvider checkLicence={async () => ({ state: "none", checkedAt: "x" })} passkeyPort={noWebAuthn}>
        <SortProvider client={client} writer={{ create }} me="Jonathan" refreshBalances={async () => {}} pollMs={60_000} {...seams}>
          <MemoryRouter initialEntries={[path]}>
            <Routed />
          </MemoryRouter>
        </SortProvider>
      </FactoryProvider>
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.clear();
  localStorage.setItem("tradetracker-theme", "light");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  tapSettings.ms = 0;
  backend = fakeAlerts();
  client = makeAlertsClient(BACKEND, key, backend.fetch);
  create = vi.fn(async () => "local-id");
  const ynab = new YnabRepository();
  await ynab.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  await ynab.applyCategories(
    [
      groupOf("g1", "Food", [["c1", "Groceries", 212_000], ["c2", "Eating Out", 8_000]]),
      groupOf("g2", "Home", [["c3", "Household", 60_500]]),
    ],
    1,
  );
  await ynab.applyAccounts([accountOf("a1", "Chase Freedom"), accountOf("a2", "Citi Double")], 1);
  const family = new FamilyRepository();
  await family.addCard({ lastFour: "1234", owner: "Jonathan", accountId: "a1" });
  await family.addCard({ lastFour: "5678", owner: "Sarah", accountId: "a2" });
  await setFamilyOn(true);
  await setYnabOn(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Sort sheet", () => {
  it("his card's charge waits on his Home, opens the sheet with its facts, and Done writes it with the category and claims it", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234", when: WHEN });
    renderPhone();

    expect(await screen.findByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /\$43\.12.*Trader Joe's/ });
    await user.click(row);

    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Trader Joe's" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(where()).toBe(`/sort/${alert.id}`);
    expect(within(sheet).getByText("•••• 1234 · Jonathan")).toBeInTheDocument();
    expect(within(sheet).getByText("Chase Freedom")).toBeInTheDocument();
    expect(within(sheet).getByText(/2:14 PM/)).toBeInTheDocument();

    // the categories with their balances; one too short for the charge in red, with how short
    const groceries = within(sheet).getByRole("radio", { name: "Groceries · $212 left" });
    const short = within(sheet).getByRole("radio", { name: "Eating Out · $8 left · short by $35.12" });
    expect(within(short).getByText("short by $35.12")).toHaveClass("text-red-600");
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();

    await user.click(groceries);
    expect(groceries).toHaveAttribute("aria-checked", "true");
    await user.type(within(sheet).getByLabelText("Memo"), "Weekly shop");
    expect(within(sheet).getByText("11 of 150")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(where()).toBe("/"));
    expect(create).toHaveBeenCalledWith(
      { accountId: "a1", date: "2026-10-30", amount: 43.12, payeeName: "Trader Joe's", categoryId: "c1", memo: "Weekly shop" },
      { localId: `alert-${alert.id}` },
    );
    await waitFor(() => expect(backend.requests.some((r) => r.method === "DELETE" && r.path === `/api/alerts/${alert.id}`)).toBe(true));
    expect(backend.feed).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Waiting · 0" })).toBeInTheDocument();
    const sorted = screen.getByRole("list", { name: "Sorted today" });
    expect(screen.getByRole("heading", { name: "Sorted today · 1" })).toBeInTheDocument();
    expect(within(sorted).getByText(/Trader Joe's/)).toBeInTheDocument();
    expect(within(sorted).getByText("Jonathan")).toBeInTheDocument();
  });

  it("a split that does not add up to the amount cannot be Done, and shows what is left", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234", when: WHEN });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });

    await user.click(await within(sheet).findByRole("button", { name: "Split" }));
    await user.selectOptions(within(sheet).getByLabelText("Category for part 1"), "c1");
    await user.type(within(sheet).getByLabelText("Amount for part 1"), "30");
    await user.selectOptions(within(sheet).getByLabelText("Category for part 2"), "c3");
    await user.type(within(sheet).getByLabelText("Amount for part 2"), "10");
    expect(within(sheet).getByText("$3.12 left to place")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();

    await user.type(within(sheet).getByLabelText("Amount for part 2"), "0");
    expect(within(sheet).getByText("$86.88 too much")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();

    await user.clear(within(sheet).getByLabelText("Amount for part 2"));
    await user.type(within(sheet).getByLabelText("Amount for part 2"), "13.12");
    expect(within(sheet).getByText("Adds up to $43.12")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toEqual({
      accountId: "a1",
      date: "2026-10-30",
      amount: 43.12,
      payeeName: "Target",
      splits: [
        { categoryId: "c1", amount: 30 },
        { categoryId: "c3", amount: 13.12 },
      ],
    });
  });

  it("a third part can be added and one removed; the remainder follows", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "20.00", merchant: "CVS", last4: "1234" });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$20.00 at CVS" });
    await user.click(await within(sheet).findByRole("button", { name: "Split" }));
    expect(within(sheet).getByText("$20.00 left to place")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Add a part" }));
    await user.type(within(sheet).getByLabelText("Amount for part 3"), "5");
    expect(within(sheet).getByText("$15.00 left to place")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Remove part 3" }));
    expect(within(sheet).queryByLabelText("Amount for part 3")).not.toBeInTheDocument();
    expect(within(sheet).getByText("$20.00 left to place")).toBeInTheDocument();
  });

  it("Later leaves it Waiting; Not mine hands it to the other person", async () => {
    const user = userEvent.setup();
    backend.receive({ kind: "charge", amount: "9.99", merchant: "Spotify", last4: "1234" });
    renderPhone();
    await user.click(await screen.findByRole("link", { name: /Spotify/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Later" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(screen.getByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Yours" })).getByText("Spotify")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Spotify/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Not mine" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(screen.getByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Sarah's" })).getByText("Spotify")).toBeInTheDocument();
    expect(screen.getByText("Handed to Sarah")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(backend.feed).toHaveLength(1);
  });

  it("opened from the ping before the feed answers: waits with a deadline, offers Try again, and gives up in plain words", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    let answer = false;
    const slow: AlertsClient = { ...client, list: (since) => (answer ? client.list(since) : new Promise(() => {})) };
    renderPhone(`/sort/${alert.id}`, { client: slow, feedTiming: { slowAfterMs: 600, tryAgainAfterMs: 1_200, timeoutMs: 1_800 } });

    const sheet = await screen.findByRole("dialog", { name: "Sort a charge" });
    expect(await within(sheet).findByText("Reading the family's charges…")).toBeInTheDocument();
    expect(await within(sheet).findByText("Still waiting for the backend…", undefined, { timeout: 3_000 })).toBeInTheDocument();
    expect(await within(sheet).findByRole("button", { name: "Try again" }, { timeout: 3_000 })).toBeInTheDocument();
    expect(await within(sheet).findByText("The backend did not answer in 2 seconds.", undefined, { timeout: 3_000 })).toBeInTheDocument();

    answer = true;
    await user.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("dialog", { name: "$43.12 at Trader Joe's" })).toBeInTheDocument();
  });

  it("the balances' read from YNAB has a deadline too: the kept balances stay, with Try again", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    let reads = 0;
    const refreshBalances = () => {
      reads += 1;
      return reads === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    };
    renderPhone(`/sort/${alert.id}`, { refreshBalances, balanceTiming: { slowAfterMs: 600, tryAgainAfterMs: 1_200, timeoutMs: 1_800 } });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Trader Joe's" });
    expect(await within(sheet).findByText("Updating the balances from YNAB…")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "Groceries · $212 left" })).toBeInTheDocument();
    expect(await within(sheet).findByText("YNAB did not answer in 2 seconds; these balances are from before.", undefined, { timeout: 3_000 })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(sheet).queryByText(/these balances are from before/)).not.toBeInTheDocument());
    expect(reads).toBe(2);
  });

  it("a charge another phone already sorted says so", async () => {
    renderPhone("/sort/00000000000000ff");
    const sheet = await screen.findByRole("dialog", { name: "Sort a charge" });
    expect(await within(sheet).findByText("This charge is not waiting any more: it was sorted on another phone.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("every control on the sheet is at least 48 px tall", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Trader Joe's" });
    await user.click(await within(sheet).findByRole("button", { name: "Split" }));
    const controls = [...within(sheet).queryAllByRole("button"), ...within(sheet).queryAllByRole("radio"), ...within(sheet).queryAllByRole("combobox"), ...within(sheet).queryAllByRole("textbox")];
    expect(controls.length).toBeGreaterThan(6);
    for (const control of controls) expect(control.className, control.textContent ?? "").toMatch(/\bmin-h-12\b/);
  });
});

describe("the Sort sheet and a double tap", () => {
  it("the second tap of the one that opened the sheet, landing on the dimmed page, does not close it", async () => {
    tapSettings.ms = 300;
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    renderPhone();
    const row = await screen.findByRole("link", { name: /Trader Joe's/ });
    const { twoTaps } = await import("pwa-kit/tap/testing");
    const { second } = await twoTaps(row, () => document.querySelector(".bg-black\\/40"));
    expect(second).not.toBeNull();
    expect(await screen.findByRole("dialog", { name: "$43.12 at Trader Joe's" })).toBeInTheDocument();
    expect(where()).toBe(`/sort/${alert.id}`);
  });
});

describe("the Sort sheet: the first Done of the family takes the charge", () => {
  it("a Done after another phone took the charge writes nothing and says it was sorted on another phone", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    // her phone's Done claims it while his sheet is open
    expect(await makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch).claim(alert.id)).toBe(true);

    await user.click(await within(sheet).findByRole("radio", { name: /Eating Out/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(await screen.findByText("This charge is not waiting any more: it was sorted on another phone.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("a Done with the backend out of reach still queues the write, and keeps the claim to send later", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    backend.refuse = { status: 503 };
    await user.click(await within(sheet).findByRole("radio", { name: /Eating Out/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(PENDING_CLAIMS_KEY) ?? "[]")).toEqual([alert.id]));
    expect(await screen.findByRole("heading", { name: "Waiting · 0" })).toBeInTheDocument();
  });
});
