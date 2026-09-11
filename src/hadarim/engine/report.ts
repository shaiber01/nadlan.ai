import { priceAppendixAt } from "../data/generate";
import { chapterLabelHe } from "../data/bluebook";
import { RECORD_TYPE_HE, type BuildingTag, type HForecastLine, type HadarimPackage, type SectionId } from "../data/types";
import { boqPageFor, documentById, findingIds, findingReported, isContingency, quoteFacts, revisionRemovalDocFor, runChecks, sectionShort, type HFinding } from "./checks";
import { allIssues } from "./commands";
import { uncoveredAt, uncoveredByBasis, workingForecast, type UncoveredBreakdown, type WorkingForecast, type WorkingSection } from "./forecast";
import { isUnprocessed, reportBlockers } from "./heartbeat";
import { CHANGE_TYPE_HE, type ControlNote, type V2State } from "./model";
import { CHANNEL_HE } from "./operations";

/**
 * Builds the control report model per `budgetcontrolreportstandard.md` (sections 0–11 and the CEO page)
 * from the live state: the working forecast, the control's decisions, adjustments, corrections, tasks and
 * the controller's notes (risks, events, decisions needed, assumptions). Every number is derived; the
 * UI and the exporters only render this model. Nothing here is specific to one project.
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const mil = (v: number) => `${(v / 1_000_000).toFixed(2)} מ׳`;
const num = (v: number) => v.toLocaleString("he-IL");
const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`;
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");
const monthHe = (ym: string) => (ym.length >= 7 ? `${ym.slice(5, 7)}/${ym.slice(0, 4)}` : ym);
const signed = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);
const label = (id: SectionId) => `${id}-${sectionShort(id)}`;
const isolate = (s: string) => `⁨${s}⁩`;

/** A clickable origin for a number: a document page (with an anchor), an ERP record, or an ERP screen. */
export interface ReportSource {
  labelHe: string;
  documentId?: string;
  anchor?: string;
  recordRef?: { type: "invoice" | "po" | "contract"; id: string };
  erp?: { screen: "invoices" | "purchase_orders" | "contracts" | "boq" | "budget" | "change_log"; sectionId?: SectionId; contractId?: string; invoiceId?: number; poId?: number; boqLineId?: string };
}

export interface ReportHeader {
  /** The agent's review pass over the control's data, or null when it has not been done. */
  reviewPassHe: string | null;
  projectNameHe: string;
  projectHe: string;
  companyHe: string;
  cutoffHe: string;
  controlLabelHe: string;
  previousControlHe: string;
  budgetVersionHe: string;
  boqVersionHe: string;
  preparedByHe: string;
  approvedByHe: string;
  distributionHe: string;
  sourcesHe: string;
}

export interface KeyRow {
  labelHe: string;
  valueHe: string;
  pctHe: string;
}

/** Secondary view: the sections grouped by their primary chapter of the Interministerial Specification. */
export interface ChapterRow {
  chapter: string;
  labelHe: string;
  sectionsHe: string;
  budget: number;
  changes: number;
  updatedBudget: number;
  recorded: number;
  committed: number;
  remainingCommitment: number;
  uncovered: number;
  eac: number;
  variance: number;
  variancePct: number;
  basisPct: number;
  boqLines: number;
  boqUncoveredLines: number;
}

export interface SectionRow {
  sectionId: SectionId;
  nameHe: string;
  /** Blue Book chapter codes the section covers (primary first), for display. */
  chaptersHe?: string;
  budget: number;
  changes: number;
  updatedBudget: number;
  recorded: number;
  committed: number;
  remainingCommitment: number;
  uncovered: number;
  eac: number;
  variance: number;
  variancePct: number;
  previousEac: number;
  change: number;
  basisPct: number;
  highlighted: boolean;
  isContingency: boolean;
}

export interface BuildingRow {
  /** A building id, the parking bucket or the shared bucket. */
  building: string;
  labelHe: string;
  budget: number;
  recorded: number;
  committed: number;
  remainingCommitment: number;
  uncovered: number;
  eac: number;
  variance: number;
  variancePct: number;
  basisPct: number;
}

export interface ChangeRow {
  sectionHe: string;
  typeHe: string;
  descriptionHe: string;
  basisHe: string;
  amount: number;
  documentId?: string;
}

export interface CorrectionRow {
  recordHe: string;
  whatHe: string;
  beforeHe: string;
  afterHe: string;
  approvedByHe: string;
  crossSectionHe: string;
  statusHe: string;
}

export interface IssueRow {
  id: string;
  titleHe: string;
  sectionHe: string;
  ownerHe: string;
  dueHe: string;
  openedHe: string;
  statusHe: string;
  impactHe: string;
  stale: boolean;
  closedHe?: string;
}

export interface RiskRow {
  topicHe: string;
  sectionHe: string;
  descriptionHe: string;
  exposureHe: string;
  likelihoodHe: string;
  triggerHe: string;
  ownerHe: string;
}

export interface MaterialSection {
  sectionId: SectionId;
  titleHe: string;
  reasonHe: string;
  paragraphsHe: string[];
  table: string[][];
  recommendationHe: string;
  sources: ReportSource[];
}

export interface UncoveredRow {
  descriptionHe: string;
  sectionHe: string;
  basisHe: string;
  amount: number;
  source?: ReportSource;
}

export interface ReportModel {
  header: ReportHeader;
  executive: { paragraphHe: string; keyTable: KeyRow[]; bulletsHe: string[]; decisionsHe: string[] };
  status: { stageHe: string; physicalPct: number | null; expensePct: number; commitmentPct: number; scheduleHe: string; eventsHe: string[] };
  sections: { rows: SectionRow[]; totals: SectionRow; materialityHe: string; byChapter: ChapterRow[] | null; byBuilding: BuildingRow[] | null; byBuildingNoteHe: string | null; byBuildingChangeable: { invoiceId: number; labelHe: string; building: BuildingTag | null }[]; byBuildingOptions: { id: string; labelHe: string; kind: "building" | "shared" }[] };
  changes: { forecast: ChangeRow[]; forecastTotal: number; corrections: CorrectionRow[] };
  material: MaterialSection[];
  contingency: { original: number; used: number; remaining: number; pendingChangeOrdersHe: string; claimsHe: string; decisionHe: string };
  risks: RiskRow[];
  issues: { open: IssueRow[]; closed: IssueRow[] };
  /**
   * Findings nobody has decided on: those of the session still open, plus what a fresh run of the checks on
   * the current data raises beyond the session (the control not run, or data changed since). The report
   * says so rather than hiding them, with the recommended fix and the people involved.
   */
  openFindings: { id: string; kind: string; titleHe: string; sectionHe: string; questionHe: string; fixHe: string; peopleHe: string; statusHe: string }[];
  /** Questions put to people and not yet answered. */
  openQuestions: { id: string; toHe: string; channelHe: string; textHe: string; askedHe: string; findingId: string | null }[];
  verified: { titleHe: string; textHe: string }[];
  trends: { eacSeries: { labelHe: string; value: number }[]; uncoveredSeries: { labelHe: string; value: number }[]; uncoveredNow: number; uncoveredCommentaryHe: string; commentaryHe: string; comparison: string[][] | null };
  appendices: { definitionsHe: string[]; assumptionsHe: string[]; sourcesHe: string[]; correctionLog: CorrectionRow[]; inReview: { count: number; amount: number }; afterCutoffHe: string[]; uncovered: UncoveredRow[]; uncoveredTotal: number; allocations: UncoveredRow[]; allocationTotal: number };
  ceo: { paragraphHe: string; keyTable: KeyRow[]; changes: ChangeRow[]; issues: IssueRow[]; riskLineHe: string };
  working: WorkingForecast;
  finalized: boolean;
}

const BASIS_HE: Record<string, string> = { invoice: "חשבון מאושר", contract: "חוזה חתום", po: "הזמנה מאושרת", quote: "הצעת מחיר", appendix: "נספח מחיר", estimate: "אומדן פנימי", allocation: "הקצאה תקציבית פנימית" };

/** Standard §5 with the project's thresholds: a change since the previous control, or a variance over the materiality threshold. */
function isMaterial(pkg: HadarimPackage, s: WorkingSection): boolean {
  const m = pkg.project.materiality;
  const abs = Math.abs(s.variance);
  return s.change !== 0 || abs >= m.absoluteAlways || (abs >= m.absolute && abs >= (s.budget * m.pctOfSection) / 100);
}

function personName(pkg: HadarimPackage, id: string | undefined | null): string {
  return pkg.people.find((p) => p.id === id)?.nameHe ?? id ?? "—";
}

/** The person accountable for execution matters (VP execution if there is one, else the project manager). */
function executionOwner(pkg: HadarimPackage, state: V2State): string {
  return pkg.people.find((p) => p.roleHe.includes("ביצוע"))?.nameHe ?? personName(pkg, state.operatorId);
}

// ---------------------------------------------------------------------------
// Optional secondary split by building (standard §3: same columns; estimates declared as such)
// ---------------------------------------------------------------------------

