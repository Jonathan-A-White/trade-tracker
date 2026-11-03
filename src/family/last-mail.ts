// What this device remembers of the family's mail: the time of the latest card or order alert it ever saw in the feed. A sorted alert is
// claimed (deleted) from the feed, so the feed alone cannot say "mail did come" once every alert is sorted. Device-only: localStorage.
const KEY = "tradetracker.family-last-mail";

/** The latest card or order alert seen. `when` is its time as the receiver parsed it, if it had one. */
export interface LastMail {
  when?: string;
}

/** The remembered last mail, or null when this device has seen none (or the record cannot be read). */
export function readLastMail(): LastMail | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const when = (parsed as { when?: unknown }).when;
    return typeof when === "string" ? { when } : {};
  } catch {
    return null;
  }
}

/** Remembers `seen` unless it is older than what is kept (an alert with no readable time counts as the newest seen). Returns what is kept. */
export function rememberLastMail(seen: LastMail): LastMail {
  const kept = readLastMail();
  const seenAt = seen.when ? new Date(seen.when).getTime() : NaN;
  const keptAt = kept?.when ? new Date(kept.when).getTime() : NaN;
  if (kept && !Number.isNaN(seenAt) && !Number.isNaN(keptAt) && seenAt < keptAt) return kept;
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // storage full or refused: the line still shows for this visit
  }
  return seen;
}

/** Forgets the remembered last mail (Clear All Data: it is data about the family's mail, not a setting). */
export function forgetLastMail(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage refused: nothing more to do
  }
}
