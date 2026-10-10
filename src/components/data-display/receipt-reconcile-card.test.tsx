// The card's factory notice, with the real FactoryProvider: it says whether the key is missing,
// locked or without a licence, and a locked key is unlocked right on the card.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { licence } from "bsv-kit/bsv";
import { ReceiptReconcileCard } from "./receipt-reconcile-card";
import { FactoryProvider, useFactory } from "@/contexts/factory-context";
import { db } from "@/db/database";
import type { PasskeyPort } from "@/services/passkey";

const PRF_SECRET = new Uint8Array(32).fill(7);
const checkedAt = "2026-10-05T00:00:00.000Z";
const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};
const none: licence.LicenceStatus = { state: "none", checkedAt };

function fakePort(overrides: Partial<PasskeyPort> = {}): PasskeyPort {
  return {
    isAvailable: () => true,
    create: async () => ({ credentialId: new Uint8Array([1, 2, 3, 4]).buffer, prfSupported: true }),
    getPrfSecret: async () => PRF_SECRET.buffer.slice(0),
    ...overrides,
  };
}

function MakeKeyButton() {
  const { makeKey } = useFactory();
  return <button onClick={() => void makeKey()}>make the key</button>;
}

/** Makes a key (with its fingerprint copy) in localStorage, then forgets the session: the key is locked. */
async function seedLockedKey(port: PasskeyPort) {
  const user = userEvent.setup();
  const first = render(
    <FactoryProvider checkLicence={async () => held} passkeyPort={port} askDoor={async () => "unreachable"}>
      <MakeKeyButton />
    </FactoryProvider>,
  );
  await user.click(screen.getByRole("button", { name: "make the key" }));
  await waitFor(() => expect(localStorage.getItem("tradetracker-factory-fingerprint")).toBeTruthy());
  first.unmount();
}

function renderCard(port: PasskeyPort, checkLicence: () => Promise<licence.LicenceStatus>) {
  return render(
    <MemoryRouter initialEntries={["/trips/t1"]}>
      <FactoryProvider checkLicence={checkLicence} passkeyPort={port} askDoor={async () => "unreachable"}>
        <Routes>
          <Route path="/trips/:id" element={<ReceiptReconcileCard tripId="t1" onTotal={() => {}} />} />
          <Route path="/settings" element={<h1>Settings screen</h1>} />
        </Routes>
      </FactoryProvider>
    </MemoryRouter>,
  );
}

describe("Check against the receipt: the factory notice", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
  });

  it("no key yet: says to set up the factory in Settings, with a link", async () => {
    const user = userEvent.setup();
    renderCard(fakePort(), async () => held);

    expect(screen.getByText("Set up the factory in Settings")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photograph receipt" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Open Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings screen" })).toBeInTheDocument();
  });

  it("locked key: says it is locked and Unlock runs the fingerprint right on the card", async () => {
    const port = fakePort();
    await seedLockedKey(port);
    const getPrfSecret = vi.fn(async () => PRF_SECRET.buffer.slice(0));
    const user = userEvent.setup();
    renderCard(fakePort({ getPrfSecret }), async () => held);

    expect(screen.getByText("Locked. Unlock with your fingerprint to read a receipt.")).toBeInTheDocument();
    expect(screen.queryByText(/needs a licence/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photograph receipt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose a photo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Photograph receipt" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Choose a photo" })).toBeEnabled();
    expect(getPrfSecret).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Locked/)).not.toBeInTheDocument();
  });

  it("locked key, the fingerprint copy missing: says so plainly and links to Unlock in Settings", async () => {
    await seedLockedKey(fakePort());
    localStorage.removeItem("tradetracker-factory-fingerprint");
    localStorage.removeItem("tradetracker-factory-fingerprint-credential");
    const user = userEvent.setup();
    renderCard(fakePort(), async () => held);

    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No fingerprint is set up on this device.");
    expect(screen.getByRole("button", { name: "Photograph receipt" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Unlock in Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings screen" })).toBeInTheDocument();
  });

  it("locked key, the fingerprint cancelled: says so and keeps the Unlock button", async () => {
    await seedLockedKey(fakePort());
    const user = userEvent.setup();
    renderCard(
      fakePort({
        getPrfSecret: async () => {
          throw new DOMException("cancelled", "NotAllowedError");
        },
      }),
      async () => held,
    );

    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Fingerprint cancelled");
    expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Unlock in Settings" })).toBeInTheDocument();
  });

  it("unlocked but no licence for the key: says so with an Open Settings link and no Unlock button", async () => {
    await seedLockedKey(fakePort());
    const user = userEvent.setup();
    renderCard(fakePort(), async () => none);

    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("This key holds no TradeTracker licence.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Locked/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photograph receipt" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Open Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings screen" })).toBeInTheDocument();
  });
});