/** What an invoice can be tagged with: the project's buildings, or its shared bucket. */
export function buildingOptions(pkg: HadarimPackage): { id: string; labelHe: string; kind: "building" | "shared" }[] {
  const shared = pkg.project.buckets.shared;
  return [...pkg.project.buildings.map((b) => ({ id: b.id, labelHe: `בניין ${b.id}`, kind: "building" as const })), { id: shared.id, labelHe: shared.labelHe, kind: "shared" as const }];
}

/** Split `x` among the buildings by `shares` (which sum to 1), whole shekels, the last building taking the rounding. */
function splitAmong(x: number, shares: number[]): number[] {
  const parts = shares.map((sh) => Math.round(x * sh));
  parts[parts.length - 1] = x - parts.slice(0, -1).reduce((a, v) => a + v, 0);
  return parts;
}

/** How a section's budget and commitments are apportioned to the buildings: by floors cast, by units, or equally per building. */
function buildingShares(pkg: HadarimPackage, split: "by_floors" | "by_units" | "per_building"): number[] {
  const b = pkg.project.buildings;
  if (!b.length) return [];
  const weights = split === "by_floors" ? b.map((x) => x.floorsCast) : split === "by_units" ? b.map((x) => x.floors * x.unitsPerFloor) : b.map(() => 1);
  const total = weights.reduce((a, w) => a + w, 0);
  return total > 0 ? weights.map((w) => w / total) : b.map(() => 1 / b.length);
}

/**
 * The sections by Blue Book chapter. Money is counted once, under each section's primary chapter; a chapter a
 * section covers as secondary, or that only BOQ lines carry, still gets a row (no budget, its BOQ lines) so the
 * bill of quantities can be read by chapter. Sections with no chapter (reserve, overhead) close the table.
 */
function chapterSplit(pkg: HadarimPackage, wf: WorkingForecast): ChapterRow[] {
  const groups = new Map<string, WorkingSection[]>();
  const secondary = new Map<string, string[]>();
  for (const s of wf.sections) {
    const chapters = pkg.sections.find((x) => x.id === s.sectionId)?.chapters ?? [];
    const primary = chapters[0] ?? "";
    groups.set(primary, [...(groups.get(primary) ?? []), s]);
    for (const c of chapters.slice(1)) secondary.set(c, [...(secondary.get(c) ?? []), s.sectionId]);
  }
  const codes = [...new Set([...groups.keys(), ...secondary.keys(), ...pkg.boq.map((l) => l.chapter)])].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  return codes.map((code) => {
    const secs = groups.get(code) ?? [];
    const alsoHe = (secondary.get(code) ?? []).map((id) => `${sectionShort(id as SectionId, pkg)} (משני)`);
    const sum = (f: (s: WorkingSection) => number) => secs.reduce((a, s) => a + f(s), 0);
    const updatedBudget = sum((s) => s.budget);
    const eac = sum((s) => s.eac);
    const recorded = sum((s) => s.recorded);
    const remainingCommitment = sum((s) => s.remainingCommitment);
    const boq = code ? pkg.boq.filter((l) => l.chapter === code) : [];
    return {
      chapter: code || "—",
      labelHe: code ? chapterLabelHe(code) : "ללא פרק (רזרבה, הנהלה)",
      sectionsHe: [...secs.map((s) => sectionShort(s.sectionId, pkg)), ...alsoHe].join(", ") || "—",
      budget: sum((s) => s.originalBudget),
      changes: sum((s) => s.budgetChanges),
      updatedBudget,
      recorded,
      committed: sum((s) => s.committed),
      remainingCommitment,
      uncovered: sum((s) => s.uncovered),
      eac,
      variance: eac - updatedBudget,
      variancePct: updatedBudget ? ((eac - updatedBudget) / updatedBudget) * 100 : 0,
      basisPct: eac > 0 ? Math.round(((recorded + remainingCommitment) / eac) * 100) : 100,
      boqLines: boq.length,
      boqUncoveredLines: boq.filter((l) => l.coverage !== "covered").length,
    };
  });
}

function buildingSplit(pkg: HadarimPackage, wf: WorkingForecast, state: V2State): { rows: BuildingRow[]; noteHe: string; changeable: ReportModel["sections"]["byBuildingChangeable"] } {
  const buildings = pkg.project.buildings.map((b) => b.id);
  const { shared, parking } = pkg.project.buckets;
  const SHARED_BUILDING = shared.id;
  const PARKING_BUCKET = parking.id;
  const hasParking = pkg.sections.some((s) => s.split === "parking");
  const keys = [...buildings, ...(hasParking ? [PARKING_BUCKET] : []), SHARED_BUILDING];
  const labelOf = (key: string) => (key === shared.id ? shared.labelHe : key === parking.id ? parking.labelHe : `בניין ${key}`);
  const blank = (building: string): BuildingRow => ({ building, labelHe: labelOf(building), budget: 0, recorded: 0, committed: 0, remainingCommitment: 0, uncovered: 0, eac: 0, variance: 0, variancePct: 0, basisPct: 0 });
  const rows: Record<string, BuildingRow> = Object.fromEntries(keys.map((k) => [k, blank(k)]));
  const add = (key: string, part: Partial<Pick<BuildingRow, "budget" | "recorded" | "committed" | "remainingCommitment" | "uncovered">>) => {
    const r = rows[key];
    r.budget += part.budget ?? 0;
    r.recorded += part.recorded ?? 0;
    r.committed += part.committed ?? 0;
    r.remainingCommitment += part.remainingCommitment ?? 0;
    r.uncovered += part.uncovered ?? 0;
  };
  const untagged: string[] = [];
  const unknownTags: string[] = [];
  for (const s of wf.sections) {
    const section = pkg.sections.find((x) => x.id === s.sectionId)!;
    const invoices = state.erp.invoices.filter((i) => i.sectionId === s.sectionId && i.status !== "בבדיקה" && i.dateReceived < wf.controlDate);
    // recorded amounts follow the invoices' own building tags; an unknown tag counts as shared
    const byTag: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const inv of invoices) {
      const tag = inv.building && buildings.includes(inv.building) ? inv.building : SHARED_BUILDING;
      if (inv.building && !buildings.includes(inv.building) && inv.building !== SHARED_BUILDING) unknownTags.push(`חשבון ${inv.id} (${inv.building})`);
      byTag[tag] += inv.amount;
    }
    const recordedInBuildings = buildings.reduce((a, b) => a + byTag[b], 0);
    for (const b of buildings) add(b, { recorded: byTag[b] });
    if (section.split === "shared" || section.split === "parking") {
      const home = section.split === "parking" ? PARKING_BUCKET : SHARED_BUILDING;
      add(home, { budget: s.budget, recorded: s.recorded - recordedInBuildings, committed: s.committed, remainingCommitment: s.remainingCommitment, uncovered: s.uncovered });
      continue;
    }
    for (const inv of invoices) if (!inv.building) untagged.push(`חשבון ${inv.id}`);
    const shares = buildingShares(pkg, section.split);
    const budget = splitAmong(s.budget, shares);
    const committed = splitAmong(s.committed, shares);
    const remaining = splitAmong(s.remainingCommitment, shares);
    const uncovered = splitAmong(s.uncovered, shares);
    buildings.forEach((b, i) => add(b, { budget: budget[i], committed: committed[i], remainingCommitment: remaining[i], uncovered: uncovered[i] }));
    add(SHARED_BUILDING, { recorded: byTag[SHARED_BUILDING] });
  }
  for (const r of Object.values(rows)) {
    r.eac = r.recorded + r.remainingCommitment + r.uncovered;
    r.variance = r.eac - r.budget;
    r.variancePct = r.budget ? (r.variance / r.budget) * 100 : 0;
    r.basisPct = r.eac ? Math.round(((r.recorded + r.remainingCommitment) / r.eac) * 100) : 100;
  }
  const changeable: ReportModel["sections"]["byBuildingChangeable"] = [];
  for (const c of state.control.corrections.filter((x) => x.recordType === "invoice")) {
    const inv = state.erp.invoices.find((i) => String(i.id) === c.recordId);
    if (!inv) continue;
    if (!inv.building) untagged.push(`חשבון ${inv.id}`);
    changeable.push({ invoiceId: inv.id, labelHe: `חשבון ${inv.id}`, building: inv.building });
  }
  const sharedEstimates = state.control.adjustments.filter((a) => pkg.sections.find((s) => s.id === a.sectionId)?.split === "shared");
  const tagged = changeable.filter((c) => c.building && c.building !== SHARED_BUILDING);
  const noteHe = [
    untagged.length ? `${[...new Set(untagged)].join(", ")} אינו מפולח לפי בניין במקור — שויך ל״${shared.labelHe}״.` : "",
    unknownTags.length ? `${[...new Set(unknownTags)].join(", ")} מתויג בבניין שאינו בפרויקט — נספר כ״${shared.labelHe}״.` : "",
    tagged.length ? tagged.map((t) => `${t.labelHe} שויך לבניין ${t.building} לפי החלטת מנהל הפרויקט (נרשם ביומן השינויים).`).join(" ") : "",
    sharedEstimates.length ? `${sharedEstimates.map((a) => a.descriptionHe.split(" — ")[0]).join(", ")} נכנס תחת ״${shared.labelHe}״.` : "",
    `הפילוח הפנימי של סעיפים לפי קומות שיוצקו, יח״ד או שווה בין ${num(buildings.length)} הבניינים הוא הערכה ומסומן ככזה; תחזית קודמת ושינוי אינם מפולחים.`,
  ]
    .filter(Boolean)
    .join(" ");
  return { rows: Object.values(rows), noteHe, changeable };
}

