// Clean up: YNAB's unapproved transactions, oldest first, twenty to a page, grouped by payee. Each group carries the category its
// payee usually goes to and how sure that is (src/ynab/cleanup.ts); the sure ones are ticked and first, the rest wait unticked.
// Nothing reaches YNAB until he taps Approve, and then only the ticked ones, in one request. "Always <category>" on a card approves all
// of that payee's unapproved transactions at once and keeps a payee rule (src/ynab/payee-rules.ts): the payee's new ones are approved as
// they are read, before this lists them; Undo takes the last "Always" back for 10 seconds, and Payee rules lists the rules to remove.
// A check (payee text 'CHECK <number>') is its own card in a Checks pile at the end: "Add check image" keeps an image on the device
// (never sent to YNAB), and the mill reads its payee and memo to suggest the category; Approve writes the payee read into the memo.
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { Link } from "react-router";
import type { CheckImage, YnabCategory } from "@/contracts/types";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db/database";
import { CheckImageRepository } from "@/db/repositories/check-image-repository";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { RECEIPT_STILL, stillFromFile } from "@/scanner/capture-still";
import { useYnabOn } from "@/settings/connections";
import { useCleanupDeps } from "@/sort/sort-context";
import { buildRequest, readHistory, resolveSuggestion, tallyFor } from "@/sort/suggest";
import { money } from "@/sort/waiting";
import { refreshCache } from "@/ynab/cache";
import { resolveCheckRead } from "@/ynab/check-read";
import { applyCheckRead, compareItems, groupPage, isInflowCategory, loadCleanup, pageAfter, withHeldNotes, type CleanupGroup, type CleanupItem, type Confidence } from "@/ynab/cleanup";
import { PayeeRuleRepository, setAlways, undoAlways, unapprovedWithRules, type AlwaysDone } from "@/ynab/payee-rules";
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

/** How long Undo stays after "Always". */
const UNDO_MS = 10_000;

interface Undoable {
  done: AlwaysDone;
  /** the items that left the list, as they were */
  items: CleanupItem[];
  categoryName: string;
}

const plural = (n: number) => (n === 1 ? "1 transaction" : `${n} transactions`);
/** Dollars as said on a row: money out plain, money in marked. */
const said = (amount: number) => `${money(Math.abs(amount))}${amount > 0 ? " in" : ""}`;
const bestOf = (items: readonly CleanupItem[]): Confidence => items.reduce<Confidence>((best, i) => (RANK[i.confidence] > RANK[best] ? i.confidence : best), "unsure");

