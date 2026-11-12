import { useState } from "react";
import { Link } from "react-router";
import { link } from "pwa-kit/settings";
import { useAlive } from "pwa-kit/alive";
import { useLiveQuery } from "dexie-react-hooks";
import { useFactory } from "@/factory";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import { browserStorage } from "@/services/factory-service";
import { YnabRefusedError, createYnabClient } from "@/ynab/api";
import { connectBudget, refreshCache } from "@/ynab/cache";
import { readIdeaSettings, writeIdeaSettings } from "@/ynab/budget-ideas";
import { readShortRule, writeShortRule, type ShortRule } from "@/ynab/payee-rules";
import { disconnectYnab } from "@/ynab/disconnect";
import { openToken, sealToken } from "@/ynab/token";
import type { YnabBudgetSummary } from "@/ynab/types";
import { SettingRow } from "../setting-row";
import { setYnabOn, useYnabOn } from "../connections";
import { SETTINGS_PATH } from "../registry";
import { OUTLINE_BUTTON_CLASS, ErrorNote, SectionCard, SectionNote } from "../parts";

const repo = new YnabRepository();
const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "That did not work.";
}

export function YnabSection() {
  const { door, getKey } = useFactory();
  const alive = useAlive();
  const on = useYnabOn();
  // undefined while read, null with no connection
  const connection = useLiveQuery(async () => (await repo.getConnection()) ?? null, []);
  // The person turned the switch on and has not finished: nothing is On (or kept) until a budget is chosen.
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState("");
  const [budgets, setBudgets] = useState<YnabBudgetSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState(readIdeaSettings);
  // what is typed in the two fields, kept as typed so a field can be cleared and retyped; only a valid number is saved
  const [typed, setTyped] = useState(() => ({ spend: String(ideas.minSpend), charges: String(ideas.minCharges) }));

  const [shortRule, setShortRule] = useState<ShortRule>(readShortRule);

  const connected = on && !!connection;
  const switchedOn = connected || setup;
  const unlocked = door === "unlocked" || door === "licensed";

  function reset() {
    setSetup(false);
    setToken("");
    setBudgets(null);
  }

  async function handleSwitch() {
    setError(null);
    if (connected) {
      setBusy(true);
      try {
        await disconnectYnab(browserStorage());
      } catch (err) {
        if (alive()) setError(messageOf(err));
      } finally {
        if (alive()) setBusy(false);
      }
      return;
    }
    if (setup) reset();
    else setSetup(true);
  }

  async function handleCheck() {
    setBusy(true);
    setError(null);
    try {
      const list = await createYnabClient(token.trim()).budgets();
      if (!alive()) return;
      setBudgets(list);
      if (list.length === 0) setError("YNAB has no budget for this token.");
    } catch (err) {
      if (!alive()) return;
      if (err instanceof YnabRefusedError) reset();
      setError(messageOf(err));
    } finally {
      if (alive()) setBusy(false);
    }
  }

  async function handleChoose(budget: YnabBudgetSummary) {
    const key = getKey();
    if (!key) {
      setError("Unlock the key under Factory first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pat = token.trim();
      await connectBudget(createYnabClient(pat), budget);
      await sealToken(browserStorage(), key, pat);
      await setYnabOn(true);
      if (alive()) reset();
    } catch (err) {
      await repo.clearAll();
      if (!alive()) return;
      if (err instanceof YnabRefusedError) reset();
      setError(messageOf(err));
    } finally {
      if (alive()) setBusy(false);
    }
  }

  async function handleRefresh() {
    const key = getKey();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const pat = await openToken(browserStorage(), key);
      if (pat === null) throw new Error("The token could not be opened. Turn YNAB off and on again to enter it.");
      await refreshCache(createYnabClient(pat));
    } catch (err) {
      if (alive()) setError(messageOf(err));
    } finally {
      if (alive()) setBusy(false);
    }
  }

  return (
    <SectionCard title="YNAB">
      <div className="flex items-center justify-between gap-3">
        <SectionNote>
          {connected && connection
            ? `Connected as ${connection.budgetName}`
            : "Off until you turn it on. Connect your YNAB budget so this app can fit around it."}
        </SectionNote>
        <button
          type="button"
          role="switch"
          aria-checked={switchedOn}
          aria-label="Connect YNAB"
          disabled={busy}
          onClick={handleSwitch}
          className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: switchedOn ? "#3b82f6" : "#d1d5db" }}
        >
          <span
            className="inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform"
            style={{ transform: switchedOn ? "translateX(1.625rem)" : "translateX(0.25rem)" }}
          />
        </button>
      </div>

      {setup && budgets === null && (
        <>
          <SectionNote>
            Get a Personal Access Token at app.ynab.com &gt; Account Settings &gt; Developer Settings &gt; New Token, and paste it here.
            It is kept sealed under your key on this device, never in the clear.
          </SectionNote>
          {!unlocked && (
            <SectionNote>
              {door === "no-key" ? "Make the key" : "Unlock the key"} under{" "}
              <Link to={link("factory", SETTINGS_PATH)} className="font-medium text-blue-600 dark:text-blue-400 underline">
                Factory
              </Link>{" "}
              first: the token is kept sealed under it.
            </SectionNote>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Personal Access Token</span>
            <input
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            disabled={busy || !unlocked || token.trim() === ""}
            onClick={handleCheck}
            className={`w-full ${OUTLINE_BUTTON_CLASS} disabled:opacity-50`}
          >
            Check
          </button>
        </>
      )}

      {setup && budgets !== null && budgets.length > 0 && (
        <div className="space-y-2">
          <SectionNote>Choose the budget to connect.</SectionNote>
          <ul aria-label="Your budgets" className="space-y-2">
            {budgets.map((budget) => (
              <li key={budget.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleChoose(budget)}
                  className={`w-full text-left ${OUTLINE_BUTTON_CLASS} disabled:opacity-50`}
                >
                  {budget.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {connected && (
        <button type="button" disabled={busy || !unlocked} onClick={handleRefresh} className={`w-full ${OUTLINE_BUTTON_CLASS} disabled:opacity-50`}>
          Refresh
        </button>
      )}
      {connected && !unlocked && <SectionNote>Unlock the key under Factory to refresh.</SectionNote>}

      <SettingRow settingKey="ideas-spend">
        <label className="block space-y-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Budget ideas: dollars a year</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            value={typed.spend}
            onChange={(e) => {
              setTyped({ ...typed, spend: e.target.value });
              const minSpend = Number(e.target.value);
              if (!(minSpend > 0)) return;
              const next = { ...ideas, minSpend };
              setIdeas(next);
              writeIdeaSettings(next);
            }}
            className={INPUT_CLASS}
          />
        </label>
      </SettingRow>
      <SettingRow settingKey="ideas-charges">
        <label className="block space-y-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Budget ideas: charges</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={typed.charges}
            onChange={(e) => {
              setTyped({ ...typed, charges: e.target.value });
              const minCharges = Math.floor(Number(e.target.value));
              if (!(minCharges >= 1)) return;
              const next = { ...ideas, minCharges };
              setIdeas(next);
              writeIdeaSettings(next);
            }}
            className={INPUT_CLASS}
          />
        </label>
      </SettingRow>
      <SettingRow settingKey="rule-short">
        <label className="block space-y-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Auto-approve when the category is short</span>
          <select
            value={shortRule}
            onChange={(e) => {
              const next: ShortRule = e.target.value === "hold" ? "hold" : "approve";
              setShortRule(next);
              writeShortRule(next);
            }}
            className={INPUT_CLASS}
          >
            <option value="approve">Approve and note</option>
            <option value="hold">Leave it for me</option>
          </select>
        </label>
      </SettingRow>

      {error && <ErrorNote>{error}</ErrorNote>}
    </SectionCard>
  );
}
