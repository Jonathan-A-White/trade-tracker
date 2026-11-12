import type { vault } from "bsv-kit/bsv";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { setYnabOn } from "@/settings/connections";
import { forgetTally } from "./tally";
import { forgetToken } from "./token";

/** Turns YNAB Off: the sealed token and every cached list are forgotten, the tally of his YNAB history, and the record of what the rules approved. */
export async function disconnectYnab(storage: vault.Storage): Promise<void> {
  await setYnabOn(false);
  await forgetToken(storage);
  await new YnabRepository().clearAll();
  // what the payee rules approved (payee, amount, date) is a copy of his YNAB data; the rules themselves are his own and stay
  await db.ynabRuleApprovals.clear();
  forgetTally();
}
