// Home's "Budget ideas": what keeps landing in Stuff I Forgot to Budget For, proposed as a category with an amount. Each idea has
// Add (the app creates the category and its target in YNAB and says so; when it cannot, it says exactly what to add by hand),
// Not now (hidden 90 days), Never, and Reply (his words go to the budget-idea-reply grind: the idea is revised, retired or explained, and
// his reason is kept for later ideas, src/ynab/budget-idea-reply.ts). Drawn only while YNAB is On and the budget has the fallback category.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { NotAllowed } from "@/factory/mill";
import { useYnabOn } from "@/settings/connections";
import { FALLBACK_NAME, OTHER_KIND, askKind, fallbackCategory } from "@/sort/suggest";
import { useCleanupDeps } from "@/sort/sort-context";
import { money, wholeMoney } from "@/sort/waiting";
import { ReplyBox, NO_ANSWER } from "@/components/forms/reply-box";
import { refreshCache } from "./cache";
import {
  addReason,
  applyRevisions,
  buildReplyRequest,
  readReasons,
  readRevisions,
  resolveReply,
  ruledOutPayees,
  writeRevision,
} from "./budget-idea-reply";
import { day } from "./tally";
import {
  dismiss,
  isDismissed,
  chooseShown,
  proposeIdeas,
  readCharges,
  readDismissed,
  readIdeaSettings,
  readIntroduced,
  readKinds,
  refreshIdeaCharges,
  writeIntroduced,
  writeKind,
  type BudgetIdea,
  type KeptCharges,
} from "./budget-ideas";

/** The most payees asked about their kind in one visit to Home; the rest wait for the next. */
const KINDS_ASKED_AT_A_TIME = 8;
const BUTTON = "min-h-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm font-medium text-gray-800 dark:text-gray-100 disabled:opacity-50";

const dayLine = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** What the idea is, in dollars: '$40 a month' or '$595 a year, due Feb 1, 2027'. */
const amountLine = (idea: BudgetIdea): string =>
  idea.cadence === "monthly" ? `${wholeMoney(idea.amount)} a month` : `${wholeMoney(idea.amount)} a year, due ${dayLine(idea.dueDate!)}`;

