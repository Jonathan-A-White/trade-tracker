import { vault } from "bsv-kit/bsv";

/**
 * The unlock kept on this device ends, as it does after a day or a Lock: the next launch finds the
 * key locked. A test that relaunches the app and expects the door locked calls this after unmounting.
 */
export async function endTheDay(): Promise<void> {
  await vault.indexedDbSessionStore().clear();
}
