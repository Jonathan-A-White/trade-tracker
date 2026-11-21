import { render, screen, within } from "@testing-library/react";
import { FactoryProvider } from "@/contexts/factory-context";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import type { PasskeyPort } from "@/services/passkey";
import { setYnabOn } from "@/settings/connections";
import { SortProvider } from "@/sort/sort-context";
import { BudgetIdeas } from "./BudgetIdeas";
import { CHARGES_KEY, monthsBefore, type IdeaCharge } from "./budget-ideas";
import { groupOf } from "./fake-ynab";
import { day } from "./tally";

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

const LONG_NAME = "SQ *THE VERY LONG HARDWARE AND GARDEN SUPPLY COMPANY 1234 MAIN STREET SPRINGFIELD";

/** Charges of one month a while ago, one payee each, the n-th costing 10 + n dollars: too small alone, so the yearly catch-all folds them. */
function keepCharges(payees: string[]) {
  const date = monthsBefore(day(Date.now()), 2);
  const charges: IdeaCharge[] = payees.map((payee, i) => ({ id: `t${i}`, date, payee, amount: 10 + i }));
  localStorage.setItem(CHARGES_KEY, JSON.stringify({ budgetId: "b1", readAt: Date.now(), charges }));
}

async function drawCard() {
  await new YnabRepository().saveConnection({ budgetId: "b1", budgetName: "Our Budget" });
  await new YnabRepository().applyCategories([groupOf("g1", "Everyday", [["f1", "Stuff I Forgot to Budget For"]])], 1);
  await setYnabOn(true);
  render(
    <FactoryProvider checkLicence={async () => ({ state: "none", checkedAt: "x" })} passkeyPort={noWebAuthn}>
      <SortProvider writer={null} refreshBalances={async () => {}} pollMs={60_000} suggest={null}>
        <BudgetIdeas />
      </SortProvider>
    </FactoryProvider>,
  );
  return screen.findByRole("listitem", { name: "Yearly extras" });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.clear();
});

describe("Budget ideas: the sentence names a few payees", () => {
  it("names the 3 payees that cost the most and says how many more, for an idea of 12 payees", async () => {
    // costs 10..21 dollars in the order written: the dearest three are Payee 12, Payee 11 and Payee 10
    keepCharges(Array.from({ length: 12 }, (_, i) => `Payee ${String(i + 1).padStart(2, "0")}`));
    const idea = await drawCard();
    expect(idea).toHaveTextContent("12 charges, $186.00 in the last year went to Stuff I Forgot to Budget For: Payee 10, Payee 11, Payee 12, and 9 more.");
    // the others are not in the sentence, only behind "The charges behind it"
    const sentence = screen.getByText(/went to Stuff I Forgot to Budget For/);
    expect(sentence).not.toHaveTextContent("Payee 01");
    expect(within(idea).getByText("The charges behind it")).toBeInTheDocument();
    expect(within(idea).getByText(/Payee 01/)).toBeInTheDocument();
  });

  it("says 'and 1 more' for four payees", async () => {
    keepCharges(["Aa", "Bb", "Cc", "Dd"]);
    const idea = await drawCard();
    expect(idea).toHaveTextContent("Stuff I Forgot to Budget For: Bb, Cc, Dd, and 1 more.");
  });

  it("lists three payees or fewer as it always has, alphabetically, with no 'more'", async () => {
    keepCharges(["Zed Co", "Aardvark Ltd", "Mid Shop", "Zed Co"]);
    const idea = await drawCard();
    expect(idea).toHaveTextContent("4 charges, $46.00 in the last year went to Stuff I Forgot to Budget For: Aardvark Ltd, Mid Shop, Zed Co.");
    expect(idea).not.toHaveTextContent("more");
  });

  it("cuts a payee name over 40 characters with an ellipsis in the sentence, and keeps it whole under 'The charges behind it'", async () => {
    keepCharges(["Aa", LONG_NAME, "Cc"]);
    const idea = await drawCard();
    const sentence = screen.getByText(/went to Stuff I Forgot to Budget For/);
    expect(sentence).toHaveTextContent(`Stuff I Forgot to Budget For: Aa, Cc, ${LONG_NAME.slice(0, 39)}….`);
    expect(sentence).not.toHaveTextContent(LONG_NAME);
    // the whole name, with its date, is one tap away
    const behind = within(idea.querySelector("details")!).getByText((_, el) => el?.tagName === "SPAN" && el.textContent?.endsWith(` · ${LONG_NAME}`) === true);
    expect(behind).toBeInTheDocument();
  });
});
