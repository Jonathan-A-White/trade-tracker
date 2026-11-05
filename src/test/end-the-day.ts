import { waitFor } from "@testing-library/react";
import { vault } from "bsv-kit/bsv";

/**
 * The unlock kept on this device ends, as it does after a day or a Lock: the next launch finds the
 * key locked. A test that relaunches the app and expects the door locked calls this after unmounting.
 */
export async function endTheDay(): Promise<void> {
  await vault.indexedDbSessionStore().clear();
}

/**
 * Waits until the unlock kept on this device has been written. The door says "unlocked" the moment the
 * key is held, but bsv-kit writes the kept session a moment later (a device key is made and the key
 * wrapped under it), so a test that unlocks and then calls endTheDay() at once can have that write land
 * after the clear and the next launch resume unlocked (mw-mr4xgrw.46). Call it between an unlock and endTheDay().
 */
export async function waitForDayKept(): Promise<void> {
  const store = vault.indexedDbSessionStore();
  await waitFor(async () => expect(await store.get()).not.toBeNull(), { timeout: 5000 });
}
