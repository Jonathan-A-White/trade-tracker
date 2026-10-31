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
import { useFamilyOn } from "@/settings/connections";
import { createYnabClient } from "@/ynab/api";
import { refreshCache } from "@/ynab/cache";
import { openToken } from "@/ynab/token";
import { createYnabWriter, type YnabWriter } from "@/ynab/writer";
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
  waitingCharges,
  type SortedRecord,
  type WaitingCharge,
} from "./waiting";

/** What the sheet needs of the YNAB writer. */
export type SortWriter = Pick<YnabWriter, "create">;

/** The parts a test replaces: each left out is the app's own. */
export interface SortSeams {
  /** the alerts client; null reads nothing */
  client?: AlertsClient | null;
  writer?: SortWriter | null;
  /** whose phone this is */
  me?: string | null;
  /** reads the category balances from YNAB into the cache */
  refreshBalances?: () => Promise<void>;
  /** asks the mill where a charge goes; null asks nothing (the app's own is the factory's, only on a licensed key) */
  suggest?: SortChargeAsk | null;
  /** how long the sheet waits for the suggestion */
  suggestTimeoutMs?: number;
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

export function SortProvider({ children, ...seams }: SortSeams & { children: ReactNode }) {
  const appWriter = useAppWriter(seams.writer === undefined);
  const { client, writer, me, refreshBalances, suggest, suggestTimeoutMs, pollMs, feedTiming, balanceTiming } = seams;
  const value = useMemo<SortSeams>(
    () => ({ client, writer: writer === undefined ? appWriter : writer, me, refreshBalances, suggest, suggestTimeoutMs, pollMs, feedTiming, balanceTiming }),
    [client, writer, appWriter, me, refreshBalances, suggest, suggestTimeoutMs, pollMs, feedTiming, balanceTiming],
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
  balanceTiming?: LaunchTiming;
  /** asks the mill where a charge goes; null when the AI is not allowed (no licensed key), and then nothing is asked */
  suggest: SortChargeAsk | null;
  suggestTimeoutMs: number;
  /** keeps that this phone sorted the charge; `claimed` false claims it for every phone now (or later, when unreached) */
  sortedHere: (charge: WaitingCharge, claimed: boolean) => void;
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
        if (alert.kind !== "charge" || amount === null || mine.has(alert.id) || now - at > SWEEP_MS) return [];
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
  const sorted = useMemo(() => (on ? sortedToday(records) : []), [on, records]);

  const appRefresh = useCallback(async () => {
    const key = getKey();
    if (!key) throw new Error("Unlock the key to read the balances from YNAB.");
    const token = await openToken(browserStorage(), key);
    if (!token) throw new Error("The YNAB token could not be opened. Turn YNAB off and on again under Settings.");
    await refreshCache(createYnabClient(token));
  }, [getKey]);

  const { claim, forget } = feed;
  const sortedHere = useCallback(
    (charge: WaitingCharge, claimed: boolean) => {
      recordSorted([{ id: charge.alert.id, amount: charge.amount, merchant: charge.merchant, by: meRef.current.me ?? "This phone", at: Date.now() }]);
      if (claimed) forget(charge.alert.id);
      else void claim(charge.alert.id);
    },
    [claim, forget],
  );

  // the suggestion is the AI: asked only on a licensed key, the key read when it asks
  const appSuggest = useMemo<SortChargeAsk | null>(
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

  const blocked = !on || client ? null : !unlocked ? (door === "no-key" ? "Make the key" : "Unlock the key") : "Hold the licence";

  return {
    on,
    blocked,
    feed,
    waiting,
    sorted,
    me,
    other,
    people: people(owners),
    book,
    writer: seams.writer ?? null,
    refreshBalances: seams.refreshBalances ?? appRefresh,
    balanceTiming: seams.balanceTiming,
    suggest: seams.suggest !== undefined ? seams.suggest : appSuggest,
    suggestTimeoutMs: seams.suggestTimeoutMs ?? SUGGEST_DEADLINE_MS,
    sortedHere,
  };
}
