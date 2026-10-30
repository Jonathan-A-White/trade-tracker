import { NotAllowed, openMill } from "./mill";
import type { MillLicence } from "./mill";

const key = new Uint8Array(32).fill(3);

describe("the gated mill", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each<[MillLicence, "checking" | "unlicensed"]>([
    ["checking", "checking"],
    ["unlicensed", "unlicensed"],
  ])("refuses a send while the licence is %s, before anything goes out", async (state, reason) => {
    const mill = openMill("https://backend.example", key, () => state);
    const refused = await mill.send({ kind: "item-from-photos", v: "1.0", input: {} }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(NotAllowed);
    expect((refused as InstanceType<typeof NotAllowed>).reason).toBe(reason);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to wait for an answer while the licence is not licensed", async () => {
    const mill = openMill("https://backend.example", key, () => "checking");
    await expect(mill.awaitAnswer("direct:abc")).rejects.toBeInstanceOf(NotAllowed);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the licence at each call: one that goes after the client is built stops the next send", async () => {
    let state: MillLicence = "licensed";
    const mill = openMill("https://backend.example", key, () => state);
    state = "unlicensed";
    await expect(mill.send({ kind: "form-talk", v: "1.0", input: {} })).rejects.toBeInstanceOf(NotAllowed);
  });
});
