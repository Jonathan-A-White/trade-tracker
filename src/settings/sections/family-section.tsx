import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { link } from "pwa-kit/settings";
import { useAlive } from "pwa-kit/alive";
import { useLiveQuery } from "dexie-react-hooks";
import { useFactory } from "@/factory";
import { FamilyRepository } from "@/db/repositories/family-repository";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { ALERT_POLL_MS, makeAlertsClient } from "@/family/alerts-client";
import { setFamilyOn, useFamilyOn, useYnabOn } from "../connections";
import { SETTINGS_PATH } from "../registry";
import { OUTLINE_BUTTON_CLASS, ErrorNote, SectionCard, SectionNote } from "../parts";

const family = new FamilyRepository();
const ynab = new YnabRepository();
const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";
const SMALL_BUTTON_CLASS = `${OUTLINE_BUTTON_CLASS} shrink-0 !px-3 !py-1.5`;
const HEADING_CLASS = "text-sm font-medium text-gray-700 dark:text-gray-300";

/** The Gmail filter that forwards the bank's alerts to the family's address, in five short lines. */
const RECIPE = [
  "In Gmail, open Settings > See all settings > Filters and Blocked Addresses > Create a new filter.",
  "In From, put the addresses your Chase and Citi alerts come from, then choose Create filter.",
  "Tick Forward it to, choose Add forwarding address, and paste the address above.",
  "Gmail mails a confirmation code to that address: it shows here, under Gmail's confirmation. Type it into Gmail.",
  "Back in the filter, pick the address under Forward it to and save the filter.",
];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "That did not work.";
}

function shortKey(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex;
}

function Toggle({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Family alerts"
      disabled={busy}
      onClick={onClick}
      className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50"
      style={{ backgroundColor: on ? "#3b82f6" : "#d1d5db" }}
    >
      <span
        className="inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? "translateX(1.625rem)" : "translateX(0.25rem)" }}
      />
    </button>
  );
}

/** A value with its Copy button; the button says Copied for a moment after. */
function Copyable({ value, copyLabel, mono }: { value: string; copyLabel: string; mono?: boolean }) {
  const alive = useAlive();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      if (alive()) {
        setCopied(true);
        setFailed(false);
      }
    } catch {
      if (alive()) setFailed(true);
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <p className={`break-all text-sm text-gray-900 dark:text-gray-100 ${mono ? "font-mono slashed-zero text-lg tracking-widest" : ""}`}>{value}</p>
        <button type="button" aria-label={copyLabel} onClick={copy} className={SMALL_BUTTON_CLASS}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {failed && <SectionNote>Could not copy. Select it and copy it by hand.</SectionNote>}
    </div>
  );
}

