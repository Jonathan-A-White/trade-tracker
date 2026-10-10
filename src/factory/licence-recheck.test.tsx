import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { LockingScript, OP, P2PKH, PrivateKey, Transaction, Utils } from "@bsv/sdk";
import { licence } from "bsv-kit/bsv";
import { FactoryProvider } from "@/factory";
import { makeChainCheck, useFactoryLicence } from "@/factory/licence";
import type { FactoryLicenceChecker } from "@/factory/licence";
import { ThemeProvider } from "@/contexts/theme-context";
import { POSTERN_ISSUER } from "@/services/factory-service";
import type { PasskeyPort } from "@/services/passkey";
import SettingsPage from "@/pages/settings-page";

const PUBLIC_KEY = "tradetracker-factory-public";
const checkedAt = "2026-10-10T00:00:00.000Z";
const held: licence.LicenceStatus = {
  state: "held",
  outpoint: { txid: "ab".repeat(32), vout: 0 },
  collection: "trade-tracker",
  checkedAt,
};
const none: licence.LicenceStatus = { state: "none", checkedAt };

const noWebAuthn: PasskeyPort = {
  isAvailable: () => false,
  create: async () => {
    throw new Error("no WebAuthn");
  },
  getPrfSecret: async () => null,
};

/** A checker that rejects `failures` times (the chain not answering), then answers `then`. */
function flaky(failures: number, then: licence.LicenceStatus = held) {
  let calls = 0;
  const check = vi.fn<FactoryLicenceChecker>(async () => {
    calls += 1;
    if (calls <= failures) throw new Error("Failed to fetch");
    return then;
  });
  return check;
}

const HOLDER = PrivateKey.fromHex("11".repeat(32));
const HOLDER_PUBLIC = HOLDER.toPublicKey().toString();
const HOLDER_ADDRESS = HOLDER.toPublicKey().toAddress("testnet");
const ISSUER = PrivateKey.fromHex("22".repeat(32));
const ISSUER_PUBLIC = ISSUER.toPublicKey().toString();
const ISSUER_ADDRESS = ISSUER.toPublicKey().toAddress("testnet");

/** A mint of trade-tracker to the holder, signed and funded by the issuer: the shape Postern's Issue a licence makes. */
async function issuedMint(): Promise<FakeChain> {
  const funding = new Transaction();
  funding.addOutput({ lockingScript: new P2PKH().lock(ISSUER_ADDRESS), satoshis: 1000 });
  const script = new LockingScript()
    .writeOpCode(OP.OP_FALSE)
    .writeOpCode(OP.OP_RETURN)
    .writeBin(Utils.toArray("nftgate", "utf8"))
    .writeBin([0x02])
    .writeBin(Utils.toArray("M", "utf8"))
    .writeBin([0x00])
    .writeBin(Utils.toArray(JSON.stringify({ collection: "trade-tracker", holder: HOLDER_ADDRESS }), "utf8"));
  const mint = new Transaction();
  mint.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(ISSUER) });
  mint.addOutput({ lockingScript: script, satoshis: 0 });
  await mint.sign();
  const reader = new licence.FakeChainReader();
  reader.addKnownTransaction(funding.id("hex"), funding.toHex());
  reader.addTransaction(ISSUER_ADDRESS, mint.id("hex"), mint.toHex());
  return { reader, mintTxid: mint.id("hex") };
}
interface FakeChain {
  reader: licence.FakeChainReader;
  mintTxid: string;
}

describe("the chain check counts a licence Postern issued", () => {
  it("names the Governor's issuer key", () => {
    expect(POSTERN_ISSUER).toBe("035666d4ea414a65801ac092a4e28be6515065adcc7ac58d9cc76db8d5597f44c4");
  });

  it("reads held for a licence the issuer minted to the key, which the key's own history never lists", async () => {
    const { reader, mintTxid } = await issuedMint();
    const withIssuer = makeChainCheck({ reader, issuer: ISSUER_PUBLIC });
    expect(await withIssuer(HOLDER_PUBLIC, "trade-tracker")).toMatchObject({
      state: "held",
      outpoint: { txid: mintTxid, vout: 0 },
    });
    // without the issuer (what the app did) the same chain reads none
    expect(await makeChainCheck({ reader, issuer: undefined })(HOLDER_PUBLIC, "trade-tracker")).toMatchObject({
      state: "none",
    });
  });

  it("passes Postern's issuer by default", async () => {
    const read: string[] = [];
    const reader = new licence.FakeChainReader();
    const spy = reader.getAddressHistory.bind(reader);
    reader.getAddressHistory = async (address) => {
      read.push(address);
      return spy(address);
    };
    await makeChainCheck({ reader })(HOLDER_PUBLIC, "trade-tracker");
    expect(read).toContain(licence.addressForPublicKey(POSTERN_ISSUER));
  });
});

describe("useFactoryLicence retries a failed chain read", () => {
  const base = { backendUrl: "http://x", collection: "trade-tracker", key: null, retryDelaysMs: [1, 1] };

  it("one failed read, then a good one, shows the licence and never 'unknown'", async () => {
    const checkLicence = flaky(1);
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const reading = useFactoryLicence({ ...base, publicKeyHex: "aa", checkLicence });
      if (reading) seen.push(reading.licence);
      return reading;
    });
    await waitFor(() => expect(result.current?.licence).toBe("held"));
    expect(seen).not.toContain("unknown");
    expect(checkLicence).toHaveBeenCalledTimes(2);
  });

  it("three failed reads give 'unknown'; recheck after the chain recovers gives the state", async () => {
    const checkLicence = flaky(3);
    const { result } = renderHook(() => useFactoryLicence({ ...base, publicKeyHex: "aa", checkLicence }));
    await waitFor(() => expect(result.current?.licence).toBe("unknown"));
    expect(checkLicence).toHaveBeenCalledTimes(3);

    result.current?.recheck();
    await waitFor(() => expect(result.current?.licence).toBe("held"));
    expect(checkLicence).toHaveBeenCalledTimes(4);
  });
});

describe("Settings > Factory licence line", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tradetracker-theme", "light");
    localStorage.setItem(PUBLIC_KEY, HOLDER_PUBLIC);
  });

  function renderSettings(checkLicence: FactoryLicenceChecker) {
    return render(
      <MemoryRouter>
        <ThemeProvider>
          <FactoryProvider
            checkLicence={checkLicence}
            passkeyPort={noWebAuthn}
            askDoor={async () => "unreachable"}
            licenceRetryMs={[1, 1]}
          >
            <SettingsPage />
          </FactoryProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  }

  it("one failed read then a good one shows Held, with the key locked", async () => {
    renderSettings(flaky(1));
    await waitFor(() => expect(screen.getByText("Held")).toBeInTheDocument());
    expect(screen.queryByText("Could not check")).not.toBeInTheDocument();
  });

  it("three failed reads say why and offer Check again, which shows the state once the chain is back", async () => {
    const user = userEvent.setup();
    renderSettings(flaky(3, none));
    expect(await screen.findByText("Could not check")).toBeInTheDocument();
    expect(screen.getByText("The chain could not be reached.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByText("None")).toBeInTheDocument());
    expect(screen.queryByText("Could not check")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("a licence the Postern issuer minted reads Held while the key is locked", async () => {
    const { reader } = await issuedMint();
    renderSettings(makeChainCheck({ reader, issuer: ISSUER_PUBLIC }));
    await waitFor(() => expect(screen.getByText("Held")).toBeInTheDocument());
  });
});
