import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAlive } from "pwa-kit/alive";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { db } from "@/db/database";
import { storedPublicKeyHex } from "@/services/factory-service";
import { SuccessNote } from "@/settings/parts";
import { NotAPackError, checkRestorable, restoreFromPack } from "./unpack";
import { reloadPage } from "./reload";
import { clearUnpacked, peekUnpacked, rememberUnpacked, unpackedLine } from "./unpacked-notice";

/** Whether this phone holds anything an Unpack would replace: a key, or a row in any table. */
async function holdsSomething(): Promise<boolean> {
  if (storedPublicKeyHex() !== null) return true;
  for (const table of db.tables) if ((await table.count()) > 0) return true;
  return false;
}

/** The file's text: Blob.text where the browser has it, a FileReader where it does not. */
function readText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function parse(file: File): Promise<unknown> {
  try {
    return JSON.parse(await readText(file)) as unknown;
  } catch {
    throw new NotAPackError("This file is not a Trade Tracker pack.");
  }
}

/**
 * The file picker of Unpack, and what follows it: the file is read and checked (a refusal is a plain sentence under the trigger), a phone
 * that holds something is asked before it is replaced, then the pack is restored and the app reloads itself. `trigger` draws the one
 * button that opens the picker, so Home and Settings > Move each word it their own way.
 */
export function UnpackFile({ trigger }: { trigger: (open: () => void, busy: boolean) => ReactNode }) {
  const alive = useAlive();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<unknown>(null);

  async function restore(file: unknown) {
    setBusy(true);
    try {
      rememberUnpacked(await restoreFromPack(file));
      reloadPage();
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : "This file could not be unpacked.");
    } finally {
      if (alive()) setBusy(false);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const pack = checkRestorable(await parse(file));
      if (await holdsSomething()) {
        if (alive()) setAsking(pack);
      } else {
        await restore(pack);
      }
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : "This file could not be read.");
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json"
        hidden
        aria-label="Pack file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void choose(file);
        }}
      />
      {trigger(() => input.current?.click(), busy)}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={asking !== null}
        title="Replace everything on this phone?"
        message="The file's stores, items, trips, prices, photos and key replace what this phone holds now. This cannot be undone."
        confirmLabel="Unpack"
        variant="danger"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const pack = asking;
          setAsking(null);
          void restore(pack);
        }}
      />
    </>
  );
}

/** What the last Unpack brought, shown once (it is forgotten as it is drawn) after the app reloaded itself, with what is left to do at this address. */
export function UnpackedNote() {
  const [counts] = useState(peekUnpacked);
  useEffect(() => clearUnpacked(), []);
  if (!counts) return null;
  return (
    <SuccessNote>
      {unpackedLine(counts)} The key, licence and YNAB came with them. Unlock the key with your 12 words under Settings &gt; Factory, then set
      up the fingerprint and Notify me again here.
    </SuccessNote>
  );
}
