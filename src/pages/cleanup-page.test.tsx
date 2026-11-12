import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useRoutes } from "react-router";
import { tapSettings } from "pwa-kit/tap";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { appRoutes } from "@/routes";
import type { PasskeyPort } from "@/services/passkey";
import { setYnabOn } from "@/settings/connections";
import { SortProvider, type SortSeams } from "@/sort/sort-context";
import type { SortChargeAsk } from "@/sort/suggest";
import { createYnabClient } from "@/ynab/api";
import { fakeYnab, groupOf, type FakeYnab, type FakeYnabTransaction } from "@/ynab/fake-ynab";
import type { CheckReader } from "@/ynab/check-read";
import { YNAB_BUSY_KEY, createYnabWriter } from "@/ynab/writer";

// the browser's canvas makes the JPEG; here the picture is kept as it came
vi.mock("@/scanner/capture-still", async (original) => ({ ...(await original<typeof import("@/scanner/capture-still")>()), stillFromFile: async (file: Blob) => file }));

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

function Routed() {
  return useRoutes(appRoutes);
}

let ynab: FakeYnab;
let n = 0;
const row = (payee: string, categoryId: string | null, date: string, over: Partial<FakeYnabTransaction> = {}): FakeYnabTransaction => ({
  id: `t${++n}`,
  account_id: "a1",
  date,
  amount: -10_000,
  payee_name: payee,
  category_id: categoryId,
  approved: true,
  ...over,
});
const unapproved = (payee: string, categoryId: string | null, date: string, over: Partial<FakeYnabTransaction> = {}) =>
  row(payee, categoryId, date, { approved: false, ...over });

function renderPage(seams: Partial<SortSeams> = {}, path = "/cleanup") {
  const client = createYnabClient("good", ynab.fetch);
  const writer = createYnabWriter({ getClient: async () => client });
  return render(
    <ThemeProvider>
      <FactoryProvider checkLicence={async () => ({ state: "none", checkedAt: "x" })} passkeyPort={noWebAuthn}>
        <SortProvider client={null} writer={writer} ynabClient={async () => client} refreshBalances={async () => {}} suggest={null} approveOnOpen={false} {...seams}>
          <MemoryRouter initialEntries={[path]}>
            <Routed />
          </MemoryRouter>
        </SortProvider>
      </FactoryProvider>
    </ThemeProvider>,
  );
}