// ---------------------------------------------------------------------------
// Material sections (standard §5): threshold crossed, >10 % of budget, or basis < 70 %
// ---------------------------------------------------------------------------

function sourceForLine(pkg: HadarimPackage, l: HForecastLine, state: V2State): ReportSource | undefined {
  const adjustment = state.control.adjustments.find((a) => a.id === l.id || a.replacesLineId === l.id);
  if (adjustment?.documentId) return { labelHe: adjustment.sourceRef.split(" — ")[0], documentId: adjustment.documentId, anchor: adjustment.basis === "appendix" ? "price" : "line" };
  if (l.basis === "appendix") {
    const contract = pkg.contracts.find((c) => c.sectionId === l.sectionId && c.priceAppendices?.length);
    const appendix = contract ? priceAppendixAt(contract, state.control.controlDate) : null;
    if (appendix) return { labelHe: appendix.titleHe, documentId: appendix.documentId, anchor: "price" };
  }
  if (l.basis === "po") return { labelHe: l.sourceRef ?? "הזמנה", erp: { screen: "purchase_orders", sectionId: l.sectionId } };
  return { labelHe: l.sourceRef ?? "תקציב", erp: { screen: "budget", sectionId: l.sectionId } };
}

function materialSections(pkg: HadarimPackage, wf: WorkingForecast, state: V2State): MaterialSection[] {
  const out: MaterialSection[] = [];
  for (const s of wf.sections) {
    if (isContingency(s.sectionId)) continue;
    const reasons = [
      isMaterial(pkg, s) ? (s.change !== 0 ? "שינוי מהבקרה הקודמת" : "סטייה מעל סף המהותיות") : "",
      s.budget > (wf.totalBudget * pkg.project.materiality.budgetSharePct) / 100 ? `מעל ${pkg.project.materiality.budgetSharePct}% מהתקציב` : "",
      s.basisPct < pkg.project.materiality.softBasisPct ? `בסיס ${num(s.basisPct)}% — מתחת ל-${pkg.project.materiality.softBasisPct}% התחייבות` : "",
      state.control.corrections.some((c) => c.crossSectionHe.includes(`${s.sectionId}-`) && c.afterHe.startsWith(s.sectionId)) ? "תיקון נתונים בתקופה" : "",
    ].filter(Boolean);
    if (!reasons.length) continue;
    const reasonHe = reasons.join(" · ");
    const frameworkContract = pkg.contracts.find((c) => c.sectionId === s.sectionId && c.priceAppendices?.length);
    const excludedLines = pkg.boq.filter((l) => l.sectionId === s.sectionId && (l.coverage === "excluded" || revisionRemovalDocFor(pkg, l.id)));
    const coverageAdjustments = state.control.adjustments.filter((a) => a.sectionId === s.sectionId && a.changeType === "coverage_gap");
    if (frameworkContract) out.push(frameworkPriceSection(pkg, wf, state, s, reasonHe, frameworkContract));
    else if (excludedLines.length || coverageAdjustments.length) out.push(coverageSection(pkg, state, s, reasonHe));
    else out.push(genericSection(pkg, wf, state, s, reasonHe));
  }
  return out;
}

/** A section supplied under a framework agreement with price appendices (quantity × unit price). */
function frameworkPriceSection(pkg: HadarimPackage, wf: WorkingForecast, state: V2State, s: WorkingSection, reasonHe: string, contract: NonNullable<ReturnType<typeof pkg.contracts.find>>): MaterialSection {
  const supplier = pkg.suppliers.find((x) => x.id === contract.supplierId);
  const appendices = [...(contract.priceAppendices ?? [])].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const current = priceAppendixAt(contract, state.control.controlDate) ?? appendices[appendices.length - 1];
  const unit = current?.unit ?? "טון";
  const invoices = state.erp.invoices.filter((i) => i.sectionId === s.sectionId && i.status !== "בבדיקה" && i.dateReceived < wf.controlDate);
  const deliveredQty = invoices.reduce((a, i) => a + (i.unit === unit && i.quantity ? i.quantity : 0), 0) || (appendices[0] ? s.recorded / appendices[0].pricePerTon : 0);
  const boqQty = pkg.boq.filter((l) => l.sectionId === s.sectionId && l.unit === unit).reduce((a, l) => a + l.qty, 0);
  const uncoveredLines = s.lines.filter((l) => l.kind === "uncovered" && l.amount > 0);
  const poLines = s.lines.filter((l) => l.kind === "remaining_commitment" && l.basis === "po");
  const remainderQty = [...uncoveredLines, ...poLines].reduce((a, l) => a + (l.qty ?? 0), 0);
  const orderedQty = poLines.reduce((a, l) => a + (l.qty ?? 0), 0);
  const exposedQty = uncoveredLines.reduce((a, l) => a + (l.qty ?? 0), 0);
  const remainderPrice = uncoveredLines[0]?.unitPrice ?? current?.pricePerTon ?? 0;
  const budgetUnitPrice = boqQty ? Math.round(s.budget / boqQty) : null;
  const openPos = state.erp.purchaseOrders.filter((p) => p.contractId === contract.id && p.status === "פתוחה");
  return {
    sectionId: s.sectionId,
    titleHe: `${s.sectionId} — ${pkg.sections.find((x) => x.id === s.sectionId)!.nameHe}`,
    reasonHe,
    paragraphsHe: [
      `הסכם מסגרת ${isolate(contract.id)} עם ${supplier?.nameHe}; מחיר לפי נספח. סופקו ${num(Math.round(deliveredQty))} ${unit}${boqQty ? ` מתוך ${num(boqQty)} ${unit} בכתב הכמויות (${num(Math.round((deliveredQty / boqQty) * 100))}%)` : ""}.`,
      `יתרה: ${num(remainderQty)} ${unit}${orderedQty ? `, מהם ${num(orderedQty)} ${unit} בהזמנות מאושרות (${poLines.map((l) => l.sourceRef).join(", ")})` : ""}${exposedQty ? ` ו-${num(exposedQty)} ${unit} ללא הזמנה` : ""}.`,
      `מחירי יחידה: ${budgetUnitPrice ? `תקציב ${num(budgetUnitPrice)} ₪/${unit} · ` : ""}${appendices.map((a) => `${a.titleHe} (מ-${dateHe(a.validFrom)}) ${num(a.pricePerTon)} ₪/${unit}`).join(" · ")}.`,
      `מה יכול עוד להשתנות: עדכון נספח נוסף (ההסכם מתעדכן בנספחי מחיר בכתב); כמויות בפועל מול כתב הכמויות.`,
    ],
    table: [
      ["רכיב", "נתון"],
      ["תקציב", nis(s.budget)],
      ["עלות שנרשמה", `${nis(s.recorded)} (${num(Math.round(deliveredQty))} ${unit})`],
      ["יתרה צפויה", `${num(remainderQty)} ${unit}`],
      ["מהם בהזמנה מאושרת", orderedQty ? `${num(orderedQty)} ${unit} — ${nis(poLines.reduce((a, l) => a + l.amount, 0))}` : "—"],
      ...(budgetUnitPrice ? [["מחיר יח׳ — תקציב", `${num(budgetUnitPrice)} ₪/${unit}`]] : []),
      ["מחיר יח׳ — נספח בתוקף", current ? `${num(current.pricePerTon)} ₪/${unit}` : "—"],
      ["יתרה לא מכוסה", `${nis(s.uncovered)}${uncoveredLines[0] ? ` (${BASIS_HE[uncoveredLines[0].basis]})` : ""}`],
      ["תחזית לגמר", nis(s.eac)],
      ["סטייה", signed(s.variance)],
      ["בסיס", `${num(s.basisPct)}%`],
    ],
    recommendationHe: exposedQty > 0 ? `לשקול הזמנה מרוכזת ל-${num(exposedQty)} ה${unit} הנותרים (${nis(Math.round(exposedQty * remainderPrice))}) כדי לקבע מחיר.` : "אין פעולה נדרשת.",
    sources: [
      { labelHe: `הסכם מסגרת ${contract.id}`, recordRef: { type: "contract", id: contract.id } },
      ...appendices.map((a) => ({ labelHe: `${a.titleHe} — ${num(a.pricePerTon)} ₪/${unit}`, documentId: a.documentId, anchor: "price" })),
      ...openPos.map((p) => ({ labelHe: `הזמנה ${p.id}`, recordRef: { type: "po" as const, id: String(p.id) } })),
      { labelHe: "חשבונות הסעיף במערכת המידע", erp: { screen: "invoices", sectionId: s.sectionId } },
    ],
  };
}

