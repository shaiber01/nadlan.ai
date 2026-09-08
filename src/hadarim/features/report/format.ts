/** Presentation-only formatters for the report (whole shekels; the engine formats its own text). */
export const nis = (v: number): string => `${v.toLocaleString("he-IL")} ₪`;
export const num = (v: number): string => v.toLocaleString("he-IL");
export const signedNis = (v: number): string => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);
export const pct = (v: number, digits = 1): string => `${v.toFixed(digits)}%`;
export const signedPct = (v: number, digits = 1): string => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}%`);
export const mil = (v: number): string => `${(v / 1_000_000).toFixed(2)} מ׳`;
