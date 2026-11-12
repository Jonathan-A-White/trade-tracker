// Home's "Approved for you": what Clean up's payee rules approved without his tapping (the last week), each row with its payee,
// amount, date and category, and an Undo that puts it back through the YNAB writer's restore(). The rule is kept unless he taps "Stop this rule".
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { useYnabOn } from "@/settings/connections";
import { PayeeRuleRepository, RuleApprovalRepository, undoRuleApproval } from "@/ynab/payee-rules";
import { useCleanupDeps } from "./sort-context";
import { money } from "./waiting";

const ROW = "flex flex-col gap-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2";
const SMALL_BUTTON = "min-h-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm font-medium text-gray-800 dark:text-gray-100 disabled:opacity-50";

/** 'Nov 10' from YNAB's YYYY-MM-DD, with no time zone to shift it. */
function dayLine(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ApprovedForYou() {
  const on = useYnabOn();
  const { restore } = useCleanupDeps();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approvals = useLiveQuery(async () => {
    const connection = await new YnabRepository().getConnection();
    return connection ? new RuleApprovalRepository().recent(connection.budgetId) : [];
  }, []);
  const categories = useLiveQuery(() => db.ynabCategories.toArray(), []);
  const rules = useLiveQuery(() => new PayeeRuleRepository().list(), []);

  if (!on || !approvals || approvals.length === 0) return null;
  const name = new Map(categories?.map((c) => [c.id, c.name]) ?? []);
  const standing = new Set(rules?.map((r) => r.key) ?? []);

  async function undo(id: string) {
    const approval = approvals?.find((a) => a.id === id);
    if (!approval || !restore || busy) return;
    setBusy(id);
    setError(null);
    try {
      await undoRuleApproval(approval, restore);
    } catch (err) {
      setError(`Could not undo that: ${err instanceof Error ? err.message : "YNAB did not answer."}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Approved for you" className="space-y-2">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Approved for you · {approvals.length}</h2>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <ul aria-label="Approved for you" className="space-y-2">
        {approvals.map((a) => (
          <li key={a.id} className={ROW}>
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 flex-1 break-words text-base text-gray-900 dark:text-gray-100">{a.payee}</span>
              <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{a.amount > 0 ? "+" : ""}{money(Math.abs(a.amount) / 1000)}</span>
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {dayLine(a.date)} · {name.get(a.categoryId) ?? "a category no longer in YNAB"}
            </span>
            <span className="flex flex-wrap gap-2">
              <button type="button" disabled={!restore || busy !== null} onClick={() => void undo(a.id)} className={SMALL_BUTTON}>
                Undo
              </button>
              {standing.has(a.ruleKey) && (
                <button type="button" onClick={() => void new PayeeRuleRepository().remove(a.ruleKey)} className={SMALL_BUTTON}>
                  Stop this rule
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
