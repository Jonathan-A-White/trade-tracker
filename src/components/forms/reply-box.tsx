// A Reply on a card that offers a suggestion (first used by Home's Budget ideas, mw-6ww.148.32): a 'Reply' button for the card's row of
// buttons that opens a text box; Send hands his words to the card's own `onSend`, shows 'Thinking…' while it waits, and on no answer
// leaves the card as it was with 'No answer yet; try again' and his words in the box. What an answer does is the card's business.
import { useId, useState } from "react";

export const NO_ANSWER = "No answer yet; try again";
const BUTTON = "min-h-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm font-medium text-gray-800 dark:text-gray-100 disabled:opacity-50";

export interface ReplyBoxProps {
  /** what the card is, for the text box's label: 'Reply to Chewy' */
  subject: string;
  /** Sends his words. Resolves null when answered (the box closes), else the sentence to show (the box stays, his words kept). */
  onSend: (words: string) => Promise<string | null>;
  /** another action on the card is under way */
  disabled?: boolean;
}

/** The Reply button and, when it is open, the text box with Send and Cancel. Draw it inside the card's wrapping row of buttons. */
export function ReplyBox({ subject, onSend, disabled }: ReplyBoxProps) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

  async function send() {
    const typed = words.trim();
    if (!typed || thinking) return;
    setThinking(true);
    setProblem(null);
    let said: string | null;
    try {
      said = await onSend(typed);
    } catch {
      said = NO_ANSWER;
    }
    setThinking(false);
    if (said === null) {
      setOpen(false);
      setWords("");
    } else {
      setProblem(said);
    }
  }

  return (
    <>
      <button type="button" disabled={disabled || thinking} aria-expanded={open} onClick={() => setOpen((was) => !was)} className={BUTTON}>
        Reply
      </button>
      {open && (
        <div className="flex w-full basis-full flex-col gap-2">
          <label htmlFor={id} className="text-sm text-gray-700 dark:text-gray-300">
            {`Your reply to ${subject}`}
          </label>
          <textarea
            id={id}
            rows={3}
            value={words}
            maxLength={1000}
            disabled={thinking}
            onChange={(e) => setWords(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
          />
          {thinking && (
            <p role="status" className="text-sm text-gray-600 dark:text-gray-400">
              Thinking…
            </p>
          )}
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
          <span className="flex gap-2">
            <button type="button" disabled={thinking || words.trim() === ""} onClick={() => void send()} className={BUTTON}>
              Send
            </button>
            <button type="button" disabled={thinking} onClick={() => setOpen(false)} className={BUTTON}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </>
  );
}
