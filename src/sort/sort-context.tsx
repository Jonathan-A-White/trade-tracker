// What Home's Waiting and the Sort sheet share: the family's feed, whose phone this is, the card book, and the app's one YNAB
// writer. The provider makes the writer and starts it; a test gives fakes for the parts that would reach the network.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { LaunchTiming } from "pwa-kit/launch-gate";
import { useFactory } from "@/factory";
import { useLicenceNow } from "@/factory/ai-allowed";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { makeAlertsClient, type AlertsClient, type FamilyAlert } from "@/family/alerts-client";
import { cardBook, type CardBook } from "@/family/cards";
import { browserStorage } from "@/services/factory-service";
import { useFamilyOn, useYnabOn } from "@/settings/connections";
import { createYnabClient, type YnabClient } from "@/ynab/api";
import { refreshCache } from "@/ynab/cache";
import { PayeeRuleRepository, approveByRules } from "@/ynab/payee-rules";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { refreshTally as readYnabTally } from "@/ynab/tally";
import { openToken } from "@/ynab/token";
import { CHECK_READ_DEADLINE_MS, makeCheckReadAsk, type CheckReader } from "@/ynab/check-read";
import { IDEA_REPLY_DEADLINE_MS, makeIdeaReplyAsk, type IdeaReplyAsk } from "@/ynab/budget-idea-reply";
import { createYnabWriter, type YnabWriter } from "@/ynab/writer";
import { makeReceiptClient } from "@/services/lookup-client";
import { reconcileReceipt } from "@/services/receipt-reconcile";
import { RECEIPT_DEADLINE_MS, type ReceiptReader } from "./receipt-read";
import { SUGGEST_DEADLINE_MS, makeSortChargeAsk, type SortChargeAsk } from "./suggest";
import { useAlerts, type AlertsFeed } from "./useAlerts";
import {
  HANDED_KEY,
  ME_KEY,
  SORTED_KEY,
  SORT_CHANGED,
  otherPerson,
  parseAmount,
  people,
  readHanded,
  readMe,
  readSorted,
  recordSorted,
  sortedToday,
  isTemporaryHold,
  temporaryHolds,
  waitingCharges,
  type SortedRecord,
  type WaitingCharge,
} from "./waiting";

/** What the sheet needs of the YNAB writer (and Clean up, `approve`, when the writer has it). */
export type SortWriter = Pick<YnabWriter, "create"> & Partial<Pick<YnabWriter, "approve" | "restore">>;

/** The parts a test replaces: each left out is the app's own. */
export interface SortSeams {
  /** the alerts client; null reads nothing */
  client?: AlertsClient | null;
  writer?: SortWriter | null;
  /** whose phone this is */
  me?: string | null;
  /** reads the category balances from YNAB into the cache */
  refreshBalances?: () => Promise<void>;
  /** reads YNAB's tally of payees by category, when the one kept is old */
  refreshTally?: () => Promise<void>;
  /** whether the app approves the payee rules' transactions when it opens (default true); a test of Clean up alone turns it off */
  approveOnOpen?: boolean;
  /** the YNAB client Clean up reads with; the app's own opens the sealed token with the unlocked key */
  ynabClient?: () => Promise<YnabClient>;
  /** asks the mill where a charge goes; null asks nothing (the app's own is the factory's, only on a licensed key) */
  suggest?: SortChargeAsk | null;
  /** how long the sheet waits for the suggestion */
  suggestTimeoutMs?: number;
  /** reads a photographed receipt; null reads nothing (the app's own is the factory's, only on a licensed key) */
  readReceipt?: ReceiptReader | null;
  /** reads a check image for its payee and memo (Clean up); null reads nothing (the app's own is the factory's, only on a licensed key) */
  readCheck?: CheckReader | null;
  /** how long Clean up waits for a check image to be read */
  checkTimeoutMs?: number;
  /** asks the mill about his reply to a Budget idea; null asks nothing (the app's own is the factory's, only on a licensed key) */
  replyIdea?: IdeaReplyAsk | null;
  /** how long a Budget idea waits for the answer to his reply */
  replyTimeoutMs?: number;
  /** how long the sheet waits for the receipt to be read, and again for its lines to be grouped */
  receiptTimeoutMs?: number;
  pollMs?: number;
  feedTiming?: LaunchTiming;
  balanceTiming?: LaunchTiming;
}

