import { doorWords } from "./door-words";

describe("doorWords", () => {
  it("names the state the door is in, and says nothing once the door is licensed", () => {
    expect(doorWords("no-key", null)).toBe("Set up the factory in Settings");
    expect(doorWords("locked", "held")).toBe("Locked. Unlock with your fingerprint to read a receipt.");
    expect(doorWords("unlocked", "none")).toBe("This key holds no TradeTracker licence.");
    expect(doorWords("unlocked", "revoked")).toBe("This key holds no TradeTracker licence.");
    expect(doorWords("unlocked", "checking")).toBe("Checking the licence.");
    expect(doorWords("unlocked", "indexing")).toMatch(/on its way/);
    expect(doorWords("unlocked", "unknown")).toMatch(/Could not check/);
    expect(doorWords("licensed", "held")).toBeNull();
  });
});
