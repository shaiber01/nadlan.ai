import { priceAppendixAt } from "../data/generate";
import { COST_GROUPS, MATERIAL_INDICES, chapterNameHe, costGroupOf, type CostGroup, type MaterialIndexDef } from "../data/bluebook";
import type { HBoqLine, HKpiRange, HadarimPackage, SectionId } from "../data/types";
import { isContingency, sectionShort } from "./checks";
import type { WorkingForecast, WorkingSection } from "./forecast";
import type { ErpState } from "./model";
import { convertQuantity } from "./units";

/**
 * The report's cost and quantity indices (standard §2א): what the project costs per gross m² and per unit,
 * by cost group and by section, and how much of the main materials the bill of quantities carries per m² —
 * with the unit prices the budget, the contracts and the current appendices put on them. Everything is
 * derived from the package and the working forecast; the reference ranges are the project's KPI policy.
 * Nothing here names a section, a material or a number of one project.
 */

export interface CostGroupRow {
  id: string;
  labelHe: string;
  sectionIds: SectionId[];
  sectionsHe: string;
  budget: number;
  recorded: number;
  remainingCommitment: number;
  uncovered: number;
  eac: number;
  budgetPerSqm: number;
  eacPerSqm: number;
  recordedPerSqm: number;
  /** eacPerSqm − budgetPerSqm. */
  deltaPerSqm: number;
  budgetPerUnit: number;
  eacPerUnit: number;
  recordedPerUnit: number;
  /** Share of the project's EAC. */
  sharePct: number;
  basisPct: number;
  factPct: number;
  commitmentPct: number;
  estimatePct: number;
}

export type RangeStatus = "within" | "above" | "below" | "none";

export interface MaterialIndexRow {
  id: string;
  labelHe: string;
  chapter: string;
  chapterNameHe: string;
  unit: string;
  sectionIds: SectionId[];
  /** Quantity in the bill of quantities, in `unit`. */
  boqQty: number;
  /** Value of those lines at their BOQ unit prices (null when none is priced). */
  boqValue: number | null;
  /** boqQty × factor ÷ gross m², in `perSqmUnitHe`. */
  perSqm: number | null;
  perSqmUnitHe: string;
  digits: number;
  range: HKpiRange | null;
  rangeStatus: RangeStatus;
  /** Quantity the approved invoices carry (converted into `unit`), or null when the invoices carry none. */
  deliveredQty: number | null;
  deliveredPct: number | null;
  /** What "done" rests on when invoices carry no quantity: the owning sections' recorded share. */
  deliveredNoteHe: string;
  /** Average ₪ per unit the BOQ (the budget's quantities and prices) puts on the material. */
  budgetUnitPrice: number | null;
  /** Average ₪ per unit actually paid (recorded ÷ delivered), when both are known. */
  paidUnitPrice: number | null;
  /** The price the remainder is priced at: the appendix in force, the signed contract, or the estimate. */
  currentUnitPrice: number | null;
  currentPriceBasisHe: string;
  currentPriceKind: "appendix" | "contract" | "estimate" | "mixed" | "none";
  /** Cost of the material per gross m²: the owning section's EAC when the material is the whole section, else the BOQ value. */
  costPerSqm: number | null;
  costBasisHe: string;
  /** ₪ the forecast moves for each `priceStep` ₪ of unit price on the remaining quantity, when the price is not locked. */
  sensitivityHe: string | null;
}

export interface DerivedIndexRow {
  id: string;
  labelHe: string;
  value: number | null;
  unitHe: string;
  digits: number;
  range: HKpiRange | null;
  rangeStatus: RangeStatus;
  noteHe: string;
}

export interface SectionKpiRow {
  sectionId: SectionId;
  budgetPerSqm: number;
  eacPerSqm: number;
  recordedPerSqm: number;
  budgetPerUnit: number;
  eacPerUnit: number;
}

export interface ReportKpis {
  grossSqm: number;
  units: number;
  denominatorHe: string;
  total: { budgetPerSqm: number; eacPerSqm: number; recordedPerSqm: number; budgetPerUnit: number; eacPerUnit: number; recordedPerUnit: number; range: HKpiRange | null; rangeStatus: RangeStatus };
  groups: CostGroupRow[];
  materials: MaterialIndexRow[];
  derived: DerivedIndexRow[];
  sections: SectionKpiRow[];
  /** EAC per gross m² at every final control and now. */
  eacPerSqmSeries: { labelHe: string; value: number }[];
  /** Floors cast against floors planned, from the project's buildings — site data, not spend. */
  structureProgress: { labelHe: string; pct: number } | null;
  notesHe: string[];
}

const num = (v: number) => v.toLocaleString("he-IL");
const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;

