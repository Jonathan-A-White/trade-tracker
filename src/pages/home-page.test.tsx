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
import { setFamilyOn } from "@/settings/connections";
import { SortProvider, type SortSeams } from "@/sort/sort-context";
import { ME_KEY } from "@/sort/waiting";

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
