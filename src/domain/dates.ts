/**
 * Date helpers for the fixed simulated clock (Asia/Jerusalem, +03:00 during the demo period).
 * Dates are ISO "yyyy-mm-dd"; datetimes are ISO strings with an explicit offset.
 * Only calendar arithmetic is needed; we avoid the browser timezone entirely by
 * treating the local wall-clock fields as the source of truth.
 */

export const DEMO_OFFSET = "+03:00";

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function parseWallClock(iso: string): WallClock {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toIsoDate(w: { year: number; month: number; day: number }): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function toIsoDateTime(w: WallClock): string {
  return `${toIsoDate(w)}T${pad(w.hour)}:${pad(w.minute)}:00${DEMO_OFFSET}`;
}

/** Compare two ISO dates/datetimes lexicographically (safe because both carry the same offset). */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isoDateOf(iso: string): string {
  return iso.slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add whole calendar months to a wall-clock date, clamping the day to the target month's length. */
export function addMonths(isoDate: string, months: number): string {
  const w = parseWallClock(isoDate);
  const index = w.year * 12 + (w.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(w.day, daysInMonth(year, month));
  return toIsoDate({ year, month, day });
}

export function addDays(iso: string, days: number): string {
  const w = parseWallClock(iso);
  const utc = Date.UTC(w.year, w.month - 1, w.day + days, w.hour, w.minute);
  const d = new Date(utc);
  return toIsoDateTime({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  });
}

/**
 * A site that starts on `start` and lasts `months` calendar months ends the day before
 * start + months. 01/03/2026 + 12 months -> 28/02/2027; + 14 months -> 30/04/2027.
 */
export function finishDateForDuration(startIsoDate: string, months: number): string {
  const nextStart = addMonths(startIsoDate, months);
  return isoDateOf(addDays(nextStart, -1));
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(iso: string): number {
  const w = parseWallClock(iso);
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const w = parseWallClock(iso);
  return `${pad(w.day)}/${pad(w.month)}/${w.year}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const w = parseWallClock(iso);
  return `${formatDate(iso)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** ISO datetime at a wall-clock time on a given date, e.g. at("2026-09-07", 9, 12). */
export function at(isoDate: string, hour: number, minute = 0): string {
  const w = parseWallClock(isoDate);
  return toIsoDateTime({ ...w, hour, minute });
}

/** Whole months between two ISO dates when the second is a clean month boundary of the first. */
export function monthsBetween(startIsoDate: string, endIsoDateInclusive: string): number {
  const s = parseWallClock(startIsoDate);
  const e = parseWallClock(addDays(endIsoDateInclusive, 1));
  return e.year * 12 + e.month - (s.year * 12 + s.month);
}
