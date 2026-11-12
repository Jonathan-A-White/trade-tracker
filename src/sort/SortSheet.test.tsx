import { Blob } from "node:buffer";
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
import { createYnabClient } from "@/ynab/api";
import { accountOf, fakeYnab, groupOf, type FakeYnab, type FakeYnabTransaction } from "@/ynab/fake-ynab";
import { refreshTally } from "@/ynab/tally";
import { SortProvider, type SortSeams } from "./sort-context";
import { NotAllowed } from "@/factory/mill";
import { keepReceiptShots, type ReceiptReader } from "./receipt-read";
import type { ReceiptReconcileAnswer } from "@/contracts/types";
import { LEARNED_KEY, readHistory, recordCharge, type SortChargeAnswer, type SortChargeAsk } from "./suggest";
import { PENDING_CLAIMS_KEY } from "./useAlerts";
import { cardBook } from "@/family/cards";
import { waitingCharges } from "./waiting";

vi.mock("@/scanner/capture-still", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/scanner/capture-still")>()),
  captureStill: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

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

describe("the Sort sheet with the AI's suggestion", () => {
  const ask = (answer: SortChargeAnswer) => vi.fn<SortChargeAsk>(async () => answer);

  it("opens with the suggestion ready and its why in a line; Done writes it", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234", when: WHEN });
    recordCharge("Trader Joe's", 38, [{ category: "Groceries", amount: 38 }]);
    const suggest = ask({ category: "Groceries", why: "The last charge here went to Groceries." });
    renderPhone(`/sort/${alert.id}`, { suggest });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Trader Joe's" });

    expect(await within(sheet).findByText("The last charge here went to Groceries.")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "Groceries · $212 left" })).toHaveAttribute("aria-checked", "true");
    // the request: the charge, the categories by name with what is left, and the history; no YNAB ids
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0]![0]).toEqual({
      merchant: "Trader Joe's",
      amount: 43.12,
      owner: "Jonathan",
      categories: [{ name: "Eating Out", left: 8 }, { name: "Groceries", left: 212 }, { name: "Household", left: 60.5 }],
      history: [{ amount: 38, category: "Groceries" }],
      tally: [],
    });

    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ amount: 43.12, categoryId: "c1" });
    // what this charge was sorted into is kept for the next suggestion at the merchant
    expect(readHistory("Trader Joe's")[0]).toEqual({ amount: 43.12, category: "Groceries" });
  });

  it("the suggestion says how much is available in its category with no tap, in the words of the category row (mw-mr4xgrw.47)", async () => {
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Dunkin'", last4: "1234" });
    renderPhone(`/sort/${alert.id}`, { suggest: ask({ category: "Groceries", why: "Usual." }) });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Dunkin'" });
    // already chosen in the list, and the banner carries the same figure the row does
    const banner = (await within(sheet).findByText("Usual.")).closest("[role=status]") as HTMLElement;
    expect(within(sheet).getByRole("radio", { name: "Groceries · $212 left" })).toHaveAttribute("aria-checked", "true");
    expect(banner).toHaveTextContent("Groceries · $212 left");
  });

  it("a suggested category the charge would overspend says short by in the banner too (mw-mr4xgrw.47)", async () => {
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Dunkin'", last4: "1234" });
    renderPhone(`/sort/${alert.id}`, { suggest: ask({ category: "Eating Out", why: "Coffee." }) });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Dunkin'" });
    const banner = (await within(sheet).findByText("Coffee.")).closest("[role=status]") as HTMLElement;
    expect(within(sheet).getByRole("radio", { name: "Eating Out · $8 left · short by $35.12" })).toHaveAttribute("aria-checked", "true");
    expect(banner).toHaveTextContent("Eating Out · $8 left · short by $35.12");
  });

  it("a split suggestion says what is available in each of its categories (mw-mr4xgrw.47)", async () => {
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234" });
    const split = [{ category: "Groceries", amount: 30 }, { category: "Eating Out", amount: 13.12 }];
    renderPhone(`/sort/${alert.id}`, { suggest: ask({ split, why: "Food and a coffee." }) });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    const banner = (await within(sheet).findByText("Food and a coffee.")).closest("[role=status]") as HTMLElement;
    expect(banner).toHaveTextContent("Groceries · $212 left");
    expect(banner).toHaveTextContent("Eating Out · $8 left · short by $5.12");
  });

  it("a merchant never seen in Groceries is suggested Stuff I Forgot to Budget For, not Groceries, saying so (his words, 2026-11-11)", async () => {
    await new YnabRepository().applyCategories(
      [
        groupOf("g1", "Food", [["c1", "Groceries", 212_000], ["c2", "Eating Out", 8_000]]),
        groupOf("g2", "Home", [["c3", "Household", 60_500]]),
        groupOf("g3", "Surprises", [["c4", "Stuff I Forgot to Budget For", 5_000]]),
      ],
      2,
    );
    const alert = backend.receive({ kind: "charge", amount: "17.90", merchant: "SQ *ZQX 4471", last4: "1234" });
    renderPhone(`/sort/${alert.id}`, { suggest: ask({ category: "Groceries", why: "A guess: everyday spending." }) });
    const sheet = await screen.findByRole("dialog", { name: "$17.90 at SQ *ZQX 4471" });
    expect(await within(sheet).findByText(/New to Groceries here, so Stuff I Forgot to Budget For\./)).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: /Stuff I Forgot to Budget For/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("radio", { name: /Groceries/ })).toHaveAttribute("aria-checked", "false");
  });

  it("a tap on another category changes the suggestion", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    renderPhone(`/sort/${alert.id}`, { suggest: ask({ category: "Groceries", why: "A guess." }) });
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    await within(sheet).findByText("A guess.");
    await user.click(within(sheet).getByRole("radio", { name: /Eating Out/ }));
    expect(within(sheet).getByRole("radio", { name: /Eating Out/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("radio", { name: /Groceries/ })).toHaveAttribute("aria-checked", "false");
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ categoryId: "c2" });
  });

  it("a split suggestion opens the split filled in, and Done writes the parts", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234" });
    const split = [{ category: "Groceries", amount: 30 }, { category: "Household", amount: 13.12 }];
    renderPhone(`/sort/${alert.id}`, { suggest: ask({ split, why: "Target is food and the house." }) });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    expect(await within(sheet).findByText("Target is food and the house.")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Category for part 1")).toHaveValue("c1");
    expect(within(sheet).getByLabelText("Amount for part 1")).toHaveValue("30.00");
    expect(within(sheet).getByLabelText("Category for part 2")).toHaveValue("c3");
    expect(within(sheet).getByLabelText("Amount for part 2")).toHaveValue("13.12");
    expect(within(sheet).getByText("Adds up to $43.12")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0].splits).toEqual([{ categoryId: "c1", amount: 30 }, { categoryId: "c3", amount: 13.12 }]);
    expect(readHistory("Target")[0]).toEqual({ amount: 43.12, split });
  });

  it("while the mill answers the sheet works by hand, and a late answer does not undo a choice", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    let answer: (a: SortChargeAnswer) => void = () => {};
    const suggest = vi.fn<SortChargeAsk>(() => new Promise<SortChargeAnswer>((resolve) => (answer = resolve)));
    renderPhone(`/sort/${alert.id}`, { suggest });
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    expect(await within(sheet).findByText("Asking for a suggestion…")).toBeInTheDocument();
    await user.click(await within(sheet).findByRole("radio", { name: /Eating Out/ }));
    answer({ category: "Groceries", why: "Usual." });
    await waitFor(() => expect(within(sheet).queryByText("Asking for a suggestion…")).not.toBeInTheDocument());
    expect(within(sheet).getByRole("radio", { name: /Eating Out/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).queryByText("Usual.")).not.toBeInTheDocument();
  });

  it("the mill slow past its deadline: the sheet says so and works by hand, and the wait goes on", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    let signal: AbortSignal | undefined;
    const suggest = vi.fn<SortChargeAsk>((_request, s) => {
      signal = s;
      return new Promise<SortChargeAnswer>(() => {});
    });
    renderPhone(`/sort/${alert.id}`, { suggest, suggestTimeoutMs: 300 });
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    expect(await within(sheet).findByText("The suggestion is taking too long. Choose by hand.")).toBeInTheDocument();
    expect(signal?.aborted).toBe(false);
    expect(within(sheet).queryByText("Asking for a suggestion…")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("radio", { name: /Eating Out/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ categoryId: "c2" });
  });

  it("an answer after the deadline, with nothing chosen, still fills the sheet and clears the notice (mw-mr4xgrw.40)", async () => {
    const alert = backend.receive({ kind: "charge", amount: "131.22", merchant: "JONES FAMILY FARMS, LL SHELTON USA", last4: "8235" });
    let answer: (a: SortChargeAnswer) => void = () => {};
    const suggest = vi.fn<SortChargeAsk>(() => new Promise<SortChargeAnswer>((resolve) => (answer = resolve)));
    renderPhone(`/sort/${alert.id}`, { suggest, suggestTimeoutMs: 300 });
    const sheet = await screen.findByRole("dialog", { name: "$131.22 at JONES FAMILY FARMS, LL SHELTON USA" });
    expect(await within(sheet).findByText("The suggestion is taking too long. Choose by hand.")).toBeInTheDocument();
    answer({ category: "Groceries", why: "A farm; food." });
    await waitFor(() => expect(within(sheet).queryByText("The suggestion is taking too long. Choose by hand.")).not.toBeInTheDocument());
    expect(within(sheet).getByRole("radio", { name: /Groceries/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByText("A farm; food.")).toBeInTheDocument();
  });

  it("an answer after the deadline, after he has chosen, does not touch his choice (mw-mr4xgrw.40)", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    let answer: (a: SortChargeAnswer) => void = () => {};
    const suggest = vi.fn<SortChargeAsk>(() => new Promise<SortChargeAnswer>((resolve) => (answer = resolve)));
    renderPhone(`/sort/${alert.id}`, { suggest, suggestTimeoutMs: 300 });
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    expect(await within(sheet).findByText("The suggestion is taking too long. Choose by hand.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("radio", { name: /Eating Out/ }));
    answer({ category: "Groceries", why: "Usual." });
    await waitFor(() => expect(within(sheet).queryByText("The suggestion is taking too long. Choose by hand.")).not.toBeInTheDocument());
    expect(within(sheet).getByRole("radio", { name: /Eating Out/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("radio", { name: /Groceries/ })).toHaveAttribute("aria-checked", "false");
    expect(within(sheet).queryByText("Usual.")).not.toBeInTheDocument();
  });

  it("no licence: the mill refuses with NotAllowed and nothing is shown of it", async () => {
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    const suggest = vi.fn<SortChargeAsk>(async () => {
      throw new NotAllowed("unlicensed");
    });
    renderPhone(`/sort/${alert.id}`, { suggest });
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    await waitFor(() => expect(within(sheet).queryByText("Asking for a suggestion…")).not.toBeInTheDocument());
    expect(within(sheet).queryByText(/suggest/i)).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(within(sheet).getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("with no factory key or licence the sheet makes no call and works as before", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    await within(sheet).findByRole("radio", { name: /Eating Out/ });
    expect(within(sheet).queryByText(/suggest/i)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a suggestion naming a category the budget does not have is not shown", async () => {
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "1234" });
    const suggest = ask({ category: "Boats", why: "Anchors." });
    renderPhone(`/sort/${alert.id}`, { suggest });
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin'" });
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    await waitFor(() => expect(within(sheet).queryByText("Asking for a suggestion…")).not.toBeInTheDocument());
    expect(within(sheet).queryByText("Anchors.")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();
  });
});

describe("the Sort sheet suggests what a merchant NORMALLY goes to, and learns a change of his (mw-mr4xgrw.41)", () => {
  let ynabBudget: FakeYnab;
  let n = 0;
  const charges = (count: number, payee: string, categoryId: string | null, over: Partial<FakeYnabTransaction> = {}): FakeYnabTransaction[] =>
    Array.from({ length: count }, () => ({ id: `y${++n}`, account_id: "a1", date: "2026-06-01", amount: -20_000, payee_name: payee, category_id: categoryId, ...over }));
  const seams = (suggest: SortChargeAsk): Partial<SortSeams> => ({
    suggest,
    refreshTally: () => refreshTally(createYnabClient("good", ynabBudget.fetch)),
  });
  const never = () => vi.fn<SortChargeAsk>(async () => ({ category: "Groceries", why: "From the mill." }));

  beforeEach(() => {
    ynabBudget = fakeYnab("good", [{ id: "b1", name: "Our Budget", categoryGroups: [], accounts: [], payees: [] }]);
  });

  it("one category holds most of the merchant's charges: it is suggested at once with the count, and no grist is sent", async () => {
    const user = userEvent.setup();
    // 12 to Household, then the newest one to Eating Out
    ynabBudget.transactions.push(...charges(12, "Amazon", "c3", { date: "2026-03-01" }), ...charges(1, "Amazon", "c2", { date: "2026-11-01" }));
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "AMAZON MKTPL*2X3Y4", last4: "1234" });
    const suggest = never();
    renderPhone(`/sort/${alert.id}`, seams(suggest));
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at AMAZON MKTPL*2X3Y4" });

    expect(await within(sheet).findByText("12 of 13 here went to Household.")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: /Household/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).queryByText("Asking for a suggestion…")).not.toBeInTheDocument();
    // he keeps it: nothing is taught
    expect(within(sheet).queryByRole("checkbox", { name: /Just this once/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ categoryId: "c3" });
    expect(suggest).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEARNED_KEY)).toBeNull();
  });

  it("the alert's merchant meets YNAB's payee though they are written differently", async () => {
    ynabBudget.transactions.push(...charges(3, "Jones Family Farms", "c1"), ...charges(4, "Family Dollar", "c3"));
    const alert = backend.receive({ kind: "charge", amount: "131.22", merchant: "JONES FAMILY FARMS, LL SHELTON USA", last4: "1234" });
    const suggest = never();
    renderPhone(`/sort/${alert.id}`, seams(suggest));
    const sheet = await screen.findByRole("dialog", { name: "$131.22 at JONES FAMILY FARMS, LL SHELTON USA" });
    expect(await within(sheet).findByText("3 of 3 here went to Groceries.")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: /Groceries/ })).toHaveAttribute("aria-checked", "true");
    expect(suggest).not.toHaveBeenCalled();
  });

  it("a mixed history asks the mill as before, carrying the tally and not this phone's newest-first history", async () => {
    ynabBudget.transactions.push(...charges(2, "Costco", "c1"), ...charges(2, "Costco", "c3"));
    recordCharge("Costco", 80, [{ category: "Eating Out", amount: 80 }]);
    const alert = backend.receive({ kind: "charge", amount: "99.10", merchant: "COSTCO WHSE #0123", last4: "1234" });
    const suggest = vi.fn<SortChargeAsk>(async () => ({ category: "Household", why: "Costco is mostly the house." }));
    renderPhone(`/sort/${alert.id}`, seams(suggest));
    const sheet = await screen.findByRole("dialog", { name: "$99.10 at COSTCO WHSE #0123" });
    expect(await within(sheet).findByText("Costco is mostly the house.")).toBeInTheDocument();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0]![0]).toMatchObject({
      tally: [
        { category: "Groceries", count: 2 },
        { category: "Household", count: 2 },
      ],
      history: [],
    });
  });

  it("a merchant with only Uncategorized still gets a suggestion, whatever is left in the category", async () => {
    ynabBudget.transactions.push(...charges(5, "Jones Family Farms", null), ...charges(2, "Jones Family Farms", "unc", { category_name: "Uncategorized" }));
    const alert = backend.receive({ kind: "charge", amount: "131.22", merchant: "JONES FAMILY FARMS, LL SHELTON USA", last4: "1234" });
    const suggest = vi.fn<SortChargeAsk>(async () => ({ category: "Eating Out", why: "A farm stand; it is a guess." }));
    renderPhone(`/sort/${alert.id}`, seams(suggest));
    const sheet = await screen.findByRole("dialog", { name: "$131.22 at JONES FAMILY FARMS, LL SHELTON USA" });
    expect(await within(sheet).findByText("A farm stand; it is a guess.")).toBeInTheDocument();
    expect(suggest.mock.calls[0]![0].tally).toEqual([]);
    // Eating Out has $8 left: it is suggested all the same
    expect(within(sheet).getByRole("radio", { name: "Eating Out · $8 left · short by $123.22" })).toHaveAttribute("aria-checked", "true");
  });

  it("he changes the suggestion and taps Done: that merchant's suggestion is his category from then on, ahead of the tally, across a reload, until he changes it again", async () => {
    const user = userEvent.setup();
    ynabBudget.transactions.push(...charges(12, "Amazon", "c3"));
    const first = backend.receive({ kind: "charge", amount: "43.12", merchant: "AMAZON MKTPL*2X3Y4", last4: "1234" });
    const suggest = never();
    const phone = renderPhone(`/sort/${first.id}`, seams(suggest));
    let sheet = await screen.findByRole("dialog", { name: "$43.12 at AMAZON MKTPL*2X3Y4" });
    await within(sheet).findByText("12 of 12 here went to Household.");
    await user.click(within(sheet).getByRole("radio", { name: /Eating Out/ }));
    const once = within(sheet).getByRole("checkbox", { name: /Just this once/ });
    expect(once).not.toBeChecked();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ categoryId: "c2" });
    phone.unmount();

    // the app is opened again: the next Amazon charge is his category, ahead of 12 in Household, with no grist
    const second = backend.receive({ kind: "charge", amount: "17.99", merchant: "AMAZON MKTPL*9Z8Q1", last4: "1234" });
    const again = renderPhone(`/sort/${second.id}`, seams(suggest));
    sheet = await screen.findByRole("dialog", { name: "$17.99 at AMAZON MKTPL*9Z8Q1" });
    expect(await within(sheet).findByText("You chose Eating Out for this merchant.")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: /Eating Out/ })).toHaveAttribute("aria-checked", "true");
    // he changes it again
    await user.click(within(sheet).getByRole("radio", { name: /Household/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    again.unmount();

    const third = backend.receive({ kind: "charge", amount: "5.00", merchant: "Amazon Mktpl*AB12", last4: "1234" });
    renderPhone(`/sort/${third.id}`, seams(suggest));
    sheet = await screen.findByRole("dialog", { name: "$5.00 at Amazon Mktpl*AB12" });
    expect(await within(sheet).findByText("You chose Household for this merchant.")).toBeInTheDocument();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("a change of the mill's suggestion is learned too", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin' #3321", last4: "1234" });
    renderPhone(`/sort/${alert.id}`, seams(vi.fn<SortChargeAsk>(async () => ({ category: "Groceries", why: "A guess." }))));
    const sheet = await screen.findByRole("dialog", { name: "$8.50 at Dunkin' #3321" });
    await within(sheet).findByText("A guess.");
    await user.click(within(sheet).getByRole("radio", { name: /Eating Out/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(LEARNED_KEY) ?? "{}")).toMatchObject({ dunkin: { categoryId: "c2", name: "Eating Out" } });
  });

  it("'Just this once' sorts this charge into his choice without teaching anything", async () => {
    const user = userEvent.setup();
    ynabBudget.transactions.push(...charges(12, "Amazon", "c3"));
    const first = backend.receive({ kind: "charge", amount: "43.12", merchant: "AMAZON MKTPL*2X3Y4", last4: "1234" });
    const phone = renderPhone(`/sort/${first.id}`, seams(never()));
    let sheet = await screen.findByRole("dialog", { name: "$43.12 at AMAZON MKTPL*2X3Y4" });
    await within(sheet).findByText("12 of 12 here went to Household.");
    await user.click(within(sheet).getByRole("radio", { name: /Eating Out/ }));
    await user.click(within(sheet).getByRole("checkbox", { name: /Just this once/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ categoryId: "c2" });
    expect(localStorage.getItem(LEARNED_KEY)).toBeNull();
    phone.unmount();

    const second = backend.receive({ kind: "charge", amount: "17.99", merchant: "AMAZON MKTPL*9Z8Q1", last4: "1234" });
    renderPhone(`/sort/${second.id}`, seams(never()));
    sheet = await screen.findByRole("dialog", { name: "$17.99 at AMAZON MKTPL*9Z8Q1" });
    expect(await within(sheet).findByText("12 of 12 here went to Household.")).toBeInTheDocument();
  });
});

describe("the Sort sheet with a photographed receipt", () => {
  const receiptLines = [
    { text: "ORG BNNA", price: 5, quantity: 1, weightLbs: null, tripItemId: null, confidence: "high" as const },
    { text: "MILK", price: 20, quantity: 1, weightLbs: null, tripItemId: null, confidence: "high" as const },
    { text: "PAPER TWL", price: 15, quantity: 1, weightLbs: null, tripItemId: null, confidence: "high" as const },
  ];
  const receipt = (over: Partial<ReceiptReconcileAnswer> = {}): ReceiptReader =>
    vi.fn<ReceiptReader>(async () => ({
      ok: true,
      answer: { store: "Target", date: "2026-10-30", subtotal: 40, tax: 3.12, total: 43.12, lines: receiptLines, unreadable: null, ...over },
    }));
  const grouped = () => vi.fn<SortChargeAsk>(async () => ({ split: [{ category: "Groceries", amount: 25 }, { category: "Household", amount: 15 }], why: "Food went to Groceries, the paper towels to Household." }));

  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) } });
  });

  it("Photo the receipt opens the camera; the photo comes back as split rows with the tax spread, they can be edited, and Done writes them", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234", when: WHEN });
    const readReceipt = receipt();
    const suggest = grouped();
    renderPhone(`/sort/${alert.id}`, { readReceipt, suggest });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    await user.click(await within(sheet).findByRole("button", { name: "Photo the receipt" }));

    // the camera, for this charge's receipt
    expect(where()).toBe(`/sort/${alert.id}/receipt`);
    expect(await screen.findByRole("heading", { name: /RECEIPT/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(await screen.findByRole("button", { name: "Use photo" }));
    await user.click(await screen.findByRole("button", { name: "Read the receipt" }));

    // back on the sheet: the lines read, grouped, and the tax spread in proportion (25 : 15 of 3.12 is 1.95 and 1.17)
    const back = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    expect(where()).toBe(`/sort/${alert.id}`);
    expect(await within(back).findByText(/From the receipt/)).toBeInTheDocument();
    expect(within(back).getByText(/the paper towels to Household/)).toBeInTheDocument();
    // and what is available in each category the receipt went to (mw-mr4xgrw.47)
    const fromReceipt = within(back).getByText(/the paper towels to Household/).closest("[role=status]") as HTMLElement;
    expect(fromReceipt).toHaveTextContent("Groceries · $212 left");
    expect(fromReceipt).toHaveTextContent("Household · $61 left");
    expect(readReceipt).toHaveBeenCalledWith("Target", expect.any(Array), expect.any(AbortSignal));
    // the sheet's own suggestion asked first, without lines; the receipt's grouping asked with them
    expect(suggest.mock.calls[0]![0].lines).toBeUndefined();
    expect(suggest.mock.calls.at(-1)![0].lines).toEqual([
      { text: "ORG BNNA", price: 5 },
      { text: "MILK", price: 20 },
      { text: "PAPER TWL", price: 15 },
    ]);
    expect(within(back).getByLabelText("Category for part 1")).toHaveValue("c1");
    expect(within(back).getByLabelText("Amount for part 1")).toHaveValue("26.95");
    expect(within(back).getByLabelText("Category for part 2")).toHaveValue("c3");
    expect(within(back).getByLabelText("Amount for part 2")).toHaveValue("16.17");
    expect(within(back).getByText("Adds up to $43.12")).toBeInTheDocument();

    // a row can be moved to another category, and Done writes the split
    await user.selectOptions(within(back).getByLabelText("Category for part 2"), "c2");
    await user.click(within(back).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({
      accountId: "a1",
      amount: 43.12,
      splits: [
        { categoryId: "c1", amount: 26.95 },
        { categoryId: "c2", amount: 16.17 },
      ],
    });
  });

  it("a receipt under the charge leaves the difference as a row of its own to place, and Done waits for it", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234", when: WHEN });
    keepReceiptShots(alert.id, [new Blob(["jpeg"], { type: "image/jpeg" }) as unknown as globalThis.Blob]);
    // 25 + 15 = 40 and 1.80 tax: 41.80
    renderPhone(`/sort/${alert.id}`, { readReceipt: receipt({ tax: 1.8, total: 41.8 }), suggest: grouped() });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    expect(await within(sheet).findByText("Receipt $41.80, charge $43.12: $1.32 not on the receipt")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Amount for part 3")).toHaveValue("1.32");
    expect(within(sheet).getByLabelText("Category for part 3")).toHaveValue("");
    expect(within(sheet).getByText("Adds up to $43.12")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(within(sheet).getByText("Give every part a category and an amount.")).toBeInTheDocument();

    await user.selectOptions(within(sheet).getByLabelText("Category for part 3"), "c2");
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0].splits).toEqual([
      { categoryId: "c1", amount: 26.13 },
      { categoryId: "c3", amount: 15.67 },
      { categoryId: "c2", amount: 1.32 },
    ]);
  });

  it("a receipt over the charge says so plainly and writes nothing", async () => {
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234", when: WHEN });
    keepReceiptShots(alert.id, [new Blob(["jpeg"], { type: "image/jpeg" }) as unknown as globalThis.Blob]);
    renderPhone(`/sort/${alert.id}`, { readReceipt: receipt({ tax: 11, total: 51 }), suggest: grouped() });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    expect(await within(sheet).findByText("Receipt $51.00 is more than the charge $43.12. Place the charge by hand.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it("a receipt the factory could not read says why and leaves the sheet to hand", async () => {
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234", when: WHEN });
    keepReceiptShots(alert.id, [new Blob(["jpeg"], { type: "image/jpeg" }) as unknown as globalThis.Blob]);
    const readReceipt = vi.fn<ReceiptReader>(async () => ({ ok: false, error: "The factory could not read the receipt." }));
    renderPhone(`/sort/${alert.id}`, { readReceipt, suggest: grouped() });
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    expect(await within(sheet).findByText("The factory could not read the receipt.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: /Groceries/ })).toBeInTheDocument();
  });

  it("without the factory there is no Photo the receipt", async () => {
    const alert = backend.receive({ kind: "charge", amount: "43.12", merchant: "Target", last4: "1234", when: WHEN });
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$43.12 at Target" });
    await within(sheet).findByRole("radio", { name: /Groceries/ });
    expect(within(sheet).queryByRole("button", { name: "Photo the receipt" })).not.toBeInTheDocument();
  });
});

describe("the account chosen on the sheet is remembered by the card", () => {
  const cardsOf = (lastFour: string) => db.familyCards.where("lastFour").equals(lastFour).toArray();

  async function chooseAccount(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, id: string) {
    await user.selectOptions(await within(sheet).findByLabelText("YNAB account"), id);
  }

  it("a card with a row and no account: Done puts the account on the row, and the next charge asks nothing and writes to it", async () => {
    const user = userEvent.setup();
    await new FamilyRepository().addCard({ lastFour: "4321", owner: "Jonathan" });
    const first = backend.receive({ kind: "charge", amount: "10.00", merchant: "Farm Stand", last4: "4321", when: WHEN });
    const second = backend.receive({ kind: "charge", amount: "12.00", merchant: "Bakery", last4: "4321", when: WHEN });
    renderPhone(`/sort/${first.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$10.00 at Farm Stand" });
    await chooseAccount(user, sheet, "a2");
    await user.click(await within(sheet).findByRole("radio", { name: /Groceries/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(where()).toBe("/"));

    const [row] = await cardsOf("4321");
    expect(row).toMatchObject({ lastFour: "4321", owner: "Jonathan", accountId: "a2" });

    await user.click(await screen.findByRole("link", { name: /Bakery/ }));
    const next = await screen.findByRole("dialog", { name: "$12.00 at Bakery" });
    await within(next).findByRole("radio", { name: /Groceries/ });
    expect(within(next).queryByLabelText("YNAB account")).not.toBeInTheDocument();
    expect(within(next).getByText("Citi Double")).toBeInTheDocument();
    await user.click(within(next).getByRole("radio", { name: /Groceries/ }));
    await user.click(within(next).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "a2", amount: 12 }), { localId: `alert-${second.id}` });
  });

  it("a last four with no row: Done adds a row with owner 'anyone' and the account, and who is pinged does not change", async () => {
    const user = userEvent.setup();
    const alert = backend.receive({ kind: "charge", amount: "131.22", merchant: "JONES FAMILY FARMS", last4: "8235", when: WHEN });
    const pinged = async () => {
      const book = cardBook(await new FamilyRepository().listCards());
      return ["Jonathan", "Sarah", null].map((me) => waitingCharges([alert], book, me, new Set())[0]!.mine);
    };
    const before = await pinged();
    renderPhone(`/sort/${alert.id}`);
    const sheet = await screen.findByRole("dialog", { name: "$131.22 at JONES FAMILY FARMS" });
    await chooseAccount(user, sheet, "a1");
    await user.click(await within(sheet).findByRole("radio", { name: /Groceries/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(where()).toBe("/"));

    const rows = await cardsOf("8235");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lastFour: "8235", owner: "anyone", accountId: "a1" });
    expect(await pinged()).toEqual(before);
    expect(before).toEqual([true, true, true]);
  });

  it("Later and Not mine save no account", async () => {
    const user = userEvent.setup();
    await new FamilyRepository().addCard({ lastFour: "4321", owner: "Jonathan" });
    const known = backend.receive({ kind: "charge", amount: "10.00", merchant: "Farm Stand", last4: "4321", when: WHEN });
    const unknown = backend.receive({ kind: "charge", amount: "12.00", merchant: "Bakery", last4: "8235", when: WHEN });
    renderPhone(`/sort/${known.id}`);
    let sheet = await screen.findByRole("dialog", { name: "$10.00 at Farm Stand" });
    await chooseAccount(user, sheet, "a2");
    await user.click(within(sheet).getByRole("button", { name: "Later" }));
    await waitFor(() => expect(where()).toBe("/"));
    await user.click(await screen.findByRole("link", { name: /Bakery/ }));
    sheet = await screen.findByRole("dialog", { name: "$12.00 at Bakery" });
    await chooseAccount(user, sheet, "a1");
    await user.click(within(sheet).getByRole("button", { name: "Not mine" }));
    await waitFor(() => expect(where()).toBe("/"));

    expect((await cardsOf("4321"))[0]?.accountId).toBeUndefined();
    expect(await cardsOf("8235")).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(unknown.id).toBeTruthy();
  });

  it("choosing an account and leaving without Done saves nothing", async () => {
    const user = userEvent.setup();
    await new FamilyRepository().addCard({ lastFour: "4321", owner: "Jonathan" });
    const known = backend.receive({ kind: "charge", amount: "10.00", merchant: "Farm Stand", last4: "4321", when: WHEN });
    const unknown = backend.receive({ kind: "charge", amount: "12.00", merchant: "Bakery", last4: "8235", when: WHEN });
    for (const [alert, name, id] of [[known, "$10.00 at Farm Stand", "a2"], [unknown, "$12.00 at Bakery", "a1"]] as const) {
      const view = renderPhone(`/sort/${alert.id}`);
      const sheet = await screen.findByRole("dialog", { name });
      await chooseAccount(user, sheet, id);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(where()).toBe("/"));
      view.unmount();
    }
    expect((await cardsOf("4321"))[0]?.accountId).toBeUndefined();
    expect(await cardsOf("8235")).toEqual([]);
  });
});
