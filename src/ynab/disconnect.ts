import type { vault } from "bsv-kit/bsv";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { setYnabOn } from "@/settings/connections";
import { forgetTally } from "./tally";
import { forgetToken } from "./token";

/** Turns YNAB Off: the sealed token and every cached list are forgotten, and the tally of his YNAB history. */
export async function disconnectYnab(storage: vault.Storage): Promise<void> {
  await setYnabOn(false);
  await forgetToken(storage);
  await new YnabRepository().clearAll();
  forgetTally();
}
