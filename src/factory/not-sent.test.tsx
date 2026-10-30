// The Governor's report (2026-10-18): scanned lines said 'Waiting on the factory' while the phone
// sent nothing (no licence held, offline, backing off). The line must say why and what to do.
import { Blob } from "node:buffer";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLiveQuery } from "dexie-react-hooks";
import { MemoryRouter } from "react-router";
import { licence } from "bsv-kit/bsv";
import { FactoryProvider, useFactory } from "@/factory";
import type { FactoryLicenceChecker } from "@/factory";
import { PendingLineRow } from "@/components/data-display/pending-line-row";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import type { LookupClient } from "@/services/lookup-runner";
import type { PasskeyPort } from "@/services/passkey";

const sendMock = vi.fn(async () => "direct:tx1");
const fakeClient: LookupClient = {
  send: sendMock,
  awaitAnswer: () => new Promise(() => {}),
};
vi.mock("@/services/lookup-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/lookup-client")>()),
  makeLookupClient: () => fakeClient,
  currentReceiptClient: () => null,
}));

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};
const checkedAt = "2026-10-18T00:00:00.000Z";
const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};
const repo = new PendingLookupRepository();

function Line({ id }: { id: string }) {
  const lookup = useLiveQuery(() => repo.getById(id), [id]);
  return lookup ? <PendingLineRow lookup={lookup} /> : null;
}
function MakeKey() {
  const { makeKey } = useFactory();
  return <button onClick={() => void makeKey()}>make key</button>;
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

async function renderOpened(checkLicence: FactoryLicenceChecker) {
  const created = await repo.create({
    barcode: "0780994802445",
    tripId: "t1",
    photos: [new Blob(["p"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
  });
  render(
    <MemoryRouter>
      <FactoryProvider
        checkLicence={checkLicence}
        passkeyPort={noWebAuthn}
      >
        <MakeKey />
        <Line id={created.id} />
      </FactoryProvider>
    </MemoryRouter>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "make key" }));
  return created;
}

describe("a scan the phone has not sent", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    localStorage.clear();
    sendMock.mockClear();
    setOnline(true);
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => setOnline(true));

  it("while the licence is still being checked, says so and sends nothing ('checking' is not allowed)", async () => {
    await renderOpened(() => new Promise<licence.LicenceStatus>(() => {}));
    expect(await screen.findByText("Not sent: checking the licence")).toBeInTheDocument();
    expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("with the licence unreadable and none kept, says no licence rather than sending", async () => {
    await renderOpened(async () => {
      throw new Error("Failed to fetch");
    });
    expect(await screen.findByText("Not sent: no licence")).toBeInTheDocument();
    expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("with no licence, says so", async () => {
    await renderOpened(async () => ({ state: "none", checkedAt }));
    expect(await screen.findByText("Not sent: no licence")).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("asks the chain again when the app returns to the screen, and sends on held", async () => {
    const check = vi.fn<FactoryLicenceChecker>();
    check.mockRejectedValueOnce(new Error("Failed to fetch"));
    check.mockResolvedValue(held);
    await renderOpened(check);
    await screen.findByText("Not sent: no licence");
    expect(check).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Waiting on the factory")).toBeInTheDocument();
  });

  it("offline, says it sends when he is back", async () => {
    setOnline(false);
    await renderOpened(async () => held);
    expect(
      await screen.findByText("Not sent: offline, sends when you are back"),
    ).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("backing off after a failed send, says it will try again", async () => {
    sendMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    await renderOpened(async () => held);
    expect(await screen.findByText("Not sent yet, trying again")).toBeInTheDocument();
    expect(screen.queryByText("Waiting on the factory")).not.toBeInTheDocument();
  });
});