export function BudgetIdeas() {
  const on = useYnabOn();
  const { getClient, suggest, suggestTimeoutMs, replyIdea, replyTimeoutMs } = useCleanupDeps();
  const categories = useLiveQuery(() => db.ynabCategories.toArray(), []);
  const [charges, setCharges] = useState<KeptCharges | null>(readCharges);
  const [kinds, setKinds] = useState(readKinds);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState(readReasons);
  const [revisions, setRevisions] = useState(readRevisions);
  // what a reply said: a revised or explained idea's sentence under its card, and a retired idea's goodbye (shown once)
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [farewell, setFarewell] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  const forgot = useMemo(() => (categories ? fallbackCategory(categories) : undefined), [categories]);
  const hasForgot = forgot !== undefined;

  // the year's charges to the fallback: kept, and read from YNAB when they are old
  useEffect(() => {
    if (!on || !hasForgot) return;
    let cancelled = false;
    void (async () => {
      try {
        const read = await refreshIdeaCharges(await getClient());
        if (!cancelled && read) setCharges(read);
      } catch {
        // nothing blocks on YNAB: the ideas from what is kept stay, and the next visit tries again
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [on, hasForgot, getClient]);

  // what each payee's spend is for, asked once of the guesser and kept
  const payeesToAsk = useMemo(() => {
    const spend = new Map<string, { name: string; dollars: number }>();
    for (const c of charges?.charges ?? []) {
      const key = c.payee.trim().toLowerCase();
      spend.set(key, { name: c.payee, dollars: (spend.get(key)?.dollars ?? 0) + c.amount });
    }
    return [...spend].filter(([key]) => !kinds.has(key)).sort((a, b) => b[1].dollars - a[1].dollars).map(([, v]) => v.name);
  }, [charges, kinds]);
  const askKey = payeesToAsk.join("\u0000");
  useEffect(() => {
    if (!on || !hasForgot || !suggest || askKey === "") return;
    let cancelled = false;
    const run = new AbortController();
    void (async () => {
      for (const payee of askKey.split("\u0000")) {
        // the answer to one changes askKey and restarts this loop, so the limit is on all that were asked since Home opened
        if (cancelled || asked.current.size >= KINDS_ASKED_AT_A_TIME) return;
        if (asked.current.has(payee)) continue;
        asked.current.add(payee);
        const deadline = setTimeout(() => run.abort(), suggestTimeoutMs);
        try {
          const kind = await askKind(payee, suggest, run.signal);
          writeKind(payee, kind ?? OTHER_KIND);
          if (!cancelled) setKinds(readKinds());
        } catch (err) {
          // the licence is not held: nothing more is asked; any other failure leaves this payee to the next visit
          if (err instanceof NotAllowed) return;
        } finally {
          clearTimeout(deadline);
        }
      }
    })();
    return () => {
      cancelled = true;
      run.abort();
    };
  }, [on, hasForgot, suggest, suggestTimeoutMs, askKey]);

  const today = day(Date.now());
  const settings = readIdeaSettings();
  const { shown, introduced } = useMemo(() => {
    if (!on || !forgot || !charges) return { shown: [], introduced: [] as string[] };
    const ideas = proposeIdeas(charges.charges, {
      today,
      kindOf: (payee) => {
        const kind = kinds.get(payee.trim().toLowerCase());
        return kind && kind !== OTHER_KIND ? kind : undefined;
      },
      settings,
      existingNames: (categories ?? []).map((c) => c.name),
      ruledOut: ruledOutPayees(reasons),
    });
    const hidden = new Set(ideas.filter((i) => isDismissed(dismissed, i.key)).map((i) => i.key));
    return chooseShown(applyRevisions(ideas, revisions), readIntroduced(today), hidden);
    // the thresholds are read from storage at each draw
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, forgot, charges, kinds, dismissed, categories, today, reasons, revisions, settings.minSpend, settings.minCharges]);
  const introducedKey = introduced.join("\u0000");
  useEffect(() => {
    if (introducedKey !== "") writeIntroduced(today, introducedKey.split("\u0000"));
  }, [introducedKey, today]);

  const answer = useCallback((idea: BudgetIdea, how: "not-now" | "never") => {
    dismiss(idea.key, how);
    setDismissed(readDismissed());
  }, []);

  /** His words about one idea go to the grind; null when the answer was used, else what to tell him (the card stays as it was). */
  async function reply(idea: BudgetIdea, words: string): Promise<string | null> {
    if (!replyIdea) return "Hold the licence to send a reply.";
    const names = (categories ?? []).filter((c) => !c.hidden).map((c) => c.name);
    const run = new AbortController();
    const deadline = setTimeout(() => run.abort(), replyTimeoutMs);
    try {
      const result = resolveReply(await replyIdea(buildReplyRequest(idea, words, names), run.signal), idea, names);
      if (!result) return NO_ANSWER;
      if (result.kind === "explain") {
        setNotes((was) => ({ ...was, [idea.key]: result.say }));
        return null;
      }
      // only a payee this idea was made from can be ruled out
      const mine = new Set(idea.payees.map((p) => p.trim().toLowerCase()));
      const rulesOut = result.rulesOut.filter((p) => mine.has(p.trim().toLowerCase()));
      // a retire always keeps his reason (the grind's line of it, else his words); a revise keeps one only when the grind found one
      const reason = result.note ?? (result.kind === "retire" ? words : undefined);
      if (reason) {
        addReason({ words: reason, payees: rulesOut });
        setReasons(readReasons());
      }
      if (result.kind === "revise") {
        writeRevision(idea.key, result.revision);
        setRevisions(readRevisions());
        setNotes((was) => ({ ...was, [idea.key]: result.say }));
      } else {
        dismiss(idea.key, "never");
        setDismissed(readDismissed());
        setFarewell(`${result.say}${reason ? ` Your reason, kept for later ideas: "${reason}"` : ""}`);
      }
      return null;
    } catch {
      return NO_ANSWER;
    } finally {
      clearTimeout(deadline);
    }
  }

  async function add(idea: BudgetIdea) {
    if (!forgot || busy) return;
    setBusy(idea.key);
    setError(null);
    setAdded(null);
    try {
      const client = await getClient();
      const connection = await new YnabRepository().getConnection();
      if (!connection) throw new Error("YNAB is not connected.");
      await client.createCategory(connection.budgetId, {
        name: idea.name,
        groupId: forgot.groupId,
        target: { dollars: idea.amount, frequency: idea.cadence === "monthly" ? "monthly" : "yearly", ...(idea.dueDate ? { dueDate: idea.dueDate } : {}) },
      });
      // the idea is answered for good: it is in his budget now
      dismiss(idea.key, "never");
      setDismissed(readDismissed());
      setAdded(`Added ${idea.name} to YNAB in the group ${forgot.groupName}, with a target of ${amountLine(idea)}.`);
      await refreshCache(client).catch(() => undefined);
    } catch (err) {
      setError(`Could not add it in YNAB (${err instanceof Error ? err.message : "YNAB did not answer"}). ${howToAdd(idea, forgot.groupName)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!on || !forgot || (shown.length === 0 && !added && !error && !farewell)) return null;
  return (
    <section aria-label="Budget ideas" className="space-y-2">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Budget ideas</h2>
      {added && (
        <p role="status" className="text-sm text-green-800 dark:text-green-300">
          {added}
        </p>
      )}
      {farewell && (
        <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
          {farewell}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <ul aria-label="Budget ideas" className="space-y-2">
        {shown.map((idea) => (
          <li key={idea.key} aria-label={idea.name} className="flex flex-col gap-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 flex-1 break-words text-base font-medium text-gray-900 dark:text-gray-100">{idea.name}</span>
              <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{amountLine(idea)}</span>
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {idea.charges.length} {idea.charges.length === 1 ? "charge" : "charges"}, {money(idea.total)} in the last year went to {FALLBACK_NAME}: {[...idea.payees].sort().join(", ")}.
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">{howToAdd(idea, forgot.groupName)}</span>
            <details>
              <summary className="min-h-8 cursor-pointer text-sm text-blue-600 dark:text-blue-400">The charges behind it</summary>
              <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {[...idea.charges]
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .map((c) => (
                    <li key={c.id} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">
                        {dayLine(c.date)} · {c.payee}
                      </span>
                      <span>{money(c.amount)}</span>
                    </li>
                  ))}
              </ul>
            </details>
            {notes[idea.key] && <p className="text-sm text-gray-800 dark:text-gray-200">{notes[idea.key]}</p>}
            <span className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void add(idea)} className={BUTTON}>
                Add
              </button>
              <button type="button" disabled={busy !== null} onClick={() => answer(idea, "not-now")} className={BUTTON}>
                Not now
              </button>
              <button type="button" disabled={busy !== null} onClick={() => answer(idea, "never")} className={BUTTON}>
                Never
              </button>
              <ReplyBox subject={idea.name} disabled={busy !== null} onSend={(words) => reply(idea, words)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Exactly what to add in YNAB for an idea, said whether or not the app can do it. */
function howToAdd(idea: BudgetIdea, group: string): string {
  return `To add in YNAB: a category named ${idea.name} in the group ${group}, with a target of ${amountLine(idea)}.`;
}
