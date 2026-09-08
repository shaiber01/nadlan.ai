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
export function forceSum(values: number[], target: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  const out = [...values];
  out[out.length - 1] += target - sum;
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
