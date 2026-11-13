// A Reply on a Budget idea (mw-6ww.148.32): his words about an idea go to the budget-idea-reply grind (grinds/budget-idea-reply.json),
// whose answer revises the idea, retires it, or explains it. His reason is kept (REASONS_KEY) until he removes it in Settings, is given
// to the grind with the next reply, and the payees it rules out are left out of later ideas (proposeIdeas' ruledOut). PROVISIONAL, the
// Governor to confirm: a reason is kept for good until he removes it.
import { MAX_PAYLOAD_BYTES, openMill, sealedRecordBytes } from "@/factory/mill";
import type { MillLicence } from "@/factory/mill";
import { dueDateFor, isRecord, readJson, writeJson, type BudgetIdea } from "./budget-ideas";
import { day } from "./tally";

/** The grind the reply runs: grinds/budget-idea-reply.json, version 1.0 of its input and answer. */
export const IDEA_REPLY_KIND = "budget-idea-reply";
export const IDEA_REPLY_VERSION = "1.0";
/** The longest the card waits for the mill; after it the card stays as it was and says to try again. */
export const IDEA_REPLY_DEADLINE_MS = 90_000;
const POLL_MS = 2_000;
/** The most charges and reasons one reply carries. */
export const CHARGES_SENT = 40;
export const REASONS_SENT = 20;
/** The most reasons kept; the oldest go first. */
export const REASONS_KEPT = 50;
const SAY_MAX = 240;
const WORDS_MAX = 1000;

/** What the grind is asked (schemas/budget-idea-reply-input-1.0.schema.json). */
export interface IdeaReplyRequest {
  idea: {
    name: string;
    cadence: "monthly" | "yearly";
    amount: number;
    dueDate?: string;
    total: number;
    payees: string[];
    charges: { date: string; payee: string; amount: number }[];
  };
  words: string;
  reasons: { words: string; payees?: string[] }[];
  categories: { name: string }[];
}

/** What the grind answers (schemas/budget-idea-reply-answer-1.0.schema.json). */
export interface IdeaReplyAnswer {
  outcome: "revise" | "retire" | "explain";
  say: string;
  name?: string;
  amount?: number;
  cadence?: "monthly" | "yearly";
  dueDate?: string;
  rulesOut?: string[];
  remember?: string;
}

/** Asks the mill about one reply; rejects with a plain sentence when it cannot. */
export type IdeaReplyAsk = (request: IdeaReplyRequest, signal?: AbortSignal) => Promise<IdeaReplyAnswer>;

/** The reply over the factory: a budget-idea-reply grist, its answer waited for. `licence` is read at each call. */
export function makeIdeaReplyAsk(backendUrl: string, key: Uint8Array, licence: () => MillLicence): IdeaReplyAsk {
  const mill = openMill(backendUrl, key, licence);
  return async (request, signal) => {
    if (sealedRecordBytes(key, IDEA_REPLY_KIND, IDEA_REPLY_VERSION, request, 0) > MAX_PAYLOAD_BYTES) throw new Error("The reply is too long to send. Shorten it.");
    const txid = await mill.send({ kind: IDEA_REPLY_KIND, v: IDEA_REPLY_VERSION, input: request });
    const reply = await mill.awaitAnswer<IdeaReplyAnswer>(txid, signal, { intervalMs: POLL_MS });
    if (reply.status !== "answered" || !reply.answer) throw new Error(reply.reason || "The factory could not answer this one.");
    return reply.answer;
  };
}

const nameKey = (name: string) => name.trim().toLowerCase();
const clean = (text: unknown, max: number): string => (typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "");

// --- his reasons -------------------------------------------------------------------------------------------------------------

/** His reasons for retiring or changing ideas, kept until he removes them. His own record: it stays when YNAB goes Off. */
export const REASONS_KEY = "tradetracker-budget-ideas-reasons";
/** How an idea was changed by a reply, by idea key. His own record, like the reasons. */
export const REVISIONS_KEY = "tradetracker-budget-ideas-revisions";

export interface Reason {
  id: string;
  /** his words, or the grind's short line of them */
  words: string;
  /** the payees the reason rules out of later ideas, as the charges write them */
  payees: string[];
  /** epoch ms */
  at: number;
}

export function readReasons(): Reason[] {
  const kept = readJson(REASONS_KEY);
  if (!Array.isArray(kept)) return [];
  return kept.filter(
    (r): r is Reason => isRecord(r) && typeof r.id === "string" && typeof r.words === "string" && typeof r.at === "number" && Array.isArray(r.payees) && r.payees.every((p) => typeof p === "string"),
  );
}

/** Keeps a reason; returns it. */
export function addReason(reason: { words: string; payees: readonly string[] }, at: number = Date.now()): Reason {
  const made: Reason = { id: `r${at.toString(36)}${Math.random().toString(36).slice(2, 8)}`, words: reason.words, payees: reason.payees.map((p) => p.trim()).filter(Boolean), at };
  writeJson(REASONS_KEY, [...readReasons(), made].slice(-REASONS_KEPT));
  return made;
}

export function removeReason(id: string): void {
  writeJson(REASONS_KEY, readReasons().filter((r) => r.id !== id));
}

/** The payees his reasons rule out, trimmed and lower case, for proposeIdeas. */
export function ruledOutPayees(reasons: readonly Reason[]): Set<string> {
  return new Set(reasons.flatMap((r) => r.payees.map(nameKey)));
}

// --- the request -------------------------------------------------------------------------------------------------------------