export function rangeStatus(value: number | null, range: HKpiRange | null | undefined): RangeStatus {
  if (value == null || !range) return "none";
  if (value < range.min) return "below";
  if (value > range.max) return "above";
  return "within";
}

export const RANGE_STATUS_HE: Record<RangeStatus, string> = { within: "בטווח", above: "מעל הטווח", below: "מתחת לטווח", none: "ללא טווח ייחוס" };

const perSqm = (v: number, sqm: number) => (sqm > 0 ? Math.round(v / sqm) : 0);
const perUnit = (v: number, units: number) => (units > 0 ? Math.round(v / units) : 0);
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The cost group a section belongs to: contingency, overhead (no chapter), or its primary chapter's group. */
export function sectionCostGroup(pkg: HadarimPackage, sectionId: SectionId): CostGroup {
  const section = pkg.sections.find((s) => s.id === sectionId);
  if (!section) return costGroupOf(undefined);
  if (section.kind === "contingency" || isContingency(sectionId)) return COST_GROUPS.find((g) => g.id === "contingency")!;
  if (section.kind === "overhead") return COST_GROUPS.find((g) => g.id === "overhead")!;
  return costGroupOf(section.chapters?.[0]);
}

function groupRows(pkg: HadarimPackage, wf: WorkingForecast, sqm: number, units: number): CostGroupRow[] {
  const rows: CostGroupRow[] = [];
  for (const g of COST_GROUPS) {
    const secs = wf.sections.filter((s) => sectionCostGroup(pkg, s.sectionId).id === g.id);
    if (!secs.length) continue;
    const sum = (f: (s: WorkingSection) => number) => secs.reduce((a, s) => a + f(s), 0);
    const budget = sum((s) => s.budget);
    const recorded = sum((s) => s.recorded);
    const remainingCommitment = sum((s) => s.remainingCommitment);
    const uncovered = sum((s) => s.uncovered);
    const eac = sum((s) => s.eac);
    rows.push({
      id: g.id,
      labelHe: g.labelHe,
      sectionIds: secs.map((s) => s.sectionId),
      sectionsHe: secs.map((s) => s.sectionId).join(", "),
      budget,
      recorded,
      remainingCommitment,
      uncovered,
      eac,
      budgetPerSqm: perSqm(budget, sqm),
      eacPerSqm: perSqm(eac, sqm),
      recordedPerSqm: perSqm(recorded, sqm),
      deltaPerSqm: perSqm(eac, sqm) - perSqm(budget, sqm),
      budgetPerUnit: perUnit(budget, units),
      eacPerUnit: perUnit(eac, units),
      recordedPerUnit: perUnit(recorded, units),
      sharePct: wf.totalEac > 0 ? Math.round((eac / wf.totalEac) * 1000) / 10 : 0,
      basisPct: eac > 0 ? Math.round(((recorded + remainingCommitment) / eac) * 100) : 100,
      factPct: share(recorded, eac),
      commitmentPct: share(remainingCommitment, eac),
      estimatePct: share(uncovered, eac),
    });
  }
  return rows;
}

/** Average ₪ per unit over the priced lines (quantity-weighted), or null when none is priced. */
function averageUnitPrice(lines: HBoqLine[]): number | null {
  const priced = lines.filter((l) => l.unitPrice != null && l.qty > 0);
  const qty = priced.reduce((a, l) => a + l.qty, 0);
  if (!qty) return null;
  return Math.round(priced.reduce((a, l) => a + l.qty * (l.unitPrice ?? 0), 0) / qty);
}

