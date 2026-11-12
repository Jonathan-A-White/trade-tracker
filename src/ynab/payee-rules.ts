// Payee rules: Clean up's "Always <category>" on a payee card approves every unapproved transaction of that payee into that category
// and keeps a rule, so the payee's new unapproved transactions are approved as they are read, before Clean up lists anything.
// Every write goes through the YNAB writer's approve() and restore() (src/ynab/writer.ts), passed in; nothing here calls YNAB's write API.
import type { YnabApproval, YnabPayeeRule, YnabRestore, YnabRuleApproval } from "@/contracts/types";
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

/** How long Home keeps listing what a rule approved. PROVISIONAL (the Governor to confirm). */
export const RULE_APPROVAL_DAYS = 7;
const DAY_MS = 86_400_000;

/** What the rules approved, kept for Home to show and Undo. */
export class RuleApprovalRepository {
  /** The not-undone approvals of the last RULE_APPROVAL_DAYS days in the budget, newest first. */
  async recent(budgetId: string, now: number = Date.now()): Promise<YnabRuleApproval[]> {
    const rows = await db.ynabRuleApprovals.where("approvedAt").aboveOrEqual(now - RULE_APPROVAL_DAYS * DAY_MS).toArray();
    return rows.filter((a) => a.budgetId === budgetId && !a.undone).sort((a, b) => b.approvedAt - a.approvedAt);
  }

  async put(rows: readonly YnabRuleApproval[]): Promise<void> {
    await db.ynabRuleApprovals.bulkPut([...rows]);
  }

  /** The ids Undo has put back: the rules leave these alone. */
  async undoneIds(budgetId: string): Promise<Set<string>> {
    const rows = await db.ynabRuleApprovals.where("budgetId").equals(budgetId).toArray();
    return new Set(rows.filter((a) => a.undone).map((a) => a.id));
  }

  async markUndone(id: string): Promise<void> {
    await db.ynabRuleApprovals.update(id, { undone: true });
  }

  /** Forgets old records, and the undone ones YNAB no longer holds unapproved (they are no longer in `unapprovedIds`). */
  async prune(budgetId: string, unapprovedIds: ReadonlySet<string>, now: number = Date.now()): Promise<void> {
    const rows = await db.ynabRuleApprovals.where("budgetId").equals(budgetId).toArray();
    const stale = rows.filter((a) => (a.undone ? !unapprovedIds.has(a.id) : a.approvedAt < now - RULE_APPROVAL_DAYS * DAY_MS));
    if (stale.length > 0) await db.ynabRuleApprovals.bulkDelete(stale.map((a) => a.id));
  }
}

const repo = new PayeeRuleRepository();
const approvals = new RuleApprovalRepository();

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

/** What a rule does when its category lacks the money for a charge: 'approve' approves it and notes the shortfall, 'hold' leaves it for him in Clean up. A setting; PROVISIONAL default 'approve' (his words, 2026-11-12: "Right now though, auto approve should note but disregard lack of funds"). */
export type ShortRule = "approve" | "hold";
export const SHORT_RULE_KEY = "tradetracker-short-rule";

export function readShortRule(): ShortRule {
  try {
    return localStorage.getItem(SHORT_RULE_KEY) === "hold" ? "hold" : "approve";
  } catch {
    return "approve";
  }
}
export function writeShortRule(value: ShortRule): void {
  try {
    localStorage.setItem(SHORT_RULE_KEY, value);
  } catch {
    // a full or blocked store only costs the next read
  }
}

/** A charge a rule left for him because its category lacks the money (the setting 'Leave it for me'). Dollars. */
export interface HeldByRule {
  categoryId: string;
  short: number;
}

/** The dollars `amount` (milliunits, negative out) lacks in a category holding `balance` dollars; null when it holds enough, the balance is unknown, or it is money in. */
function shortfall(balance: number | undefined, amount: number): number | null {
  if (balance === undefined || !(amount < 0)) return null;
  const lack = Math.round((-amount / 1000 - balance) * 100) / 100;
  return lack > 0 ? lack : null;
}

