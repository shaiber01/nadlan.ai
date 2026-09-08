/** Small seeded PRNG (mulberry32) so the generated package is identical on every run. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** integer in [min, max] */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    /** value ± pct, rounded to `step` */
    jitter: (value: number, pct: number, step = 100) => Math.round((value * (1 + (next() * 2 - 1) * pct)) / step) * step,
    pick: <T>(items: T[]): T => items[Math.floor(next() * items.length)],
  };
}

export type Rng = ReturnType<typeof createRng>;

/** Adjust the last element so the array sums exactly to `target` (keeps the earlier elements untouched). */
/**
 * Scales a list of positive amounts so they sum exactly to `target`: the residual is spread
 * proportionally (rounded to `step`) and the rounding remainder lands on the last item, so no
 * single item absorbs the whole difference and none can turn negative.
 */
export function forceSum(values: number[], target: number, step = 10): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0 || values.length === 0) return [...values];
  const out = values.map((v) => Math.round((v * target) / sum / step) * step);
  const rounded = out.reduce((a, b) => a + b, 0);
  out[out.length - 1] += target - rounded;
  return out;
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
