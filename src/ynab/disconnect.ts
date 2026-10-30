import type { vault } from "bsv-kit/bsv";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { setYnabOn } from "@/settings/connections";
import { forgetToken } from "./token";

/** Turns YNAB Off: the sealed token and every cached list are forgotten. */
export async function disconnectYnab(storage: vault.Storage): Promise<void> {
  await setYnabOn(false);
  await forgetToken(storage);
  await new YnabRepository().clearAll();
}
