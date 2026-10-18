import { receiptHoldText, sendHold, sendHoldText } from "./send-hold";

const key = new Uint8Array([1]);
const free = { publicKeyHex: "aa", key, online: true, licence: "held" as const, backingOff: false };

describe("sendHold: why the phone is not sending", () => {
  it("is null only with a key, a connection, a held licence and no backoff", () => {
    expect(sendHold(free)).toBeNull();
  });

  it("names the first true reason", () => {
    expect(sendHold({ ...free, publicKeyHex: null, key: null, licence: null })).toBe("no-key");
    expect(sendHold({ ...free, key: null })).toBe("locked");
    expect(sendHold({ ...free, online: false, licence: "unknown" })).toBe("offline");
    expect(sendHold({ ...free, licence: "unknown" })).toBe("licence-unchecked");
    expect(sendHold({ ...free, licence: "none" })).toBe("no-licence");
    expect(sendHold({ ...free, licence: "revoked" })).toBe("no-licence");
    expect(sendHold({ ...free, licence: "indexing" })).toBe("licence-pending");
    expect(sendHold({ ...free, licence: "checking" })).toBe("licence-checking");
    expect(sendHold({ ...free, backingOff: true })).toBe("backing-off");
  });

  it("says each reason in its own words, and never blames the factory", () => {
    const holds = [
      "no-key", "locked", "offline", "licence-checking", "licence-unchecked",
      "licence-pending", "no-licence", "backing-off",
    ] as const;
    const texts = holds.map(sendHoldText);
    expect(new Set(texts).size).toBe(holds.length);
    for (const text of texts) expect(text).toMatch(/^Not sent/);
    for (const hold of holds) expect(receiptHoldText(hold)).toMatch(/^Not checking for the answer/);
    expect(sendHoldText("licence-unchecked")).toBe(
      "Not sent: licence not checked. Settings > Factory > Check again",
    );
    expect(sendHoldText("no-licence")).toBe("Not sent: no licence");
    expect(sendHoldText("offline")).toBe("Not sent: offline, sends when you are back");
    expect(sendHoldText("backing-off")).toBe("Not sent yet, trying again");
  });
});
