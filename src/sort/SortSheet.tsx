// The Sort sheet: one charge's facts at the top, the YNAB categories with what is left in each (or a split), a memo, and
// Done, Later and Not mine. Done queues the entered transaction in the YNAB outbox and claims the alert, so it leaves every
// phone. Every load here has a deadline with Try again (rule 32); every control is at least 48 px (rule 42's dialog).
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { openWithin, LaunchTimeout } from "pwa-kit/launch-gate";
import type { LaunchTiming } from "pwa-kit/launch-gate";
import { useSettled, useTapGuard } from "pwa-kit/tap";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import type { YnabCategory, YnabTransactionInput } from "@/contracts/types";
import { ANYONE } from "@/family/cards";
import { useYnabOn } from "@/settings/connections";
import { CategoryPicker } from "./CategoryPicker";
import { SplitEditor } from "./SplitEditor";
import { newPart, partCents, remainderCents, splitReady, type SplitPart } from "./split";
import { buildRequest, readHistory, recordCharge, resolveSuggestion, type SortChargeAsk, type Suggestion } from "./suggest";
import type { FamilyFeed } from "./sort-context";
import type { FeedPhase } from "./useAlerts";
import { chargeDate, handOff, money, readSorted, takeBack, whenLine, type WaitingCharge } from "./waiting";

const ynab = new YnabRepository();
/** The memo's longest: YNAB keeps 200 characters, and the writer adds its marker to the tail. */
const MEMO_MAX = 150;
/** The balances' deadline: slow at 3 s, Try again at 6 s, given up at 12 s. */
const BALANCE_TIMING: Required<LaunchTiming> = { slowAfterMs: 3_000, tryAgainAfterMs: 6_000, timeoutMs: 12_000 };
/** YNAB's own groups, not ones a charge is sorted into. */
const NOT_FOR_CHARGES = new Set(["Internal Master Category", "Credit Card Payments", "Hidden Categories"]);

const PRIMARY = "min-h-12 rounded-xl bg-blue-600 px-4 text-base font-semibold text-white disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-gray-700 dark:disabled:text-gray-300";
const SECONDARY = "min-h-12 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-base font-medium text-gray-800 dark:text-gray-100";
const LINK = "min-h-12 rounded-lg px-3 text-base font-medium text-blue-700 dark:text-blue-400";

function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? "" : "s"}`;
}

/** The sheet's frame: a dialog that rises from the bottom, its title read out, Escape and the dimmed page close it. */
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // the second tap of the double tap that opened the sheet lands on the dimmed page: it does not close it
  const settled = useSettled();
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        aria-hidden="true"
        onClick={() => {
          if (settled()) onClose();
        }}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-gray-50 dark:bg-gray-900 shadow-xl outline-none"
      >
        <div className="overflow-y-auto overscroll-contain px-4 pt-4 pb-2">
          <h2 id={titleId} className="text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">
            {title}
          </h2>
          {children}
        </div>
        {footer && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** A wait in words, with Try again once it is offered and after it failed. */
function Waiting({ phase, words, failed, onRetry }: { phase: FeedPhase; words: { opening: string; slow: string }; failed: string | null; onRetry: () => void }) {
  const line = phase === "failed" ? failed : phase === "slow" || phase === "retryable" ? words.slow : words.opening;
  return (
    <div role="status" className="mt-4 space-y-2">
      <p className={`text-base ${phase === "failed" ? "text-red-700 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}>{line}</p>
      {(phase === "retryable" || phase === "failed") && (
        <button type="button" onClick={onRetry} className={SECONDARY}>
          Try again
        </button>
      )}
    </div>
  );
}

/** The balances, read from YNAB each time the sheet opens, with a deadline; the kept ones stay shown meanwhile. */
function useBalances(enabled: boolean, refresh: () => Promise<void>, timing: LaunchTiming | undefined) {
  const { slowAfterMs, tryAgainAfterMs, timeoutMs } = { ...BALANCE_TIMING, ...timing };
  const [phase, setPhase] = useState<FeedPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const abort = new AbortController();
    openWithin(() => refreshRef.current(), {
      slowAfterMs,
      tryAgainAfterMs,
      timeoutMs,
      signal: abort.signal,
      onPhase: (p) => {
        if (current) setPhase(p);
      },
    }).then(
      () => {
        if (!current) return;
        setPhase("ready");
        setError(null);
      },
      (err: unknown) => {
        if (!current) return;
        setPhase("failed");
        setError(
          err instanceof LaunchTimeout
            ? `YNAB did not answer in ${seconds(timeoutMs)}; these balances are from before.`
            : `${err instanceof Error && err.message ? err.message : "YNAB could not be reached."} These balances are from before.`,
        );
      },
    );
    return () => {
      current = false;
      abort.abort();
    };
  }, [enabled, attempt, slowAfterMs, tryAgainAfterMs, timeoutMs]);
  return { phase, error, retry: () => setAttempt((n) => n + 1) };
}