const patches = () => ynab.requests.filter((r) => r.method === "PATCH");
const groupOfPayee = (name: string) => screen.getByRole("group", { name });

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.clear();
  localStorage.setItem("tradetracker-theme", "light");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  tapSettings.ms = 0;
  n = 0;
  ynab = fakeYnab("good", [
    {
      id: "b1",
      name: "Our Budget",
      categoryGroups: [groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"]]), groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]]), groupOf("g2", "Home", [["c3", "Household"]]), groupOf("g3", "Surprises", [["c4", "Stuff I Forgot to Budget For"]])],
      accounts: [],
      payees: [],
    },
  ]);
  const repo = new YnabRepository();
  await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  await repo.applyCategories(
    [groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"]]), groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]]), groupOf("g2", "Home", [["c3", "Household"]]), groupOf("g3", "Surprises", [["c4", "Stuff I Forgot to Budget For"]])],
    1,
  );
  await setYnabOn(true);
  ynab.transactions.push(
    // history: Trader Joe's is sure (last three all Groceries), Costco is likely (two of three)
    row("Trader Joe's", "c1", "2026-08-01"),
    row("Trader Joe's", "c1", "2026-08-08"),
    row("Trader Joe's", "c1", "2026-08-15"),
    row("Costco", "c1", "2026-08-01"),
    row("Costco", "c1", "2026-08-08"),
    row("Costco", "c3", "2026-08-15"),
    // the unapproved
    unapproved("Trader Joe's", null, "2026-10-01", { id: "tj1", amount: -12_340 }),
    unapproved("Trader Joe's", null, "2026-10-05", { id: "tj2", amount: -30_000 }),
    unapproved("Costco", null, "2026-10-02", { id: "co1" }),
    unapproved("Mystery Shop", null, "2026-10-03", { id: "my1" }),
    unapproved("Shell", "c2", "2026-10-04", { id: "sh1", category_name: "Eating Out" }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(YNAB_BUSY_KEY);
});

describe("Clean up", () => {
  it("lists the unapproved transactions grouped by payee, with the count, the total and one category for the group", async () => {
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    expect(within(tj).getByText("2 transactions · $42.34")).toBeInTheDocument();
    expect(within(tj).getByLabelText("Category for Trader Joe's")).toHaveValue("c1");
    expect(within(groupOfPayee("Costco")).getByText("1 transaction · $10.00")).toBeInTheDocument();
    // the approved ones are not here
    expect(screen.queryByText(/2026-08/)).not.toBeInTheDocument();
    expect(ynab.requests.some((r) => r.path.includes("type=unapproved"))).toBe(true);
  });

  it("ticks the sure ones and puts them first; the others are unticked, with their confidence shown", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    const names = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(names[0]).toBe("Trader Joe's");

    const tj = groupOfPayee("Trader Joe's");
    expect(within(tj).getByText("Sure")).toBeInTheDocument();
    for (const box of within(tj).getAllByRole("checkbox", { name: /^Approve / })) expect(box).toBeChecked();

    const costco = groupOfPayee("Costco");
    expect(within(costco).getByText("Likely")).toBeInTheDocument();
    expect(within(costco).getByLabelText("Category for Costco")).toHaveValue("c1");
    expect(within(costco).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();

    const mystery = groupOfPayee("Mystery Shop");
    expect(within(mystery).getByText("Unsure")).toBeInTheDocument();
    expect(within(mystery).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Approve 2" })).toBeInTheDocument();
  });

  it("writes only the ticked ones, category and approved, in one bulk PATCH, and nothing before the tap", async () => {
    const user = userEvent.setup();
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    expect(patches()).toHaveLength(0);

    await user.click(within(tj).getByRole("checkbox", { name: /Approve \$30\.00/ }));
    await user.click(screen.getByRole("button", { name: "Approve 1" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({ transactions: [{ id: "tj1", category_id: "c1", approved: true }] });
    const byId = (id: string) => ynab.transactions.find((t) => t.id === id);
    expect(byId("tj1")).toMatchObject({ approved: true, category_id: "c1" });
    expect(byId("tj2")?.approved).toBe(false);
    expect(byId("co1")?.approved).toBe(false);
    expect(byId("my1")?.approved).toBe(false);
  });

  it("moves to the next page after the write, the unticked ones left behind", async () => {
    const user = userEvent.setup();
    ynab.transactions = ynab.transactions.filter((t) => t.approved);
    for (let i = 1; i <= 25; i++) ynab.transactions.push(unapproved("Trader Joe's", null, `2026-10-${String(i).padStart(2, "0")}`, { id: `x${i}` }));
    renderPage();
    await screen.findByRole("button", { name: "Approve 20" });
    expect(screen.getAllByRole("checkbox", { name: /^Approve \$/ })).toHaveLength(20);
    await user.click(screen.getByRole("button", { name: "Approve 20" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve 5" })).toBeInTheDocument());
    expect(patches()).toHaveLength(1);
    expect((patches()[0]?.body as { transactions: unknown[] }).transactions).toHaveLength(20);
    expect(screen.getAllByRole("checkbox", { name: /^Approve \$/ })).toHaveLength(5);
  });

  it("says when a write failed and leaves the page as it was, nothing approved", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    ynab.failNextBulk = 500;
    await user.click(screen.getByRole("button", { name: "Approve 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not approve/i);
    // the same transactions, still ticked, still on the page; a second tap works
    const tj = groupOfPayee("Trader Joe's");
    for (const box of within(tj).getAllByRole("checkbox", { name: /^Approve / })) expect(box).toBeChecked();
    expect(ynab.transactions.filter((t) => !t.approved)).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Approve 2" }));
    await waitFor(() => expect(ynab.transactions.filter((t) => t.approved && t.id.startsWith("tj"))).toHaveLength(2));
  });

  it("keeps the category a categorized transaction has, and writes a changed one", async () => {
    const user = userEvent.setup();
    renderPage();
    const shell = await screen.findByRole("group", { name: "Shell" });
    const select = within(shell).getByLabelText("Category for Shell");
    expect(select).toHaveValue("c2");
    expect(within(shell).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();

    await user.click(within(shell).getByRole("checkbox", { name: /^Approve / }));
    await user.click(screen.getByRole("button", { name: "Approve 3" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect((patches()[0]?.body as { transactions: { id: string; category_id?: string }[] }).transactions).toContainEqual({ id: "sh1", category_id: "c2", approved: true });

    // the page is done (the unticked were passed by); going through them again reads YNAB afresh
    await user.click(await screen.findByRole("button", { name: "Go through them again" }));
    // a changed one: Mystery Shop to Household, which ticks it
    const mystery = await screen.findByRole("group", { name: "Mystery Shop" });
    await user.selectOptions(within(mystery).getByLabelText("Category for Mystery Shop"), "c3");
    expect(within(mystery).getByRole("checkbox", { name: /^Approve / })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Approve 1" }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]?.body).toEqual({ transactions: [{ id: "my1", category_id: "c3", approved: true }] });
  });

  it("changes the category of the whole group, or of one transaction", async () => {
    const user = userEvent.setup();
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    await user.selectOptions(within(tj).getByLabelText("Category for Trader Joe's"), "c2");
    for (const select of within(tj).getAllByLabelText(/^Category for \$/)) expect(select).toHaveValue("c2");
    await user.selectOptions(within(tj).getAllByLabelText(/^Category for \$/)[1]!, "c3");
    expect(within(tj).getByLabelText("Category for Trader Joe's")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Approve 2" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({
      transactions: [
        { id: "tj1", category_id: "c2", approved: true },
        { id: "tj2", category_id: "c3", approved: true },
      ],
    });
  });

  it("opens again showing only what is still unapproved", async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    await user.click(screen.getByRole("button", { name: "Approve 2" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    first.unmount();

    renderPage();
    await screen.findByRole("group", { name: "Costco" });
    expect(screen.queryByRole("group", { name: "Trader Joe's" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Mystery Shop" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Shell" })).toBeInTheDocument();
  });

  it("asks the AI for a payee nothing else knows, and marks its category unsure and unticked", async () => {
    const suggest: SortChargeAsk = vi.fn(async () => ({ category: "Eating Out", why: "It sounds like a cafe." }));
    renderPage({ suggest });
    const mystery = await screen.findByRole("group", { name: "Mystery Shop" });
    await waitFor(() => expect(within(mystery).getByLabelText("Category for Mystery Shop")).toHaveValue("c2"));
    expect(within(mystery).getByText("Unsure")).toBeInTheDocument();
    expect(within(mystery).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();
    // not asked for the ones the history knows
    expect(vi.mocked(suggest).mock.calls.map((c) => c[0].merchant)).toEqual(["Mystery Shop"]);
  });

  it("puts a payee nothing knows in Stuff I Forgot to Budget For, unticked, before and without the AI", async () => {
    renderPage();
    const mystery = await screen.findByRole("group", { name: "Mystery Shop" });
    expect(within(mystery).getByLabelText("Category for Mystery Shop")).toHaveValue("c4");
    expect(within(mystery).getByText("Unsure")).toBeInTheDocument();
    expect(within(mystery).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();
    expect(within(mystery).getByText(/Stuff I Forgot to Budget For/, { selector: "p" })).toBeInTheDocument();
  });

  it("does not let the AI put a payee new to Groceries or Household there: it stays in Stuff I Forgot to Budget For, unticked, saying so", async () => {
    const suggest: SortChargeAsk = vi.fn(async () => ({ category: "Groceries", why: "A guess: everyday spending." }));
    renderPage({ suggest });
    const mystery = await screen.findByRole("group", { name: "Mystery Shop" });
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(within(mystery).getByLabelText("Category for Mystery Shop")).toHaveValue("c4");
    expect(within(mystery).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();
    expect(within(mystery).queryByText(/everyday/i)).not.toBeInTheDocument();
  });

  it("lets the AI answer Household for a payee whose YNAB history has Household before", async () => {
    // Hardware Hank was Household once and Groceries once: no majority, so the AI is asked, and Household is seen there
    ynab.transactions.push(
      row("Hardware Hank", "c3", "2026-08-01"),
      row("Hardware Hank", "c1", "2026-08-08"),
      unapproved("Hardware Hank", null, "2026-10-06", { id: "hh1" }),
    );
    const suggest: SortChargeAsk = vi.fn(async () => ({ category: "Household", why: "Hardware." }));
    renderPage({ suggest });
    const hank = await screen.findByRole("group", { name: "Hardware Hank" });
    await waitFor(() => expect(within(hank).getByLabelText("Category for Hardware Hank")).toHaveValue("c3"));
    expect(within(hank).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();
    expect(within(hank).getByText("Unsure")).toBeInTheDocument();
  });

  it("says there is nothing to clean when nothing is unapproved", async () => {
    ynab.transactions = ynab.transactions.filter((t) => t.approved);
    renderPage();
    expect(await screen.findByText("Nothing is waiting to be approved.")).toBeInTheDocument();
  });

  it("is reached from a Clean up link on Home while the connection is On", async () => {
    renderPage({}, "/");
    expect(await screen.findByRole("link", { name: "Clean up" })).toHaveAttribute("href", "/cleanup");
  });
});

describe("Clean up: Always", () => {
  const ruleOf = (key: string) => db.ynabPayeeRules.get(key);
  const byId = (id: string) => ynab.transactions.find((t) => t.id === id);

  it("approves every unapproved transaction of the payee into the card's category in one PATCH, saves a rule, and the card goes", async () => {
    const user = userEvent.setup();
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    expect(screen.getByText(/of 5, oldest first/)).toBeInTheDocument();
    await user.click(within(tj).getByRole("button", { name: "Always Groceries" }));

    await waitFor(() => expect(screen.queryByRole("group", { name: "Trader Joe's" })).not.toBeInTheDocument());
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.body).toEqual({
      transactions: [
        { id: "tj1", category_id: "c1", approved: true },
        { id: "tj2", category_id: "c1", approved: true },
      ],
    });
    expect(byId("co1")?.approved).toBe(false);
    expect(await ruleOf("trader joe's")).toMatchObject({ budgetId: "b1", payee: "Trader Joe's", categoryId: "c1", approved: 2 });
    expect(screen.getByText(/of 3, oldest first/)).toBeInTheDocument();
  });

  it("reaches the payee's transactions on every page, not just this one", async () => {
    const user = userEvent.setup();
    ynab.transactions = ynab.transactions.filter((t) => t.approved);
    for (let i = 1; i <= 25; i++) ynab.transactions.push(unapproved("Chewy", null, `2026-09-${String(i).padStart(2, "0")}`, { id: `ch${i}` }));
    ynab.transactions.push(unapproved("Shell", "c2", "2026-10-04", { id: "sh1", category_name: "Eating Out" }));
    renderPage();
    const chewy = await screen.findByRole("group", { name: "Chewy" });
    expect(within(chewy).getAllByRole("checkbox", { name: /^Approve \$/ })).toHaveLength(20);
    await user.click(within(chewy).getByRole("button", { name: "Always Stuff I Forgot to Budget For" }));

    await waitFor(() => expect(screen.queryByRole("group", { name: "Chewy" })).not.toBeInTheDocument());
    expect(patches()).toHaveLength(1);
    expect((patches()[0]?.body as { transactions: unknown[] }).transactions).toHaveLength(25);
    expect(ynab.transactions.filter((t) => t.id.startsWith("ch") && t.approved && t.category_id === "c4")).toHaveLength(25);
    expect((await ruleOf("chewy"))?.approved).toBe(25);
    expect(await screen.findByRole("group", { name: "Shell" })).toBeInTheDocument();
  });

  it("leaves a payee's split and transfer alone and listed", async () => {
    const user = userEvent.setup();
    ynab.transactions.push(
      unapproved("Trader Joe's", null, "2026-10-06", { id: "tjs", subtransactions: [{ amount: -5_000, category_id: "c1" }, { amount: -5_000, category_id: "c2" }] }),
      unapproved("Trader Joe's", null, "2026-10-07", { id: "tjt", transfer_account_id: "a2" }),
    );
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    await user.click(within(tj).getByRole("button", { name: "Always Groceries" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect((patches()[0]?.body as { transactions: { id: string }[] }).transactions.map((t) => t.id)).toEqual(["tj1", "tj2"]);
    // the card is redrawn with only the split and the transfer on it
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Trader Joe's" })).queryByRole("button", { name: /^Always/ })).not.toBeInTheDocument());
    const left = screen.getByRole("group", { name: "Trader Joe's" });
    expect(within(left).getByText("Split")).toBeInTheDocument();
    expect(within(left).getByText("Transfer")).toBeInTheDocument();
  });

  it("says so when the write fails, saves no rule, and a second tap works", async () => {
    const user = userEvent.setup();
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    ynab.failNextBulk = 500;
    await user.click(within(tj).getByRole("button", { name: "Always Groceries" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not approve/i);
    expect(await db.ynabPayeeRules.count()).toBe(0);
    expect(screen.getByRole("group", { name: "Trader Joe's" })).toBeInTheDocument();
    expect(byId("tj1")?.approved).toBe(false);

    await user.click(within(screen.getByRole("group", { name: "Trader Joe's" })).getByRole("button", { name: "Always Groceries" }));
    await waitFor(() => expect(byId("tj1")?.approved).toBe(true));
    expect(await ruleOf("trader joe's")).toMatchObject({ approved: 2 });
  });

  it("shows 'Approved N from <payee> as <category> · Undo', and Undo puts them back as they were and drops the rule", async () => {
    const user = userEvent.setup();
    ynab.transactions.push(unapproved("Trader Joe's", "c2", "2026-10-06", { id: "tj3", category_name: "Eating Out" }));
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    // the three differ, so the card has no one category to be 'Always' until he chooses it
    expect(within(tj).queryByRole("button", { name: /^Always/ })).not.toBeInTheDocument();
    await user.selectOptions(within(tj).getByLabelText("Category for Trader Joe's"), "c1");
    await user.click(within(tj).getByRole("button", { name: "Always Groceries" }));
    expect(await screen.findByText("Approved 3 from Trader Joe's as Groceries ·")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByRole("group", { name: "Trader Joe's" })).toBeInTheDocument());
    expect(patches()).toHaveLength(2);
    expect(patches()[1]?.body).toEqual({
      transactions: [
        { id: "tj1", category_id: null, approved: false },
        { id: "tj2", category_id: null, approved: false },
        { id: "tj3", category_id: "c2", approved: false },
      ],
    });
    expect([byId("tj1"), byId("tj2"), byId("tj3")].map((t) => [t?.approved, t?.category_id])).toEqual([[false, null], [false, null], [false, "c2"]]);
    expect(await db.ynabPayeeRules.count()).toBe(0);
    expect(screen.queryByText(/^Approved 3 from/)).not.toBeInTheDocument();
  });

  it("takes the Undo away after 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    try {
      renderPage();
      const tj = await screen.findByRole("group", { name: "Trader Joe's" });
      within(tj).getByRole("button", { name: "Always Groceries" }).click();
      expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(9_000);
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(1_500);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
      expect(await db.ynabPayeeRules.count()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("approves a standing rule's new transactions on opening, so they are never listed; a split stays", async () => {
    await db.ynabPayeeRules.put({ key: "shell", budgetId: "b1", payee: "Shell", categoryId: "c2", createdAt: 1, approved: 4 });
    ynab.transactions.push(unapproved("Shell", null, "2026-10-08", { id: "sh2" }), unapproved("Shell", null, "2026-10-09", { id: "sh3", subtransactions: [{ amount: -5_000, category_id: "c1" }, { amount: -5_000, category_id: "c2" }] }));
    renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    expect(patches()).toHaveLength(1);
    expect((patches()[0]?.body as { transactions: unknown[] }).transactions).toEqual([
      { id: "sh1", category_id: "c2", approved: true },
      { id: "sh2", category_id: "c2", approved: true },
    ]);
    const shell = screen.getByRole("group", { name: "Shell" });
    expect(within(shell).getByText("Split")).toBeInTheDocument();
    expect(within(shell).getAllByRole("checkbox", { name: /^Approve / })).toHaveLength(1);
    expect((await ruleOf("shell"))?.approved).toBe(6);
  });

  it("approves a standing rule's transactions when the app opens, without Clean up being opened", async () => {
    await db.ynabPayeeRules.put({ key: "shell", budgetId: "b1", payee: "Shell", categoryId: "c2", createdAt: 1, approved: 0 });
    renderPage({ approveOnOpen: true }, "/settings");
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(byId("sh1")).toMatchObject({ approved: true, category_id: "c2" });
    await waitFor(async () => expect((await ruleOf("shell"))?.approved).toBe(1));
  });

  it("says a rule's write failed, still lists those transactions, and writes them once on the next load", async () => {
    await db.ynabPayeeRules.put({ key: "shell", budgetId: "b1", payee: "Shell", categoryId: "c2", createdAt: 1, approved: 0 });
    ynab.failNextBulk = 500;
    const { unmount } = renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/payee rules/i);
    expect(screen.getByRole("group", { name: "Shell" })).toBeInTheDocument();
    expect(byId("sh1")?.approved).toBe(false);
    expect((await ruleOf("shell"))?.approved).toBe(0);

    unmount();
    renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    await waitFor(() => expect(byId("sh1")?.approved).toBe(true));
    expect(screen.queryByRole("group", { name: "Shell" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(patches()).toHaveLength(2);
    expect((await ruleOf("shell"))?.approved).toBe(1);
  });

  it("lists the payee rules with their payee, category and how many they approved; Remove stops them and changes nothing written", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    await user.click(within(tj).getByRole("button", { name: "Always Groceries" }));
    await waitFor(() => expect(patches()).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Payee rules" }));
    const list = await screen.findByRole("list", { name: "Payee rules" });
    const item = within(list).getByRole("listitem");
    expect(item).toHaveTextContent("Trader Joe's");
    expect(item).toHaveTextContent("Groceries");
    expect(item).toHaveTextContent("Approved 2");
    await user.click(within(item).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(db.ynabPayeeRules.count()).resolves.toBe(0));
    expect(await screen.findByText("No payee rules yet.")).toBeInTheDocument();
    expect(patches()).toHaveLength(1);
    expect(byId("tj1")).toMatchObject({ approved: true, category_id: "c1" });

    // a new one of that payee is now left for him
    unmount();
    ynab.transactions.push(unapproved("Trader Joe's", null, "2026-10-09", { id: "tj9" }));
    renderPage();
    expect(await screen.findByRole("group", { name: "Trader Joe's" })).toBeInTheDocument();
    expect(patches()).toHaveLength(1);
  });
});

describe("Clean up: the Checks pile (his words, 2026-11-12)", () => {
  const jpeg = () => new File([new Uint8Array([1, 2, 3])], "check.jpg", { type: "image/jpeg" });
  const checks = () =>
    ynab.transactions.push(
      unapproved("CHECK 1089 *8368", null, "2026-01-22", { id: "ck1", amount: -15_000 }),
      unapproved("CHECK 1090 *8368", null, "2026-01-23", { id: "ck2", amount: -40_000 }),
    );
  const diner: CheckReader = async () => ({ payTo: "Joe's Diner", memo: "lunch", category: "Eating Out", confidence: "high", why: "A diner." });
  const writes = () => ynab.requests.filter((r) => r.method !== "GET");

  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:check"), revokeObjectURL: vi.fn() });
  });

  it("lists each check after every other card under a Checks heading, with its number, date and amount", async () => {
    checks();
    renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    const names = screen.getAllByRole("group").filter((g) => g.tagName === "SECTION").map((g) => g.getAttribute("aria-label"));
    expect(names).toEqual(["Trader Joe's", "Costco", "Mystery Shop", "Shell", "CHECK 1089 *8368", "CHECK 1090 *8368"]);
    const heading = screen.getByRole("heading", { name: "Checks" });
    expect(heading.compareDocumentPosition(groupOfPayee("Shell")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(heading.compareDocumentPosition(groupOfPayee("CHECK 1089 *8368")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groupOfPayee("CHECK 1089 *8368")).toHaveTextContent("$15.00");
    expect(groupOfPayee("CHECK 1089 *8368")).toHaveTextContent("2026-01-22");
    expect(groupOfPayee("CHECK 1090 *8368")).toHaveTextContent("$40.00");
    // a check is not a payee to learn: no Always, no AI asked of the payee text, unsure and unticked
    expect(within(groupOfPayee("CHECK 1089 *8368")).queryByRole("button", { name: /^Always/ })).not.toBeInTheDocument();
    expect(within(groupOfPayee("CHECK 1089 *8368")).getByText("Unsure")).toBeInTheDocument();
    expect(within(groupOfPayee("CHECK 1089 *8368")).getByRole("checkbox", { name: /^Approve / })).not.toBeChecked();
  });

  it("has no Checks heading when no check is waiting", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Trader Joe's" });
    expect(screen.queryByRole("heading", { name: "Checks" })).not.toBeInTheDocument();
  });

  it("keeps an image he adds on the device, shows it as a thumbnail that opens full size, and sends nothing to YNAB", async () => {
    checks();
    const user = userEvent.setup();
    renderPage({ readCheck: null });
    const card = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    expect(within(card).getByRole("button", { name: "Add check image" })).toBeInTheDocument();
    await user.upload(within(card).getByTestId("check-file-input"), jpeg());

    const thumb = await within(card).findByRole("img", { name: "Image of check 1089" });
    expect(thumb).toHaveAttribute("src", "blob:check");
    const kept = await db.checkImages.get("ck1");
    expect(kept?.image).toBeDefined();
    expect(kept?.addedAt).toBeGreaterThan(0);
    expect(await db.checkImages.get("ck2")).toBeUndefined();
    expect(writes()).toHaveLength(0);

    await user.click(within(card).getByRole("button", { name: "Open the image of check 1089 full size" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Check 1089, full size" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("takes an image pasted on the card", async () => {
    checks();
    renderPage({ readCheck: null });
    const card = await screen.findByRole("group", { name: "CHECK 1090 *8368" });
    fireEvent.paste(card, { clipboardData: { files: [jpeg()], items: [] } });
    expect(await within(card).findByRole("img", { name: "Image of check 1090" })).toBeInTheDocument();
    expect(await db.checkImages.get("ck2")).toBeDefined();
  });

  it("reads the image for the payee and memo, suggests the category from them with its why, and writes nothing until Approve", async () => {
    checks();
    const user = userEvent.setup();
    const readCheck = vi.fn(diner);
    renderPage({ readCheck });
    const card = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    await user.upload(within(card).getByTestId("check-file-input"), jpeg());

    await waitFor(() => expect(within(card).getByLabelText("Category for CHECK 1089 *8368")).toHaveValue("c2"));
    expect(readCheck).toHaveBeenCalledTimes(1);
    const [request, photo] = readCheck.mock.calls[0]!;
    expect(request).toMatchObject({ check: "CHECK 1089 *8368", date: "2026-01-22", amount: 15 });
    expect(request.categories.map((c) => c.name)).toContain("Eating Out");
    expect(request.categories.map((c) => c.name)).not.toContain("Uncategorized");
    expect(photo).toBeInstanceOf(Blob);
    expect(card).toHaveTextContent("Joe's Diner");
    expect(card).toHaveTextContent("lunch");
    expect(within(card).getByText("Likely")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    // the read is kept with the image: opening again asks nothing more
    expect((await db.checkImages.get("ck1"))?.read).toMatchObject({ payTo: "Joe's Diner", category: "Eating Out" });
  });

  it("writes the payee read into the YNAB memo on Approve, and the payee text is left as YNAB has it", async () => {
    checks();
    const user = userEvent.setup();
    renderPage({ readCheck: diner });
    const card = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    await user.upload(within(card).getByTestId("check-file-input"), jpeg());
    await waitFor(() => expect(within(card).getByLabelText("Category for CHECK 1089 *8368")).toHaveValue("c2"));

    await user.click(within(card).getByRole("checkbox", { name: /^Approve / }));
    await user.click(screen.getByRole("button", { name: "Approve 3" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    const sent = (patches()[0]?.body as { transactions: Record<string, unknown>[] }).transactions;
    expect(sent).toContainEqual({ id: "ck1", category_id: "c2", memo: "Paid to Joe's Diner (lunch)", approved: true });
    expect(ynab.transactions.find((t) => t.id === "ck1")).toMatchObject({ payee_name: "CHECK 1089 *8368", approved: true });
    // an image never goes to YNAB, and a check with no read has no memo written
    expect(JSON.stringify(patches()[0]?.body)).not.toContain("blob");
    expect(sent.find((t) => t.id === "tj1")).not.toHaveProperty("memo");
  });

  it("shows the kept image and its read when Clean up is opened again, and asks the mill nothing", async () => {
    checks();
    const user = userEvent.setup();
    const first = renderPage({ readCheck: diner });
    const card = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    await user.upload(within(card).getByTestId("check-file-input"), jpeg());
    await waitFor(() => expect(within(card).getByLabelText("Category for CHECK 1089 *8368")).toHaveValue("c2"));
    first.unmount();

    const readCheck = vi.fn(diner);
    renderPage({ readCheck });
    const again = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    expect(await within(again).findByRole("img", { name: "Image of check 1089" })).toBeInTheDocument();
    expect(within(again).getByLabelText("Category for CHECK 1089 *8368")).toHaveValue("c2");
    expect(again).toHaveTextContent("Joe's Diner");
    expect(readCheck).not.toHaveBeenCalled();
    // the other check has none
    expect(within(groupOfPayee("CHECK 1090 *8368")).queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the image and says so when the read fails, leaving the category as it was", async () => {
    checks();
    const user = userEvent.setup();
    renderPage({
      readCheck: async () => {
        throw new Error("The factory could not answer this one.");
      },
    });
    const card = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    await user.upload(within(card).getByTestId("check-file-input"), jpeg());
    expect(await within(card).findByText(/could not be read/i)).toBeInTheDocument();
    expect(await within(card).findByRole("img", { name: "Image of check 1089" })).toBeInTheDocument();
    expect(within(card).getByLabelText("Category for CHECK 1089 *8368")).toHaveValue("c4");
    expect((await db.checkImages.get("ck1"))?.read).toBeUndefined();
  });

  it("will not name Groceries for a payee read, which falls to Stuff I Forgot to Budget For", async () => {
    checks();
    const user = userEvent.setup();
    renderPage({ readCheck: async () => ({ payTo: "Farmer Joe", memo: "eggs", category: "Groceries", confidence: "high", why: "Eggs." }) });
    const card = await screen.findByRole("group", { name: "CHECK 1089 *8368" });
    await user.upload(within(card).getByTestId("check-file-input"), jpeg());
    await waitFor(() => expect(card).toHaveTextContent("Farmer Joe"));
    expect(within(card).getByLabelText("Category for CHECK 1089 *8368")).toHaveValue("c4");
  });
});

describe("Clean up: an inflow (his words, 2026-11-12: 'Inflow should go to Ready to Assign')", () => {
  it("suggests Ready to Assign for a $108.93 Chase Rewards inflow, and Always makes a Ready to Assign rule", async () => {
    const user = userEvent.setup();
    await new YnabRepository().applyCategories(
      [groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"], ["rta", "Inflow: Ready to Assign"]]), groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]]), groupOf("g2", "Home", [["c3", "Household"]]), groupOf("g3", "Surprises", [["c4", "Stuff I Forgot to Budget For"]])],
      2,
    );
    ynab.transactions.push(unapproved("Chase Rewards", null, "2026-03-17", { id: "cr1", amount: 108_930 }));
    renderPage();
    const chase = await screen.findByRole("group", { name: "Chase Rewards" });
    expect(within(chase).getByRole("combobox", { name: "Category for Chase Rewards" })).toHaveValue("rta");
    expect(within(chase).getByText(/Ready to Assign/, { selector: "p" })).toBeInTheDocument();
    expect(within(chase).queryByText(/Stuff I Forgot to Budget For/, { selector: "p" })).not.toBeInTheDocument();
    expect(within(chase).getByText("Unsure")).toBeInTheDocument();
    await user.click(within(chase).getByRole("button", { name: "Always Inflow: Ready to Assign" }));

    await waitFor(() => expect(screen.queryByRole("group", { name: "Chase Rewards" })).not.toBeInTheDocument());
    expect(ynab.transactions.find((t) => t.id === "cr1")).toMatchObject({ approved: true, category_id: "rta" });
    expect(await db.ynabPayeeRules.get("chase rewards")).toMatchObject({ categoryId: "rta", approved: 1 });
  });

  it("does not offer Ready to Assign for a charge", async () => {
    await new YnabRepository().applyCategories([groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"], ["rta", "Inflow: Ready to Assign"]])], 2);
    renderPage();
    const tj = await screen.findByRole("group", { name: "Trader Joe's" });
    expect(within(tj).queryByRole("option", { name: "Inflow: Ready to Assign" })).not.toBeInTheDocument();
  });
});