function materialRow(pkg: HadarimPackage, erp: ErpState, wf: WorkingForecast, def: MaterialIndexDef, sqm: number): MaterialIndexRow | null {
  const lines = pkg.boq.filter((l) => l.chapter === def.chapter && l.unit === def.unit);
  if (!lines.length) return null;
  const boqQty = lines.reduce((a, l) => a + l.qty, 0);
  const pricedValue = lines.filter((l) => l.unitPrice != null).reduce((a, l) => a + l.qty * (l.unitPrice ?? 0), 0);
  const boqValue = lines.some((l) => l.unitPrice != null) ? Math.round(pricedValue) : null;
  const sectionIds = [...new Set(lines.map((l) => l.sectionId))];
  const sections = sectionIds.map((id) => wf.sections.find((s) => s.sectionId === id)).filter((s): s is WorkingSection => !!s);
  const range = pkg.project.kpiPolicy.ranges[def.id] ?? null;
  const value = sqm > 0 && boqQty > 0 ? (boqQty * def.perSqmFactor) / sqm : null;

  // what the approved invoices of the owning sections say was delivered, restated in the index unit
  const invoices = erp.invoices.filter((i) => sectionIds.includes(i.sectionId) && i.status !== "בבדיקה" && i.dateReceived < wf.controlDate);
  let deliveredQty: number | null = null;
  let deliveredAmount = 0;
  for (const inv of invoices) {
    if (inv.quantity == null || !inv.unit) continue;
    const q = convertQuantity(inv.quantity, inv.unit, def.unit);
    if (q == null) continue;
    deliveredQty = (deliveredQty ?? 0) + q;
    deliveredAmount += inv.amount;
  }
  const recorded = sections.reduce((a, s) => a + s.recorded, 0);
  const eac = sections.reduce((a, s) => a + s.eac, 0);
  const deliveredPct = deliveredQty != null && boqQty > 0 ? Math.round((deliveredQty / boqQty) * 100) : null;
  const deliveredNoteHe = deliveredQty != null ? "כמות מהחשבונות המאושרים" : eac > 0 ? `החשבונות ללא כמות — לפי הוצאת ${sectionIds.map((id) => sectionShort(id, pkg)).join(", ")} (${num(share(recorded, eac))}%)` : "אין חשבונות";

  // the price the remainder is priced at
  const framework = pkg.contracts.find((c) => sectionIds.includes(c.sectionId) && c.priceAppendices?.length);
  const appendix = framework ? priceAppendixAt(framework, wf.controlDate) : null;
  const coverages = new Set(lines.map((l) => l.coverage));
  let currentUnitPrice: number | null = null;
  let currentPriceKind: MaterialIndexRow["currentPriceKind"] = "none";
  let currentPriceBasisHe = "—";
  const budgetUnitPrice = averageUnitPrice(lines);
  if (appendix && (appendix.unit ?? "טון") === def.unit) {
    currentUnitPrice = appendix.pricePerTon;
    currentPriceKind = "appendix";
    currentPriceBasisHe = `${appendix.titleHe.split(" — ")[0]} (מ-${appendix.validFrom.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".")})`;
  } else if (coverages.size === 1 && coverages.has("covered") && budgetUnitPrice != null) {
    currentUnitPrice = budgetUnitPrice;
    currentPriceKind = "contract";
    currentPriceBasisHe = `חוזה חתום${lines[0].coveredByContractId ? ` ${lines[0].coveredByContractId}` : ""}`;
  } else if (coverages.size === 1 && !coverages.has("covered") && budgetUnitPrice != null) {
    currentUnitPrice = budgetUnitPrice;
    currentPriceKind = "estimate";
    currentPriceBasisHe = "אומדן — טרם נחתם חוזה";
  } else if (budgetUnitPrice != null) {
    currentUnitPrice = budgetUnitPrice;
    currentPriceKind = "mixed";
    currentPriceBasisHe = "חלק בחוזה, חלק ללא כיסוי";
  }

  // cost per m²: the owning sections' EAC when the lines are all those sections carry, else the BOQ value
  const ownSectionsLines = pkg.boq.filter((l) => sectionIds.includes(l.sectionId));
  const isWholeSection = ownSectionsLines.length === lines.length && sections.length > 0;
  const costPerSqm = isWholeSection ? perSqm(eac, sqm) : boqValue != null ? perSqm(boqValue, sqm) : null;
  const costBasisHe = isWholeSection ? `תחזית לגמר של ${sectionIds.map((id) => sectionShort(id, pkg)).join(", ")}` : boqValue != null ? "ערך השורות בכתב הכמויות" : "לא מתומחר";

  const paidUnitPrice = deliveredQty && deliveredAmount ? Math.round(deliveredAmount / deliveredQty) : null;
  const remainingQty = deliveredQty != null ? Math.max(0, boqQty - deliveredQty) : null;
  const step = pkg.project.riskPolicy.priceStep;
  const sensitivityHe = currentPriceKind === "appendix" && remainingQty ? `כל ${num(step)} ₪/${def.unit} על ${num(Math.round(remainingQty))} ${def.unit} שנותרו = ${nis(Math.round(remainingQty * step))}` : null;

  return {
    id: def.id,
    labelHe: def.labelHe,
    chapter: def.chapter,
    chapterNameHe: chapterNameHe(def.chapter),
    unit: def.unit,
    sectionIds,
    boqQty,
    boqValue,
    perSqm: value,
    perSqmUnitHe: def.perSqmUnitHe,
    digits: def.digits,
    range,
    rangeStatus: rangeStatus(value, range),
    deliveredQty: deliveredQty != null ? Math.round(deliveredQty * 100) / 100 : null,
    deliveredPct,
    deliveredNoteHe,
    budgetUnitPrice,
    paidUnitPrice,
    currentUnitPrice,
    currentPriceBasisHe,
    currentPriceKind,
    costPerSqm,
    costBasisHe,
    sensitivityHe,
  };
}