function Badge({ confidence }: { confidence: Confidence }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[confidence]}`}>{WORD[confidence]}</span>;
}

/** Ready to Assign is for money in: a list for an outflow leaves it out. */
const choicesFor = (categories: readonly YnabCategory[], moneyIn: boolean): readonly YnabCategory[] => (moneyIn ? categories : categories.filter((c) => !isInflowCategory(c)));

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
  onAlways,
  busy,
}: {
  group: CleanupGroup;
  categories: readonly YnabCategory[];
  onGroupCategory: (key: string, categoryId: string) => void;
  onItemCategory: (id: string, categoryId: string) => void;
  onTick: (id: string, on: boolean) => void;
  onTickAll: (key: string, on: boolean) => void;
  /** taps "Always <category>"; null while that cannot be done (no writer) */
  onAlways: ((group: CleanupGroup, categoryId: string) => void) | null;
  busy: boolean;
}) {
  const best = bestOf(group.items);
  const editable = group.items.filter((i) => !i.fixedLabel);
  const shared = editable.length > 0 && editable.every((i) => i.categoryId === editable[0]!.categoryId) ? (editable[0]!.categoryId ?? "") : "";
  const mixed = editable.length > 1 && shared === "" && editable.some((i) => i.categoryId !== null);
  const tickable = group.items.filter((i) => i.categoryId !== null || i.fixedLabel);
  const sharedName = shared ? categories.find((c) => c.id === shared)?.name : undefined;
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
      {editable.length > 0 && <CategorySelect label={`Category for ${group.payee}`} value={shared} mixed={mixed} categories={choicesFor(categories, group.items.some((i) => i.amount > 0))} onChange={(id) => onGroupCategory(group.key, id)} />}
      {onAlways && sharedName && (
        <button type="button" disabled={busy} className={`${SECONDARY} w-full`} onClick={() => onAlways(group, shared)}>
          Always {sharedName}
        </button>
      )}
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
              {item.note && <p className="break-words pl-8 text-sm text-gray-800 dark:text-gray-200">{item.note}</p>}
              <p className="pl-8 text-xs text-gray-600 dark:text-gray-400">{item.why}</p>
              {item.fixedLabel ? (
                <p className="pl-8 text-sm font-medium text-gray-800 dark:text-gray-200">{item.fixedLabel}</p>
              ) : (
                group.items.length > 1 && (
                  <div className="pl-8">
                    <CategorySelect label={`Category for ${what}`} value={item.categoryId ?? ""} categories={choicesFor(categories, item.amount > 0)} onChange={(id) => onItemCategory(item.id, id)} />
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

/** An object URL for a blob, made while it is shown. */
function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== "function") return;
    const objectUrl = URL.createObjectURL(blob);
    // set after the effect body, so StrictMode's re-run never shows a revoked URL
    let live = true;
    queueMicrotask(() => {
      if (live) setUrl(objectUrl);
    });
    return () => {
      live = false;
      URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [blob]);
  return url;
}

/** The image of a check as a thumbnail that opens full size. */
function CheckThumb({ image, check }: { image: Blob; check: string }) {
  const url = useBlobUrl(image);
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <button type="button" aria-label={`Open the image of check ${check} full size`} className="block overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600" onClick={() => setOpen(true)}>
        <img src={url} alt={`Image of check ${check}`} className="h-24 w-auto max-w-full object-cover" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`Check ${check}`} className="fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-black/90 p-3">
          <button type="button" className={`${SECONDARY} self-end`} onClick={() => setOpen(false)}>
            Close
          </button>
          <img src={url} alt={`Check ${check}, full size`} className="mx-auto h-auto max-w-full" />
        </div>
      )}
    </>
  );
}

/** One check, its own card in the Checks pile: its number, date and amount, the image he adds, and the category the read suggests. */
function CheckCard({
  group,
  categories,
  image,
  note,
  onItemCategory,
  onTick,
  onImage,
  canUndo,
  onUndo,
}: {
  group: CleanupGroup;
  categories: readonly YnabCategory[];
  image: Blob | undefined;
  /** what is happening to its image now, or what went wrong */
  note: string | undefined;
  onItemCategory: (id: string, categoryId: string) => void;
  onTick: (id: string, on: boolean) => void;
  onImage: (item: CleanupItem, file: Blob) => void;
  /** an image he replaced is still kept, until he leaves the card */
  canUndo: boolean;
  onUndo: (item: CleanupItem) => void;
}) {
  const item = group.items[0]!;
  const number = item.check ?? "";
  const what = `${said(item.amount)} on ${item.date}`;
  const file = useRef<HTMLInputElement>(null);
  const pasted = (event: ClipboardEvent) => {
    const picture = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!picture) return;
    event.preventDefault();
    onImage(item, picture);
  };
  return (
    <section role="group" aria-label={group.payee} onPaste={pasted} className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="min-w-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{group.payee}</h3>
        <Badge confidence={item.confidence} />
      </div>
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
      </label>
      {item.memo && <p className="break-words text-sm text-gray-600 dark:text-gray-400">{item.memo}</p>}
      {item.writeMemo && <p className="break-words text-sm text-gray-700 dark:text-gray-300">Memo on approve: {item.writeMemo}</p>}
      {item.note && <p className="break-words text-sm text-gray-800 dark:text-gray-200">{item.note}</p>}
      <p className="text-xs text-gray-600 dark:text-gray-400">{item.why}</p>
      {item.fixedLabel ? (
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.fixedLabel}</p>
      ) : (
        <CategorySelect label={`Category for ${group.payee}`} value={item.categoryId ?? ""} categories={choicesFor(categories, item.amount > 0)} onChange={(id) => onItemCategory(item.id, id)} />
      )}
      {image && <CheckThumb image={image} check={number} />}
      <button type="button" className={`${SECONDARY} w-full`} onClick={() => file.current?.click()}>
        {image ? "Replace check image" : "Add check image"}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="check-file-input"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onImage(item, picked);
        }}
      />
      <p className="text-xs text-gray-600 dark:text-gray-400">Take a photo, choose a file, or paste an image here. It stays on this phone and never goes to YNAB.</p>
      {canUndo && (
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-gray-800 dark:text-gray-200">
          The earlier image was replaced.
          <button type="button" className="min-h-12 px-2 font-semibold underline" onClick={() => onUndo(item)}>
            Undo
          </button>
        </p>
      )}
      {note && (
        <p role="status" className="text-sm text-gray-800 dark:text-gray-200">
          {note}
        </p>
      )}
    </section>
  );
}

/** The payee rules: each with its payee, category and how many it has approved; Remove stops it and changes nothing already written. */
function PayeeRules() {
  const rules = useLiveQuery(() => new PayeeRuleRepository().list(), []);
  const names = useLiveQuery(async () => new Map((await db.ynabCategories.toArray()).map((c) => [c.id, c.name])), []);
  if (!rules) return null;
  if (rules.length === 0) return <p className="text-base text-gray-700 dark:text-gray-300">No payee rules yet.</p>;
  return (
    <ul aria-label="Payee rules" className="space-y-2">
      {rules.map((rule) => (
        <li key={rule.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div className="min-w-0">
            <p className="break-words text-base font-semibold text-gray-900 dark:text-gray-100">{rule.payee}</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{names?.get(rule.categoryId) ?? "A category no longer in YNAB"}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Approved {rule.approved}</p>
          </div>
          <button type="button" className={SECONDARY} onClick={() => void new PayeeRuleRepository().remove(rule.key)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function CleanupPage() {
  const on = useYnabOn();
  const deps = useCleanupDeps();
  const { getClient, approve, restore, suggest, suggestTimeoutMs, readCheck, checkTimeoutMs } = deps;
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [items, setItems] = useState<CleanupItem[]>([]);
  const [categories, setCategories] = useState<YnabCategory[]>([]);
  const [start, setStart] = useState(0);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [checkNotes, setCheckNotes] = useState<Record<string, string>>({});
  // a second image waiting for his answer to "Replace the check image?", and the images he has replaced on this page (kept for Undo
  // until he leaves the card: the rows are tied to the page they were replaced on)
  const [pendingImage, setPendingImage] = useState<{ item: CleanupItem; file: Blob } | null>(null);
  const [replacedOn, setReplacedOn] = useState<{ page: string; rows: Record<string, CheckImage> }>({ page: "", rows: {} });
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
        // the payee rules approve their payees' new transactions first, so those are never listed
        const read = await unapprovedWithRules(client, connection.budgetId, approve);
        const loaded = await loadCleanup(client, connection.budgetId, Date.now(), read.rows);
        if (cancelled) return;
        setRuleError(read.error);
        asked.current = new Set();
        setCategories(loaded.categories);
        setItems(withHeldNotes(loaded.items, read.held, loaded.categories));
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
  }, [on, getClient, approve, round]);

  const page = useMemo(() => pageAfter(items, start), [items, start]);
  const groups = useMemo(() => groupPage(page), [page]);
  const checkIds = useMemo(() => page.filter((i) => i.check !== undefined).map((i) => i.id), [page]);
  const checkIdsKey = checkIds.join("\u0000");
  const pageKey = `${round}:${start}:${checkIdsKey}`;
  const replaced = replacedOn.page === pageKey ? replacedOn.rows : {};
  // the images kept for the checks on this page
  const images = useLiveQuery(async () => new Map([...(await new CheckImageRepository().many(checkIds))].map(([id, row]) => [id, row.image])), [checkIdsKey]);

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
          const spending = categories.filter((c) => !isInflowCategory(c));
          const tally = tallyFor(payee, readTally(), spending);
          const answer = await suggest(buildRequest({ merchant: payee, amount }, spending, readHistory(payee), undefined, tally), run.signal);
          const seen = new Set(items.find((i) => i.payee === payee)?.seen ?? []);
          const found = resolveSuggestion(answer, spending, amount, seen);
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

  const note = (id: string, text: string | null) =>
    setCheckNotes((all) => {
      const rest = Object.fromEntries(Object.entries(all).filter(([key]) => key !== id));
      return text === null ? rest : { ...rest, [id]: text };
    });

  // an image he adds is kept on the device first, then read by the mill (when allowed) for the payee and memo; a failed read leaves
  // the image kept and the card as it was
  async function addImage(item: CleanupItem, file: Blob, previous?: CheckImage) {
    let image: Blob;
    try {
      image = await stillFromFile(file, RECEIPT_STILL);
    } catch {
      note(item.id, "That picture could not be used. Try another.");
      return;
    }
    const repo = new CheckImageRepository();
    if (previous) setReplacedOn((now) => ({ page: pageKey, rows: { ...(now.page === pageKey ? now.rows : {}), [item.id]: previous } }));
    const kept = await repo.put(item.id, image);
    if (!readCheck) return note(item.id, null);
    note(item.id, "Reading the image…");
    const run = new AbortController();
    const deadline = setTimeout(() => run.abort(), checkTimeoutMs);
    try {
      const request = { check: item.payee, date: item.date, amount: Math.abs(item.amount), categories: categories.filter((c) => !isInflowCategory(c)).slice(0, 150).map((c) => ({ name: c.name.slice(0, 60) })) };
      const answer = await readCheck(request, image, run.signal);
      // the image was put back by Undo while the mill was reading: the read is of an image no longer on the card
      if ((await repo.get(item.id))?.addedAt !== kept.addedAt) return note(item.id, null);
      await repo.setRead(item.id, kept.addedAt, answer);
      const read = resolveCheckRead(answer, categories);
      if (read) setItems((all) => all.map((i) => (i.id === item.id ? applyCheckRead(i, read) : i)));
      note(item.id, read ? null : "The image was read, but it said nothing to go by.");
    } catch (err) {
      const why = run.signal.aborted ? "The factory took too long." : err instanceof Error && err.message ? err.message : "The factory did not answer.";
      note(item.id, `The image is kept, but it could not be read: ${why}`);
    } finally {
      clearTimeout(deadline);
    }
  }

  // a second image on a check that has one is asked about first; the first image of a check is just kept
  async function offerImage(item: CleanupItem, file: Blob) {
    if (await new CheckImageRepository().get(item.id)) setPendingImage({ item, file });
    else await addImage(item, file);
  }

  async function replaceImage() {
    const pending = pendingImage;
    if (!pending) return;
    setPendingImage(null);
    const previous = await new CheckImageRepository().get(pending.item.id);
    await addImage(pending.item, pending.file, previous);
  }

  // Undo puts the replaced image back, with its read, and what that read suggested
  async function undoImage(item: CleanupItem) {
    const previous = replaced[item.id];
    if (!previous) return;
    await new CheckImageRepository().restore(previous);
    setReplacedOn((now) => ({ page: now.page, rows: Object.fromEntries(Object.entries(now.rows).filter(([id]) => id !== item.id)) }));
    note(item.id, null);
    const read = previous.read ? resolveCheckRead(previous.read, categories) : null;
    if (read) setItems((all) => all.map((i) => (i.id === item.id ? applyCheckRead(i, read) : i)));
  }

  // Undo is there for ten seconds after "Always"
  useEffect(() => {
    if (!undoable) return;
    const timer = setTimeout(() => setUndoable(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undoable]);

  async function always(group: CleanupGroup, categoryId: string) {
    if (!approve || saving) return;
    const targets = items.filter((i) => i.key === group.key && !i.fixedLabel);
    if (targets.length === 0) return;
    setSaving(true);
    setWriteError(null);
    try {
      const connection = await new YnabRepository().getConnection();
      if (!connection) throw new Error("No budget is connected.");
      const done = await setAlways(
        { budgetId: connection.budgetId, payee: group.payee, key: group.key, categoryId, items: targets.map((i) => ({ id: i.id, ynabCategoryId: i.ynabCategoryId })) },
        approve,
      );
      const gone = new Set(targets.map((i) => i.id));
      // the page keeps its place: the ones that left from before it move it back
      const before = items.slice(0, start).filter((i) => gone.has(i.id)).length;
      setItems((all) => all.filter((i) => !gone.has(i.id)));
      setStart((s) => Math.max(0, s - before));
      setUndoable({ done, items: targets, categoryName: categories.find((c) => c.id === categoryId)?.name ?? "that category" });
    } catch (err) {
      setWriteError(`Could not approve these: ${err instanceof Error ? err.message : "YNAB did not answer."}`);
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    if (!undoable || !restore || saving) return;
    setSaving(true);
    setWriteError(null);
    try {
      await undoAlways(undoable.done, restore);
      const back = undoable.items;
      setItems((all) => [...all, ...back].sort(compareItems));
      setStart(0);
      setUndoable(null);
    } catch (err) {
      setWriteError(`Could not undo: ${err instanceof Error ? err.message : "YNAB did not answer."}`);
    } finally {
      setSaving(false);
    }
  }

  const picked = page.filter((i) => i.ticked && (i.categoryId !== null || !!i.fixedLabel));

  async function approvePage() {
    if (!approve || picked.length === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    try {
      await approve(picked.map((i) => ({ id: i.id, ...(i.fixedLabel || i.categoryId === null ? {} : { categoryId: i.categoryId }), ...(i.writeMemo ? { memo: i.writeMemo } : {}) })));
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
        <button type="button" aria-expanded={showRules} className={SECONDARY} onClick={() => setShowRules((v) => !v)}>
          Payee rules
        </button>
        {showRules && <PayeeRules />}
        {ruleError && (
          <p role="alert" className="text-base text-red-700 dark:text-red-400">
            {ruleError}
          </p>
        )}
        {undoable && (
          <p className="flex flex-wrap items-center gap-x-3 rounded-lg bg-gray-800 px-3 py-2 text-base text-white">
            Approved {undoable.items.length} from {undoable.done.payee} as {undoable.categoryName} ·
            <button type="button" disabled={saving || !restore} className="min-h-12 px-2 font-semibold underline disabled:opacity-50" onClick={() => void undo()}>
              Undo
            </button>
          </p>
        )}
        <ConfirmDialog
          open={pendingImage !== null}
          title="Replace the check image?"
          message="The image on this check is replaced by the new one. You can undo it on the card until you leave it."
          confirmLabel="Replace"
          cancelLabel="Keep"
          onConfirm={() => void replaceImage()}
          onCancel={() => setPendingImage(null)}
        />
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
            {groups.map((group, at) =>
              group.items[0]?.check !== undefined ? (
                <div key={group.key} className="space-y-3">
                  {groups[at - 1]?.items[0]?.check === undefined && (
                    <h2 className="pt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Checks</h2>
                  )}
                  <CheckCard
                    group={group}
                    categories={categories}
                    image={images?.get(group.items[0].id)}
                    note={checkNotes[group.items[0].id]}
                    onItemCategory={onItemCategory}
                    onTick={onTick}
                    onImage={(item, file) => void offerImage(item, file)}
                    canUndo={replaced[group.items[0].id] !== undefined}
                    onUndo={(item) => void undoImage(item)}
                  />
                </div>
              ) : (
                <GroupCard key={group.key} group={group} categories={categories} onGroupCategory={onGroupCategory} onItemCategory={onItemCategory} onTick={onTick} onTickAll={onTickAll} onAlways={approve ? (g, id) => void always(g, id) : null} busy={saving} />
              ),
            )}
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