export interface RulesRead {
  /** the unapproved transactions left after the rules' approvals */
  rows: YnabTransactionWire[];
  /** how many the rules approved just now */
  approved: number;
  /** why the rules' write failed; null when it did not (or there was none to make) */
  error: string | null;
  /** the transactions (by id) a rule left unapproved because its category lacks the money, with the category and the shortfall */
  held: Record<string, HeldByRule>;
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
    if (!approve) return { rows, approved: 0, error: null, held: {} };
    // the record is a convenience: a failure to keep or tidy it must never stop the rules
    const undone = await approvals.undoneIds(budgetId).catch(() => new Set<string>());
    await approvals.prune(budgetId, new Set(rows.map((r) => r.id ?? "")), Date.now()).catch(() => {});
    const rules = await repo.list(budgetId);
    if (rules.length === 0) return { rows, approved: 0, error: null, held: {} };
    const { categories, inflow } = offeredCategories(await new YnabRepository().listCategories());
    const offered = new Set(categories.map((c) => c.id));
    const byKey = new Map(rules.filter((r) => offered.has(r.categoryId)).map((r) => [r.key, r]));
    const candidates = rows.flatMap((row) => {
      // one he put back from Home stays his to decide
      const rule = ruleable(row) && !undone.has(row.id!) ? byKey.get(payeeKey(row.payee_name!)) : undefined;
      // a rule into Ready to Assign (made on an inflow) takes money in only: an outflow of the same payee is left to him
      if (rule && rule.categoryId === inflow?.id && !(row.amount > 0)) return [];
      return rule ? [{ row, rule }] : [];
    });
    if (candidates.length === 0) return { rows, approved: 0, error: null, held: {} };
    // each category's available now (a fresh read; the cache when YNAB cannot be asked), less what this same read already puts into it
    const balances = await availableNow(client, budgetId);
    const hold = readShortRule() === "hold";
    const held: Record<string, HeldByRule> = {};
    const picks: { row: YnabTransactionWire; rule: YnabPayeeRule; short: number | null }[] = [];
    for (const { row, rule } of candidates) {
      const short = shortfall(balances.get(rule.categoryId), row.amount);
      if (short !== null && hold) {
        held[row.id!] = { categoryId: rule.categoryId, short };
        continue;
      }
      picks.push({ row, rule, short });
      if (row.amount < 0 && balances.has(rule.categoryId)) balances.set(rule.categoryId, balances.get(rule.categoryId)! + row.amount / 1000);
    }
    if (picks.length === 0) return { rows, approved: 0, error: null, held };
    try {
      await approve(picks.map((p) => ({ id: p.row.id!, categoryId: p.rule.categoryId })));
    } catch (err) {
      const why = err instanceof Error ? err.message : "YNAB did not answer.";
      return { rows, approved: 0, error: `Could not approve ${picks.length} from payee rules: ${why}`, held };
    }
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p.rule.key, (counts.get(p.rule.key) ?? 0) + 1);
    // the write landed: a failure to count it must not make it look as if it had not
    await Promise.all([...counts].map(([key, n]) => repo.addApproved(key, n))).catch(() => {});
    const at = Date.now();
    await approvals
      .put(
        picks.map((p) => ({
          id: p.row.id!,
          budgetId,
          ruleKey: p.rule.key,
          payee: p.row.payee_name!.trim(),
          amount: p.row.amount,
          date: p.row.date,
          categoryId: p.rule.categoryId,
          previousCategoryId: p.row.category_id ?? null,
          approvedAt: at,
          ...(p.short === null ? {} : { shortBy: p.short }),
          undone: false,
        })),
      )
      .catch(() => {});
    const gone = new Set(picks.map((p) => p.row.id));
    return { rows: rows.filter((r) => !gone.has(r.id)), approved: picks.length, error: null, held };
  });
}

/** Each category's available in dollars, read from YNAB now; the cached ones when that read fails. A category with no balance is not in the map. */
async function availableNow(client: YnabClient, budgetId: string): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  try {
    for (const group of (await client.categoryGroups(budgetId)).rows) {
      for (const c of group.categories) if (typeof c.balance === "number") balances.set(c.id, c.balance / 1000);
    }
    return balances;
  } catch {
    balances.clear();
    for (const c of await new YnabRepository().listCategories().catch(() => [])) if (c.balance !== undefined) balances.set(c.id, c.balance);
    return balances;
  }
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

/** Home's Undo: puts the transaction back (unapproved, in the category it had) in one PATCH, then marks it so the rule leaves it alone. The rule is kept. */
export async function undoRuleApproval(approval: YnabRuleApproval, restore: Restore): Promise<void> {
  return inTurn(async () => {
    await restore([{ id: approval.id, categoryId: approval.previousCategoryId }]);
    await approvals.markUndone(approval.id);
  });
}