function derivedRows(pkg: HadarimPackage, materials: MaterialIndexRow[]): DerivedIndexRow[] {
  const out: DerivedIndexRow[] = [];
  const steel = materials.find((m) => m.id === "steel");
  const concrete = materials.find((m) => m.id === "concrete");
  if (steel && concrete && concrete.boqQty > 0) {
    const steelDef = MATERIAL_INDICES.find((d) => d.id === "steel")!;
    const value = (steel.boqQty * steelDef.perSqmFactor) / concrete.boqQty;
    const range = pkg.project.kpiPolicy.ranges.steel_per_concrete ?? null;
    out.push({ id: "steel_per_concrete", labelHe: "יחס ברזל לבטון", value, unitHe: "ק״ג/מ״ק", digits: 0, range, rangeStatus: rangeStatus(value, range), noteHe: "כמות הברזל בכתב הכמויות חלקי נפח הבטון — מדד לצפיפות הזיון" });
  }
  return out;
}

function structureProgress(pkg: HadarimPackage): ReportKpis["structureProgress"] {
  const b = pkg.project.buildings;
  if (!b.length) return null;
  const planned = b.reduce((a, x) => a + x.floors, 0);
  const cast = b.reduce((a, x) => a + x.floorsCast, 0);
  if (!planned) return null;
  return { labelHe: `${b.map((x) => `${x.id}: ${num(x.floorsCast)}/${num(x.floors)}`).join(" · ")} — ${num(cast)} מתוך ${num(planned)} קומות יצוקות`, pct: Math.round((cast / planned) * 100) };
}

export function buildKpis(pkg: HadarimPackage, erp: ErpState, wf: WorkingForecast, eacSeries: { labelHe: string; value: number }[]): ReportKpis {
  const sqm = pkg.project.grossSqm;
  const units = pkg.project.units;
  const groups = groupRows(pkg, wf, sqm, units);
  const materials = MATERIAL_INDICES.map((d) => materialRow(pkg, erp, wf, d, sqm)).filter((r): r is MaterialIndexRow => !!r);
  const totalRange = pkg.project.kpiPolicy.ranges.cost_per_sqm ?? null;
  const eacPerSqm = perSqm(wf.totalEac, sqm);
  const notesHe = [
    sqm > 0 ? `המכנה: ${num(sqm)} מ״ר ברוטו ו-${num(units)} יח״ד לפי נתוני הפרויקט; כל המדדים לפני מע״מ.` : "שטח ברוטו לא הוגדר לפרויקט — מדדי ₪/מ״ר אינם מחושבים.",
    "קבוצת העלות נגזרת מפרק המפרט הבינמשרדי הראשי של כל סעיף; הנהלה ובלתי צפוי בקבוצות משלהן. כל סעיף נספר פעם אחת.",
    "מדדי הכמות נקראים מכתב הכמויות (פרק ויחידה); ״בוצע״ מוצג מכמויות בחשבונות מאושרים בלבד, אחרת נכתב על מה הוא נשען. מחיר עדכני = נספח בתוקף / חוזה חתום / אומדן — ומסומן בהתאם.",
    "טווח הייחוס הוא הגדרת הפרויקט (מדיניות המדדים); מדד מחוץ לטווח הוא שאלה לבדיקה, לא ממצא.",
  ];
  return {
    grossSqm: sqm,
    units,
    denominatorHe: `${num(sqm)} מ״ר ברוטו · ${num(units)} יח״ד`,
    total: {
      budgetPerSqm: perSqm(wf.totalBudget, sqm),
      eacPerSqm,
      recordedPerSqm: perSqm(wf.totalRecorded, sqm),
      budgetPerUnit: perUnit(wf.totalBudget, units),
      eacPerUnit: perUnit(wf.totalEac, units),
      recordedPerUnit: perUnit(wf.totalRecorded, units),
      range: totalRange,
      rangeStatus: rangeStatus(sqm > 0 ? eacPerSqm : null, totalRange),
    },
    groups,
    materials,
    derived: derivedRows(pkg, materials),
    sections: wf.sections.map((s) => ({ sectionId: s.sectionId, budgetPerSqm: perSqm(s.budget, sqm), eacPerSqm: perSqm(s.eac, sqm), recordedPerSqm: perSqm(s.recorded, sqm), budgetPerUnit: perUnit(s.budget, units), eacPerUnit: perUnit(s.eac, units) })),
    eacPerSqmSeries: eacSeries.map((p) => ({ labelHe: p.labelHe, value: perSqm(p.value, sqm) })),
    structureProgress: structureProgress(pkg),
    notesHe,
  };
}

/** A sections-table row restated per m² or per unit (whole shekels); percentages and flags are kept. */
export function scaleMoney<T extends object>(row: T, divisor: number, keys: (keyof T)[]): T {
  if (divisor <= 0) return row;
  const out: T = { ...row };
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") (out as unknown as Record<string, unknown>)[k as string] = Math.round(v / divisor);
  }
  return out;
}
