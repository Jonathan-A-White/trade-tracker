// Clean up: YNAB's unapproved transactions, oldest first, twenty to a page, grouped by payee. Each group carries the category its
// payee usually goes to and how sure that is (src/ynab/cleanup.ts); the sure ones are ticked and first, the rest wait unticked.
// Nothing reaches YNAB until he taps Approve, and then only the ticked ones, in one request.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { YnabCategory } from "@/contracts/types";
import { PageHeader } from "@/components/layout/page-header";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { useYnabOn } from "@/settings/connections";
import { useCleanupDeps } from "@/sort/sort-context";
import { buildRequest, readHistory, resolveSuggestion, tallyFor } from "@/sort/suggest";
import { money } from "@/sort/waiting";
import { refreshCache } from "@/ynab/cache";
import { groupPage, loadCleanup, pageAfter, type CleanupGroup, type CleanupItem, type Confidence } from "@/ynab/cleanup";
import { readTally } from "@/ynab/tally";

const BUTTON = "min-h-12 rounded-lg px-4 text-base font-medium";
const SECONDARY = `${BUTTON} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100`;
const SELECT = "min-h-12 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-base text-gray-900 dark:text-gray-100";
const BADGE: Record<Confidence, string> = {
  sure: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  likely: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  unsure: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100",
};
const RANK: Record<Confidence, number> = { sure: 2, likely: 1, unsure: 0 };
const WORD: Record<Confidence, string> = { sure: "Sure", likely: "Likely", unsure: "Unsure" };

type Phase = { state: "loading" } | { state: "failed"; error: string } | { state: "ready" };

const plural = (n: number) => (n === 1 ? "1 transaction" : `${n} transactions`);
/** Dollars as said on a row: money out plain, money in marked. */
const said = (amount: number) => `${money(Math.abs(amount))}${amount > 0 ? " in" : ""}`;
const bestOf = (items: readonly CleanupItem[]): Confidence => items.reduce<Confidence>((best, i) => (RANK[i.confidence] > RANK[best] ? i.confidence : best), "unsure");