const SortContext = createContext<SortSeams>({});

const family = new FamilyRepository();
/** An alert older than this that leaves the feed was dropped by the backend's 30-day sweep, not sorted. */
const SWEEP_MS = 25 * 24 * 60 * 60_000;

/** The app's one YNAB writer, started while the app runs, so a queued write is sent whatever screen is open. */
function useAppWriter(enabled: boolean): SortWriter | null {
  // getKey is the same function for the session's life
  const { getKey } = useFactory();
  const writer = useMemo<YnabWriter | null>(
    () =>
      enabled
        ? createYnabWriter({
            getClient: async () => {
              const key = getKey();
              if (!key) return null;
              const token = await openToken(browserStorage(), key);
              return token ? createYnabClient(token) : null;
            },
          })
        : null,
    [enabled, getKey],
  );
  useEffect(() => writer?.start(), [writer]);
  return writer;
}

/**
 * When the app opens (and YNAB is On, the key unlocked, a rule standing), the payee rules approve their payees' new transactions, whatever
 * screen is open. Silent when it fails: Clean up says so, and the next load tries again.
 */
function useApproveByRules(writer: SortWriter | null, enabled: boolean, seamClient: SortSeams["ynabClient"]) {
  const on = useYnabOn();
  const { door } = useFactory();
  const clientFor = useYnabClientFor();
  const rules = useLiveQuery(() => new PayeeRuleRepository().list(), []);
  const approve = writer?.approve;
  const unlocked = door === "licensed" || door === "unlocked";
  const standing = (rules?.length ?? 0) > 0;
  useEffect(() => {
    if (!enabled || !on || !approve || !standing || (!seamClient && !unlocked)) return;
    let cancelled = false;
    void (async () => {
      try {
        const connection = await new YnabRepository().getConnection();
        if (!connection || cancelled) return;
        const client = await (seamClient ? seamClient() : clientFor("the transactions"));
        if (!cancelled) await approveByRules(client, connection.budgetId, approve);
      } catch {
        // the next load tries again
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, on, approve, standing, seamClient, unlocked, clientFor]);
}

export function SortProvider({ children, ...seams }: SortSeams & { children: ReactNode }) {
  const appWriter = useAppWriter(seams.writer === undefined);
  useApproveByRules(seams.writer === undefined ? appWriter : seams.writer, seams.approveOnOpen !== false, seams.ynabClient);
  const { client, writer, me, approveOnOpen, refreshBalances, refreshTally, ynabClient, suggest, suggestTimeoutMs, readReceipt, readCheck, checkTimeoutMs, replyIdea, replyTimeoutMs, receiptTimeoutMs, pollMs, feedTiming, balanceTiming } = seams;
  const value = useMemo<SortSeams>(
    () => ({ client, writer: writer === undefined ? appWriter : writer, me, approveOnOpen, refreshBalances, refreshTally, ynabClient, suggest, suggestTimeoutMs, readReceipt, readCheck, checkTimeoutMs, replyIdea, replyTimeoutMs, receiptTimeoutMs, pollMs, feedTiming, balanceTiming }),
    [client, writer, appWriter, me, approveOnOpen, refreshBalances, refreshTally, ynabClient, suggest, suggestTimeoutMs, readReceipt, readCheck, checkTimeoutMs, replyIdea, replyTimeoutMs, receiptTimeoutMs, pollMs, feedTiming, balanceTiming],
  );
  return <SortContext.Provider value={value}>{children}</SortContext.Provider>;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || [ME_KEY, HANDED_KEY, SORTED_KEY].includes(event.key)) onChange();
  };
  window.addEventListener(SORT_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SORT_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** A string that changes whenever what this phone keeps of sorting changes. */
const snapshot = () => [ME_KEY, HANDED_KEY, SORTED_KEY].map((key) => localStorage.getItem(key) ?? "").join("\u0000");

export interface FamilyFeed {
  /** Family is On on this phone */
  on: boolean;
  /** why the feed cannot be read now ('Unlock the key', 'Hold the licence'); null when it can */
  blocked: string | null;
  feed: AlertsFeed;
  /** the charges waiting, this phone's person's first */
  waiting: WaitingCharge[];
  /** the temporary authorizations of the last two days (a card check, a pre-auth): nothing to sort, drawn as a quiet line */
  holds: FamilyAlert[];
  /** today's sorted charges, newest first */
  sorted: SortedRecord[];
  me: string | null;
  /** the other person of a family of two; null when the cards do not say */
  other: string | null;
  /** the people the cards name */
  people: string[];
  book: CardBook;
  writer: SortWriter | null;
  refreshBalances: () => Promise<void>;
  /** reads YNAB's tally of payees by category into the phone when the one kept is old (src/ynab/tally.ts) */
  refreshTally: () => Promise<void>;
  balanceTiming?: LaunchTiming;
  /** asks the mill where a charge goes; null when the AI is not allowed (no licensed key), and then nothing is asked */
  suggest: SortChargeAsk | null;
  suggestTimeoutMs: number;
  /** reads a photographed receipt; null when the AI is not allowed, and then the sheet offers no photo */
  readReceipt: ReceiptReader | null;
  receiptTimeoutMs: number;
  /** keeps that this phone sorted the charge; `claimed` false claims it for every phone now (or later, when unreached) */
  sortedHere: (charge: WaitingCharge, claimed: boolean) => void;
}

/** The app's YNAB client for a read: the token opened with the unlocked key, or the sentence that says why not. */
function useYnabClientFor(): (what: string) => Promise<YnabClient> {
  const { getKey } = useFactory();
  return useCallback(
    async (what: string) => {
      const key = getKey();
      if (!key) throw new Error(`Unlock the key to read ${what} from YNAB.`);
      const token = await openToken(browserStorage(), key);
      if (!token) throw new Error("The YNAB token could not be opened. Turn YNAB off and on again under Settings.");
      return createYnabClient(token);
    },
    [getKey],
  );
}

/** The suggestion is the AI: asked only on a licensed key, the key read when it asks. */
function useAppSuggest(): SortChargeAsk | null {
  const { door, getKey, backendUrl } = useFactory();
  const licenceNow = useLicenceNow();
  const licensed = door === "licensed";
  return useMemo<SortChargeAsk | null>(
    () =>
      licensed
        ? async (request, signal) => {
            const key = getKey();
            if (!key) throw new Error("The factory is locked.");
            return makeSortChargeAsk(backendUrl, key, licenceNow)(request, signal);
          }
        : null,
    [licensed, getKey, backendUrl, licenceNow],
  );
}

/** The check read is the AI too: asked only on a licensed key, the key read when it asks. */
function useAppReadCheck(): CheckReader | null {
  const { door, getKey, backendUrl } = useFactory();
  const licenceNow = useLicenceNow();
  const licensed = door === "licensed";
  return useMemo<CheckReader | null>(
    () =>
      licensed
        ? async (request, photo, signal) => {
            const key = getKey();
            if (!key) throw new Error("The factory is locked.");
            return makeCheckReadAsk(backendUrl, key, licenceNow)(request, photo, signal);
          }
        : null,
    [licensed, getKey, backendUrl, licenceNow],
  );
}

/** The reply to a Budget idea is the AI too: asked only on a licensed key, the key read when it asks. */
function useAppReplyIdea(): IdeaReplyAsk | null {
  const { door, getKey, backendUrl } = useFactory();
  const licenceNow = useLicenceNow();
  const licensed = door === "licensed";
  return useMemo<IdeaReplyAsk | null>(
    () =>
      licensed
        ? async (request, signal) => {
            const key = getKey();
            if (!key) throw new Error("The factory is locked.");
            return makeIdeaReplyAsk(backendUrl, key, licenceNow)(request, signal);
          }
        : null,
    [licensed, getKey, backendUrl, licenceNow],
  );
}

/** What the Clean up screen reads and writes with. */
export interface CleanupDeps {
  /** opens a YNAB client for a read */
  getClient: () => Promise<YnabClient>;
  /** approves transactions; null when the writer is not there */
  approve: YnabWriter["approve"] | null;
  /** puts approved transactions back as they were (Undo); null when the writer is not there */
  restore: YnabWriter["restore"] | null;
  /** asks the mill where a payee's charge goes; null when the AI is not allowed */
  suggest: SortChargeAsk | null;
  suggestTimeoutMs: number;
  /** reads a check image for its payee and memo; null when the AI is not allowed, and then the image is only kept */
  readCheck: CheckReader | null;
  checkTimeoutMs: number;
  /** asks the mill about his reply to a Budget idea; null when the AI is not allowed */
  replyIdea: IdeaReplyAsk | null;
  replyTimeoutMs: number;
}

export function useCleanupDeps(): CleanupDeps {
  const seams = useContext(SortContext);
  const clientFor = useYnabClientFor();
  const appSuggest = useAppSuggest();
  const appReadCheck = useAppReadCheck();
  const appReplyIdea = useAppReplyIdea();
  const { approve, restore } = seams.writer ?? {};
  const seamClient = seams.ynabClient;
  const getClient = useCallback(() => (seamClient ? seamClient() : clientFor("the transactions")), [seamClient, clientFor]);
  return {
    getClient,
    approve: approve ?? null,
    restore: restore ?? null,
    suggest: seams.suggest !== undefined ? seams.suggest : appSuggest,
    suggestTimeoutMs: seams.suggestTimeoutMs ?? SUGGEST_DEADLINE_MS,
    readCheck: seams.readCheck !== undefined ? seams.readCheck : appReadCheck,
    checkTimeoutMs: seams.checkTimeoutMs ?? CHECK_READ_DEADLINE_MS,
    replyIdea: seams.replyIdea !== undefined ? seams.replyIdea : appReplyIdea,
    replyTimeoutMs: seams.replyTimeoutMs ?? IDEA_REPLY_DEADLINE_MS,
  };
}

/** The family's feed as Home and the sheet read it. */
export function useFamilyFeed(): FamilyFeed {
  const seams = useContext(SortContext);
  const { door, getKey, backendUrl } = useFactory();
  const licenceNow = useLicenceNow();
  const on = useFamilyOn();
  const licensed = door === "licensed";
  const unlocked = door === "licensed" || door === "unlocked";

  // the app's client: Family On, the key unlocked and the licence held
  const appClient = useMemo(() => {
    if (seams.client !== undefined || !on || !licensed) return null;
    const key = getKey();
    return key ? makeAlertsClient(backendUrl, key) : null;
  }, [seams.client, on, licensed, getKey, backendUrl]);
  const client = on ? (seams.client !== undefined ? seams.client : appClient) : null;

  const kept = useSyncExternalStore(subscribe, snapshot, () => "");
  const cards = useLiveQuery(() => family.listCards(), []);
  const book = useMemo(() => cardBook(cards ?? []), [cards]);
  const owners = useMemo(() => (cards ?? []).map((c) => c.owner), [cards]);
  // `kept` is read so these follow every change of what the phone keeps
  const me = useMemo(() => {
    void kept;
    return seams.me !== undefined ? seams.me : readMe();
  }, [kept, seams.me]);
  const handed = useMemo(() => {
    void kept;
    return readHanded();
  }, [kept]);
  const records = useMemo(() => {
    void kept;
    return readSorted();
  }, [kept]);
  const other = otherPerson(owners, me);

  const meRef = useRef({ book, me, other });
  useEffect(() => {
    meRef.current = { book, me, other };
  });
  // a charge gone from the feed that this phone did not sort was claimed by another phone
  const onGone = useCallback((gone: FamilyAlert[]) => {
    const now = Date.now();
    const mine = new Set(readSorted().map((r) => r.id));
    const by = meRef.current.other ?? "Another phone";
    recordSorted(
      gone.flatMap((alert) => {
        const amount = parseAmount(alert.amount);
        const at = alert.when ? Date.parse(alert.when) : now;
        if (alert.kind !== "charge" || isTemporaryHold(alert) || amount === null || mine.has(alert.id) || now - at > SWEEP_MS) return [];
        return [{ id: alert.id, amount, merchant: alert.merchant ?? "A charge", by, at: now }];
      }),
    );
  }, []);

  const feed = useAlerts(client, { pollMs: seams.pollMs, timing: seams.feedTiming, onGone });
  const sortedIds = useMemo(() => new Set(records.map((r) => r.id)), [records]);
  const waiting = useMemo(
    () => (on ? waitingCharges(feed.alerts ?? [], book, me, handed, sortedIds) : []),
    [on, feed.alerts, book, me, handed, sortedIds],
  );
  const holds = useMemo(() => (on ? temporaryHolds(feed.alerts ?? []) : []), [on, feed.alerts]);
  const sorted = useMemo(() => (on ? sortedToday(records) : []), [on, records]);

  const ynabClient = useYnabClientFor();
  const appRefresh = useCallback(async () => refreshCache(await ynabClient("the balances")), [ynabClient]);
  const appRefreshTally = useCallback(async () => readYnabTally(await ynabClient("the history")), [ynabClient]);

  const { claim, forget } = feed;
  const sortedHere = useCallback(
    (charge: WaitingCharge, claimed: boolean) => {
      recordSorted([{ id: charge.alert.id, amount: charge.amount, merchant: charge.merchant, by: meRef.current.me ?? "This phone", at: Date.now() }]);
      if (claimed) forget(charge.alert.id);
      else void claim(charge.alert.id);
    },
    [claim, forget],
  );

  const appSuggest = useAppSuggest();

  // the receipt is read by the receipt grind, over the same key and licence
  const appReadReceipt = useMemo<ReceiptReader | null>(
    () =>
      licensed
        ? async (merchant, photos, signal) => {
            const key = getKey();
            if (!key) return { ok: false, error: "The factory is locked." };
            const client = makeReceiptClient(backendUrl, key, licenceNow);
            const sent = await Promise.all(photos.map(async (blob) => ({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type })));
            return reconcileReceipt(client, { store: merchant, lines: [] }, sent, { signal });
          }
        : null,
    [licensed, getKey, backendUrl, licenceNow],
  );

  const blocked = !on || client ? null : !unlocked ? (door === "no-key" ? "Make the key" : "Unlock the key") : "Hold the licence";

  return {
    on,
    blocked,
    feed,
    waiting,
    holds,
    sorted,
    me,
    other,
    people: people(owners),
    book,
    writer: seams.writer ?? null,
    refreshBalances: seams.refreshBalances ?? appRefresh,
    refreshTally: seams.refreshTally ?? appRefreshTally,
    balanceTiming: seams.balanceTiming,
    suggest: seams.suggest !== undefined ? seams.suggest : appSuggest,
    suggestTimeoutMs: seams.suggestTimeoutMs ?? SUGGEST_DEADLINE_MS,
    readReceipt: seams.readReceipt !== undefined ? seams.readReceipt : appReadReceipt,
    receiptTimeoutMs: seams.receiptTimeoutMs ?? RECEIPT_DEADLINE_MS,
    sortedHere,
  };
}
