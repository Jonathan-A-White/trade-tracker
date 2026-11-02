import { useEffect, useState } from "react";

/**
 * The time, read again each time one of `deadlines` (epoch ms) passes while the component is open, so
 * a line that depends on a stored time (a lookup past its limit) changes by itself. Deadlines already
 * past are ignored.
 */
export function useNowAt(deadlines: readonly number[]): number {
  const [now, setNow] = useState(() => Date.now());
  const future = deadlines.filter((d) => d > now);
  const next = future.length > 0 ? Math.min(...future) : undefined;
  useEffect(() => {
    if (next === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [next, now]);
  return now;
}