function Cards() {
  const alive = useAlive();
  const ynabOn = useYnabOn();
  const cards = useLiveQuery(() => family.listCards(), []);
  const accounts = useLiveQuery(async () => (await ynab.listAccounts()).filter((a) => !a.closed), []);
  const [lastFour, setLastFour] = useState("");
  const [owner, setOwner] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const offered = ynabOn && accounts && accounts.length > 0 ? accounts : null;
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  async function handleAdd() {
    setError(null);
    try {
      await family.addCard({ lastFour, owner, accountId: accountId || undefined });
      if (alive()) {
        setLastFour("");
        setOwner("");
        setAccountId("");
      }
    } catch (err) {
      if (alive()) setError(messageOf(err));
    }
  }

  return (
    <div className="space-y-2">
      <h3 className={HEADING_CLASS}>My cards</h3>
      <SectionNote>A card's last four, whose it is{offered ? " and the YNAB account it goes with" : ""}, so an alert can be told apart.</SectionNote>
      {cards && cards.length > 0 && (
        <ul aria-label="Cards" className="space-y-2">
          {cards.map((card) => (
            <li key={card.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <div className="min-w-0 text-sm text-gray-900 dark:text-gray-100">
                <span className="font-mono slashed-zero text-gray-500 dark:text-gray-400">•••• {card.lastFour}</span>
                <span className="ml-2 font-medium">{card.owner}</span>
                {card.accountId && accountName.has(card.accountId) && (
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{accountName.get(card.accountId)}</span>
                )}
              </div>
              <button type="button" aria-label={`Remove card ${card.lastFour}`} onClick={() => family.removeCard(card.id)} className={SMALL_BUTTON_CLASS}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Last four</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={lastFour}
            onChange={(e) => setLastFour(e.target.value.replace(/\D/g, ""))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Whose card</span>
          <input autoComplete="off" placeholder="A name, or shared" value={owner} onChange={(e) => setOwner(e.target.value)} className={INPUT_CLASS} />
        </label>
      </div>
      {offered && (
        <label className="block space-y-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">YNAB account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={INPUT_CLASS}>
            <option value="">No account</option>
            {offered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" onClick={handleAdd} className={`w-full ${OUTLINE_BUTTON_CLASS}`}>
        Add card
      </button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

export function FamilySection() {
  const { door, getKey, backendUrl, publicKeyHex } = useFactory();
  const alive = useAlive();
  const on = useFamilyOn();
  const [address, setAddress] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const cursor = useRef(0);

  const licensed = door === "licensed";

  // While the row is open and the phone may ask: the address once, then the feed every few seconds for Gmail's confirmation.
  useEffect(() => {
    if (!on || !licensed) return;
    const key = getKey();
    if (!key) return;
    const client = makeAlertsClient(backendUrl, key);
    let current = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const page = await client.list(cursor.current);
        if (!current) return;
        cursor.current = page.next;
        const confirm = page.alerts.filter((a) => a.kind === "forward-confirm" && a.code).at(-1);
        if (confirm?.code) setCode(confirm.code);
        setError(null);
      } catch (err) {
        if (current) setError(messageOf(err));
      } finally {
        polling = false;
      }
    };
    client
      .address()
      .then((found) => {
        if (current) setAddress(found);
      })
      .catch((err) => {
        if (current) setError(messageOf(err));
      });
    void poll();
    const timer = setInterval(poll, ALERT_POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
      cursor.current = 0;
    };
  }, [on, licensed, backendUrl, getKey]);

  async function handleSwitch() {
    setError(null);
    setHint(null);
    if (on) {
      setAddress(null);
      setCode(null);
      await setFamilyOn(false);
      return;
    }
    const key = getKey();
    if (!licensed || !key) {
      setHint(
        door === "no-key"
          ? "Make the key"
          : door === "locked"
            ? "Unlock the key"
            : "Hold the licence",
      );
      return;
    }
    setBusy(true);
    try {
      // On only once the backend has given the family its address.
      const found = await makeAlertsClient(backendUrl, key).address();
      await setFamilyOn(true);
      if (alive()) setAddress(found);
    } catch (err) {
      if (alive()) setError(messageOf(err));
    } finally {
      if (alive()) setBusy(false);
    }
  }

  return (
    <SectionCard title="Family">
      <div className="flex items-center justify-between gap-3">
        <SectionNote>
          {on
            ? "The family's card alerts come to one address."
            : "Off until you turn it on. Share one mail address so the family's card alerts come here."}
        </SectionNote>
        <Toggle on={on} busy={busy} onClick={handleSwitch} />
      </div>

      {hint && (
        <SectionNote>
          {hint} under{" "}
          <Link to={link("factory", SETTINGS_PATH)} className="font-medium text-blue-600 dark:text-blue-400 underline">
            Factory
          </Link>{" "}
          first: the family's address is asked of the backend with the licence.
        </SectionNote>
      )}

      {on && (
        <>
          <div className="space-y-2">
            <h3 className={HEADING_CLASS}>Alert address</h3>
            {address ? (
              <Copyable value={address} copyLabel="Copy address" />
            ) : licensed ? (
              <SectionNote>Asking for the address…</SectionNote>
            ) : (
              <SectionNote>
                {door === "no-key" ? "Make the key" : door === "locked" ? "Unlock the key" : "Hold the licence"} under{" "}
                <Link to={link("factory", SETTINGS_PATH)} className="font-medium text-blue-600 dark:text-blue-400 underline">
                  Factory
                </Link>{" "}
                to see the address and Gmail's confirmation.
              </SectionNote>
            )}
            <ol aria-label="Gmail filter recipe" className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">
              {RECIPE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>

          {licensed && (
            <div className="space-y-2">
              <h3 className={HEADING_CLASS}>Gmail's confirmation</h3>
              {code ? <Copyable value={code} copyLabel="Copy code" mono /> : <SectionNote>Waiting for Gmail's confirmation</SectionNote>}
            </div>
          )}

          <Cards />

          <div className="space-y-2">
            <h3 className={HEADING_CLASS}>People</h3>
            <SectionNote>The keys on this licence.</SectionNote>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">This phone</span>
              <span className="font-mono slashed-zero text-xs text-gray-500 dark:text-gray-400">{publicKeyHex ? shortKey(publicKeyHex) : "no key yet"}</span>
            </div>
          </div>
        </>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </SectionCard>
  );
}
