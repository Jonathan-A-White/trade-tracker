import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useRoutes } from "react-router";
import { FactoryProvider } from "@/contexts/factory-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { db } from "@/db/database";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { makeAlertsClient, type AlertsClient } from "@/family/alerts-client";
import { fakeAlerts, type FakeAlerts } from "@/family/fake-alerts";
import { reloadPage } from "@/move/reload";
import { appRoutes } from "@/routes";
import type { PasskeyPort } from "@/services/passkey";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { setFamilyOn, setYnabOn } from "@/settings/connections";
import { SortProvider, type SortSeams } from "@/sort/sort-context";
import { ME_KEY } from "@/sort/waiting";
import { createYnabClient } from "@/ynab/api";
import { fakeYnab, groupOf, type FakeYnab, type FakeYnabTransaction } from "@/ynab/fake-ynab";
import { monthsBefore } from "@/ynab/budget-ideas";
import type { IdeaReplyAnswer, IdeaReplyRequest } from "@/ynab/budget-idea-reply";
import { PayeeRuleRepository, SHORT_RULE_KEY } from "@/ynab/payee-rules";
import { day } from "@/ynab/tally";
import { createYnabWriter } from "@/ynab/writer";
import { ASYNC_WAIT_MS } from "pwa-kit/test-preset";

vi.mock("@/move/reload", () => ({ reloadPage: vi.fn() }));

const BACKEND = "https://backend.example.test";
const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

function Routed() {
  return useRoutes(appRoutes[0].children ?? []);
}

let backend: FakeAlerts;

function renderHome(seams: SortSeams) {
  return render(
    <ThemeProvider>
      <FactoryProvider checkLicence={async () => ({ state: "none", checkedAt: "x" })} passkeyPort={noWebAuthn}>
        <SortProvider writer={null} refreshBalances={async () => {}} pollMs={60_000} {...seams}>
          <MemoryRouter initialEntries={["/"]}>
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
  backend = fakeAlerts();
  const family = new FamilyRepository();
  await family.addCard({ lastFour: "1234", owner: "Jonathan" });
  await family.addCard({ lastFour: "5678", owner: "Sarah" });
  await family.addCard({ lastFour: "9876", owner: "shared" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home: Waiting and Sorted today", () => {
  it("draws nothing of the family and asks nothing while Family is Off", async () => {
    backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    renderHome({ client: makeAlertsClient(BACKEND, new Uint8Array(32).fill(7), backend.fetch), me: "Jonathan" });
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/Waiting/)).not.toBeInTheDocument();
    expect(backend.requests).toEqual([]);
  });

  it("shows both people's charges, this phone's person's first, and a shared card's as theirs", async () => {
    await setFamilyOn(true);
    backend.receive({ kind: "charge", amount: "43.12", merchant: "Trader Joe's", last4: "1234" });
    backend.receive({ kind: "charge", amount: "12.00", merchant: "Shell", last4: "5678" });
    backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "9876" });
    backend.receive({ kind: "forward-confirm", code: "493827" });
    renderHome({ client: makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch), me: "Sarah" });

    expect(await screen.findByRole("heading", { name: "Waiting · 3" })).toBeInTheDocument();
    const yours = screen.getByRole("list", { name: "Yours" });
    expect(within(yours).getAllByRole("link").map((l) => l.textContent)).toEqual([
      expect.stringContaining("Dunkin'"),
      expect.stringContaining("Shell"),
    ]);
    const his = screen.getByRole("list", { name: "Jonathan's" });
    expect(within(his).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([`/sort/${backend.feed[0]!.id}`]);
  });

  it("does not count or offer a GOOGLE*GPAY TEMP card check, says it is a hold that drops off by itself, and still waits on a real charge", async () => {
    await setFamilyOn(true);
    backend.receive({ kind: "charge", amount: "1.00", merchant: "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", last4: "9876", when: new Date().toISOString() });
    backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "9876" });
    renderHome({ client: makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch), me: "Sarah" });

    expect(await screen.findByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();
    const yours = screen.getByRole("list", { name: "Yours" });
    expect(within(yours).getAllByRole("link")).toHaveLength(1);
    expect(within(yours).getByText("Dunkin'")).toBeInTheDocument();
    expect(screen.queryByText(/GPAY TEMP/, { selector: "a *" })).not.toBeInTheDocument();
    const hold = screen.getByText(/Hold, drops off by itself/);
    expect(hold).toHaveTextContent("$1.00");
    expect(hold).toHaveTextContent("GOOGLE*GPAY TEMP");
    expect(hold.closest("a")).toBeNull();
  });

  it("two phones over one backend: his Done claims the shared charge, and her Home drops it on its next poll as sorted by him", async () => {
    await setFamilyOn(true);
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "9876" });
    const herPhone: AlertsClient = makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch);
    const hisPhone: AlertsClient = makeAlertsClient(BACKEND, new Uint8Array(32).fill(7), backend.fetch);
    renderHome({ client: herPhone, me: "Sarah", pollMs: 200 });
    expect(await screen.findByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();

    // his phone's Done claims it; her list drops it on her phone's next poll
    await act(() => hisPhone.claim(alert.id));
    expect(await screen.findByRole("heading", { name: "Waiting · 0" }, { timeout: ASYNC_WAIT_MS })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Sorted today · 1" })).toBeInTheDocument();
    const sorted = await screen.findByRole("list", { name: "Sorted today" });
    expect(within(sorted).getByText("$8.50 Dunkin'")).toBeInTheDocument();
    expect(within(sorted).getByText("Jonathan")).toBeInTheDocument();
  });

  it("asks whose phone this is when the cards name two people, and keeps the answer on the phone", async () => {
    await setFamilyOn(true);
    const user = userEvent.setup();
    backend.receive({ kind: "charge", amount: "12.00", merchant: "Shell", last4: "5678" });
    renderHome({ client: makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch) });
    expect(await screen.findByText("Whose phone is this? Their charges come first.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sarah" }));
    expect(localStorage.getItem(ME_KEY)).toBe("Sarah");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Yours" })).getByText("Shell")).toBeInTheDocument());
    expect(screen.getByText(/This is Sarah's phone/)).toBeInTheDocument();
  });

  it("with the backend out of reach shows the reason and Try again", async () => {
    await setFamilyOn(true);
    backend.refuse = { status: 503 };
    renderHome({ client: makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch), me: "Sarah" });
    expect(await screen.findByText("The backend could not answer (503).")).toBeInTheDocument();
    const user = userEvent.setup();
    backend.refuse = null;
    backend.receive({ kind: "charge", amount: "12.00", merchant: "Shell", last4: "5678" });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();
  });

  it("with the key locked says to unlock it, and shows no list", async () => {
    await setFamilyOn(true);
    renderHome({ me: "Sarah" });
    expect(await screen.findByText(/Make the key under/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Waiting · 0" })).toBeInTheDocument();
  });
});