/** A section with contract exclusions or coverage-gap adjustments: the "three documents" story. */
function coverageSection(pkg: HadarimPackage, state: V2State, s: WorkingSection, reasonHe: string): MaterialSection {
  const contract = pkg.contracts.find((c) => c.sectionId === s.sectionId && c.amount != null);
  const supplier = contract ? pkg.suppliers.find((x) => x.id === contract.supplierId) : undefined;
  const invoices = state.erp.invoices.filter((i) => i.sectionId === s.sectionId && i.status !== "בבדיקה" && (!contract || i.contractId === contract.id));
  const excluded = pkg.boq.filter((l) => l.sectionId === s.sectionId && (l.coverage === "excluded" || revisionRemovalDocFor(pkg, l.id)));
  const adjustments = state.control.adjustments.filter((a) => a.sectionId === s.sectionId && a.changeType === "coverage_gap");
  const quoteValidity = adjustments.map((a) => quoteFacts(documentById(pkg, a.documentId))?.validUntil).find(Boolean);
  const excludedHe = excluded.map((l) => {
    const clause = contract?.exclusions.find((e) => e.clause === l.coverageRef);
    const revisionDoc = revisionRemovalDocFor(pkg, l.id);
    const reasonHe = clause ? ` — מוחרג בסעיף ${clause.clause} לחוזה` : revisionDoc ? ` — הוסר ב${revisionDoc.titleHe}, הרשומה עדיין מסומנת מכוסה בחוזה ${l.coveredByContractId}` : "";
    const estimated = adjustments.find((a) => a.sourceRef.includes(l.id));
    return `${l.descriptionHe.split(",")[0]} (${num(l.qty)} ${l.unit})${reasonHe}; ${estimated ? `הוסף לתחזית כאומדן לפי ${estimated.basisHe} (טרם הוזמן)` : "ללא אומדן"}`;
  });
  return {
    sectionId: s.sectionId,
    titleHe: `${s.sectionId} — ${pkg.sections.find((x) => x.id === s.sectionId)!.nameHe}`,
    reasonHe,
    paragraphsHe: [
      contract ? `חוזה ${contract.id} (${supplier?.nameHe}) ${nis(contract.amount ?? 0)}; נרשמו ${nis(s.recorded)} (${num(invoices.length)} חשבונות חלקיים); יתרת חוזה ${nis(s.remainingCommitment)}.` : `ללא חוזה ראשי; נרשמו ${nis(s.recorded)}.`,
      `כתב הכמויות גרסה ${pkg.project.boqVersion.number}: ${excludedHe.join("; ")}.`,
      "המסמכים נכונים כל אחד בפני עצמו; רק ההצלבה בין כתב הכמויות, החוזה והתחזית חושפת את הפער.",
      `מה יכול עוד להשתנות: ${quoteValidity ? `תוקף ההצעה (${dateHe(quoteValidity)}); ` : ""}אגרות והתחברויות מחוץ לחוזה; כמויות בפועל.`,
    ],
    table: [
      ["רכיב", "נתון"],
      ["תקציב", nis(s.budget)],
      ["עלות שנרשמה", nis(s.recorded)],
      [contract ? `יתרת חוזה ${contract.id}` : "יתרת התחייבות", nis(s.remainingCommitment)],
      ["יתרה לא מכוסה", `${nis(s.uncovered)}${adjustments.length ? " (הצעת מחיר — אומדן)" : ""}`],
      ["תחזית לגמר", nis(s.eac)],
      ["סטייה", signed(s.variance)],
      ["בסיס", `${num(s.basisPct)}%`],
    ],
    recommendationHe: adjustments.length ? `להסדיר הזמנה ל${adjustments.map((a) => a.descriptionHe.split(" — ")[0]).join(", ")}${quoteValidity ? ` לפני פקיעת ההצעה (${dateHe(quoteValidity)})` : ""}.` : "לתמחר את השורות המוחרגות לפני סגירת התחזית.",
    sources: [
      ...(contract ? [{ labelHe: `חוזה ${contract.id}${excluded.find((l) => l.coverage === "excluded")?.coverageRef ? ` — סעיף ${excluded.find((l) => l.coverage === "excluded")!.coverageRef}` : ""}`, documentId: contract.documentId, anchor: "exclusion", recordRef: { type: "contract" as const, id: contract.id } }] : []),
      ...excluded.map((l) => boqPageFor(pkg, l.id)).filter(Boolean).map((d) => ({ labelHe: d!.titleHe, documentId: d!.id, anchor: "line" })),
      ...excluded.map((l) => revisionRemovalDocFor(pkg, l.id)).filter(Boolean).map((d) => ({ labelHe: d!.titleHe, documentId: d!.id, anchor: "removed" })),
      ...excluded.map((l) => ({ labelHe: `שורה ${l.id} בכתב הכמויות במערכת המידע`, erp: { screen: "boq" as const, sectionId: s.sectionId, boqLineId: l.id } })),
      ...adjustments.filter((a) => a.documentId).map((a) => ({ labelHe: a.basisHe.split(",")[0], documentId: a.documentId!, anchor: "line" })),
      ...state.control.corrections.filter((c) => c.recordType === "invoice" && c.afterHe.startsWith(s.sectionId)).map((c) => ({ labelHe: `חשבון ${c.recordId}`, recordRef: { type: "invoice" as const, id: c.recordId } })),
      { labelHe: "חשבונות הסעיף במערכת המידע", erp: { screen: "invoices", sectionId: s.sectionId } },
    ],
  };
}