function Badge({ confidence }: { confidence: Confidence }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[confidence]}`}>{WORD[confidence]}</span>;
}

/** The categories as a list narrowed by their group; `value` "" says none (or, for a group, that its transactions differ). */
function CategorySelect({ label, value, categories, onChange, mixed = false }: { label: string; value: string; categories: readonly YnabCategory[]; onChange: (id: string) => void; mixed?: boolean }) {
  const groups = new Map<string, YnabCategory[]>();
  for (const category of categories) groups.set(category.groupName, [...(groups.get(category.groupName) ?? []), category]);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
      <option value="" disabled={!mixed}>
        {mixed ? "Different categories" : "Choose a category"}
      </option>
      {[...groups].map(([group, rows]) => (
        <optgroup key={group} label={group}>
          {rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function GroupCard({
  group,
  categories,
  onGroupCategory,
  onItemCategory,
  onTick,
  onTickAll,
}: {
  group: CleanupGroup;
  categories: readonly YnabCategory[];
  onGroupCategory: (key: string, categoryId: string) => void;
  onItemCategory: (id: string, categoryId: string) => void;
  onTick: (id: string, on: boolean) => void;
  onTickAll: (key: string, on: boolean) => void;
}) {
  const best = bestOf(group.items);
  const editable = group.items.filter((i) => !i.fixedLabel);
  const shared = editable.length > 0 && editable.every((i) => i.categoryId === editable[0]!.categoryId) ? (editable[0]!.categoryId ?? "") : "";
  const mixed = editable.length > 1 && shared === "" && editable.some((i) => i.categoryId !== null);
  const tickable = group.items.filter((i) => i.categoryId !== null || i.fixedLabel);
  const allTicked = tickable.length > 0 && tickable.every((i) => i.ticked);
  return (
    <section role="group" aria-label={group.payee} className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="min-w-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{group.payee}</h2>
        <Badge confidence={best} />
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {plural(group.items.length)} · {said(group.total)}
      </p>
      {editable.length > 0 && <CategorySelect label={`Category for ${group.payee}`} value={shared} mixed={mixed} categories={categories} onChange={(id) => onGroupCategory(group.key, id)} />}
      {group.items.length > 1 && tickable.length > 0 && (
        <label className="flex min-h-12 items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" className="h-5 w-5" aria-label={`Tick all of ${group.payee}`} checked={allTicked} onChange={(e) => onTickAll(group.key, e.target.checked)} />
          Tick all
        </label>
      )}
      <ul className="space-y-2">
        {group.items.map((item) => {
          const what = `${said(item.amount)} on ${item.date}`;
          return (
            <li key={item.id} className="space-y-1 border-t border-gray-100 dark:border-gray-700 pt-2">
              <label className="flex min-h-12 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  aria-label={`Approve ${what}`}
                  checked={item.ticked}
                  disabled={item.categoryId === null && !item.fixedLabel}
                  onChange={(e) => onTick(item.id, e.target.checked)}
                />
                <span className="min-w-0 flex-1 text-base text-gray-900 dark:text-gray-100">
                  {said(item.amount)} <span className="text-sm text-gray-600 dark:text-gray-400">· {item.date}</span>
                </span>
                {item.confidence !== best && <Badge confidence={item.confidence} />}
              </label>
              {item.memo && <p className="break-words pl-8 text-sm text-gray-600 dark:text-gray-400">{item.memo}</p>}
              <p className="pl-8 text-xs text-gray-600 dark:text-gray-400">{item.why}</p>
              {item.fixedLabel ? (
                <p className="pl-8 text-sm font-medium text-gray-800 dark:text-gray-200">{item.fixedLabel}</p>
              ) : (
                group.items.length > 1 && (
                  <div className="pl-8">
                    <CategorySelect label={`Category for ${what}`} value={item.categoryId ?? ""} categories={categories} onChange={(id) => onItemCategory(item.id, id)} />
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function CleanupPage() {
  const on = useYnabOn();
  const deps = useCleanupDeps();
  const { getClient, approve, suggest, suggestTimeoutMs } = deps;
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [items, setItems] = useState<CleanupItem[]>([]);
  const [categories, setCategories] = useState<YnabCategory[]>([]);
  const [start, setStart] = useState(0);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const asked = useRef(new Set<string>());

  // read YNAB afresh on opening and when he goes through them again
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    void (async () => {
      setPhase({ state: "loading" });
      try {
        const connection = await new YnabRepository().getConnection();
        if (!connection) throw new Error("No budget is connected.");
        const client = await getClient();
        // a category made in YNAB lately is on offer; a failed refresh keeps the list as it was
        await refreshCache(client).catch(() => {});
        const loaded = await loadCleanup(client, connection.budgetId);
        if (cancelled) return;
        asked.current = new Set();
        setCategories(loaded.categories);
        setItems(loaded.items);
        setStart(0);
        setWriteError(null);
        setPhase({ state: "ready" });
      } catch (err) {
        if (!cancelled) setPhase({ state: "failed", error: err instanceof Error ? err.message : "YNAB could not be read." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [on, getClient, round]);

  const page = useMemo(() => pageAfter(items, start), [items, start]);
  const groups = useMemo(() => groupPage(page), [page]);

  // a payee nothing else knows holds Stuff I Forgot to Budget For and is asked of the AI, one at a time; its answer replaces that
  // unsure and unticked, and never names Food or Household for a payee not seen there before
  const needing = useMemo(() => groups.filter((g) => g.items.some((i) => !i.fixedLabel && i.open)).map((g) => g.payee), [groups]);
  const needKey = needing.join("\u0000");
  useEffect(() => {
    if (!suggest || needKey === "" || categories.length === 0) return;
    let cancelled = false;
    const run = new AbortController();
    void (async () => {
      for (const payee of needKey.split("\u0000")) {
        if (cancelled) return;
        if (asked.current.has(payee)) continue;
        asked.current.add(payee);
        const key = payee.trim().toLowerCase();
        const amount = Math.abs(items.find((i) => i.payee === payee)?.amount ?? 0);
        const deadline = setTimeout(() => run.abort(), suggestTimeoutMs);
        try {
          const tally = tallyFor(payee, readTally(), categories);
          const answer = await suggest(buildRequest({ merchant: payee, amount }, categories, readHistory(payee), undefined, tally), run.signal);
          const seen = new Set(items.find((i) => i.payee === payee)?.seen ?? []);
          const found = resolveSuggestion(answer, categories, amount, seen);
          if (found && "categoryId" in found && !cancelled) {
            setItems((all) => all.map((i) => (i.key === key && !i.fixedLabel && i.open ? { ...i, categoryId: found.categoryId, why: found.why, open: false } : i)));
          }
        } catch {
          // the AI is only a help: the group stays without a category until he chooses one
        } finally {
          clearTimeout(deadline);
        }
      }
    })();
    return () => {
      cancelled = true;
      run.abort();
    };
    // `items` is read for the amount and the categories seen only, once per payee
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needKey, suggest, suggestTimeoutMs, categories]);

  const change = useCallback((match: (i: CleanupItem) => boolean, patch: Partial<CleanupItem>) => {
    setItems((all) => all.map((i) => (match(i) ? { ...i, ...patch } : i)));
  }, []);
  const onGroupCategory = (key: string, categoryId: string) =>
    change((i) => i.key === key && page.some((p) => p.id === i.id) && !i.fixedLabel, { categoryId, ticked: true, open: false });
  const onItemCategory = (id: string, categoryId: string) => change((i) => i.id === id, { categoryId, ticked: true, open: false });
  const onTick = (id: string, ticked: boolean) => change((i) => i.id === id, { ticked });
  const onTickAll = (key: string, ticked: boolean) =>
    change((i) => i.key === key && page.some((p) => p.id === i.id) && (i.categoryId !== null || !!i.fixedLabel), { ticked });

  const picked = page.filter((i) => i.ticked && (i.categoryId !== null || !!i.fixedLabel));

  async function approvePage() {
    if (!approve || picked.length === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    try {
      await approve(picked.map((i) => ({ id: i.id, ...(i.fixedLabel || i.categoryId === null ? {} : { categoryId: i.categoryId }) })));
      const gone = new Set(picked.map((i) => i.id));
      setItems((all) => all.filter((i) => !gone.has(i.id)));
      // the ones left unticked are passed by: the next page starts after them
      setStart((s) => s + (page.length - picked.length));
    } catch (err) {
      setWriteError(`Could not approve these: ${err instanceof Error ? err.message : "YNAB did not answer."}`);
    } finally {
      setSaving(false);
    }
  }

  if (!on) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader title="Clean up" backTo="/" />
        <p className="px-4 py-6 text-base text-gray-700 dark:text-gray-300">
          Connect your budget under{" "}
          <Link to="/settings" className="font-medium text-blue-700 dark:text-blue-400 underline">
            Settings
          </Link>{" "}
          to clean up its transactions.
        </p>
      </div>
    );
  }

  const left = items.length;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title="Clean up" backTo="/" />
      <div className="flex-1 space-y-3 px-4 py-4">
        {phase.state === "loading" && <p role="status" className="text-base text-gray-700 dark:text-gray-300">Reading the transactions…</p>}
        {phase.state === "failed" && (
          <div role="alert" className="space-y-2">
            <p className="text-base text-red-700 dark:text-red-400">{phase.error}</p>
            <button type="button" className={SECONDARY} onClick={() => setRound((r) => r + 1)}>
              Try again
            </button>
          </div>
        )}
        {phase.state === "ready" && left === 0 && <p className="text-base text-gray-700 dark:text-gray-300">Nothing is waiting to be approved.</p>}
        {phase.state === "ready" && left > 0 && page.length === 0 && (
          <div className="space-y-3">
            <p className="text-base text-gray-700 dark:text-gray-300">{left === 1 ? "1 is still unapproved." : `${left} are still unapproved.`}</p>
            <button type="button" className={SECONDARY} onClick={() => setRound((r) => r + 1)}>
              Go through them again
            </button>
          </div>
        )}
        {phase.state === "ready" && page.length > 0 && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Showing {start + 1}–{start + page.length} of {left}, oldest first. Nothing goes to YNAB until you tap Approve.
            </p>
            {groups.map((group) => (
              <GroupCard key={group.key} group={group} categories={categories} onGroupCategory={onGroupCategory} onItemCategory={onItemCategory} onTick={onTick} onTickAll={onTickAll} />
            ))}
            {writeError && (
              <p role="alert" className="text-base text-red-700 dark:text-red-400">
                {writeError}
              </p>
            )}
            <div className="sticky bottom-16 flex flex-wrap gap-2 bg-gray-50 dark:bg-gray-900 py-2">
              <button
                type="button"
                disabled={!approve || picked.length === 0 || saving}
                onClick={() => void approvePage()}
                className={`${BUTTON} flex-1 bg-blue-600 text-white disabled:opacity-50`}
              >
                {saving ? "Approving…" : `Approve ${picked.length}`}
              </button>
              {start + page.length < left && (
                <button type="button" disabled={saving} className={SECONDARY} onClick={() => setStart((s) => s + page.length)}>
                  Skip this page
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