describe("Home: header and stat labels", () => {
  it("says 'Track what you spend' under the title, with Family Off, and no longer says grocery", async () => {
    renderHome({ me: "Jonathan" });
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("heading", { name: "TradeTracker" })).toBeInTheDocument();
    expect(within(header).getByText("Track what you spend")).toBeInTheDocument();
    expect(header).not.toHaveTextContent(/grocery/i);
    expect(header).not.toHaveTextContent(/ynab/i);
  });

  it("labels the stat that sums trips 'Spent on Trips'", async () => {
    renderHome({ me: "Jonathan" });
    expect(await screen.findByText("Spent on Trips")).toBeInTheDocument();
    expect(screen.queryByText("Spent This Month")).not.toBeInTheDocument();
  });
});

describe("Home: Moving from the old address", () => {
  const LINE = "Moving from the old address? Unpack";
  const packFile = () =>
    new File(
      [
        JSON.stringify({
          version: 1,
          app: "trade-tracker",
          from: "http://old.example",
          when: "2026-11-05T20:00:00.000Z",
          db: { schema: db.verno, tables: { stores: [{ id: "n1", name: "Aldi", createdAt: 1, updatedAt: 1 }] } },
          storage: { "tradetracker-factory-public": "02aabb" },
        }),
      ],
      "tradetracker-move-2026-11-05.json",
      { type: "application/json" },
    );

  beforeEach(() => {
    vi.mocked(reloadPage).mockClear();
    sessionStorage.clear();
  });

  it("offers the line, 44 px tall, while the phone has no key", async () => {
    renderHome({ me: "Jonathan" });
    const line = await screen.findByRole("button", { name: LINE });
    expect(line.className).toMatch(/min-h-\[44px\]/);
    expect(screen.getByLabelText("Pack file")).toHaveAttribute("accept", ".json");
  });

  it("draws nothing of it once the phone has a key", async () => {
    localStorage.setItem("tradetracker-factory-public", "02aabb");
    renderHome({ me: "Jonathan" });
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LINE })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pack file")).not.toBeInTheDocument();
  });

  it("restores the picked file (after asking, since this phone holds cards), keeps its key and reloads; Home then has no line", async () => {
    const user = userEvent.setup();
    const first = renderHome({ me: "Jonathan" });
    await screen.findByRole("button", { name: LINE });
    await user.upload(screen.getByLabelText("Pack file"), packFile());
    await user.click(await screen.findByRole("button", { name: "Unpack" }));
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect((await db.stores.toArray()).map((s) => s.id)).toEqual(["n1"]);
    expect(await db.familyCards.count()).toBe(0);
    expect(localStorage.getItem("tradetracker-factory-public")).toBe("02aabb");
    first.unmount();

    // the app reloaded: the ordinary Home, with one line of what came
    renderHome({ me: "Jonathan" });
    expect(await screen.findByText(/Unpacked: 1 stores, 0 items, 0 trips, 0 prices, 0 photos\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LINE })).not.toBeInTheDocument();
  });
});

