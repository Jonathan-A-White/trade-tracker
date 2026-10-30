// A charge split across categories: the parts as typed, what is left to place, and whether they make a split YNAB takes.
import { money } from "./waiting";

export interface SplitPart {
  key: string;
  categoryId: string;
  /** as typed: '13.12' */
  amount: string;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** A typed amount in cents; null for what is no amount (empty, letters, more than two decimals). */
export function partCents(typed: string): number | null {
  const text = typed.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** What is left to place in cents (negative: too much). */
export function remainderCents(parts: readonly SplitPart[], amount: number): number {
  return cents(amount) - parts.reduce((sum, part) => sum + (partCents(part.amount) ?? 0), 0);
}

/** Whether the parts make a split that can be written: each a category and dollars, adding up to the charge. */
export function splitReady(parts: readonly SplitPart[], amount: number): boolean {
  return (
    parts.length >= 2 &&
    parts.every((part) => part.categoryId !== "" && (partCents(part.amount) ?? 0) > 0) &&
    remainderCents(parts, amount) === 0
  );
}

/** The line under the parts: '$3.12 left to place', '$7.38 too much', 'Adds up to $43.12'. */
export function remainderLine(parts: readonly SplitPart[], amount: number): string {
  const left = remainderCents(parts, amount);
  if (left > 0) return `${money(left / 100)} left to place`;
  if (left < 0) return `${money(-left / 100)} too much`;
  return `Adds up to ${money(amount)}`;
}

let made = 0;
export function newPart(categoryId = ""): SplitPart {
  made += 1;
  return { key: `part-${made}`, categoryId, amount: "" };
}
