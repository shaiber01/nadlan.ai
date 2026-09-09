/**
 * Units of measure, and what an order line is worth once they are taken into account.
 *
 * A purchase-order line carries two units: the quantity is measured in `unit`, the price is quoted in
 * `priceUnit`. They are usually the same — 15 חודשים at 30,000 ₪ a month — but a supplier often quotes
 * per טון while delivering and invoicing in ק״ג. When the two differ the quantity is converted into the
 * priced unit before it is multiplied, so 12,000 ק״ג at 4,800 ₪ לטון is 57,600 ₪, not 57,600,000 ₪.
 *
 * Only units within one family convert. Everything else — a count of items, a visit, a month — is its
 * own family: `convertQuantity` returns null rather than inventing a factor.
 */

/** Families of commensurable units, each keyed by its base unit, with every member's size in base units. */
const FAMILIES: Record<string, Record<string, number>> = {
  מסה: { "ק״ג": 1, טון: 1000, גרם: 0.001 },
  אורך: { "מ׳": 1, "ס״מ": 0.01, "מ״מ": 0.001, "ק״מ": 1000 },
  שטח: { "מ״ר": 1, "דונם": 1000, "סמ״ר": 0.0001 },
  נפח: { "מ״ק": 1, ליטר: 0.001 },
  זמן: { חודש: 1, חודשים: 1 },
};

interface UnitEntry {
  family: string;
  /** Size of one of this unit, measured in the family's base unit. */
  size: number;
}

const UNITS: Record<string, UnitEntry> = Object.fromEntries(Object.entries(FAMILIES).flatMap(([family, members]) => Object.entries(members).map(([name, size]) => [name, { family, size }])));

/** The units a purchase order may be keyed in, most-used first; anything already on a record is kept. */
export const ORDER_UNITS = ["ק״ג", "טון", "יח׳", "מ׳", "מ״ר", "מ״ק", "ליטר", "קומפ׳", "חודש", "חודשים", "שעה"];

/** The family a unit belongs to, or null for a unit that stands alone (יח׳, קומפ׳, בדיקה, ביקור…). */
export function unitFamily(unit: string): string | null {
  return UNITS[unit]?.family ?? null;
}

/** True when a quantity in `from` can be restated in `to` — the same unit, or the same family. */
export function areCommensurable(from: string, to: string): boolean {
  if (from === to) return true;
  const a = UNITS[from];
  const b = UNITS[to];
  return !!a && !!b && a.family === b.family;
}

/** `qty` restated in `to`, or null when the two units are not commensurable. */
export function convertQuantity(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.family !== b.family) return null;
  return (qty * a.size) / b.size;
}

/** Fixed-width factor between two commensurable units (1,000 for ק״ג → טון), or null. */
export function conversionFactor(from: string, to: string): number | null {
  const converted = convertQuantity(1, from, to);
  return converted;
}

export interface OrderLine {
  qty: number;
  unit: string;
  priceUnit: string;
  unitPrice: number;
}

export interface LineValue {
  /** Quantity restated in the priced unit, or null when the units do not convert. */
  pricedQty: number | null;
  /** `pricedQty × unitPrice`, rounded to whole shekels, or null when the units do not convert. */
  amount: number | null;
  /** The units differ but belong to one family, so the amount carries a conversion. */
  converted: boolean;
  /** The units differ and do not convert — the line cannot be valued. */
  incommensurable: boolean;
}

/** What an order line is worth, with the quantity converted into the unit the price is quoted in. */
export function lineValue(line: OrderLine): LineValue {
  const priceUnit = line.priceUnit || line.unit;
  const pricedQty = convertQuantity(line.qty, line.unit, priceUnit);
  if (pricedQty == null) return { pricedQty: null, amount: null, converted: false, incommensurable: true };
  return { pricedQty, amount: Math.round(pricedQty * line.unitPrice), converted: priceUnit !== line.unit, incommensurable: false };
}

/** The line's value, or NaN when its units do not convert — for callers that only compare numbers. */
export function lineAmount(line: OrderLine): number {
  return lineValue(line).amount ?? Number.NaN;
}

/** "4,800 ₪ לטון", or "4.8 ₪ ליחידה" for a unit that stands alone. */
export function pricePerUnitHe(unitPrice: number, priceUnit: string): string {
  return `${unitPrice.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪ ל${priceUnit}`;
}