describe("Home: Approved for you (what the payee rules approved)", () => {
  const groups = [groupOf("gi", "Internal Master Category", [["unc", "Uncategorized"], ["rta", "Inflow: Ready to Assign"]]), groupOf("g1", "Food", [["c1", "Groceries"], ["c2", "Eating Out"]])];
  let ynab: FakeYnab;
  const tx = (id: string, payee: string, over: Partial<FakeYnabTransaction> = {}): FakeYnabTransaction => ({
    id,
    account_id: "a1",
    date: "2026-11-10",
    amount: -43_120,
    payee_name: payee,
    category_id: null,
    approved: false,
    ...over,
  });

  function renderYnabHome() {
    const client = createYnabClient("good", ynab.fetch);
    const writer = createYnabWriter({ getClient: async () => client });
    return renderHome({ writer, ynabClient: async () => client, me: "Jonathan" });
  }

  beforeEach(async () => {
    ynab = fakeYnab("good", [{ id: "b1", name: "Our Budget", categoryGroups: groups, accounts: [], payees: [] }]);
    const repo = new YnabRepository();
    await repo.saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await repo.applyCategories(groups, 1);
    await setYnabOn(true);
    await new PayeeRuleRepository().put({ key: "chewy", budgetId: "b1", payee: "Chewy", categoryId: "c1", createdAt: 1, approved: 0 });
  });

  it("lists what a rule approved with payee, amount, date and category, and Undo puts one back to Waiting / Clean up, keeping the rule", async () => {
    ynab.transactions.push(tx("t1", "Chewy"), tx("t2", "Chewy", { amount: -9_990, date: "2026-11-11" }), tx("t3", "Shell"));
    const user = userEvent.setup();
    renderYnabHome();

    expect(await screen.findByRole("heading", { name: "Approved for you · 2" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Approved for you" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent).join("|")).toMatch(/Chewy/);
    const first = rows.find((r) => r.textContent?.includes("$43.12"))!;
    expect(first).toHaveTextContent("Chewy");
    expect(first).toHaveTextContent("Nov 10");
    expect(first).toHaveTextContent("Groceries");
    expect(ynab.transactions.map((t) => [t.id, t.approved])).toEqual([["t1", true], ["t2", true], ["t3", false]]);

    await user.click(within(first).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "Approved for you · 1" })).toBeInTheDocument();
    expect(ynab.transactions.map((t) => [t.id, t.approved, t.category_id])).toEqual([["t1", false, null], ["t2", true, "c1"], ["t3", false, null]]);
    expect((await new PayeeRuleRepository().get("chewy"))?.categoryId).toBe("c1");

    // and it is waiting in Clean up again, not approved a second time by the rule
    await user.click(await screen.findByRole("link", { name: "Clean up" }));
    expect((await screen.findAllByLabelText("Approve $43.12 on 2026-11-10")).length).toBeGreaterThan(0);
    expect(ynab.transactions.find((t) => t.id === "t1")?.approved).toBe(false);
  });

  it("'Stop this rule' takes the rule away and leaves what it approved listed", async () => {
    ynab.transactions.push(tx("t1", "Chewy"));
    const user = userEvent.setup();
    renderYnabHome();
    expect(await screen.findByRole("heading", { name: "Approved for you · 1" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Stop this rule" }));
    await waitFor(async () => expect(await new PayeeRuleRepository().get("chewy")).toBeUndefined());
    expect(screen.getByRole("heading", { name: "Approved for you · 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop this rule" })).not.toBeInTheDocument();
  });

  describe("when the rule's category lacks the money (his words, 2026-11-12)", () => {
    const withFun = [...groups, groupOf("g2", "Fun", [["c3", "Fun Money", 5_000]])];

    beforeEach(async () => {
      localStorage.removeItem(SHORT_RULE_KEY);
      ynab.budgets[0]!.categoryGroups = withFun;
      await new YnabRepository().applyCategories(withFun, 2);
      await new PayeeRuleRepository().put({ key: "chewy", budgetId: "b1", payee: "Chewy", categoryId: "c3", createdAt: 1, approved: 0 });
    });

    it("approves it and the row says how far over budget the category went", async () => {
      ynab.transactions.push(tx("t1", "Chewy"), tx("t2", "Chewy", { amount: -1_000 }));
      renderYnabHome();
      expect(await screen.findByRole("heading", { name: "Approved for you · 2" })).toBeInTheDocument();
      const rows = within(screen.getByRole("list", { name: "Approved for you" })).getAllByRole("listitem");
      const big = rows.find((r) => r.textContent?.includes("$43.12"))!;
      expect(big).toHaveTextContent("over budget by $38.12 in Fun Money");
      expect(ynab.transactions.find((t) => t.id === "t1")?.approved).toBe(true);
    });

    it("with 'Leave it for me' it is not approved, and waits in Clean up with the shortfall", async () => {
      localStorage.setItem(SHORT_RULE_KEY, "hold");
      ynab.transactions.push(tx("t1", "Chewy"));
      const user = userEvent.setup();
      renderYnabHome();
      await user.click(await screen.findByRole("link", { name: "Clean up" }));
      expect(await screen.findByText("Held for you: Fun Money is short by $38.12 for this.")).toBeInTheDocument();
      expect(ynab.transactions.find((t) => t.id === "t1")?.approved).toBe(false);
      expect(screen.queryByText(/Approved for you/)).not.toBeInTheDocument();
    });
  });

  it("draws nothing when no rule has approved anything", async () => {
    renderYnabHome();
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    expect(screen.queryByText(/Approved for you/)).not.toBeInTheDocument();
  });
});

describe("Home: Budget ideas", () => {
  const monthsAgo = (months: number) => monthsBefore(day(Date.now()), months);
  let ynab: FakeYnab;

  async function connect() {
    ynab = fakeYnab("tok", [
      { id: "b1", name: "Our Budget", categoryGroups: [groupOf("g1", "Everyday", [["f1", "Stuff I Forgot to Budget For"], ["c2", "Groceries"]])], accounts: [], payees: [] },
    ]);
    await new YnabRepository().saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
    await new YnabRepository().applyCategories(ynab.budgets[0]!.categoryGroups, 1);
    const charge = (id: string, payee: string, months: number, dollars: number): FakeYnabTransaction => ({
      id,
      account_id: "a1",
      date: monthsAgo(months),
      amount: -dollars * 1000,
      payee_name: payee,
      category_id: "f1",
    });
    // Hardware Hank: three charges in as many months; Chewy: three, and smaller
    ynab.transactions.push(charge("t1", "Hardware Hank", 1, 60), charge("t2", "Hardware Hank", 2, 60), charge("t3", "Hardware Hank", 3, 60));
    ynab.transactions.push(charge("t4", "Chewy", 1, 20), charge("t5", "Chewy", 2, 20), charge("t6", "Chewy", 3, 20));
  }
  const seams = (): SortSeams => ({ ynabClient: async () => createYnabClient("tok", ynab.fetch), suggest: null });

  it("draws nothing of it while YNAB is Off, though a budget's charges are kept", async () => {
    await connect();
    localStorage.setItem("tradetracker-budget-ideas-charges", JSON.stringify({ budgetId: "b1", readAt: Date.now(), charges: [{ id: "t1", date: monthsAgo(1), payee: "Hardware Hank", amount: 60 }] }));
    renderHome(seams());
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Budget ideas")).not.toBeInTheDocument();
    expect(ynab.requests).toEqual([]);
  });

  it("proposes the payee that kept landing in Stuff I Forgot to Budget For, saying what it would add", async () => {
    await connect();
    await setYnabOn(true);
    renderHome(seams());
    const card = await screen.findByRole("region", { name: "Budget ideas" });
    const idea = await within(card).findByRole("listitem", { name: "Hardware Hank" });
    expect(idea).toHaveTextContent("$45 a month");
    expect(idea).toHaveTextContent("3 charges, $180.00 in the last year went to Stuff I Forgot to Budget For: Hardware Hank.");
    expect(idea).toHaveTextContent("To add in YNAB: a category named Hardware Hank in the group Everyday, with a target of $45 a month.");
    expect(within(idea).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(within(idea).getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(within(idea).getByRole("button", { name: "Never" })).toBeInTheDocument();
  });

  it("asks the guesser what each payee is for, once, and proposes two brands of one kind as one category", async () => {
    await connect();
    ynab.transactions.length = 0;
    const charge = (id: string, payee: string, months: number, dollars: number): FakeYnabTransaction => ({ id, account_id: "a1", date: monthsAgo(months), amount: -dollars * 1000, payee_name: payee, category_id: "f1" });
    ynab.transactions.push(charge("p1", "Puracy Naturals", 4, 149.91), charge("b1", "Blueland", 2, 38.4), charge("b2", "Blueland", 1, 41.2));
    await setYnabOn(true);
    const asked: string[] = [];
    renderHome({ ...seams(), suggest: async (request) => { asked.push(request.merchant); return { category: "Cleaning supplies", why: "Household cleaners." }; } });
    const idea = await screen.findByRole("listitem", { name: "Cleaning supplies" });
    expect(idea).toHaveTextContent("3 charges");
    expect(idea).toHaveTextContent("Blueland, Puracy Naturals");
    expect(screen.getAllByRole("listitem", { name: /./ })).toHaveLength(1);
    expect(asked.sort()).toEqual(["Blueland", "Puracy Naturals"]);
    expect(JSON.parse(localStorage.getItem("tradetracker-budget-ideas-kinds")!)).toEqual({ blueland: "Cleaning supplies", "puracy naturals": "Cleaning supplies" });
  });

  it("Add creates the category with its monthly target in YNAB and says so", async () => {
    await connect();
    await setYnabOn(true);
    const user = userEvent.setup();
    renderHome(seams());
    const idea = await screen.findByRole("listitem", { name: "Hardware Hank" });
    await user.click(within(idea).getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Added Hardware Hank to YNAB in the group Everyday, with a target of $45 a month.")).toBeInTheDocument();
    const made = ynab.requests.find((r) => r.method === "POST" && r.path === "/v1/budgets/b1/categories");
    expect(made?.body).toEqual({ category: { name: "Hardware Hank", category_group_id: "g1", goal_target: 45_000, goal_frequency: "monthly" } });
    expect(screen.queryByRole("listitem", { name: "Hardware Hank" })).not.toBeInTheDocument();
  });

  it("when YNAB refuses, says exactly what to add by hand", async () => {
    await connect();
    await setYnabOn(true);
    const user = userEvent.setup();
    renderHome({ ynabClient: async () => ({ ...createYnabClient("tok", ynab.fetch), createCategory: async () => { throw new Error("YNAB answered 400. Try again later."); } }), suggest: null });
    const idea = await screen.findByRole("listitem", { name: "Hardware Hank" });
    await user.click(within(idea).getByRole("button", { name: "Add" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not add it in YNAB (YNAB answered 400. Try again later.). To add in YNAB: a category named Hardware Hank in the group Everyday, with a target of $45 a month.");
    expect(screen.getByRole("listitem", { name: "Hardware Hank" })).toBeInTheDocument();
  });

  describe("Reply", () => {
    const replying = (answer: IdeaReplyAnswer | Error | "never", asked: IdeaReplyRequest[] = []): SortSeams => ({
      ...seams(),
      replyTimeoutMs: 80,
      replyIdea: (request, signal) => {
        asked.push(request);
        if (answer === "never") return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    });
    async function replyTo(name: string, words: string) {
      const user = userEvent.setup();
      const idea = await screen.findByRole("listitem", { name });
      await user.click(within(idea).getByRole("button", { name: "Reply" }));
      await user.type(within(idea).getByLabelText(`Your reply to ${name}`), words);
      await user.click(within(idea).getByRole("button", { name: "Send" }));
      return { user, idea };
    }

    it("shows Reply beside Add, Not now and Never, opening a text box", async () => {
      await connect();
      await setYnabOn(true);
      const user = userEvent.setup();
      renderHome(replying({ outcome: "explain", say: "x" }));
      const idea = await screen.findByRole("listitem", { name: "Hardware Hank" });
      expect(within(idea).queryByLabelText("Your reply to Hardware Hank")).not.toBeInTheDocument();
      await user.click(within(idea).getByRole("button", { name: "Reply" }));
      expect(within(idea).getByLabelText("Your reply to Hardware Hank")).toBeInTheDocument();
    });

    it("sends the idea, its charges and his words, and says Thinking… while it waits", async () => {
      await connect();
      await setYnabOn(true);
      const asked: IdeaReplyRequest[] = [];
      let release: (a: IdeaReplyAnswer) => void = () => undefined;
      renderHome({ ...seams(), replyIdea: (request) => { asked.push(request); return new Promise((resolve) => { release = resolve; }); } });
      const user = userEvent.setup();
      const idea = await screen.findByRole("listitem", { name: "Hardware Hank" });
      await user.click(within(idea).getByRole("button", { name: "Reply" }));
      await user.type(within(idea).getByLabelText("Your reply to Hardware Hank"), "Why $45?");
      await user.click(within(idea).getByRole("button", { name: "Send" }));
      expect(await within(idea).findByText("Thinking…")).toBeInTheDocument();
      expect(asked).toHaveLength(1);
      expect(asked[0]!.words).toBe("Why $45?");
      expect(asked[0]!.idea).toMatchObject({ name: "Hardware Hank", cadence: "monthly", amount: 45, total: 180, payees: ["Hardware Hank"] });
      expect(asked[0]!.idea.charges).toHaveLength(3);
      expect(asked[0]!.categories.map((c) => c.name)).toContain("Groceries");
      release({ outcome: "explain", say: "It is the average of three months." });
      expect(await within(idea).findByText("It is the average of three months.")).toBeInTheDocument();
      expect(within(idea).queryByText("Thinking…")).not.toBeInTheDocument();
    });

    it("explain: a short answer under the card, the card as it was", async () => {
      await connect();
      await setYnabOn(true);
      renderHome(replying({ outcome: "explain", say: "Three charges of $60 in three months." }));
      const { idea } = await replyTo("Hardware Hank", "Why $45 a month?");
      expect(await within(idea).findByText("Three charges of $60 in three months.")).toBeInTheDocument();
      expect(idea).toHaveTextContent("$45 a month");
      expect(localStorage.getItem("tradetracker-budget-ideas-reasons")).toBeNull();
    });

    it("revise: the card changes in place and stays changed after Home is drawn again", async () => {
      await connect();
      await setYnabOn(true);
      const first = renderHome(replying({ outcome: "revise", say: "Now $100 a month, as you said.", amount: 100 }));
      const { idea } = await replyTo("Hardware Hank", "Make it $100");
      await waitFor(() => expect(screen.getByRole("listitem", { name: "Hardware Hank" })).toHaveTextContent("$100 a month"));
      expect(screen.getByRole("listitem", { name: "Hardware Hank" })).toHaveTextContent("To add in YNAB: a category named Hardware Hank in the group Everyday, with a target of $100 a month.");
      expect(within(screen.getByRole("listitem", { name: "Hardware Hank" })).getByText("Now $100 a month, as you said.")).toBeInTheDocument();
      expect(idea).toBeInTheDocument();
      first.unmount();
      renderHome(seams());
      expect(await screen.findByRole("listitem", { name: "Hardware Hank" })).toHaveTextContent("$100 a month");
    });

    it("revise into a category the budget has: the card goes, and his reason is shown once", async () => {
      await connect();
      await setYnabOn(true);
      renderHome(replying({ outcome: "revise", say: "Folded into Groceries.", name: "Groceries", remember: "Hank's is groceries to us." }));
      await replyTo("Hardware Hank", "fold these into Groceries");
      expect(await screen.findByRole("status")).toHaveTextContent('Folded into Groceries. Your reason, kept for later ideas: "Hank\'s is groceries to us."');
      expect(screen.queryByRole("listitem", { name: "Hardware Hank" })).not.toBeInTheDocument();
    });

    it("retire: the card goes, his reason is shown once, and the payee he ruled out is not offered again (the NAC case)", async () => {
      await connect();
      ynab.transactions.push(
        ...[3, 2, 1].map((m, i): FakeYnabTransaction => ({ id: `n${i}`, account_id: "a1", date: monthsAgo(m), amount: -1_112_500, payee_name: "New Apostolic Church", category_id: "f1" })),
      );
      await setYnabOn(true);
      const asked: IdeaReplyRequest[] = [];
      const first = renderHome(
        replying({ outcome: "retire", say: "Understood: no more ideas for New Apostolic Church.", rulesOut: ["New Apostolic Church"], remember: "We moved our tithe to Brookfield First." }, asked),
      );
      await replyTo("New Apostolic Church", "We won't be donating there anymore as we have shifted churches and our tithe fully to Brookfield First.");
      expect(await screen.findByRole("status")).toHaveTextContent('Understood: no more ideas for New Apostolic Church. Your reason, kept for later ideas: "We moved our tithe to Brookfield First."');
      expect(screen.queryByRole("listitem", { name: "New Apostolic Church" })).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem("tradetracker-budget-ideas-reasons")!)).toMatchObject([{ words: "We moved our tithe to Brookfield First.", payees: ["New Apostolic Church"] }]);
      first.unmount();

      // another idea's reply is given the reason; and even with his dismissal forgotten the church is not proposed again
      localStorage.removeItem("tradetracker-budget-ideas-dismissed");
      localStorage.removeItem("tradetracker-budget-ideas-introduced");
      renderHome(replying({ outcome: "explain", say: "ok" }, asked));
      expect(await screen.findByRole("listitem", { name: "Hardware Hank" })).toBeInTheDocument();
      expect(screen.queryByRole("listitem", { name: "New Apostolic Church" })).not.toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(within(screen.getByRole("listitem", { name: "Hardware Hank" })).getByRole("button", { name: "Reply" }));
      await user.type(screen.getByLabelText("Your reply to Hardware Hank"), "hi");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(asked).toHaveLength(2));
      expect(asked[1]!.reasons).toEqual([{ words: "We moved our tithe to Brookfield First.", payees: ["New Apostolic Church"] }]);
    });

    it("no answer within the limit leaves the card as it was, with 'No answer yet; try again' and his words kept", async () => {
      await connect();
      await setYnabOn(true);
      renderHome(replying("never"));
      const { idea } = await replyTo("Hardware Hank", "Make it $100");
      expect(await within(idea).findByText("No answer yet; try again")).toBeInTheDocument();
      expect(idea).toHaveTextContent("$45 a month");
      expect(within(idea).getByLabelText("Your reply to Hardware Hank")).toHaveValue("Make it $100");
      expect(localStorage.getItem("tradetracker-budget-ideas-reasons")).toBeNull();
    });

    it("a failed or unusable answer says the same and changes nothing", async () => {
      await connect();
      await setYnabOn(true);
      renderHome(replying({ outcome: "explain", say: "" }));
      const { idea } = await replyTo("Hardware Hank", "hello");
      expect(await within(idea).findByText("No answer yet; try again")).toBeInTheDocument();
    });

    it("with no licence there is nothing to ask: it says so, and keeps his words", async () => {
      await connect();
      await setYnabOn(true);
      renderHome({ ...seams(), replyIdea: null });
      const { idea } = await replyTo("Hardware Hank", "hello");
      expect(await within(idea).findByText("Hold the licence to send a reply.")).toBeInTheDocument();
    });
  });

  it("Not now hides an idea, Never hides another, and they stay hidden after Home is drawn again", async () => {
    await connect();
    await setYnabOn(true);
    const user = userEvent.setup();
    const first = renderHome(seams());
    await user.click(within(await screen.findByRole("listitem", { name: "Hardware Hank" })).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("listitem", { name: "Hardware Hank" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("listitem", { name: "Chewy" })).getByRole("button", { name: "Never" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Budget ideas" })).not.toBeInTheDocument());
    first.unmount();
    renderHome(seams());
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("region", { name: "Budget ideas" })).not.toBeInTheDocument();
  });
});
