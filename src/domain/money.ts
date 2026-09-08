/**
 * Money is stored as integer agorot (1 ILS = 100 agorot) everywhere in the domain.
 * The seed and the brief express amounts in whole ILS; convert once at ingestion with `ils()`.
 */
export type Agorot = number;

const AGOROT_PER_ILS = 100;

/** Whole or fractional ILS -> integer agorot (rounded once, half away from zero). */
export function ils(amount: number): Agorot {
  if (!Number.isFinite(amount)) throw new Error("ils(): amount must be finite");
  return roundHalfAwayFromZero(amount * AGOROT_PER_ILS);
}

export function toIls(agorot: Agorot): number {
  return agorot / AGOROT_PER_ILS;
}

export function roundHalfAwayFromZero(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

export function assertAgorot(value: unknown, label = "amount"): asserts value is Agorot {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer agorot amount, got ${String(value)}`);
  }
}

export function sum(values: Iterable<Agorot>): Agorot {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** quantity × unit price, rounded once to the nearest agora. */
export function multiplyQuantity(quantity: number, unitPriceAgorot: Agorot): Agorot {
  return roundHalfAwayFromZero(quantity * unitPriceAgorot);
}

/**
 * Split `total` across `weights` proportionally in exact agorot.
 * Each part is floored; the rounding remainder is assigned deterministically to the LAST part,
 * as the brief requires for reallocating an invoice's existing payment across allocation rows.
 */
export function splitProportionally(total: Agorot, weights: number[]): Agorot[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    const parts = weights.map(() => 0);
    parts[parts.length - 1] = total;
    return parts;
  }
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const parts = weights.map((w) => Math.floor((absTotal * w) / weightSum));
  const assigned = parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] += absTotal - assigned;
  return parts.map((p) => p * sign);
}

/** Parse user-entered currency text ("13,333.33", "13333", "₪ 1,200") into agorot, or null when invalid. */
export function parseMoneyInput(text: string): Agorot | null {
  const cleaned = text
    .replace(/[₪\s]/g, "")
    .replace(/,/g, "")
    .replace(/[‎‏]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return ils(value);
}

/** Parse a quantity with up to three decimals; null when invalid. */
export function parseQuantityInput(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, "").replace(/[‎‏]/g, "");
  if (!/^-?\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

const ilsFormatter = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const ilsFormatterDecimals = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 });

/** "6,106,000 ₪" or "13,333.33 ₪". Decimals are only shown when the amount is not a whole shekel. */
export function formatILS(agorot: Agorot, options: { withSign?: boolean; alwaysDecimals?: boolean } = {}): string {
  const value = toIls(agorot);
  const isWhole = agorot % AGOROT_PER_ILS === 0;
  const formatted = isWhole && !options.alwaysDecimals ? ilsFormatter.format(Math.abs(value)) : ilsFormatterDecimals.format(Math.abs(value));
  const sign = agorot < 0 ? "−" : options.withSign && agorot > 0 ? "+" : "";
  return `${sign}${formatted} ₪`;
}

/** Plain number without currency: "1,440,000" */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Signed variance text: "+6,000 ₪" / "−2,000 ₪" / "0 ₪" */
export function formatVariance(agorot: Agorot): string {
  return formatILS(agorot, { withSign: true });
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}
