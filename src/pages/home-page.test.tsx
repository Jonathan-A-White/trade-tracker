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
import { PayeeRuleRepository } from "@/ynab/payee-rules";
import { createYnabWriter } from "@/ynab/writer";

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

  it("two phones over one backend: his Done claims the shared charge, and her Home drops it on its next poll as sorted by him", async () => {
    await setFamilyOn(true);
    const alert = backend.receive({ kind: "charge", amount: "8.50", merchant: "Dunkin'", last4: "9876" });
    const herPhone: AlertsClient = makeAlertsClient(BACKEND, new Uint8Array(32).fill(9), backend.fetch);
    const hisPhone: AlertsClient = makeAlertsClient(BACKEND, new Uint8Array(32).fill(7), backend.fetch);
    renderHome({ client: herPhone, me: "Sarah", pollMs: 200 });
    expect(await screen.findByRole("heading", { name: "Waiting · 1" })).toBeInTheDocument();

    // his phone's Done claims it; her list drops it on her phone's next poll
    await act(() => hisPhone.claim(alert.id));
    expect(await screen.findByRole("heading", { name: "Waiting · 0" }, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sorted today · 1" })).toBeInTheDocument();
    const sorted = screen.getByRole("list", { name: "Sorted today" });
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
    expect(screen.getByRole("heading", { name: "Waiting · 0" })).toBeInTheDocument();
  });
});

describe("Home: header and stat labels", () => {
  it("says 'Track what you spend' under the title, with Family Off, and no longer says grocery", async () => {
    renderHome({ me: "Jonathan" });
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    const header = screen.getByRole("banner");
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
    await user.click(screen.getByRole("link", { name: "Clean up" }));
    expect((await screen.findAllByLabelText("Approve $43.12 on 2026-11-10")).length).toBeGreaterThan(0);
    expect(ynab.transactions.find((t) => t.id === "t1")?.approved).toBe(false);
  });

  it("'Stop this rule' takes the rule away and leaves what it approved listed", async () => {
    ynab.transactions.push(tx("t1", "Chewy"));
    const user = userEvent.setup();
    renderYnabHome();
    expect(await screen.findByRole("heading", { name: "Approved for you · 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop this rule" }));
    await waitFor(async () => expect(await new PayeeRuleRepository().get("chewy")).toBeUndefined());
    expect(screen.getByRole("heading", { name: "Approved for you · 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop this rule" })).not.toBeInTheDocument();
  });

  it("draws nothing when no rule has approved anything", async () => {
    renderYnabHome();
    expect(await screen.findByText("Start New Trip")).toBeInTheDocument();
    expect(screen.queryByText(/Approved for you/)).not.toBeInTheDocument();
  });
});