/** Where the AI's suggestion stands: asking while the mill answers, slow when its deadline passed, quiet otherwise. */
type SuggestStatus = "off" | "asking" | "slow" | "done";

/**
 * Asks the mill where the charge goes once `ready` (the categories and their balances are in), with a deadline. The answer reaches
 * `onSuggestion` unless the deadline passed first; nothing is said of a refusal (no licence) or a failure: the sheet works by hand.
 */
function useSuggestion(opts: {
  suggest: SortChargeAsk | null;
  timeoutMs: number;
  ready: boolean;
  charge: WaitingCharge;
  categories: YnabCategory[] | undefined;
  onSuggestion: (suggestion: Suggestion) => void;
}): SuggestStatus {
  const { suggest, timeoutMs, ready } = opts;
  const [result, setResult] = useState<"slow" | "done" | null>(null);
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  useEffect(() => {
    const { charge: c, categories: list } = latest.current;
    if (!suggest || !ready || !list) return;
    const abort = new AbortController();
    let current = true;
    const owner = c.owner === ANYONE ? undefined : c.owner;
    const request = buildRequest({ merchant: c.merchant, amount: c.amount, owner }, list, readHistory(c.merchant));
    const timer = setTimeout(() => {
      if (!current) return;
      setResult("slow");
      abort.abort();
    }, timeoutMs);
    suggest(request, abort.signal).then(
      (answer) => {
        if (!current || abort.signal.aborted) return;
        clearTimeout(timer);
        setResult("done");
        const suggestion = resolveSuggestion(answer, list, c.amount);
        if (suggestion) latest.current.onSuggestion(suggestion);
      },
      () => {
        if (!current || abort.signal.aborted) return;
        clearTimeout(timer);
        setResult("done");
      },
    );
    return () => {
      current = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [suggest, ready, timeoutMs]);
  return result ?? (suggest && ready ? "asking" : "off");
}

function chargeTitle(charge: WaitingCharge): string {
  return `${money(charge.amount)} at ${charge.merchant}`;
}

/** The sheet for one charge that is waiting. */
function ChargeSheet({ family, charge, onClose }: { family: FamilyFeed; charge: WaitingCharge; onClose: () => void }) {
  const guard = useTapGuard();
  const memoId = useId();
  const accountId = useId();
  const reasonId = useId();
  const ynabOn = useYnabOn();
  const categories = useLiveQuery(
    async () => (await ynab.listCategories()).filter((c: YnabCategory) => !c.hidden && !NOT_FOR_CHARGES.has(c.groupName)),
    [],
  );
  const accounts = useLiveQuery(async () => (await ynab.listAccounts()).filter((a) => !a.closed), []);
  const balances = useBalances(ynabOn, family.refreshBalances, family.balanceTiming);

  const { alert, amount } = charge;
  const cardAccount = family.book.account(alert.last4);
  const [chosenAccount, setChosenAccount] = useState("");
  const account = cardAccount ?? (chosenAccount || null);
  const accountName = accounts?.find((a) => a.id === account)?.name;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [parts, setParts] = useState<SplitPart[]>(() => [newPart(), newPart()]);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // the AI's suggestion fills the sheet in only while nothing has been chosen by hand
  const touched = useRef(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const suggestStatus = useSuggestion({
    suggest: ynabOn ? family.suggest : null,
    timeoutMs: family.suggestTimeoutMs,
    ready: !!categories && categories.length > 0 && ["ready", "failed", "retryable"].includes(balances.phase),
    charge,
    categories,
    onSuggestion: (s) => {
      if (touched.current) return;
      setSuggestion(s);
      if ("categoryId" in s) setCategoryId(s.categoryId);
      else {
        setSplitting(true);
        setParts(s.parts.map((p) => ({ ...newPart(p.categoryId), amount: p.amount.toFixed(2) })));
      }
    },
  });
  const suggestedShown = suggestion !== null && ("categoryId" in suggestion ? !splitting && categoryId === suggestion.categoryId : splitting);
  const selectCategory = (id: string) => {
    touched.current = true;
    setCategoryId(id);
  };
  const changeParts = (next: SplitPart[]) => {
    touched.current = true;
    setParts(next);
  };

  const ready = splitting ? splitReady(parts, amount) : categoryId !== null;
  const reason = !ynabOn
    ? null
    : !family.writer
      ? "This phone cannot write to YNAB yet."
      : !account
        ? "Choose the YNAB account this card goes with."
        : splitting
          ? remainderCents(parts, amount) !== 0
            ? "The parts must add up to the charge."
            : parts.some((p) => p.categoryId === "" || (partCents(p.amount) ?? 0) <= 0)
              ? "Give every part a category and an amount."
              : null
          : categoryId === null
            ? "Choose a category."
            : null;
  const canDone = ynabOn && !!family.writer && !!account && ready && !saving;

  async function done() {
    if (!canDone || !family.writer || !account) return;
    setSaving(true);
    setSaveError(null);
    const input: YnabTransactionInput = {
      accountId: account,
      date: chargeDate(alert.when),
      amount,
      ...(alert.merchant?.trim() ? { payeeName: alert.merchant.trim() } : {}),
      ...(splitting
        ? { splits: parts.map((p) => ({ categoryId: p.categoryId, amount: (partCents(p.amount) ?? 0) / 100 })) }
        : { categoryId: categoryId ?? undefined }),
      ...(memo.trim() ? { memo: memo.trim() } : {}),
    };
    // the first Done of the family takes it: one another phone already took is not written twice
    const taken = await family.feed.take(alert.id);
    if (taken === "gone") {
      // the feed is read again, and the sheet says it was sorted on another phone
      setSaving(false);
      return;
    }
    try {
      await family.writer.create(input, { localId: `alert-${alert.id}` });
      family.sortedHere(charge, taken === "claimed");
      const nameOf = (id: string) => categories?.find((c) => c.id === id)?.name;
      const sortedInto = (splitting ? parts.map((p) => ({ id: p.categoryId, amount: (partCents(p.amount) ?? 0) / 100 })) : [{ id: categoryId ?? "", amount }])
        .map((p) => ({ category: nameOf(p.id), amount: p.amount }))
        .filter((p): p is { category: string; amount: number } => p.category !== undefined);
      recordCharge(charge.merchant, amount, sortedInto);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : "This phone could not keep the transaction. Try again.");
      setSaving(false);
    }
  }

  const owner = charge.owner === ANYONE ? null : charge.owner;
  const when = whenLine(alert.when);

  const footer = (
    <div className="space-y-2">
      {reason && ynabOn && (
        <p id={reasonId} className="text-sm text-gray-600 dark:text-gray-400">
          {reason}
        </p>
      )}
      {saveError && <p className="text-sm text-red-700 dark:text-red-400">{saveError}</p>}
      {ynabOn && (
        <button
          type="button"
          disabled={!canDone}
          aria-describedby={reason ? reasonId : undefined}
          onClick={guard(() => void done())}
          className={`${PRIMARY} w-full`}
        >
          Done
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={guard(onClose)} className={SECONDARY}>
          Later
        </button>
        {charge.handed ? (
          <button type="button" onClick={guard(() => takeBack(alert.id))} className={SECONDARY}>
            Mine after all
          </button>
        ) : (
          <button
            type="button"
            onClick={guard(() => {
              handOff(alert.id);
              onClose();
            })}
            className={SECONDARY}
          >
            Not mine
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Sheet title={chargeTitle(charge)} onClose={onClose} footer={footer}>
      <dl className="mt-1 space-y-0.5 text-base text-gray-700 dark:text-gray-300">
        {alert.last4 && (
          <div>
            <dt className="sr-only">Card</dt>
            <dd>{owner ? `•••• ${alert.last4} · ${owner}` : `•••• ${alert.last4}`}</dd>
          </div>
        )}
        {accountName && (
          <div>
            <dt className="sr-only">YNAB account</dt>
            <dd>{accountName}</dd>
          </div>
        )}
        {when && (
          <div>
            <dt className="sr-only">When</dt>
            <dd>{when}</dd>
          </div>
        )}
        {charge.handed && family.other && <dd className="text-sm text-gray-500 dark:text-gray-400">Handed to {family.other}</dd>}
      </dl>

      {!ynabOn ? (
        <p className="mt-4 text-base text-gray-700 dark:text-gray-300">Connect YNAB under Settings to sort a charge into a category.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {!cardAccount && accounts && (
            <div className="space-y-1">
              <label htmlFor={accountId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                YNAB account
              </label>
              <select
                id={accountId}
                value={chosenAccount}
                onChange={(e) => setChosenAccount(e.target.value)}
                className="min-h-12 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-base text-gray-900 dark:text-gray-100"
              >
                <option value="">Choose the account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{splitting ? "Split" : "Category"}</h3>
            <button
              type="button"
              onClick={() => {
                touched.current = true;
                setSplitting((s) => !s);
              }}
              className={LINK}
            >
              {splitting ? "One category" : "Split"}
            </button>
          </div>

          {suggestStatus === "asking" && (
            <p role="status" className="text-sm text-gray-600 dark:text-gray-400">
              Asking for a suggestion…
            </p>
          )}
          {suggestStatus === "slow" && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
              The suggestion is taking too long. Choose by hand.
            </p>
          )}
          {suggestedShown && (
            <p role="status" className="rounded-lg bg-blue-50 dark:bg-blue-950 px-3 py-2 text-sm text-gray-800 dark:text-gray-100">
              <span className="font-semibold">Suggested · </span>
              {suggestion.why}
            </p>
          )}

          {balances.phase !== "ready" && balances.phase !== "idle" && (
            <div role="status" className="space-y-2 text-sm">
              <p className={balances.phase === "failed" ? "text-amber-700 dark:text-amber-400" : "text-gray-600 dark:text-gray-400"}>
                {balances.phase === "failed"
                  ? balances.error
                  : balances.phase === "opening"
                    ? "Updating the balances from YNAB…"
                    : "Still waiting for YNAB…"}
              </p>
              {(balances.phase === "retryable" || balances.phase === "failed") && (
                <button type="button" onClick={balances.retry} className={SECONDARY}>
                  Try again
                </button>
              )}
            </div>
          )}

          {categories === undefined ? null : categories.length === 0 ? (
            <p className="text-base text-gray-700 dark:text-gray-300">No categories are kept yet. Refresh YNAB under Settings.</p>
          ) : splitting ? (
            <SplitEditor categories={categories} amount={amount} parts={parts} onChange={changeParts} />
          ) : (
            <CategoryPicker categories={categories} amount={amount} selected={categoryId} onSelect={selectCategory} />
          )}

          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={memoId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Memo
              </label>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {memo.length} of {MEMO_MAX}
              </span>
            </div>
            <input
              id={memoId}
              autoComplete="off"
              maxLength={MEMO_MAX}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-base text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The sheet for an alert id: the charge when it is waiting, the wait for the feed while it is read, or what became of it. */
export function SortSheet({ family, alertId, onClose }: { family: FamilyFeed; alertId: string; onClose: () => void }) {
  const charge = family.waiting.find((c) => c.alert.id === alertId);
  if (charge) return <ChargeSheet key={alertId} family={family} charge={charge} onClose={onClose} />;

  const { phase, error, refresh } = family.feed;
  const closeFooter = (
    <button type="button" onClick={onClose} className={`${SECONDARY} w-full`}>
      Close
    </button>
  );
  let body: ReactNode;
  if (!family.on) {
    body = <p className="mt-4 text-base text-gray-700 dark:text-gray-300">Family is Off on this phone. Turn it on under Settings to sort the family's charges.</p>;
  } else if (family.blocked) {
    body = <p className="mt-4 text-base text-gray-700 dark:text-gray-300">{family.blocked} under Settings &gt; Factory to read the family's charges.</p>;
  } else if (phase === "ready") {
    const record = readSorted().find((r) => r.id === alertId);
    body = (
      <p className="mt-4 text-base text-gray-700 dark:text-gray-300">
        {record && record.by === (family.me ?? "This phone")
          ? "You sorted this charge already."
          : "This charge is not waiting any more: it was sorted on another phone."}
      </p>
    );
  } else {
    body = (
      <Waiting
        phase={phase}
        words={{ opening: "Reading the family's charges…", slow: "Still waiting for the backend…" }}
        failed={error}
        onRetry={refresh}
      />
    );
  }
  return (
    <Sheet title="Sort a charge" onClose={onClose} footer={closeFooter}>
      {body}
    </Sheet>
  );
}

/** The route /sort/:alertId, drawn over Home (whose feed it reads). */
export function SortRoute() {
  const { alertId = "" } = useParams();
  const family = useOutletContext<FamilyFeed>();
  const navigate = useNavigate();
  return <SortSheet family={family} alertId={alertId} onClose={() => navigate("/", { replace: true })} />;
}
