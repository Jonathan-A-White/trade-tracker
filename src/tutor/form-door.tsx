import { useEffect, useId, useRef, useState } from "react";
import { useAlive } from "pwa-kit/alive";
import { FORM_START, applyValues, argsOf, oneQuestion, requiredFilled } from "voice-kit/forms";
import type { FormSpec } from "voice-kit/forms";
import { defineRegistry } from "voice-kit/talks";
import type { Command } from "voice-kit/talks";
import { MAX_HISTORY_TURNS, buildFormTalkRequest } from "./form-talk";
import type { TalkTurn } from "./form-talk";
import { useFormTutor } from "./tutor-context";

export const START_LABEL = "Let the tutor do it";
export const READY_LINE = "Everything required is filled in. Read the form, change anything you like, then tap Send.";
export const NO_FACTORY =
  "The tutor works through the factory, which is not set up and unlocked on this phone. What you have typed stays here.";

export interface FormDoorProps {
  form: FormSpec;
  /** The confirm command the Send tap runs: the same path as the form's own Save. */
  command: Command;
  /** What each field holds now, as text, by field name. */
  values: Record<string, string>;
  /** Puts the tutor's value in the field. Returns false when the form cannot take it (the form does the setting and shows it). */
  onFill: (field: string, value: string) => boolean | void;
}

type Phase =
  | { name: "idle" }
  | { name: "sending" }
  | { name: "failed"; detail: string }
  | { name: "refused"; why: string };

function failureDetail(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

/**
 * 'Let the tutor do it': a button at the top of a form and, once tapped, a panel where the tutor asks one
 * question at a time and fills the matching field, which he sees filled. When every required field holds
 * something the panel offers Send, which runs the form's command. The tutor never sends: Send is his tap.
 */
export function FormDoor({ form, command, values, onFill }: FormDoorProps) {
  const ask = useFormTutor();
  const alive = useAlive();
  const [open, setOpen] = useState(false);
  const [say, setSay] = useState("");
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [typed, setTyped] = useState("");
  const answerId = useId();
  const turns = useRef<TalkTurn[]>([]);
  const lastMessage = useRef("");
  const live = useRef<AbortController | null>(null);
  const latest = useRef({ form, command, values, onFill, ask });
  useEffect(() => {
    latest.current = { form, command, values, onFill, ask };
  });
  useEffect(() => {
    return () => live.current?.abort();
  }, []);

  async function talk(message: string): Promise<void> {
    lastMessage.current = message;
    const current = latest.current;
    if (!current.ask) {
      setPhase({ name: "failed", detail: NO_FACTORY });
      return;
    }
    live.current ??= new AbortController();
    const signal = live.current.signal;
    setPhase({ name: "sending" });
    try {
      const request = buildFormTalkRequest(
        current.form,
        current.values,
        message,
        turns.current.slice(-MAX_HISTORY_TURNS),
        current.command.name,
      );
      const answer = await current.ask(request, signal);
      if (signal.aborted || !alive()) return;
      const said = oneQuestion(answer.answer);
      turns.current = [...turns.current, { q: message, a: said }].slice(-MAX_HISTORY_TURNS);
      for (const { field, value } of applyValues(latest.current.form, answer.form_values)) {
        latest.current.onFill(field, value);
      }
      const next = latest.current.form.fields.some((f) => f.name === answer.form_ask) ? answer.form_ask : undefined;
      setSay(said);
      setAsking(next);
      setPhase({ name: "idle" });
    } catch (err) {
      if (signal.aborted || !alive()) return;
      setPhase({ name: "failed", detail: failureDetail(err) });
    }
  }

  async function send(): Promise<void> {
    const current = latest.current;
    setPhase({ name: "sending" });
    const registry = defineRegistry({ commands: [current.command] });
    const ran = await registry.run(current.command.name, argsOf(current.form, current.values));
    if (!alive()) return;
    if (ran.ok) {
      setOpen(false);
      setPhase({ name: "idle" });
    } else {
      setPhase({ name: "refused", why: ran.why });
    }
  }

  function start(): void {
    turns.current = [];
    live.current = new AbortController();
    setSay("");
    setAsking(undefined);
    setTyped("");
    setOpen(true);
    void talk(FORM_START);
  }

  function stop(): void {
    live.current?.abort();
    live.current = null;
    setOpen(false);
    setPhase({ name: "idle" });
  }

  function reply(): void {
    const text = typed.trim();
    if (!text || phase.name === "sending") return;
    setTyped("");
    void talk(text);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="w-full rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 dark:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
      >
        {START_LABEL}
      </button>
    );
  }

  const sending = phase.name === "sending";
  const ready = requiredFilled(form, values) && !asking && say !== "";
  return (
    <section
      role="region"
      aria-label="The tutor is helping with this form"
      className="space-y-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-3"
    >
      {say ? (
        <p aria-live="polite" className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {say}
        </p>
      ) : null}
      {sending ? (
        <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
          {say ? "The tutor is thinking…" : "The tutor is getting ready…"}
        </p>
      ) : null}
      {phase.name === "failed" ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>{phase.detail}</p>
          <button
            type="button"
            onClick={() => void talk(lastMessage.current)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : null}
      {phase.name === "refused" ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {phase.why}
        </p>
      ) : null}
      {ready && !sending ? (
        <div className="space-y-2">
          <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
            {READY_LINE}
          </p>
          <button
            type="button"
            onClick={() => void send()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Send
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={answerId} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Your answer
          </label>
          <textarea
            id={answerId}
            rows={2}
            value={typed}
            disabled={sending}
            onChange={(e) => setTyped(e.target.value)}
            className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={sending || typed.trim() === ""}
            onClick={reply}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-40 cursor-pointer"
          >
            Reply
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={stop}
        className="w-full rounded-lg px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 cursor-pointer"
      >
        Stop
      </button>
    </section>
  );
}
