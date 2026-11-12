// Payee rules: Clean up's "Always <category>" on a payee card approves every unapproved transaction of that payee into that category
// and keeps a rule, so the payee's new unapproved transactions are approved as they are read, before Clean up lists anything.
// Every write goes through the YNAB writer's approve() and restore() (src/ynab/writer.ts), passed in; nothing here calls YNAB's write API.
import type { YnabApproval, YnabPayeeRule, YnabRestore } from "@/contracts/types";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import type { YnabClient } from "./api";
import { offeredCategories, payeeKey } from "./cleanup";
import type { YnabTransactionWire } from "./types";

type Approve = (approvals: readonly YnabApproval[]) => Promise<void>;
type Restore = (restores: readonly YnabRestore[]) => Promise<void>;

/** The rules, kept in the app's database, one per payee key. */
export class PayeeRuleRepository {
  async list(budgetId?: string): Promise<YnabPayeeRule[]> {
    const rows = budgetId === undefined ? await db.ynabPayeeRules.toArray() : await db.ynabPayeeRules.where("budgetId").equals(budgetId).toArray();
    return rows.sort((a, b) => a.payee.localeCompare(b.payee));
  }

  async get(key: string): Promise<YnabPayeeRule | undefined> {
    return db.ynabPayeeRules.get(key);
  }

  async put(rule: YnabPayeeRule): Promise<void> {
    await db.ynabPayeeRules.put(rule);
  }

  async remove(key: string): Promise<void> {
    await db.ynabPayeeRules.delete(key);
  }

  /** Counts `n` more transactions as approved by the rule. */
  async addApproved(key: string, n: number): Promise<void> {
    await db.transaction("rw", db.ynabPayeeRules, async () => {
      const rule = await db.ynabPayeeRules.get(key);
      if (rule) await db.ynabPayeeRules.put({ ...rule, approved: rule.approved + n });
    });
  }
}

const repo = new PayeeRuleRepository();

/** The rules are applied one load at a time, so two loads at once never write the same transaction twice. */
let tail: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.catch(() => {});
  return run;
}

/** Whether a rule may approve the transaction: a plain, undeleted, unapproved one that has a payee (a split or a transfer is left to him). */
const ruleable = (row: YnabTransactionWire): boolean =>
  typeof row.id === "string" && !row.deleted && row.approved !== true && !row.transfer_account_id && !(row.subtransactions && row.subtransactions.length > 0) && !!row.payee_name?.trim();

export interface RulesRead {
  /** the unapproved transactions left after the rules' approvals */
  rows: YnabTransactionWire[];
  /** how many the rules approved just now */
  approved: number;
  /** why the rules' write failed; null when it did not (or there was none to make) */
  error: string | null;
}

/**
 * Reads YNAB's unapproved transactions and approves, in one PATCH through `approve`, those of a payee with a rule into the rule's
 * category. A failed write leaves them in the rows (so Clean up lists them) with the error, and the next load tries again; the
 * rows read are what YNAB still holds unapproved, so nothing is written twice. Rules of another budget, or for a category no
 * longer on offer, are skipped.
 */
export function unapprovedWithRules(client: YnabClient, budgetId: string, approve: Approve | null): Promise<RulesRead> {
  return inTurn(async () => {
    const rows = await client.unapprovedTransactions(budgetId);
    if (!approve) return { rows, approved: 0, error: null };
    const rules = await repo.list(budgetId);
    if (rules.length === 0) return { rows, approved: 0, error: null };
    const { categories, inflow } = offeredCategories(await new YnabRepository().listCategories());
    const offered = new Set(categories.map((c) => c.id));
    const byKey = new Map(rules.filter((r) => offered.has(r.categoryId)).map((r) => [r.key, r]));
    const picks = rows.flatMap((row) => {
      const rule = ruleable(row) ? byKey.get(payeeKey(row.payee_name!)) : undefined;
      // a rule into Ready to Assign (made on an inflow) takes money in only: an outflow of the same payee is left to him
      if (rule && rule.categoryId === inflow?.id && !(row.amount > 0)) return [];
      return rule ? [{ row, rule }] : [];
    });
    if (picks.length === 0) return { rows, approved: 0, error: null };
    try {
      await approve(picks.map((p) => ({ id: p.row.id!, categoryId: p.rule.categoryId })));
    } catch (err) {
      const why = err instanceof Error ? err.message : "YNAB did not answer.";
      return { rows, approved: 0, error: `Could not approve ${picks.length} from payee rules: ${why}` };
    }
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p.rule.key, (counts.get(p.rule.key) ?? 0) + 1);
    // the write landed: a failure to count it must not make it look as if it had not
    await Promise.all([...counts].map(([key, n]) => repo.addApproved(key, n))).catch(() => {});
    const gone = new Set(picks.map((p) => p.row.id));
    return { rows: rows.filter((r) => !gone.has(r.id)), approved: picks.length, error: null };
  });
}

/** When the app opens: the rules approve what they can, whatever screen is open. Silent on failure; the next load tries again. */
export async function approveByRules(client: YnabClient, budgetId: string, approve: Approve): Promise<void> {
  await unapprovedWithRules(client, budgetId, approve);
}

export interface AlwaysInput {
  budgetId: string;
  /** the payee as YNAB names it */
  payee: string;
  key: string;
  categoryId: string;
  /** the payee's unapproved transactions that a rule may set (not a split, not a transfer), with the category YNAB holds for each now */
  items: { id: string; ynabCategoryId: string | null }[];
}

/** What "Always" did, enough to undo it. */
export interface AlwaysDone {
  payee: string;
  key: string;
  categoryId: string;
  restores: YnabRestore[];
  /** the rule this one replaced; null when there was none */
  previous: YnabPayeeRule | null;
}

/** Approves the items into the category in one PATCH, and only then keeps the rule: a failed write rejects and leaves no rule. */
export async function setAlways(input: AlwaysInput, approve: Approve): Promise<AlwaysDone> {
  return inTurn(async () => {
    const { budgetId, payee, key, categoryId, items } = input;
    await approve(items.map((i) => ({ id: i.id, categoryId })));
    const previous = (await repo.get(key)) ?? null;
    await repo.put({ key, budgetId, payee, categoryId, createdAt: previous?.createdAt ?? Date.now(), approved: (previous?.approved ?? 0) + items.length });
    return { payee, key, categoryId, restores: items.map((i) => ({ id: i.id, categoryId: i.ynabCategoryId })), previous };
  });
}

/** Puts the transactions back as they were in one PATCH, then the rule as it was; a failed write rejects and changes nothing. */
export async function undoAlways(done: AlwaysDone, restore: Restore): Promise<void> {
  return inTurn(async () => {
    await restore(done.restores);
    if (done.previous) await repo.put(done.previous);
    else await repo.remove(done.key);
  });
}
