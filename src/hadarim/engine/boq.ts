import type { HBoqLine } from "../data/types";

/** The line's value in whole shekels (quantity × unit price), or null when the line is not priced. */
export function boqLineAmount(line: HBoqLine): number | null {
  return line.unitPrice == null ? null : Math.round(line.qty * line.unitPrice);
}

/** Priced value of a set of lines, with how many of them carry a price — a partial total is flagged, not hidden. */
export function boqTotal(lines: HBoqLine[]): { amount: number; pricedLines: number; unpricedLines: number } {
  let amount = 0;
  let pricedLines = 0;
  for (const l of lines) {
    const a = boqLineAmount(l);
    if (a == null) continue;
    amount += a;
    pricedLines += 1;
  }
  return { amount, pricedLines, unpricedLines: lines.length - pricedLines };
}
