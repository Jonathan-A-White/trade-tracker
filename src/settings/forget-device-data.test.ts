import { rememberLastMail, readLastMail } from "@/family/last-mail";
import { forgetDeviceData } from "./forget-device-data";

const DATA = [
  "tradetracker.family-last-mail",
  "tradetracker-sort-handed",
  "tradetracker-sort-sorted",
  "tradetracker-sort-history",
  "tradetracker-sort-learned",
  "tradetracker-ynab-tally",
  "tradetracker-alerts-kept",
  "tradetracker-alerts-claims",
];
const SETTINGS = [
  "tradetracker-theme",
  "tradetracker-setting-family",
  "tradetracker-family-me",
  "tradetracker-factory-key",
  "tradetracker-factory-backend",
  "tradetracker-ynab-busy-until",
  "tradetracker-ynab-tally-failed-at",
  "bsv-kit.licence",
];

describe("forgetDeviceData", () => {
  beforeEach(() => localStorage.clear());

  it("forgets every data key and keeps every setting", () => {
    for (const key of [...DATA, ...SETTINGS]) localStorage.setItem(key, "x");
    forgetDeviceData();
    for (const key of DATA) expect(localStorage.getItem(key), key).toBeNull();
    for (const key of SETTINGS) expect(localStorage.getItem(key), key).toBe("x");
  });

  it("forgets the YNAB tally and what he taught the suggestion (mw-mr4xgrw.41)", async () => {
    const { learnChoice, LEARNED_KEY } = await import("@/sort/suggest");
    const { TALLY_KEY, readTally } = await import("@/ynab/tally");
    learnChoice("Amazon", { id: "c3", name: "Household" });
    localStorage.setItem(TALLY_KEY, JSON.stringify({ budgetId: "b1", since: "2024-11-05", readAt: 1, payees: { Amazon: { c3: 12 } } }));
    expect(readTally()).not.toBeNull();
    forgetDeviceData();
    expect(localStorage.getItem(LEARNED_KEY)).toBeNull();
    expect(readTally()).toBeNull();
  });

  it("forgets the last mail", () => {
    rememberLastMail({ when: "2026-10-30T18:14:00Z" });
    forgetDeviceData();
    expect(readLastMail()).toBeNull();
  });

  it("tells the open Sort screens to read again", () => {
    const heard = vi.fn();
    window.addEventListener("tradetracker-sort-changed", heard);
    forgetDeviceData();
    window.removeEventListener("tradetracker-sort-changed", heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
