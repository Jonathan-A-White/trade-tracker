// Home's Waiting: the family's charges waiting to be sorted (this phone's person's first, then the other's), each opening
// the Sort sheet, and Sorted today with who sorted each. Nothing is drawn while Family is Off.
import { Link } from "react-router";
import { useNotify } from "@/push/notify";
import { ANYONE } from "@/family/cards";
import type { FamilyFeed } from "./sort-context";
import { money, whenLine, writeMe, type WaitingCharge } from "./waiting";

const ROW = "flex min-h-12 w-full flex-col justify-center rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2";
const SMALL_BUTTON = "min-h-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm font-medium text-gray-800 dark:text-gray-100";

function ChargeRow({ charge, other }: { charge: WaitingCharge; other: string | null }) {
  const { alert } = charge;
  const facts = [
    alert.last4 ? `•••• ${alert.last4}` : null,
    charge.owner === ANYONE ? null : charge.owner,
    whenLine(alert.when),
  ].filter(Boolean);
  return (
    <li>
      <Link to={`/sort/${alert.id}`} className={ROW}>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{money(charge.amount)}</span>{" "}
          <span className="min-w-0 flex-1 break-words text-base text-gray-900 dark:text-gray-100">{charge.merchant}</span>
        </span>{" "}
        <span className="text-sm text-gray-600 dark:text-gray-400">{facts.join(" · ")}</span>
        {charge.handed && (
          <>
            {" "}
            <span className="text-sm text-amber-700 dark:text-amber-400">{other ? `Handed to ${other}` : "Handed to the other phone"}</span>
          </>
        )}
      </Link>
    </li>
  );
}

function FeedLine({ family }: { family: FamilyFeed }) {
  const { phase, error, refresh, alerts } = family.feed;
  if (family.blocked) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {family.blocked} under{" "}
        <Link to="/settings" className="font-medium text-blue-700 dark:text-blue-400 underline">
          Settings
        </Link>{" "}
        to read the family's charges.
      </p>
    );
  }
  const reading = phase === "opening" || phase === "slow" || phase === "retryable";
  if (phase !== "failed" && !(reading && alerts === null)) return null;
  const line =
    phase === "failed"
      ? `${error ?? "The family's charges could not be read."}${alerts ? " This is the list from before." : ""}`
      : phase === "opening"
        ? "Reading the family's charges…"
        : "Still waiting for the backend…";
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2">
      <p className={`text-sm ${phase === "failed" ? "text-red-700 dark:text-red-400" : "text-gray-600 dark:text-gray-400"}`}>{line}</p>
      {(phase === "failed" || phase === "retryable") && (
        <button type="button" onClick={refresh} className={SMALL_BUTTON}>
          Try again
        </button>
      )}
    </div>
  );
}

function NotifyLine() {
  const notify = useNotify(true);
  if (!notify.status || notify.status.state === "on" || notify.status.state === "unsupported") return null;
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-3">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {notify.status.state === "denied" ? notify.status.line : "Get a ping on this phone when a charge comes."}
      </p>
      {notify.status.state === "off" && (
        <button type="button" disabled={notify.busy} onClick={() => void notify.turnOn()} className={SMALL_BUTTON}>
          Notify me
        </button>
      )}
      {notify.error && <p className="text-sm text-red-700 dark:text-red-400">{notify.error}</p>}
    </div>
  );
}

export function WaitingCard({ family }: { family: FamilyFeed }) {
  if (!family.on) return null;
  const mine = family.waiting.filter((c) => c.mine);
  const others = family.waiting.filter((c) => !c.mine);
  const othersLabel = family.other ? `${family.other}'s` : "Someone else's";

  return (
    <section aria-label="Charges to sort" className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Waiting · {family.waiting.length}</h2>
        <FeedLine family={family} />
        {family.me === null && family.people.length >= 2 && (
          <div className="space-y-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 p-3">
            <p className="text-sm text-gray-800 dark:text-gray-200">Whose phone is this? Their charges come first.</p>
            <div className="flex flex-wrap gap-2">
              {family.people.map((name) => (
                <button key={name} type="button" onClick={() => writeMe(name)} className={SMALL_BUTTON}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}
        {mine.length > 0 && (
          <ul aria-label="Yours" className="space-y-2">
            {mine.map((charge) => (
              <ChargeRow key={charge.alert.id} charge={charge} other={family.other} />
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <>
            <h3 className="pt-1 text-sm font-medium text-gray-600 dark:text-gray-400">{othersLabel}</h3>
            <ul aria-label={othersLabel} className="space-y-2">
              {others.map((charge) => (
                <ChargeRow key={charge.alert.id} charge={charge} other={family.other} />
              ))}
            </ul>
          </>
        )}
        {family.waiting.length === 0 && family.feed.alerts !== null && <p className="text-sm text-gray-600 dark:text-gray-400">Nothing waiting.</p>}
        <NotifyLine />
      </div>

      {family.sorted.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Sorted today · {family.sorted.length}</h2>
          <ul aria-label="Sorted today" className="space-y-1">
            {family.sorted.map((record) => (
              <li key={record.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-sm text-gray-700 dark:text-gray-300">
                <span>
                  {money(record.amount)} {record.merchant}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{record.by}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {family.me !== null && family.people.length >= 2 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          This is {family.me}'s phone.{" "}
          <button type="button" onClick={() => writeMe(null)} className="min-h-12 px-1 font-medium text-blue-700 dark:text-blue-400 underline">
            Change
          </button>
        </p>
      )}
    </section>
  );
}