/** The request for one reply: the idea with its latest charges, his words, his latest reasons, and the budget's category names. */
export function buildReplyRequest(idea: BudgetIdea, words: string, categoryNames: readonly string[]): IdeaReplyRequest {
  const latest = [...idea.charges].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, CHARGES_SENT);
  return {
    idea: {
      name: idea.name.slice(0, 80),
      cadence: idea.cadence,
      amount: idea.amount,
      ...(idea.dueDate ? { dueDate: idea.dueDate } : {}),
      total: idea.total,
      payees: idea.payees.slice(0, 20).map((p) => p.slice(0, 120)),
      charges: latest.map((c) => ({ date: c.date, payee: c.payee.slice(0, 120), amount: c.amount })),
    },
    words: words.trim().slice(0, WORDS_MAX),
    reasons: readReasons()
      .slice(-REASONS_SENT)
      .map((r) => ({ words: r.words.slice(0, 400), ...(r.payees.length > 0 ? { payees: r.payees.slice(0, 10).map((p) => p.slice(0, 120)) } : {}) })),
    categories: categoryNames.slice(0, 150).map((name) => ({ name: name.slice(0, 60) })),
  };
}

// --- the answer --------------------------------------------------------------------------------------------------------------

/** What a revise changes on the card; a field left out stays. */
export interface Revision {
  name?: string;
  amount?: number;
  cadence?: "monthly" | "yearly";
  /** YYYY-MM-DD, with a yearly cadence */
  dueDate?: string;
}

export type ReplyResult =
  /** the card changes in place */
  | { kind: "revise"; say: string; revision: Revision; note?: string; rulesOut: string[] }
  /** the card goes, and his reason is shown once */
  | { kind: "retire"; say: string; note?: string; rulesOut: string[] }
  /** a short answer under the card */
  | { kind: "explain"; say: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The answer in the card's terms, or null when it cannot be used (no sentence, an outcome it does not know, an amount that is not
 * dollars). A revise whose new name is a category the budget already has folds the idea into it, so the card goes (a retire); a revise
 * that changes nothing is an explain. A yearly cadence always has a due date.
 */
export function resolveReply(answer: IdeaReplyAnswer, idea: BudgetIdea, categoryNames: readonly string[], today: string = day(Date.now())): ReplyResult | null {
  const say = clean(answer.say, SAY_MAX);
  if (!say) return null;
  const note = clean(answer.remember, 160) || undefined;
  const rulesOut = Array.isArray(answer.rulesOut) ? answer.rulesOut.map((p) => clean(p, 120)).filter(Boolean) : [];
  if (answer.outcome === "explain") return { kind: "explain", say };
  if (answer.outcome === "retire") return { kind: "retire", say, note, rulesOut };
  if (answer.outcome !== "revise") return null;

  const name = clean(answer.name, 80);
  if (name && categoryNames.some((c) => nameKey(c) === nameKey(name))) return { kind: "retire", say, note, rulesOut };
  if (answer.amount !== undefined && !(typeof answer.amount === "number" && Number.isFinite(answer.amount) && answer.amount > 0)) return null;
  if (answer.cadence !== undefined && answer.cadence !== "monthly" && answer.cadence !== "yearly") return null;
  const revision: Revision = {};
  if (name && nameKey(name) !== nameKey(idea.name)) revision.name = name;
  if (answer.amount !== undefined && answer.amount !== idea.amount) revision.amount = answer.amount;
  if (answer.cadence !== undefined && answer.cadence !== idea.cadence) revision.cadence = answer.cadence;
  const cadence = revision.cadence ?? idea.cadence;
  if (cadence === "yearly") {
    const given = typeof answer.dueDate === "string" && DATE.test(answer.dueDate) ? answer.dueDate : undefined;
    if (revision.cadence === "yearly") {
      const latest = [...idea.charges].map((c) => c.date).sort().pop() ?? today;
      revision.dueDate = given ?? dueDateFor(latest, today);
    } else if (given && given !== idea.dueDate) {
      revision.dueDate = given;
    }
  }
  if (Object.keys(revision).length === 0) return { kind: "explain", say };
  return { kind: "revise", say, revision, note, rulesOut };
}

// --- revisions ---------------------------------------------------------------------------------------------------------------

export type Revisions = Record<string, Revision>;

export function readRevisions(): Revisions {
  const kept = readJson(REVISIONS_KEY);
  if (!isRecord(kept)) return {};
  const out: Revisions = {};
  for (const [key, value] of Object.entries(kept)) {
    if (!isRecord(value)) continue;
    const r: Revision = {};
    if (typeof value.name === "string" && value.name.trim()) r.name = value.name;
    if (typeof value.amount === "number" && value.amount > 0) r.amount = value.amount;
    if (value.cadence === "monthly" || value.cadence === "yearly") r.cadence = value.cadence;
    if (typeof value.dueDate === "string" && DATE.test(value.dueDate)) r.dueDate = value.dueDate;
    out[key] = r;
  }
  return out;
}

/** Keeps a revision of the idea `key`, over what was kept of it before. */
export function writeRevision(key: string, revision: Revision): void {
  writeJson(REVISIONS_KEY, { ...readRevisions(), [key]: { ...readRevisions()[key], ...revision } });
}

/** The ideas as he revised them. */
export function applyRevisions(ideas: readonly BudgetIdea[], revisions: Revisions): BudgetIdea[] {
  return ideas.map((idea) => {
    const r = revisions[idea.key];
    if (!r) return idea;
    const revised: BudgetIdea = { ...idea, ...(r.name ? { name: r.name } : {}), ...(r.amount ? { amount: r.amount } : {}), ...(r.cadence ? { cadence: r.cadence } : {}) };
    if (revised.cadence === "monthly") delete revised.dueDate;
    else if (r.dueDate) revised.dueDate = r.dueDate;
    else if (!revised.dueDate) revised.dueDate = dueDateFor([...idea.charges].map((c) => c.date).sort().pop() ?? day(Date.now()), day(Date.now()));
    return revised;
  });
}
