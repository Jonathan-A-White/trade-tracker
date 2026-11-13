import { useCallback, useState } from "react";

/**
 * What a page keeps so that one thing he just did can be undone: a value per key (a trip, a card), tied to a scope.
 * Page state only: it is gone when he leaves the page, and when the scope changes (another trip, another page of cards)
 * what was kept for the old scope is no longer offered.
 */
export interface Undo<T> {
  /** what is kept for the current scope, by key */
  kept: Readonly<Record<string, T>>;
  /** keep `value` under `key`; what is kept for other scopes is dropped */
  keep: (key: string, value: T) => void;
  /** drop what is kept under `key`, or everything for the scope when no key is given */
  drop: (key?: string) => void;
}

const NOTHING: Readonly<Record<string, never>> = {};

export function useUndo<T>(scope = ""): Undo<T> {
  const [state, setState] = useState<{ scope: string; kept: Record<string, T> }>({ scope, kept: {} });
  const kept = state.scope === scope ? state.kept : NOTHING;

  const keep = useCallback(
    (key: string, value: T) =>
      setState((now) => ({ scope, kept: { ...(now.scope === scope ? now.kept : {}), [key]: value } })),
    [scope],
  );

  const drop = useCallback(
    (key?: string) =>
      setState((now) => {
        if (now.scope !== scope) return now;
        if (key === undefined) return { scope, kept: {} };
        return { scope, kept: Object.fromEntries(Object.entries(now.kept).filter(([k]) => k !== key)) };
      }),
    [scope],
  );

  return { kept, keep, drop };
}
