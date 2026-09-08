import type { FindingDecision } from "../../engine/model";

export const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
export const mil = (v: number) => `${(v / 1_000_000).toFixed(2)} מ׳ ₪`;
export const num = (v: number) => v.toLocaleString("he-IL");
export const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");
export const timeHe = (clock: string) => clock.slice(11, 16);

export const FINDING_KIND_HE: Record<string, string> = { allocation: "שיוך", unit: "יחידת מידה", price: "מחיר", coverage: "כיסוי חוזי" };

export function decisionStatusHe(d?: FindingDecision): { labelHe: string; tone: "neutral" | "primary" | "amber" | "red" | "green" | "navy" } {
  if (!d || d.status === "open") return d?.pending ? { labelHe: "בהחלטה", tone: "primary" } : { labelHe: "פתוח", tone: "amber" };
  switch (d.status) {
    case "handled":
      return { labelHe: "טופל", tone: "green" };
    case "pending_execution":
      return { labelHe: "ממתין לביצוע", tone: "navy" };
    case "referred":
      return { labelHe: "הועבר", tone: "neutral" };
    case "forecast_only":
      return { labelHe: "בתחזית בלבד", tone: "amber" };
  }
}