function genericSection(pkg: HadarimPackage, wf: WorkingForecast, state: V2State, s: WorkingSection, reasonHe: string): MaterialSection {
  const supplierHe = (id: string) => pkg.suppliers.find((x) => x.id === id)?.nameHe ?? id;
  const section = pkg.sections.find((x) => x.id === s.sectionId)!;
  const contracts = pkg.contracts.filter((c) => c.sectionId === s.sectionId);
  const invoices = state.erp.invoices.filter((i) => i.sectionId === s.sectionId && i.status !== "בבדיקה" && i.dateReceived < wf.controlDate);
  const openPos = state.erp.purchaseOrders.filter((p) => p.sectionId === s.sectionId && p.status === "פתוחה");
  const boq = pkg.boq.filter((l) => l.sectionId === s.sectionId);
  const chapters = [...new Set(boq.map((l) => `${l.chapter} ${l.chapterNameHe}`))];
  const count = (c: string) => boq.filter((l) => l.coverage === c).length;
  const uncoveredLines = s.lines.filter((l) => l.kind === "uncovered" && l.amount > 0);
  const bases = [...new Set(uncoveredLines.map((l) => BASIS_HE[l.basis]))].join(", ");
  const allocationOnly = uncoveredLines.length > 0 && uncoveredLines.every((l) => l.basis === "allocation");
  const paragraphs: string[] = [];
  if (contracts.length) {
    paragraphs.push(`${contracts.map((c) => `חוזה ${c.id} — ${supplierHe(c.supplierId)}${c.amount != null ? `, ${nis(c.amount)}` : ""}, נחתם ${dateHe(c.signedAt)}${c.closed ? `; נסגר ${dateHe(c.closed.at)} בחשבון סופי ${nis(c.closed.finalAccount)}` : ""}`).join(" · ")}. נרשמו ${nis(s.recorded)} (${num(invoices.length)} חשבונות)${s.remainingCommitment ? `; יתרת התחייבות ${nis(s.remainingCommitment)}` : ""}.`);
  } else if (openPos.length) {
    paragraphs.push(`${num(openPos.length)} הזמנות פתוחות (${[...new Set(openPos.map((p) => supplierHe(p.supplierId)))].slice(0, 4).join(", ")}${openPos.length > 4 ? " ועוד" : ""}) בסך ${nis(openPos.reduce((a, p) => a + p.amount, 0))}; נרשמו ${nis(s.recorded)} (${num(invoices.length)} חשבונות); יתרת התחייבות ${nis(s.remainingCommitment)}.`);
  } else if (allocationOnly) {
    paragraphs.push(`ללא חוזה או הזמנה — הסעיף מנוהל בהקצאה חודשית לפי התקציב. נרשמו ${nis(s.recorded)} (${num(invoices.length)} הקצאות).`);
  } else {
    paragraphs.push(`טרם נחתם חוזה ולא הוצאו הזמנות; נרשמו ${nis(s.recorded)}.`);
  }
  if (boq.length) {
    paragraphs.push(`כתב הכמויות (גרסה ${pkg.project.boqVersion.number}): ${num(boq.length)} שורות בפרק ${chapters.join(", ")} — ${[count("covered") ? `${num(count("covered"))} מכוסות בחוזה` : "", count("excluded") ? `${num(count("excluded"))} מוחרגות` : "", count("not_contracted") ? `${num(count("not_contracted"))} טרם נחתם להן חוזה` : ""].filter(Boolean).join(", ")}.`);
  }
  paragraphs.push(uncoveredLines.length ? `יתרה להשלמה לא מכוסה: ${nis(s.uncovered)} — בסיס: ${bases}. מחירי יחידה: ${contracts.length ? "לפי החוזה" : "לפי התקציב (טרם נבדקו מול הצעות)"}.` : `כל היתרה מכוסה בהתחייבות (בסיס ${num(s.basisPct)}%).`);
  const monthly = allocationOnly && uncoveredLines[0]?.qty ? Math.round(uncoveredLines[0].amount / uncoveredLines[0].qty) : null;
  paragraphs.push(`מה יכול עוד להשתנות: ${contracts.length ? "פקודות שינוי וכמויות בפועל מול התכנון; החוזה אינו צמוד למדד." : allocationOnly ? `משך הפרויקט — כל חודש נוסף מוסיף ${monthly ? `כ-${nis(monthly)}` : "הקצאה חודשית"}.` : openPos.length ? "משך הפרויקט (הזמנות המסגרת מכסות תקופה מוגדרת)." : "תוצאות המכרז מול האומדן; מועד החתימה."}`);
  return {
    sectionId: s.sectionId,
    titleHe: `${s.sectionId} — ${section.nameHe}`,
    reasonHe,
    paragraphsHe: paragraphs,
    table: [
      ["רכיב", "נתון"],
      ["תקציב", nis(s.budget)],
      ["נרשם", nis(s.recorded)],
      ["התחייבויות", nis(s.committed)],
      ["יתרת התחייבות", nis(s.remainingCommitment)],
      ["יתרה לא מכוסה", `${nis(s.uncovered)}${bases ? ` (${bases})` : ""}`],
      ["תחזית לגמר", nis(s.eac)],
      ["סטייה", signed(s.variance)],
      ["בסיס", `${num(s.basisPct)}%`],
    ],
    recommendationHe: contracts.length && !uncoveredLines.length ? "אין פעולה נדרשת; מעקב אחר שינויים בתכולה." : allocationOnly ? "לעדכן את ההקצאה אם לו״ז הסיום ישתנה." : openPos.length ? "להאריך את הזמנות המסגרת לפי לו״ז הסיום המעודכן." : "להוציא מכרז ולחתום חוזה לפני תחילת העבודות; עד אז היתרה נשארת אומדן.",
    sources: [
      ...contracts.map((c) => ({ labelHe: `חוזה ${c.id}`, recordRef: { type: "contract" as const, id: c.id } })),
      ...(openPos.length ? [{ labelHe: "הזמנות הסעיף", erp: { screen: "purchase_orders" as const, sectionId: s.sectionId } }] : []),
      ...(boq.length ? [{ labelHe: "כתב הכמויות של הסעיף במערכת המידע", erp: { screen: "boq" as const, sectionId: s.sectionId } }] : []),
      { labelHe: invoices.length ? "חשבונות הסעיף במערכת המידע" : "הסעיף במערכת המידע", erp: { screen: invoices.length ? ("invoices" as const) : ("budget" as const), sectionId: s.sectionId } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Risks and events: controller notes plus what the data itself implies
// ---------------------------------------------------------------------------

function noteRisk(pkg: HadarimPackage, n: ControlNote): RiskRow {
  return { topicHe: n.textHe.split(/[.;:]/)[0].slice(0, 60), sectionHe: n.sectionId ? label(n.sectionId) : "—", descriptionHe: n.textHe, exposureHe: n.exposureHe ?? "—", likelihoodHe: n.likelihoodHe ?? "—", triggerHe: n.triggerHe ?? "—", ownerHe: personName(pkg, n.ownerId ?? n.byId) };
}

function derivedRisks(pkg: HadarimPackage, wf: WorkingForecast, state: V2State, openIssues: IssueRow[]): RiskRow[] {
  const out: RiskRow[] = [];
  // estimates that rest on a quote with an expiry date
  for (const a of state.control.adjustments) {
    const facts = quoteFacts(documentById(pkg, a.documentId));
    if (a.basis !== "quote" || !facts?.validUntil) continue;
    const exposure = Math.round((a.amount * pkg.project.riskPolicy.quoteExpiryExposurePct) / 100);
    const task = state.control.tasks.find((t) => t.findingId && t.findingId === a.findingId);
    out.push({ topicHe: `תוקף הצעת המחיר — ${a.descriptionHe.split(" — ")[0]}`, sectionHe: label(a.sectionId), descriptionHe: `האומדן מבוסס על הצעה בתוקף עד ${dateHe(facts.validUntil)}; ללא הזמנה עד אז — תמחור מחדש`, exposureHe: `0 – ${nis(exposure)} (הנחה: עד ${pkg.project.riskPolicy.quoteExpiryExposurePct}% מהאומדן)`, likelihoodHe: "בינונית", triggerHe: `הזמנה עד ${dateHe(facts.validUntil)}`, ownerHe: personName(pkg, task?.ownerId ?? state.operatorId) });
  }
  // remainders priced by an appendix that can move again
  for (const s of wf.sections) {
    const contract = pkg.contracts.find((c) => c.sectionId === s.sectionId && c.priceAppendices?.length);
    if (!contract) continue;
    const exposedQty = s.lines.filter((l) => l.kind === "uncovered" && (l.basis === "appendix" || l.basis === "estimate") && l.qty).reduce((a, l) => a + (l.qty ?? 0), 0);
    if (!exposedQty) continue;
    const unit = priceAppendixAt(contract, state.control.controlDate)?.unit ?? "טון";
    out.push({ topicHe: `עדכון נוסף במחיר ${sectionShort(s.sectionId)}`, sectionHe: label(s.sectionId), descriptionHe: `${num(exposedQty)} ${unit} חשופים לשינוי מחיר (יתרה ללא הזמנה); ההסכם מתעדכן בנספחי מחיר`, exposureHe: `${nis(exposedQty * pkg.project.riskPolicy.priceStep)} לכל ${num(pkg.project.riskPolicy.priceStep)} ₪/${unit}`, likelihoodHe: "בינונית", triggerHe: "נספח מחיר חדש", ownerHe: executionOwner(pkg, state) });
  }
  // issues open for more than two controls with a stated impact
  for (const i of openIssues.filter((x) => x.stale && x.impactHe !== "—")) {
    out.push({ topicHe: i.titleHe, sectionHe: i.sectionHe, descriptionHe: `פתוח מ-${i.openedHe}; ${i.impactHe}`, exposureHe: "לא כומת", likelihoodHe: "בינונית", triggerHe: "סגירת הנושא", ownerHe: i.ownerHe });
  }
  return out;
}

function periodEvents(pkg: HadarimPackage, state: V2State, from: string, to: string): string[] {
  const events: string[] = [];
  for (const c of state.erp.changeLog) {
    const day = c.at.slice(0, 10);
    if (day <= from || day > to || c.recordType === "invoice") continue;
    if (!["סטטוס", "נספחים", "יצירה"].includes(c.field)) continue;
    const what = c.recordType === "contract" ? `חוזה ${c.recordId}` : `הזמנה ${c.recordId}`;
    events.push(`${what}: ${c.field === "סטטוס" ? c.after : `${c.field} — ${c.after}`} (${dateHe(c.at)})`);
  }
  for (const c of pkg.contracts) for (const a of c.priceAppendices ?? []) if (a.validFrom > from && a.validFrom <= to) events.push(`${a.titleHe} (${pkg.suppliers.find((s) => s.id === c.supplierId)?.nameHe}) בתוקף מ-${dateHe(a.validFrom)}`);
  for (const n of state.control.notes.filter((x) => x.kind === "event")) events.push(n.textHe);
  return events;
}

// ---------------------------------------------------------------------------
// Open findings: the report never goes out without saying what the checks found and nobody decided
// ---------------------------------------------------------------------------

function findingRow(f: HFinding, statusHe: string): ReportModel["openFindings"][number] {
  // a control card's first option is the fix in the user's words; a data-quality or composite card names the values
  const fix = f.kind === "allocation" || f.kind === "unit" || f.kind === "price" || f.kind === "coverage" ? f.decision.options[0].labelHe : (f.proposedFix?.labelHe ?? f.decision.options[0].labelHe);
  return { id: f.id, kind: f.kind, titleHe: f.titleHe, sectionHe: label(f.sectionId), questionHe: f.decision.questionHe, fixHe: fix, peopleHe: (f.people ?? []).map((p) => `${p.nameHe} (${p.relationHe})`).join("; ") || "—", statusHe };
}

/** The findings nobody decided on: the session's open ones, then what a fresh run of the checks raises beyond it. Runs the checks once. */
export function openFindingRows(pkg: HadarimPackage, state: V2State): ReportModel["openFindings"] {
  const c = state.control;
  const undecided = c.findings.filter((f) => {
    const d = c.decisions[f.id];
    return !d || d.status === "open" || !!d.pending;
  });
  // a fresh run of the checks on the data as it is now: anything the session does not know about is unreviewed
  const draft = pkg.forecasts.find((f) => f.controlDate === c.controlDate && f.sections);
  const fresh = draft ? runChecks(pkg, state.erp, draft, c.controlDate, state.clock.slice(0, 10)).findings : [];
  const known = findingIds(c.findings);
  const unreviewed = fresh.filter((f) => !findingReported(f, known));
  return [...undecided.map((f) => findingRow(f, c.decisions[f.id]?.pending ? "בהחלטה" : "טרם הוכרע")), ...unreviewed.map((f) => findingRow(f, c.status === "idle" ? "הבקרה טרם רצה" : "חדש מאז הרצת הבקרה"))];
}

// ---------------------------------------------------------------------------
// Readiness: what stands between the current state and a deliverable report, without rendering it
// ---------------------------------------------------------------------------

/** The last recorded heartbeat and the change log's top id, as the tools read them from the database. */
export interface ReadinessContext {
  lastHeartbeat: { id: number; at: string; untilChangeLogId: number } | null;
  latestChangeLogId: number;
  /** finding ids an earlier heartbeat presented (repeated only if their record changes again) */
  previouslyReported?: Iterable<string>;
  today?: string;
}

export interface ReportReadiness {
  /** nothing stands in the way: no pending document, the heartbeat covers the change log, no open finding, the review pass done */
  ready: boolean;
  /** what stands in the way, one Hebrew sentence per item — the same text `build_report` returns */
  attentionHe: string | null;
  openFindings: ReportModel["openFindings"];
  reviewPassDone: boolean;
  pendingDocuments: number;
  heartbeat: { id: number; at: string; changesSince: number } | null;
  latestChangeLogId: number;
  /** what refuses a saved version or a final control (`reportBlockers`) */
  blockersHe: string[];
  canSaveVersion: boolean;
}

/**
 * Whether the report can go out, and what stands in the way: pending documents, changes since the last
 * heartbeat, findings nobody decided on (the session's open ones and what the checks raise beyond it), the
 * review pass. `openFindings` is computed here unless the caller already has it (a report build runs the
 * checks once for both).
 */
export function reportReadiness(pkg: HadarimPackage, state: V2State, ctx: ReadinessContext, openFindings: ReportModel["openFindings"] = openFindingRows(pkg, state)): ReportReadiness {
  const today = ctx.today ?? state.clock.slice(0, 10);
  const blockers = reportBlockers(pkg, state, ctx.lastHeartbeat, ctx.latestChangeLogId, ctx.previouslyReported ?? [], today);
  const pendingDocuments = pkg.documents.filter(isUnprocessed).length;
  const sinceHeartbeat = ctx.lastHeartbeat ? Math.max(0, ctx.latestChangeLogId - ctx.lastHeartbeat.untilChangeLogId) : null;
  const unreviewed = openFindings.filter((f) => f.statusHe !== "טרם הוכרע" && f.statusHe !== "בהחלטה").length;
  const reviewPassDone = state.control.notes.some((n) => n.kind === "review_pass");
  const parts = [
    pendingDocuments ? `${pendingDocuments} מסמכים בתיקייה טרם עובדו — עבד אותם לפני הדוח (/bakara-heartbeat).` : "",
    sinceHeartbeat === null ? (ctx.latestChangeLogId ? "לא נרשמה פעימת לב לפרויקט: הרץ /bakara-heartbeat לפני הדוח." : "") : sinceHeartbeat > 0 ? `${sinceHeartbeat} שינויים במערכת המידע מאז פעימת הלב האחרונה — הרץ /bakara-heartbeat לפני הדוח.` : "",
    openFindings.length ? `${openFindings.length} ממצאים דורשים החלטה לפני שהדוח סופי${unreviewed ? ` (${unreviewed} מהם טרם נבדקו — הבקרה לא רצה על הנתונים הנוכחיים; הרץ run_control)` : ""}: הצג כל אחד עם התיקון המומלץ, ומי מעורב ברשומה אם המשתמש אינו יודע, וקבל אישור.` : "",
    reviewPassDone ? "" : "סקירת הסוכן טרם בוצעה לבקרה זו: get_review_material → raise_finding לכל אי-התאמה → record_review_pass.",
  ].filter(Boolean);
  return {
    ready: parts.length === 0,
    attentionHe: parts.length ? parts.join(" ") : null,
    openFindings,
    reviewPassDone,
    pendingDocuments,
    heartbeat: ctx.lastHeartbeat ? { id: ctx.lastHeartbeat.id, at: ctx.lastHeartbeat.at, changesSince: sinceHeartbeat ?? 0 } : null,
    latestChangeLogId: ctx.latestChangeLogId,
    blockersHe: blockers.map((b) => b.textHe),
    canSaveVersion: blockers.length === 0,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export function buildReport(pkg: HadarimPackage, state: V2State): ReportModel {
  const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
  const config = state.control.reportConfig;
  const controlDate = state.control.controlDate;
  const previous = pkg.forecasts.find((f) => f.controlDate === wf.previousControlDate)!;
  const variance = wf.totalEac - wf.totalBudget;
  const change = wf.totalEac - wf.previousTotalEac;
  const uncovered: UncoveredBreakdown = uncoveredByBasis(wf);
  const contingency = wf.sections.find((s) => isContingency(s.sectionId));
  const contingencyBudget = contingency?.budget ?? 0;
  const contingencyLeft = contingency?.eac ?? 0;
  const physicalPct = pkg.project.physicalProgressPct ?? null;
  const expensePct = (wf.totalRecorded / wf.totalEac) * 100;
  const commitmentPct = ((wf.totalRecorded + wf.totalRemainingCommitment) / wf.totalEac) * 100;
  const notes = state.control.notes;

  const forecastChanges: ChangeRow[] = state.control.adjustments.map((a) => ({ sectionHe: label(a.sectionId), typeHe: CHANGE_TYPE_HE[a.changeType], descriptionHe: a.descriptionHe, basisHe: a.basisHe, amount: a.amount, documentId: a.documentId }));
  const forecastTotal = forecastChanges.reduce((a, c) => a + c.amount, 0);
  const corrections: CorrectionRow[] = state.control.corrections.map((c) => ({ recordHe: `${c.recordType === "invoice" ? "חשבון" : "הזמנה"} ${c.recordId}`, whatHe: c.fieldHe, beforeHe: c.beforeHe, afterHe: c.afterHe, approvedByHe: personName(pkg, c.approvedById), crossSectionHe: c.crossSectionHe, statusHe: c.status === "applied" ? "בוצע במקור" : "ממתין לביצוע" }));

  const rows: SectionRow[] = wf.sections.map((s) => ({
    sectionId: s.sectionId,
    nameHe: pkg.sections.find((x) => x.id === s.sectionId)!.nameHe,
    chaptersHe: (pkg.sections.find((x) => x.id === s.sectionId)?.chapters ?? []).join(", "),
    budget: s.originalBudget,
    changes: s.budgetChanges,
    updatedBudget: s.budget,
    recorded: s.recorded,
    committed: s.committed,
    remainingCommitment: s.remainingCommitment,
    uncovered: s.uncovered,
    eac: s.eac,
    variance: s.variance,
    variancePct: s.budget ? (s.variance / s.budget) * 100 : 0,
    previousEac: s.previousEac,
    change: s.change,
    basisPct: s.basisPct,
    highlighted: !isContingency(s.sectionId) && (isMaterial(pkg, s) || state.control.corrections.some((c) => c.crossSectionHe.includes(`${s.sectionId}-`))),
    isContingency: isContingency(s.sectionId),
  }));
  const totals: SectionRow = { sectionId: "01", nameHe: "סה״כ", budget: wf.totalOriginalBudget, changes: wf.totalBudgetChanges, updatedBudget: wf.totalBudget, recorded: wf.totalRecorded, committed: wf.totalCommitted, remainingCommitment: wf.totalRemainingCommitment, uncovered: wf.totalUncovered, eac: wf.totalEac, variance, variancePct: (variance / wf.totalBudget) * 100, previousEac: wf.previousTotalEac, change, basisPct: Math.round(commitmentPct), highlighted: false, isContingency: false };

  const split = config.splitByBuilding ? buildingSplit(pkg, wf, state) : null;
  const byChapter = config.byChapter ? chapterSplit(pkg, wf) : null;

  const issues = allIssues(state);
  const controlsSince = (opened: string) => [...new Set([...pkg.project.controlDates, controlDate])].filter((d) => d >= opened).length;
  const toRow = (t: (typeof issues)[number]): IssueRow => ({ id: t.id, titleHe: t.titleHe, sectionHe: t.sectionId ? label(t.sectionId) : "—", ownerHe: personName(pkg, t.ownerId), dueHe: t.dueDate ? dateHe(t.dueDate) : "—", openedHe: dateHe(t.openedInControl), statusHe: t.status === "closed" ? "נסגר" : t.status === "pending_execution" ? "ממתין לביצוע" : "פתוח", impactHe: t.impactIfIgnoredHe ?? "—", stale: t.status !== "closed" && controlsSince(t.openedInControl) > 2, closedHe: t.closedAt ? dateHe(t.closedAt) : undefined });
  const openIssues = issues.filter((t) => t.status !== "closed").map(toRow);
  const closedIssues = issues.filter((t) => t.status === "closed").map(toRow);

  const risks: RiskRow[] = [...notes.filter((n) => n.kind === "risk").map((n) => noteRisk(pkg, n)), ...derivedRisks(pkg, wf, state, openIssues)];
  const material = materialSections(pkg, wf, state);
  const events = periodEvents(pkg, state, previous.controlDate, controlDate);

  // trends
  // every final control before this one (the early ones carry totals only), then the working total
  const earlier = pkg.forecasts.filter((f) => f.status === "final" && f.controlDate < controlDate).sort((a, b) => a.controlDate.localeCompare(b.controlDate));
  const eacSeries = [...earlier.map((f) => ({ labelHe: dateHe(f.controlDate), value: f.totalEac })), { labelHe: dateHe(controlDate), value: wf.totalEac }];
  const firstOverrun = eacSeries.filter((p) => p.value > wf.totalBudget).length === 1 && wf.totalEac > wf.totalBudget;
  const priceDriven = state.control.adjustments.some((a) => a.changeType === "price") && !state.control.adjustments.some((a) => a.changeType === "quantity");
  const prevUncovered = uncoveredAt(previous);
  const uncoveredSeries = [
    { labelHe: dateHe(previous.controlDate), value: prevUncovered },
    { labelHe: dateHe(controlDate), value: uncovered.total },
  ];
  const uncoveredDeltas = wf.sections
    .filter((s) => !isContingency(s.sectionId))
    .map((s) => {
      const prevSection = previous.sections!.find((p) => p.sectionId === s.sectionId)!;
      const before = prevSection.lines.filter((l) => l.kind === "uncovered" && l.basis !== "allocation").reduce((a, l) => a + l.amount, 0);
      const after = s.lines.filter((l) => l.kind === "uncovered" && l.basis !== "allocation").reduce((a, l) => a + l.amount, 0);
      return { s, delta: after - before, becameCommitted: before > 0 && after === 0 && s.remainingCommitment > 0 };
    })
    .filter((d) => d.delta !== 0);
  const uncoveredCommentaryHe = `יתרה לא מכוסה: ${nis(prevUncovered)} → ${nis(uncovered.total)} (${signed(uncovered.total - prevUncovered)}). צריכה לרדת מבקרה לבקרה ככל שאומדנים הופכים להזמנות.${uncoveredDeltas.length ? ` הפעם: ${uncoveredDeltas.map((d) => `${label(d.s.sectionId)} ${signed(d.delta)}${d.becameCommitted ? " (נחתם חוזה)" : ""}`).join(" · ")}.` : ""}`;

  const comparison: string[][] | null = config.includeTrends
    ? [
        ["", `בקרה ${dateHe(previous.controlDate)}`, `בקרה ${dateHe(controlDate)}`, "שינוי"],
        ["תחזית כוללת", mil(previous.totalEac), mil(wf.totalEac), `${change >= 0 ? "+" : "−"}${mil(Math.abs(change))}`],
        ...wf.sections
          .filter((s) => s.change !== 0 && !isContingency(s.sectionId))
          .map((s) => [`${sectionShort(s.sectionId)} — תחזית סעיף`, mil(s.previousEac), mil(s.eac), `${s.change >= 0 ? "+" : "−"}${pct((Math.abs(s.change) / s.previousEac) * 100, 0)}`]),
        ...wf.sections
          .filter((s) => state.control.corrections.some((c) => c.recordType === "invoice" && c.afterHe.startsWith(s.sectionId)))
          .map((s) => {
            const prevRecorded = previous.sections!.find((p) => p.sectionId === s.sectionId)!.recorded;
            return [`${sectionShort(s.sectionId)} — נרשם`, mil(prevRecorded), mil(s.recorded), `${s.recorded - prevRecorded >= 0 ? "+" : "−"}${nis(Math.abs(s.recorded - prevRecorded))} (העברה)`];
          }),
        ["יתרה לא מכוסה (אומדנים)", mil(prevUncovered), mil(uncovered.total), `${uncovered.total - prevUncovered >= 0 ? "+" : "−"}${mil(Math.abs(uncovered.total - prevUncovered))}`],
        ["נושאים פתוחים", String(previous.openIssues.length), String(openIssues.length), String(openIssues.length - previous.openIssues.length)],
      ]
    : null;

  // executive summary
  const uncontracted = uncovered.lines.filter((l) => l.basis === "estimate" && !pkg.sections.find((s) => s.id === l.sectionId)?.contractIds.length);
  const uncoveredGroupsHe = [
    uncontracted.length ? `${num(uncontracted.length)} חבילות שטרם נחתמו` : "",
    ...uncovered.lines.filter((l) => l.basis === "appendix").map((l) => `יתרת ${sectionShort(l.sectionId)}`),
    ...uncovered.lines.filter((l) => l.basis === "quote").map((l) => l.descriptionHe.split(" — ")[0]),
    ...uncovered.lines.filter((l) => l.basis === "estimate" && !uncontracted.includes(l)).map((l) => l.descriptionHe.split(" — ")[0]),
  ].filter(Boolean);
  const paragraphHe = `תחזית ההשלמה ${change === 0 ? "נותרה" : "עודכנה"} מ-${mil(wf.previousTotalEac)} ל-${mil(wf.totalEac)} ₪ — ${variance > 0 ? `חריגה צפויה של ${nis(variance)} (${pct((variance / wf.totalBudget) * 100, 2)})` : variance < 0 ? `תחזית נמוכה מהתקציב ב-${nis(-variance)}` : "בתוך התקציב"}.${forecastChanges.length ? ` מקור השינוי: ${forecastChanges.map((c) => `${c.typeHe.replace("שינוי ", "עדכון ")} (${(c.amount / 1000).toFixed(0)} א׳)`).join(" ו")}.` : ""}${corrections.length ? ` ${num(corrections.length)} תיקוני נתונים ללא השפעה על הסה״כ.` : ""} ${openIssues.length} נושאים פתוחים לטיפול.`;
  const approvedChanges = (pkg.budgetChanges ?? []).filter((c) => c.date <= controlDate);
  const keyTable: KeyRow[] = [
    ...(wf.totalBudgetChanges !== 0 ? [{ labelHe: "תקציב מקורי", valueHe: nis(wf.totalOriginalBudget), pctHe: `גרסה ${pkg.project.budgetVersion.number}` }, { labelHe: "שינויי תקציב מאושרים", valueHe: signed(wf.totalBudgetChanges), pctHe: `${num(approvedChanges.length)} שינויים` }] : []),
    { labelHe: "תקציב מעודכן", valueHe: nis(wf.totalBudget), pctHe: "" },
    { labelHe: "תחזית לגמר", valueHe: nis(wf.totalEac), pctHe: "" },
    { labelHe: "סטייה מתקציב", valueHe: signed(variance), pctHe: pct((variance / wf.totalBudget) * 100, 2) },
    { labelHe: "שינוי מבקרה קודמת", valueHe: signed(change), pctHe: pct((change / wf.previousTotalEac) * 100, 2) },
    { labelHe: "נרשם עד מועד החתך", valueHe: nis(wf.totalRecorded), pctHe: `${pct(expensePct, 0)} הוצאה` },
    { labelHe: "ביצוע פיזי", valueHe: physicalPct != null ? `~${physicalPct}%` : "לא נמדד", pctHe: physicalPct != null ? "מדידה מהאתר" : "אין דוח התקדמות" },
    { labelHe: "בלתי צפוי — יתרה", valueHe: nis(contingencyLeft), pctHe: contingencyBudget ? `${pct((contingencyLeft / contingencyBudget) * 100, 0)} מהמקור` : "—" },
    { labelHe: "יתרה להשלמה לא מכוסה (אומדנים)", valueHe: nis(uncovered.total), pctHe: `${pct((uncovered.total / wf.totalEac) * 100, 0)} מהתחזית` },
  ];
  const bulletsHe = [
    ...forecastChanges.map((c) => `${c.sectionHe}: ${c.descriptionHe} — ${signed(c.amount)} (${c.basisHe})`),
    `${nis(uncovered.total)} בתחזית עדיין מבוססים על אומדן ולא על הזמנה${uncoveredGroupsHe.length ? ` (${uncoveredGroupsHe.join(", ")})` : ""}.`,
    ...(openIssues.some((i) => i.stale) ? [`נושא פתוח יותר משתי בקרות: ${openIssues.filter((i) => i.stale).map((i) => i.titleHe).join("; ")}.`] : []),
    ...notes.filter((n) => n.kind === "note").map((n) => n.textHe),
  ].slice(0, 5);
  const ceoName = pkg.people.find((p) => /^מנכ/.test(p.roleHe))?.nameHe ?? "ההנהלה";
  const decisionsHe = [
    ...(variance > 0 && contingency ? [`האם לממן את ${nis(variance)} מהבלתי צפוי (יתרה ${nis(contingencyLeft)}) או להציג כחריגה — החלטת ${ceoName} עד הבקרה הבאה.`] : variance > 0 ? [`כיצד לממן את החריגה של ${nis(variance)} — החלטת ${ceoName}.`] : []),
    ...notes.filter((n) => n.kind === "decision").map((n) => n.textHe),
  ];

  const ceoIssues = openIssues.filter((i) => i.stale || i.dueHe !== "—");
  const toUncoveredRow = (l: HForecastLine): UncoveredRow => ({ descriptionHe: l.descriptionHe, sectionHe: label(l.sectionId), basisHe: BASIS_HE[l.basis] ?? l.basis, amount: l.amount, source: sourceForLine(pkg, l, state) });
  const uncoveredRows = uncovered.lines.map(toUncoveredRow);
  const allocationRows = uncovered.allocations.map(toUncoveredRow);

  const frameworkContracts = pkg.contracts.filter((c) => c.priceAppendices?.length);
  const fixedContracts = pkg.contracts.filter((c) => !c.priceAppendices?.length && c.amount != null);
  const schedule = pkg.project.schedule ?? {};
  const scheduleHe = `סיום חוזי: ${schedule.contractEnd ? monthHe(schedule.contractEnd) : "—"} · צפוי: ${schedule.expectedEnd ? monthHe(schedule.expectedEnd) : "—"}${schedule.noteHe ? ` · ${schedule.noteHe}` : schedule.contractEnd && schedule.expectedEnd && schedule.contractEnd !== schedule.expectedEnd ? " · לפער משמעות תקציבית שיש לבחון" : ""}`;
  const approver = personName(pkg, state.operatorId);
  const approverRole = pkg.people.find((p) => p.id === state.operatorId)?.roleHe ?? "";
  const distribution = pkg.people.filter((p) => p.id !== state.operatorId && !p.roleHe.includes("חשבונות")).map((p) => `${p.nameHe} (${p.roleHe})`).join(", ");

  return {
    header: {
      reviewPassHe: (() => {
        const rp = notes.find((n) => n.kind === "review_pass");
        return rp ? `סקירת הסוכן ${dateHe(rp.at)} ${rp.at.slice(11, 16)}: ${rp.textHe}` : null;
      })(),
      projectNameHe: pkg.project.nameHe,
      projectHe: `${pkg.project.nameHe} — ${pkg.project.buildings.length} בניינים, ${pkg.project.units} יח״ד`,
      companyHe: pkg.project.companyHe,
      cutoffHe: `נתונים עד ${dateHe(controlDate)} (חשבונות שהתקבלו לפני מועד החתך)`,
      controlLabelHe: `בקרה ${monthHe(controlDate)}, ${state.control.finalized ? "גרסה סופית" : "טיוטה"}`,
      previousControlHe: `בקרה קודמת: ${dateHe(previous.controlDate)} (${previous.status === "final" ? "סופית" : "טיוטה"})`,
      budgetVersionHe: `תקציב: גרסה ${pkg.project.budgetVersion.number}, אושר ${dateHe(pkg.project.budgetVersion.approvedAt)}${approvedChanges.length ? ` · ${num(approvedChanges.length)} שינויי תקציב מאושרים (${signed(wf.totalBudgetChanges)}) — תקציב מעודכן ${nis(wf.totalBudget)}` : ""}`,
      boqVersionHe: `כתב כמויות: גרסה ${pkg.project.boqVersion.number} (${dateHe(pkg.project.boqVersion.date)})`,
      preparedByHe: "מכין: מערכת הבקרה",
      approvedByHe: `מאשר: ${approver}${approverRole ? `, ${approverRole}` : ""}`,
      distributionHe: `תפוצה: ${distribution}`,
      sourcesHe: `מקורות: מערכת המידע (משיכה ${dateHe(state.clock)} ${state.clock.slice(11, 16)}) · תיקיית הפרויקט (${num(pkg.documents.length)} מסמכים) · ${physicalPct != null ? "דוח התקדמות מהאתר (מדידת ביצוע פיזי)" : "ללא דוח התקדמות מהאתר"} · ${notes.some((n) => n.kind === "review_pass") ? "סקירת הסוכן בוצעה" : "סקירת הסוכן טרם בוצעה"}`,
    },
    executive: { paragraphHe, keyTable, bulletsHe, decisionsHe },
    status: { stageHe: pkg.project.statusHe, physicalPct, expensePct, commitmentPct, scheduleHe, eventsHe: events },
    sections: { rows, totals, materialityHe: `סף מהותיות: ${nis(pkg.project.materiality.absolute)} וגם ${pkg.project.materiality.pctOfSection}% מהסעיף, או ${nis(pkg.project.materiality.absoluteAlways)} בכל מקרה`, byChapter, byBuilding: split?.rows ?? null, byBuildingNoteHe: split?.noteHe ?? null, byBuildingChangeable: split?.changeable ?? [], byBuildingOptions: buildingOptions(pkg) },
    changes: { forecast: forecastChanges, forecastTotal, corrections },
    material,
    contingency: {
      original: contingencyBudget,
      used: contingencyBudget - contingencyLeft,
      remaining: contingencyLeft,
      // change orders and claims are not ERP records in this system: they are what the controller recorded, or "none recorded"
      pendingChangeOrdersHe: notes.filter((n) => n.kind === "change_order").map((n) => n.textHe).join("; ") || "לא נרשמו פקודות שינוי ממתינות לאישור (מערכת המידע אינה מנהלת פקודות שינוי; המבקר לא רשם)",
      claimsHe: notes.filter((n) => n.kind === "claim").map((n) => n.textHe).join("; ") || "לא נרשמו דרישות או תביעות קבלנים פתוחות (המבקר לא רשם)",
      decisionHe: decisionsHe[0] ?? "אין החלטה נדרשת",
    },
    risks,
    issues: { open: openIssues, closed: closedIssues },
    openFindings: openFindingRows(pkg, state),
    openQuestions: state.control.questions.filter((q) => q.status === "open").map((q) => ({ id: q.id, toHe: personName(pkg, q.toId), channelHe: CHANNEL_HE[q.channel], textHe: q.textHe, askedHe: `${dateHe(q.askedAt)} ${q.askedAt.slice(11, 16)}`, findingId: q.findingId ?? null })),
    verified: state.control.positives.map((p) => ({ titleHe: p.titleHe, textHe: p.textHe })),
    trends: { eacSeries, uncoveredSeries, uncoveredNow: uncovered.total, uncoveredCommentaryHe, commentaryHe: firstOverrun ? `בקרה ראשונה מבין ${eacSeries.length - 1} שבה התחזית חורגת מהתקציב. ${priceDriven ? "החריגה נובעת ממחיר, לא מכמות." : ""}`.trim() : "התחזית בתוך התקציב לאורך כל הבקרות.", comparison },
    appendices: {
      definitionsHe: [
        "תקציב מאושר — התקציב האחרון שאושר, לפי סעיפים, עם גרסה ותאריך",
        "נרשם — חשבונות שאושרו לתשלום עד מועד החתך, לפני מע״מ, כולל עכבונות; חשבונות בבדיקה מוצגים בנפרד",
        "התחייבויות — חוזים חתומים והזמנות מאושרות בסכומן המלא",
        "יתרת התחייבות — התחייבויות פחות מה שנרשם מתוכן",
        "יתרה להשלמה — לא מכוסה — עבודות ורכש נדרשים ללא התחייבות; בסיס: הצעה / אומדן. הקצאות פנימיות (הנהלה, בלתי צפוי) מוצגות בנפרד ואינן נספרות כאומדני רכש",
        "תחזית לגמר (EAC) — נרשם + יתרת התחייבות + יתרה לא מכוסה",
        "סטייה — תחזית לגמר פחות תקציב מעודכן; חיובית = חריגה",
        `סף מהותיות — ${nis(pkg.project.materiality.absolute)} וגם ${pkg.project.materiality.pctOfSection}% מהסעיף, או ${nis(pkg.project.materiality.absoluteAlways)} בכל מקרה; סעיף מנותח בסעיף 5 גם כשהוא מעל ${pkg.project.materiality.budgetSharePct}% מהתקציב או כשהבסיס שלו מתחת ל-${pkg.project.materiality.softBasisPct}% התחייבות`,
      ],
      assumptionsHe: [
        `הצמדה: ${fixedContracts.length} חוזי משנה בסכום קבוע ללא הצמדה למדד${frameworkContracts.length ? `; ${frameworkContracts.map((c) => `הסכם המסגרת ${isolate(c.id)} מתעדכן בנספחי מחיר בכתב (${(c.priceAppendices ?? []).map((a) => a.titleHe).join(", ")})`).join("; ")}` : ""}`,
        `לו״ז: ${scheduleHe}`,
        `מחירים: ${[...new Set(uncovered.lines.map((l) => `${label(l.sectionId)} לפי ${BASIS_HE[l.basis]}`))].join("; ") || "כל היתרות מכוסות בהתחייבות"}`,
        ...notes.filter((n) => n.kind === "assumption").map((n) => n.textHe),
      ],
      sourcesHe: [`מערכת המידע — ${state.erp.invoices.length} חשבונות, ${state.erp.purchaseOrders.length} הזמנות, ${pkg.contracts.length} חוזים`, `כתב כמויות גרסה ${pkg.project.boqVersion.number}`, `תחזית ${dateHe(previous.controlDate)} (${previous.status === "final" ? "סופית" : "טיוטה"})`, `תיקיית הפרויקט: ${pkg.documents.map((d) => d.titleHe.split(" — ")[0]).join(", ")}`],
      correctionLog: corrections,
      inReview: wf.invoicesInReview,
      afterCutoffHe: state.erp.changeLog.filter((c) => c.at >= controlDate).map((c) => `${dateHe(c.at)} — ${RECORD_TYPE_HE[c.recordType]} ${c.recordId}: ${c.before === "—" ? `${c.field}: ${c.after}` : `${c.field} ${c.before} ← ${c.after}`} (${personName(pkg, c.byId)})`),
      uncovered: uncoveredRows,
      uncoveredTotal: uncovered.total,
      allocations: allocationRows,
      allocationTotal: uncovered.allocationTotal,
    },
    ceo: { paragraphHe, keyTable: keyTable.slice(0, 4), changes: forecastChanges, issues: ceoIssues.length ? ceoIssues : openIssues, riskLineHe: risks[0] ? `${risks[0].topicHe}: ${risks[0].descriptionHe}` : "" },
    working: wf,
    finalized: state.control.finalized,
  };
}

