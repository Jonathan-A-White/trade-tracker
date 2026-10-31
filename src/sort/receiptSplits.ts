// A receipt turned into the parts of a split: what the lines of each category add up to, the tax and fees spread over the
// categories in proportion, and the receipt's total checked against the charge. A receipt under the charge leaves the
// difference as a part of its own for him to place; a receipt over it writes nothing.
import { money } from "./waiting";

/** What the lines placed in one category add up to, in cents, before tax. */
export interface ReceiptGroup {
  categoryId: string;
  cents: number;
}

/** One part of the split; `categoryId` is "" for the part he places himself. */
export interface SplitRow {
  categoryId: string;
  cents: number;
}

export interface ReceiptSplitInput {
  groups: readonly ReceiptGroup[];
  /** the tax the receipt prints; null when it prints none */
  taxCents: number | null;
  /** the total the receipt prints (tax and fees in); null when it prints none */
  totalCents: number | null;
  chargeCents: number;
}

/** The parts to put on the sheet (`line` says what to know of them), or no parts and the plain reason. */
export type ReceiptSplit = { ok: true; rows: SplitRow[]; line: string | null } | { ok: false; rows: []; line: string };

const cents = (dollars: number) => Math.round(dollars * 100);

/** `total` shared out by `weights` to the cent: the largest remainders take the odd cents, so the shares add up to `total`. */
function share(total: number, weights: readonly number[]): number[] {
  const whole = weights.reduce((sum, w) => sum + w, 0);
  const raw = weights.map((w) => (total * w) / whole);
  const shares = raw.map(Math.floor);
  let left = total - shares.reduce((sum, s) => sum + s, 0);
  const order = raw.map((r, index) => ({ index, fraction: r - Math.floor(r) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index]! += 1;
    left -= 1;
  }
  return shares;
}

/**
 * The split a receipt makes of a charge. The tax and fees (the receipt's total less its lines) are spread over the groups in
 * proportion to what each group's lines add up to, so the parts add up to the receipt's total exactly.
 */
export function receiptSplits(input: ReceiptSplitInput): ReceiptSplit {
  const { groups, taxCents, totalCents, chargeCents } = input;
  const lines = groups.reduce((sum, g) => sum + g.cents, 0);
  if (groups.length === 0 || lines <= 0) return { ok: false, rows: [], line: "No prices could be read from the receipt. Place the charge by hand." };

  const total = totalCents ?? lines + (taxCents ?? 0);
  if (total > chargeCents) {
    return { ok: false, rows: [], line: `Receipt ${money(total / 100)} is more than the charge ${money(chargeCents / 100)}. Place the charge by hand.` };
  }
  const extras = share(total - lines, groups.map((g) => g.cents));
  const rows: SplitRow[] = groups.map((g, index) => ({ categoryId: g.categoryId, cents: g.cents + extras[index]! }));
  if (total === chargeCents) return { ok: true, rows, line: null };

  const missing = chargeCents - total;
  return {
    ok: true,
    rows: [...rows, { categoryId: "", cents: missing }],
    line: `Receipt ${money(total / 100)}, charge ${money(chargeCents / 100)}: ${money(missing / 100)} not on the receipt`,
  };
}

/** The grind's grouping of the receipt's lines, as the sheet's own category ids. */
export type Grouping = { categoryId: string } | { split: { categoryId: string; amount: number }[] };

/**
 * The lines' sums per category from the grind's grouping, or null when the grouping does not add up to the lines (the
 * model's arithmetic is not trusted: what the lines add up to is the receipt's).
 */
export function groupLines(lines: readonly { price: number }[], grouping: Grouping): ReceiptGroup[] | null {
  const lineCents = lines.reduce((sum, l) => sum + cents(l.price), 0);
  if (!("split" in grouping)) return [{ categoryId: grouping.categoryId, cents: lineCents }];
  const groups = new Map<string, number>();
  for (const part of grouping.split) groups.set(part.categoryId, (groups.get(part.categoryId) ?? 0) + cents(part.amount));
  const added = [...groups.values()].reduce((sum, c) => sum + c, 0);
  return added === lineCents ? [...groups].map(([categoryId, c]) => ({ categoryId, cents: c })) : null;
}
