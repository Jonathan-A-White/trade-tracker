import { useState } from "react";
import { useFactory } from "@/contexts/factory-context";
import type { FactoryLicence } from "@/contracts/types";

const LICENCE_TEXT: Record<FactoryLicence, string> = {
  checking: "Checking",
  held: "Held",
  none: "None",
  revoked: "Revoked",
  indexing: "On its way",
  unknown: "Could not check",
};

const buttonClass =
  "w-full rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 px-4 py-2.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50";
const inputClass =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";

export function FactorySettings() {
  const { door, publicKeyHex, licence, backendUrl, setBackendUrl, makeKey, unlockKey } =
    useFactory();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backendDraft, setBackendDraft] = useState(backendUrl);

  async function run(action: (passphrase: string) => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action(passphrase);
      setPassphrase("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!publicKeyHex) return;
    try {
      await navigator.clipboard.writeText(publicKeyHex);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the public key and copy it by hand.");
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Factory</h2>

      {door === "no-key" && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Make a key for this app. It is wrapped by your passphrase and kept on this device only.
        </p>
      )}
      {door === "locked" && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          A key is kept on this device. Unlock it with your passphrase.
        </p>
      )}
      {(door === "unlocked" || door === "licensed") && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Key unlocked for today.</p>
      )}

      {(door === "no-key" || door === "locked") && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400">
            Passphrase
            <input
              type="password"
              autoComplete={door === "no-key" ? "new-password" : "current-password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(door === "no-key" ? async (p) => setPhrase(await makeKey(p)) : unlockKey)}
            className={buttonClass}
          >
            {door === "no-key" ? "Make key" : "Unlock"}
          </button>
        </div>
      )}

      {phrase && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300 space-y-1">
          <p>Key made and kept on this device. Write down this recovery phrase; it is shown only now.</p>
          <p className="font-mono break-words">{phrase}</p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
          {error}
        </p>
      )}

      {publicKeyHex && (
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Public key</p>
            <p className="font-mono text-xs break-all text-gray-900 dark:text-gray-100">{publicKeyHex}</p>
          </div>
          <button type="button" onClick={handleCopy} className={buttonClass}>
            Copy
          </button>
          {copied && <p className="text-xs text-gray-500 dark:text-gray-400">Copied.</p>}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Licence</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {licence ? LICENCE_TEXT[licence] : ""}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            In the collection trade-tracker.
          </p>
        </div>
      )}

      <label className="block text-xs text-gray-500 dark:text-gray-400">
        Backend
        <input
          type="url"
          value={backendDraft}
          onChange={(e) => {
            setBackendDraft(e.target.value);
            setBackendUrl(e.target.value);
          }}
          className={`${inputClass} mt-1`}
        />
      </label>
    </div>
  );
}
