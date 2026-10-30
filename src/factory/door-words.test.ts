import { doorWords } from "./door-words";

describe("doorWords", () => {
  it("names the state the door is in, and says nothing once the door is licensed", () => {
    expect(doorWords("no-key", null)).toBe("Set up the factory in Settings");
    expect(doorWords("locked", "licensed")).toBe("Locked. Unlock with your fingerprint to read a receipt.");
    expect(doorWords("unlocked", "unlicensed")).toBe("This key holds no TradeTracker licence.");
    expect(doorWords("unlocked", "checking")).toBe("Checking the licence.");
    expect(doorWords("licensed", "licensed")).toBeNull();
  });
});
