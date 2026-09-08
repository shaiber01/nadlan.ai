import type { PersonId, SectionId } from "../../data/types";
import { pkg } from "../../engine/commands";
import { SECTION_SHORT_HE } from "../../engine/checks";

/** v2 amounts are whole shekels (not agorot like v1), so the ERP screens use their own formatters. */
export const nis = (v: number): string => `${v.toLocaleString("he-IL")} ₪`;
export const num = (v: number, digits = 2): string => v.toLocaleString("he-IL", { maximumFractionDigits: digits });
export const dateHe = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const [d] = iso.split("T");
  return d
    .split("-")
    .reverse()
    .map((p, i) => (i < 2 ? String(Number(p)) : p))
    .join(".");
};
export const dateTimeHe = (iso: string): string => (iso.includes("T") ? `${dateHe(iso)} ${iso.slice(11, 16)}` : dateHe(iso));
export const personName = (id: PersonId | null | undefined): string => (id ? pkg.people.find((p) => p.id === id)?.nameHe ?? id : "—");
export const supplierName = (id: string | null | undefined): string => (id ? pkg.suppliers.find((s) => s.id === id)?.nameHe ?? id : "—");
export const sectionFull = (id: SectionId): string => `${id} — ${pkg.sections.find((s) => s.id === id)?.nameHe ?? SECTION_SHORT_HE[id]}`;
export const sectionShort = (id: SectionId): string => `${id} — ${SECTION_SHORT_HE[id]}`;
export const monthHe = (period: string): string => {
  const [y, m] = period.split("-");
  return `${Number(m)}/${y}`;
};
