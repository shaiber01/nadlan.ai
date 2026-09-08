import { CURRENT_CONTROL, EARLIER_CONTROL_TOTALS } from "../data/generate";
import type { BuildingTag, HForecastLine, HadarimPackage, SectionId } from "../data/types";
import { SECTION_SHORT_HE } from "./checks";
import { allIssues } from "./commands";
import { uncoveredAt, uncoveredByBasis, workingForecast, type UncoveredBreakdown, type WorkingForecast, type WorkingSection } from "./forecast";
import { CHANGE_TYPE_HE, type V2State } from "./model";

/**
 * Builds the control report model per `budgetcontrolreportstandard.md` (sections 0–11 and the CEO page)
 * from the live state. Every number is derived; the UI and the exporters only render this model.
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const mil = (v: number) => `${(v / 1_000_000).toFixed(2)} מ׳`;
const num = (v: number) => v.toLocaleString("he-IL");
const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`;
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");
const signed = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);
const label = (id: SectionId) => `${id}-${SECTION_SHORT_HE[id]}`;

export const MATERIALITY = { absolute: 100_000, pctOfSection: 3, absoluteAlways: 250_000, budgetSharePct: 10, softBasisPct: 70 };

/** A clickable origin for a number: a document page (with an anchor), an ERP record, or an ERP screen. */
export interface ReportSource {
  labelHe: string;
  documentId?: string;
  anchor?: string;
  recordRef?: { type: "invoice" | "po" | "contract"; id: string };
  erp?: { screen: "invoices" | "purchase_orders" | "contracts" | "budget" | "change_log"; sectionId?: SectionId; contractId?: string; invoiceId?: number; poId?: number };
}

export interface ReportHeader {
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

export interface SectionRow {
  sectionId: SectionId;
  nameHe: string;
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
  building: BuildingTag | "חניון";
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
  status: { stageHe: string; physicalPct: number; expensePct: number; commitmentPct: number; scheduleHe: string; eventsHe: string[] };
  sections: { rows: SectionRow[]; totals: SectionRow; materialityHe: string; byBuilding: BuildingRow[] | null; byBuildingNoteHe: string | null; byBuildingChangeable: { invoiceId: number; labelHe: string; building: BuildingTag | null }[] };
  changes: { forecast: ChangeRow[]; forecastTotal: number; corrections: CorrectionRow[] };
  material: MaterialSection[];
  contingency: { original: number; used: number; remaining: number; pendingChangeOrdersHe: string; claimsHe: string; decisionHe: string };
  risks: RiskRow[];
  issues: { open: IssueRow[]; closed: IssueRow[] };
  verified: { titleHe: string; textHe: string }[];
  trends: { eacSeries: { labelHe: string; value: number }[]; uncoveredSeries: { labelHe: string; value: number }[]; uncoveredNow: number; uncoveredCommentaryHe: string; commentaryHe: string; comparison: string[][] | null };
  appendices: { definitionsHe: string[]; assumptionsHe: string[]; sourcesHe: string[]; correctionLog: CorrectionRow[]; inReview: { count: number; amount: number }; afterCutoffHe: string[]; uncovered: UncoveredRow[]; uncoveredTotal: number; allocations: UncoveredRow[]; allocationTotal: number };
  ceo: { paragraphHe: string; keyTable: KeyRow[]; changes: ChangeRow[]; issues: IssueRow[]; riskLineHe: string };
  working: WorkingForecast;
  finalized: boolean;
}

const BASIS_HE: Record<string, string> = { invoice: "חשבון מאושר", contract: "חוזה חתום", po: "הזמנה מאושרת", quote: "הצעת מחיר", appendix: "נספח מחיר", estimate: "אומדן פנימי", allocation: "הקצאה תקציבית פנימית" };

function isMaterial(s: WorkingSection): boolean {
  const abs = Math.abs(s.variance);
  const changed = s.change !== 0;
  return changed || abs >= MATERIALITY.absoluteAlways || (abs >= MATERIALITY.absolute && abs >= (s.budget * MATERIALITY.pctOfSection) / 100);
}

// ---------------------------------------------------------------------------
// Optional secondary split by building (standard §3: same columns; estimates declared as such)
// ---------------------------------------------------------------------------

function buildingSplit(pkg: HadarimPackage, wf: WorkingForecast, state: V2State): { rows: BuildingRow[]; noteHe: string; changeable: ReportModel["sections"]["byBuildingChangeable"] } {
  const floorsA = pkg.project.buildings[0].floorsCast;
  const floorsB = pkg.project.buildings[1].floorsCast;
  const shareA = floorsA / (floorsA + floorsB);
  const blank = (building: BuildingRow["building"]): BuildingRow => ({ building, budget: 0, recorded: 0, committed: 0, remainingCommitment: 0, uncovered: 0, eac: 0, variance: 0, variancePct: 0, basisPct: 0 });
  const rows: Record<string, BuildingRow> = { A: blank("A"), B: blank("B"), חניון: blank("חניון"), משותף: blank("משותף") };
  const add = (key: string, part: { budget: number; recorded: number; committed: number; remainingCommitment: number; uncovered: number }) => {
    const r = rows[key];
    r.budget += part.budget;
    r.recorded += part.recorded;
    r.committed += part.committed;
    r.remainingCommitment += part.remainingCommitment;
    r.uncovered += part.uncovered;
  };
  const untagged: string[] = [];
  for (const s of wf.sections) {
    const section = pkg.sections.find((x) => x.id === s.sectionId)!;
    const invoices = state.erp.invoices.filter((i) => i.sectionId === s.sectionId && i.status !== "בבדיקה" && i.dateReceived < wf.controlDate);
    const byTag: Record<string, number> = { A: 0, B: 0, משותף: 0 };
    for (const inv of invoices) byTag[inv.building ?? "משותף"] += inv.amount;
    if (section.split === "shared" || section.split === "parking") {
      const home = section.split === "parking" ? "חניון" : "משותף";
      // an invoice explicitly tagged with a building is honoured even in a shared section (the "[שנה]" affordance)
      add("A", { budget: 0, recorded: byTag.A, committed: 0, remainingCommitment: 0, uncovered: 0 });
      add("B", { budget: 0, recorded: byTag.B, committed: 0, remainingCommitment: 0, uncovered: 0 });
      add(home, { budget: s.budget, recorded: s.recorded - byTag.A - byTag.B, committed: s.committed, remainingCommitment: s.remainingCommitment, uncovered: s.uncovered });
      continue;
    }
    for (const inv of invoices) if (!inv.building) untagged.push(`חשבון ${inv.id}`);
    const share = section.split === "by_floors" ? shareA : 0.5;
    const part = (x: number) => Math.round(x * share);
    add("A", { budget: part(s.budget), recorded: byTag.A, committed: part(s.committed), remainingCommitment: part(s.remainingCommitment), uncovered: part(s.uncovered) });
    add("B", { budget: s.budget - part(s.budget), recorded: byTag.B, committed: s.committed - part(s.committed), remainingCommitment: s.remainingCommitment - part(s.remainingCommitment), uncovered: s.uncovered - part(s.uncovered) });
    add("משותף", { budget: 0, recorded: byTag["משותף"], committed: 0, remainingCommitment: 0, uncovered: 0 });
  }
  for (const r of Object.values(rows)) {
    r.eac = r.recorded + r.remainingCommitment + r.uncovered;
    r.variance = r.eac - r.budget;
    r.variancePct = r.budget ? (r.variance / r.budget) * 100 : 0;
    r.basisPct = r.eac ? Math.round(((r.recorded + r.remainingCommitment) / r.eac) * 100) : 100;
  }
  // invoices corrected in this control that carry no building tag at source are called out explicitly and can be tagged
  const changeable: ReportModel["sections"]["byBuildingChangeable"] = [];
  for (const c of state.control.corrections.filter((x) => x.recordType === "invoice")) {
    const inv = state.erp.invoices.find((i) => String(i.id) === c.recordId);
    if (!inv) continue;
    if (!inv.building) untagged.push(`חשבון ${inv.id}`);
    changeable.push({ invoiceId: inv.id, labelHe: `חשבון ${inv.id}`, building: inv.building });
  }
  const drainage = state.control.adjustments.find((a) => a.changeType === "coverage_gap");
  const tagged = changeable.filter((c) => c.building && c.building !== "משותף");
  const noteHe = [
    untagged.length ? `${[...new Set(untagged)].join(", ")} אינו מפולח לפי בניין במקור — שויך ל״משותף״.` : "",
    tagged.length ? `${tagged.map((t) => `${t.labelHe} שויך לבניין ${t.building} לפי החלטת מנהל הפרויקט (נרשם ביומן השינויים).`).join(" ")}` : "",
    drainage ? "קו הניקוז נכנס תחת ״משותף״." : "",
    "הפילוח הפנימי של סעיפים לפי קומות שיוצקו ויח״ד הוא הערכה ומסומן ככזה; תחזית קודמת ושינוי אינם מפולחים.",
  ]
    .filter(Boolean)
    .join(" ");
  return { rows: Object.values(rows), noteHe, changeable };
}

// ---------------------------------------------------------------------------
// Material sections (standard §5): threshold crossed, >10 % of budget, or basis < 70 %
// ---------------------------------------------------------------------------

function sourceForLine(l: HForecastLine): ReportSource | undefined {
  if (l.basis === "appendix") return { labelHe: "נספח א׳-2", documentId: "appendix_A2_steel_price_2026_07_15", anchor: "price" };
  if (l.basis === "quote") return { labelHe: "הצעת י. כהן", documentId: "quote_ycohen_drainage", anchor: "line" };
  if (l.basis === "po") return { labelHe: l.sourceRef ?? "הזמנה", erp: { screen: "purchase_orders", sectionId: l.sectionId } };
  return { labelHe: l.sourceRef ?? "תקציב", erp: { screen: "budget", sectionId: l.sectionId } };
}

function materialSections(pkg: HadarimPackage, wf: WorkingForecast, state: V2State): MaterialSection[] {
  const supplierHe = (id: string) => pkg.suppliers.find((x) => x.id === id)?.nameHe ?? id;
  const out: MaterialSection[] = [];
  for (const s of wf.sections) {
    if (s.sectionId === "17") continue;
    const reasons = [
      isMaterial(s) ? (s.change !== 0 ? "שינוי מהבקרה הקודמת" : "סטייה מעל סף המהותיות") : "",
      s.budget > (wf.totalBudget * MATERIALITY.budgetSharePct) / 100 ? `מעל ${MATERIALITY.budgetSharePct}% מהתקציב` : "",
      s.basisPct < MATERIALITY.softBasisPct ? `בסיס ${num(s.basisPct)}% — מתחת ל-${MATERIALITY.softBasisPct}% התחייבות` : "",
      state.control.corrections.some((c) => c.crossSectionHe.includes(`${s.sectionId}-`) && c.afterHe.startsWith(s.sectionId)) ? "תיקון נתונים בתקופה" : "",
    ].filter(Boolean);
    if (!reasons.length) continue;
    const reasonHe = reasons.join(" · ");
    if (s.sectionId === "03") out.push(steelSection(pkg, s, reasonHe));
    else if (s.sectionId === "07") out.push(developmentSection(state, s, reasonHe));
    else out.push(genericSection(pkg, wf, state, s, reasonHe, supplierHe));
  }
  return out;
}

function steelSection(pkg: HadarimPackage, steel: WorkingSection, reasonHe: string): MaterialSection {
  const uncoveredLine = steel.lines.find((l) => l.kind === "uncovered")!;
  const poLine = steel.lines.find((l) => l.kind === "remaining_commitment" && l.basis === "po");
  const remainderTons = (uncoveredLine.qty ?? 0) + (poLine?.qty ?? 0);
  const orderedTons = poLine?.qty ?? 12;
  const exposedTons = poLine ? (uncoveredLine.qty ?? 0) : Math.max(0, (uncoveredLine.qty ?? 0) - 12);
  const boqTons = pkg.boq.filter((l) => l.sectionId === "03").reduce((a, l) => a + (l.unit === "טון" ? l.qty : 0), 0) || 750;
  return {
    sectionId: "03",
    titleHe: "03 — אספקת ברזל זיון",
    reasonHe,
    paragraphsHe: [
      `הסכם מסגרת ⁨03-F⁩ עם פלדות הצפון; מחיר לפי נספח. סופקו ${num(steel.recorded / 4000)} טון מתוך ${num(boqTons)} טון בכתב הכמויות (${num(Math.round((steel.recorded / 4000 / boqTons) * 100))}%).`,
      `יתרה: ${num(remainderTons)} טון, מהם ${num(orderedTons)} טון בהזמנה 2291 (במחיר החדש) ו-${num(exposedTons)} טון ללא הזמנה.`,
      `מחירי יחידה: תקציב 4,000 ₪/טון · נספח א׳ 4,000 ₪/טון · נספח א׳-2 (מ-15.7.2026) ${num(uncoveredLine.unitPrice ?? 4000)} ₪/טון.`,
      "מה יכול עוד להשתנות: עדכון נספח רבעוני (הצמדה למדד תשומות הבנייה); כמויות בפועל לפי הקומות העליונות.",
    ],
    table: [
      ["רכיב", "נתון"],
      ["תקציב", nis(steel.budget)],
      ["עלות שנרשמה", `${nis(steel.recorded)} (${num(steel.recorded / 4000)} טון)`],
      ["יתרה צפויה", `${num(remainderTons)} טון`],
      ["מהם בהזמנה מאושרת", poLine ? `${num(orderedTons)} טון — ${nis(poLine.amount)}` : `${num(orderedTons)} טון (הזמנה 2291, בתוך היתרה)`],
      ["מחיר יח׳ — תקציב", "4,000 ₪/טון"],
      ["מחיר יח׳ — נספח בתוקף", `${num(uncoveredLine.unitPrice ?? 4000)} ₪/טון`],
      ["יתרה לא מכוסה", `${nis(steel.uncovered)} (${BASIS_HE[uncoveredLine.basis]})`],
      ["תחזית לגמר", nis(steel.eac)],
      ["סטייה", signed(steel.variance)],
      ["בסיס", `${num(steel.basisPct)}%`],
    ],
    recommendationHe: exposedTons > 0 ? `לשקול הזמנה מרוכזת ל-${num(exposedTons)} הטון הנותרים כדי לקבע מחיר.` : "אין פעולה נדרשת.",
    sources: [
      { labelHe: "הסכם מסגרת 03-F", recordRef: { type: "contract", id: "03-F" } },
      { labelHe: "נספח א׳-2 — 4,800 ₪/טון", documentId: "appendix_A2_steel_price_2026_07_15", anchor: "price" },
      { labelHe: "נספח א׳ — 4,000 ₪/טון", documentId: "appendix_A_steel_price_2025_11", anchor: "price" },
      { labelHe: "הזמנה 2291", recordRef: { type: "po", id: "2291" } },
      { labelHe: "חשבונות הסעיף במערכת המידע", erp: { screen: "invoices", sectionId: "03" } },
    ],
  };
}

function developmentSection(state: V2State, dev: WorkingSection, reasonHe: string): MaterialSection {
  const drainage = state.control.adjustments.find((a) => a.changeType === "coverage_gap");
  const invoices = state.erp.invoices.filter((i) => i.sectionId === "07" && i.status !== "בבדיקה" && i.contractId === "07-01");
  return {
    sectionId: "07",
    titleHe: "07 — פיתוח ותשתיות חוץ",
    reasonHe,
    paragraphsHe: [
      `חוזה 07-01 (נ.ת.ב. תשתיות ופיתוח) 3,200,000 ₪; נרשמו ${nis(dev.recorded)} (${num(invoices.length)} חשבונות חלקיים); יתרת חוזה ${nis(dev.remainingCommitment)}.`,
      `כתב הכמויות גרסה 4 כולל קו ניקוז חוץ Ø400 (80 מ׳) המוחרג בסעיף 3.4 לחוזה; ${drainage ? "הוסף לתחזית כאומדן לפי הצעת י. כהן (טרם הוזמן)." : "אין לו חוזה ואין לו אומדן."}`,
      "שלושה מסמכים שכל אחד נכון בפני עצמו; רק ההצלבה חושפת את הפער.",
      "מה יכול עוד להשתנות: אגרות חיבור לתאגיד (מחוץ לחוזה); תוקף ההצעה; כמויות פיתוח שלב ב׳.",
    ],
    table: [
      ["רכיב", "נתון"],
      ["תקציב", nis(dev.budget)],
      ["עלות שנרשמה", nis(dev.recorded)],
      ["יתרת חוזה 07-01", nis(dev.remainingCommitment)],
      ["יתרה לא מכוסה", `${nis(dev.uncovered)}${dev.uncovered ? " (הצעת מחיר — אומדן)" : ""}`],
      ["תחזית לגמר", nis(dev.eac)],
      ["סטייה", signed(dev.variance)],
      ["בסיס", `${num(dev.basisPct)}%`],
    ],
    recommendationHe: drainage ? "להסדיר הזמנה לקו הניקוז לפני פקיעת ההצעה (19.9.2026)." : "לתמחר את קו הניקוז המוחרג לפני סגירת התחזית.",
    sources: [
      { labelHe: "חוזה 07-01 — סעיף 3.4", documentId: "contract_07_01_excerpt", anchor: "exclusion" },
      { labelHe: "כתב כמויות גרסה 4 — פרק 57", documentId: "boq_v4_ch57", anchor: "line" },
      { labelHe: "הצעת י. כהן", documentId: "quote_ycohen_drainage", anchor: "line" },
      { labelHe: "חשבון 1147", recordRef: { type: "invoice", id: "1147" } },
      { labelHe: "חשבונות הסעיף במערכת המידע", erp: { screen: "invoices", sectionId: "07" } },
    ],
  };
}

function genericSection(pkg: HadarimPackage, wf: WorkingForecast, state: V2State, s: WorkingSection, reasonHe: string, supplierHe: (id: string) => string): MaterialSection {
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
    paragraphs.push(
      `${contracts.map((c) => `חוזה ${c.id} — ${supplierHe(c.supplierId)}${c.amount != null ? `, ${nis(c.amount)}` : ""}, נחתם ${dateHe(c.signedAt)}${c.closed ? `; נסגר ${dateHe(c.closed.at)} בחשבון סופי ${nis(c.closed.finalAccount)}` : ""}`).join(" · ")}. נרשמו ${nis(s.recorded)} (${num(invoices.length)} חשבונות)${s.remainingCommitment ? `; יתרת התחייבות ${nis(s.remainingCommitment)}` : ""}.`,
    );
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
  paragraphs.push(`מה יכול עוד להשתנות: ${contracts.length ? "פקודות שינוי וכמויות בפועל מול התכנון; החוזה אינו צמוד למדד." : allocationOnly ? "משך הפרויקט — כל חודש נוסף מוסיף כ-210,000 ₪." : openPos.length ? "משך הפרויקט (הזמנות המסגרת מכסות 15 חודשים)." : "תוצאות המכרז מול האומדן; מועד החתימה."}`);
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
      { labelHe: invoices.length ? "חשבונות הסעיף במערכת המידע" : "הסעיף במערכת המידע", erp: { screen: invoices.length ? ("invoices" as const) : ("budget" as const), sectionId: s.sectionId } },
    ],
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export function buildReport(pkg: HadarimPackage, state: V2State): ReportModel {
  const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
  const config = state.control.reportConfig;
  const previous = pkg.forecasts.find((f) => f.controlDate === wf.previousControlDate)!;
  const variance = wf.totalEac - wf.totalBudget;
  const change = wf.totalEac - wf.previousTotalEac;
  const uncovered: UncoveredBreakdown = uncoveredByBasis(wf);
  const contingency = wf.sections.find((s) => s.sectionId === "17")!;
  const physicalPct = 38;
  const expensePct = (wf.totalRecorded / wf.totalEac) * 100;
  const commitmentPct = ((wf.totalRecorded + wf.totalRemainingCommitment) / wf.totalEac) * 100;

  const forecastChanges: ChangeRow[] = state.control.adjustments.map((a) => ({ sectionHe: label(a.sectionId), typeHe: CHANGE_TYPE_HE[a.changeType], descriptionHe: a.descriptionHe, basisHe: a.basisHe, amount: a.amount, documentId: a.documentId }));
  const forecastTotal = forecastChanges.reduce((a, c) => a + c.amount, 0);
  const corrections: CorrectionRow[] = state.control.corrections.map((c) => ({ recordHe: `${c.recordType === "invoice" ? "חשבון" : "הזמנה"} ${c.recordId}`, whatHe: c.fieldHe, beforeHe: c.beforeHe, afterHe: c.afterHe, approvedByHe: pkg.people.find((p) => p.id === c.approvedById)?.nameHe ?? c.approvedById, crossSectionHe: c.crossSectionHe, statusHe: c.status === "applied" ? "בוצע במקור" : "ממתין לביצוע" }));

  const rows: SectionRow[] = wf.sections.map((s) => ({
    sectionId: s.sectionId,
    nameHe: pkg.sections.find((x) => x.id === s.sectionId)!.nameHe,
    budget: s.budget,
    changes: 0,
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
    highlighted: s.sectionId !== "17" && (isMaterial(s) || state.control.corrections.some((c) => c.crossSectionHe.includes(`${s.sectionId}-`))),
    isContingency: s.sectionId === "17",
  }));
  const totals: SectionRow = { sectionId: "01", nameHe: "סה״כ", budget: wf.totalBudget, changes: 0, updatedBudget: wf.totalBudget, recorded: wf.totalRecorded, committed: wf.totalCommitted, remainingCommitment: wf.totalRemainingCommitment, uncovered: wf.totalUncovered, eac: wf.totalEac, variance, variancePct: (variance / wf.totalBudget) * 100, previousEac: wf.previousTotalEac, change, basisPct: Math.round(commitmentPct), highlighted: false, isContingency: false };

  const split = config.splitByBuilding ? buildingSplit(pkg, wf, state) : null;

  const issues = allIssues(state);
  const personHe = (id: string) => pkg.people.find((p) => p.id === id)?.nameHe ?? id;
  // number of controls (including this one) at which the issue has been open
  const controlsSince = (opened: string) => [...new Set([...pkg.project.controlDates, CURRENT_CONTROL])].filter((d) => d >= opened).length;
  const toRow = (t: (typeof issues)[number]): IssueRow => ({ id: t.id, titleHe: t.titleHe, sectionHe: t.sectionId ? label(t.sectionId) : "—", ownerHe: personHe(t.ownerId), dueHe: t.dueDate ? dateHe(t.dueDate) : "—", openedHe: dateHe(t.openedInControl), statusHe: t.status === "closed" ? "נסגר" : t.status === "pending_execution" ? "ממתין לביצוע" : "פתוח", impactHe: t.impactIfIgnoredHe ?? "—", stale: t.status !== "closed" && controlsSince(t.openedInControl) > 2, closedHe: t.closedAt ? dateHe(t.closedAt) : undefined });
  const openIssues = issues.filter((t) => t.status !== "closed").map(toRow);
  const closedIssues = issues.filter((t) => t.status === "closed").map(toRow);

  const steel = wf.sections.find((s) => s.sectionId === "03")!;
  const steelUncovered = steel.lines.find((l) => l.kind === "uncovered")!;
  const steelPo = steel.lines.find((l) => l.kind === "remaining_commitment" && l.basis === "po");
  const exposedTons = steelPo ? (steelUncovered.qty ?? 0) : Math.max(0, (steelUncovered.qty ?? 0) - 12);
  const drainage = state.control.adjustments.find((a) => a.changeType === "coverage_gap");
  const risks: RiskRow[] = [
    ...(drainage ? [{ topicHe: "תוקף הצעת הניקוז", sectionHe: "07-פיתוח", descriptionHe: "האומדן מבוסס על הצעה בתוקף 30 יום; ללא הזמנה עד 19.9 — תמחור מחדש", exposureHe: "0 – 30,000 ₪", likelihoodHe: "בינונית", triggerHe: "הזמנה עד 19.9.2026", ownerHe: "אייל" }] : []),
    { topicHe: "עדכון נוסף במחיר ברזל", sectionHe: "03-ברזל", descriptionHe: `${num(exposedTons)} טון חשופים לשינוי מחיר (יתרה ללא הזמנה); הנספח צמוד למדד תשומות הבנייה רבעונית`, exposureHe: `${nis(exposedTons * 100)} לכל 100 ₪/טון`, likelihoodHe: "בינונית", triggerHe: "עדכון נספח ברבעון הבא", ownerHe: "רועי" },
    { topicHe: "חיבור ביוב עירוני", sectionHe: "07-פיתוח", descriptionHe: "אישור התאגיד פתוח מ-07/2026; ללא אישור — עיכוב בחיבור ואגרות לא מתוקצבות", exposureHe: "לו״ז; אגרות לפי תעריף התאגיד", likelihoodHe: "בינונית", triggerHe: "קבלת האישור", ownerHe: "אייל" },
  ];

  const material = materialSections(pkg, wf, state);

  // trends
  const eacSeries = [...Object.entries(EARLIER_CONTROL_TOTALS).map(([d, v]) => ({ labelHe: dateHe(d), value: v })), { labelHe: dateHe(previous.controlDate), value: previous.totalEac }, { labelHe: dateHe(CURRENT_CONTROL), value: wf.totalEac }];
  const firstOverrun = eacSeries.filter((p) => p.value > wf.totalBudget).length === 1 && wf.totalEac > wf.totalBudget;
  const priceDriven = state.control.adjustments.some((a) => a.changeType === "price") && !state.control.adjustments.some((a) => a.changeType === "quantity");
  const prevUncovered = uncoveredAt(previous);
  const uncoveredSeries = [
    { labelHe: dateHe(previous.controlDate), value: prevUncovered },
    { labelHe: dateHe(CURRENT_CONTROL), value: uncovered.total },
  ];
  const uncoveredDeltas = wf.sections
    .filter((s) => s.sectionId !== "17")
    .map((s) => {
      const prevSection = previous.sections!.find((p) => p.sectionId === s.sectionId)!;
      const before = prevSection.lines.filter((l) => l.kind === "uncovered" && l.basis !== "allocation").reduce((a, l) => a + l.amount, 0);
      const after = s.lines.filter((l) => l.kind === "uncovered" && l.basis !== "allocation").reduce((a, l) => a + l.amount, 0);
      return { s, delta: after - before, becameCommitted: before > 0 && after === 0 && s.remainingCommitment > 0 };
    })
    .filter((d) => d.delta !== 0);
  const uncoveredCommentaryHe = `יתרה לא מכוסה: ${nis(prevUncovered)} → ${nis(uncovered.total)} (${signed(uncovered.total - prevUncovered)}). צריכה לרדת מבקרה לבקרה ככל שאומדנים הופכים להזמנות.${uncoveredDeltas.length ? ` הפעם: ${uncoveredDeltas.map((d) => `${label(d.s.sectionId)} ${signed(d.delta)}${d.becameCommitted ? " (נחתם חוזה)" : ""}`).join(" · ")}.` : ""}`;

  const dev = wf.sections.find((s) => s.sectionId === "07")!;
  const prevDev = previous.sections!.find((s) => s.sectionId === "07")!;
  const prevSteel = previous.sections!.find((s) => s.sectionId === "03")!;
  const comparison: string[][] | null = config.includeTrends
    ? [
        ["", `בקרה ${dateHe(previous.controlDate)}`, `בקרה ${dateHe(CURRENT_CONTROL)}`, "שינוי"],
        ["תחזית כוללת", mil(previous.totalEac), mil(wf.totalEac), `${change >= 0 ? "+" : "−"}${mil(Math.abs(change))}`],
        ["ברזל — תחזית סעיף", mil(prevSteel.eac), mil(steel.eac), `${steel.change >= 0 ? "+" : "−"}${pct((Math.abs(steel.change) / prevSteel.eac) * 100, 0)}`],
        ["פיתוח — נרשם", mil(prevDev.recorded), mil(dev.recorded), `${dev.recorded - prevDev.recorded >= 0 ? "+" : "−"}${nis(Math.abs(dev.recorded - prevDev.recorded))}${state.control.corrections.some((c) => c.afterHe.startsWith("07")) ? " (העברה)" : ""}`],
        ["יתרה לא מכוסה (אומדנים)", mil(prevUncovered), mil(uncovered.total), `${uncovered.total - prevUncovered >= 0 ? "+" : "−"}${mil(Math.abs(uncovered.total - prevUncovered))}`],
        ["נושאים פתוחים", String(previous.openIssues.length), String(openIssues.length), String(openIssues.length - previous.openIssues.length)],
      ]
    : null;

  // executive summary
  const packageLines = uncovered.lines.filter((l) => l.basis === "estimate" && ["12", "13", "15", "16"].includes(l.sectionId));
  const uncoveredGroupsHe = [packageLines.length ? `${packageLines.length === 4 ? "ארבע" : num(packageLines.length)} חבילות שטרם נחתמו` : "", uncovered.lines.some((l) => l.sectionId === "03") ? "יתרת ברזל" : "", uncovered.lines.some((l) => l.basis === "quote") ? "קו ניקוז" : "", uncovered.lines.some((l) => l.sectionId === "01") ? "הארכת ארגון אתר" : ""].filter(Boolean).join(", ");
  const paragraphHe = `תחזית ההשלמה ${change === 0 ? "נותרה" : "עודכנה"} מ-${mil(wf.previousTotalEac)} ל-${mil(wf.totalEac)} ₪ — ${variance > 0 ? `חריגה צפויה של ${nis(variance)} (${pct((variance / wf.totalBudget) * 100, 2)})` : variance < 0 ? `תחזית נמוכה מהתקציב ב-${nis(-variance)}` : "בתוך התקציב"}.${forecastChanges.length ? ` מקור השינוי: ${forecastChanges.map((c) => `${c.typeHe.replace("שינוי ", "עדכון ")} (${(c.amount / 1000).toFixed(0)} א׳)`).join(" ו")}.` : ""}${corrections.length ? ` ${corrections.length === 2 ? "שני" : corrections.length} תיקוני נתונים ללא השפעה על הסה״כ.` : ""} ${openIssues.length} נושאים פתוחים לטיפול.`;
  const keyTable: KeyRow[] = [
    { labelHe: "תקציב מעודכן", valueHe: nis(wf.totalBudget), pctHe: "" },
    { labelHe: "תחזית לגמר", valueHe: nis(wf.totalEac), pctHe: "" },
    { labelHe: "סטייה מתקציב", valueHe: signed(variance), pctHe: pct((variance / wf.totalBudget) * 100, 2) },
    { labelHe: "שינוי מבקרה קודמת", valueHe: signed(change), pctHe: pct((change / wf.previousTotalEac) * 100, 2) },
    { labelHe: "נרשם עד מועד החתך", valueHe: nis(wf.totalRecorded), pctHe: `${pct(expensePct, 0)} הוצאה` },
    { labelHe: "ביצוע פיזי", valueHe: `~${physicalPct}%`, pctHe: "מדידה מהאתר" },
    { labelHe: "בלתי צפוי — יתרה", valueHe: nis(contingency.eac), pctHe: `${pct((contingency.eac / contingency.budget) * 100, 0)} מהמקור` },
    { labelHe: "יתרה להשלמה לא מכוסה (אומדנים)", valueHe: nis(uncovered.total), pctHe: `${pct((uncovered.total / wf.totalEac) * 100, 0)} מהתחזית` },
  ];
  const bulletsHe = [
    ...forecastChanges.map((c) => `${c.sectionHe}: ${c.descriptionHe} — ${signed(c.amount)} (${c.basisHe})`),
    `${nis(uncovered.total)} בתחזית עדיין מבוססים על אומדן ולא על הזמנה (${uncoveredGroupsHe}).`,
    ...(openIssues.some((i) => i.stale) ? [`נושא פתוח יותר משתי בקרות: ${openIssues.filter((i) => i.stale).map((i) => i.titleHe).join("; ")}.`] : []),
  ].slice(0, 5);
  const decisionsHe = variance > 0 ? [`האם לממן את ${nis(variance)} מהבלתי צפוי (יתרה ${nis(contingency.eac)}) או להציג כחריגה — החלטת דנה עד הבקרה הבאה.`] : [];

  const ceoIssues = openIssues.filter((i) => i.stale || i.dueHe !== "—");
  const toUncoveredRow = (l: HForecastLine): UncoveredRow => ({ descriptionHe: l.descriptionHe, sectionHe: label(l.sectionId), basisHe: BASIS_HE[l.basis] ?? l.basis, amount: l.amount, source: sourceForLine(l) });
  const uncoveredRows = uncovered.lines.map(toUncoveredRow);
  const allocationRows = uncovered.allocations.map(toUncoveredRow);

  return {
    header: {
      projectHe: `${pkg.project.nameHe} — 2 בניינים, ${pkg.project.units} יח״ד, חניון משותף`,
      companyHe: pkg.project.companyHe,
      cutoffHe: `נתונים עד ${dateHe(CURRENT_CONTROL)} (חשבונות שהתקבלו עד 31.8.2026)`,
      controlLabelHe: `בקרה 09/2026, ${state.control.finalized ? "גרסה סופית" : "טיוטה"}`,
      previousControlHe: `בקרה קודמת: ${dateHe(previous.controlDate)} (סופית)`,
      budgetVersionHe: `תקציב: גרסה ${pkg.project.budgetVersion.number}, אושר ${dateHe(pkg.project.budgetVersion.approvedAt)}`,
      boqVersionHe: `כתב כמויות: גרסה ${pkg.project.boqVersion.number} (${dateHe(pkg.project.boqVersion.date)})`,
      preparedByHe: "מכין: מערכת הבקרה",
      approvedByHe: "מאשר: אייל, מנהל פרויקט",
      distributionHe: "תפוצה: רועי (סמנכ״ל ביצוע), דנה (מנכ״לית)",
      sourcesHe: `מקורות: מערכת המידע (משיכה ${dateHe(state.clock)} ${state.clock.slice(11, 16)}) · תיקיית הפרויקט (${dateHe(state.clock)}) · דוח התקדמות מהאתר (${dateHe("2026-08-31")})`,
    },
    executive: { paragraphHe, keyTable, bulletsHe, decisionsHe },
    status: { stageHe: pkg.project.statusHe, physicalPct, expensePct, commitmentPct, scheduleHe: "סיום חוזי: 02/2027 · צפוי: 02/2027 · ללא משמעות תקציבית ידועה מעבר להארכת ארגון אתר שכבר בתחזית", eventsHe: ["נחתם חוזה אלומיניום 11-01 (25.8)", "נסגר שינוי מס׳ 2 בחוזה השלד (18.8)", "נספח מחיר ברזל א׳-2 בתוקף מ-15.7"] },
    sections: { rows, totals, materialityHe: `סף מהותיות: ${nis(MATERIALITY.absolute)} וגם ${MATERIALITY.pctOfSection}% מהסעיף, או ${nis(MATERIALITY.absoluteAlways)} בכל מקרה`, byBuilding: split?.rows ?? null, byBuildingNoteHe: split?.noteHe ?? null, byBuildingChangeable: split?.changeable ?? [] },
    changes: { forecast: forecastChanges, forecastTotal, corrections },
    material,
    contingency: { original: contingency.budget, used: contingency.budget - contingency.eac, remaining: contingency.eac, pendingChangeOrdersHe: "אין פקודות שינוי ממתינות לאישור", claimsHe: "אין דרישות/תביעות קבלנים פתוחות", decisionHe: decisionsHe[0] ?? "אין החלטה נדרשת" },
    risks,
    issues: { open: openIssues, closed: closedIssues },
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
        `סף מהותיות — ${nis(MATERIALITY.absolute)} וגם ${MATERIALITY.pctOfSection}% מהסעיף, או ${nis(MATERIALITY.absoluteAlways)} בכל מקרה; סעיף מנותח בסעיף 5 גם כשהוא מעל ${MATERIALITY.budgetSharePct}% מהתקציב או כשהבסיס שלו מתחת ל-${MATERIALITY.softBasisPct}% התחייבות`,
      ],
      assumptionsHe: ["הצמדה: חוזי המשנה בפרויקט אינם צמודים למדד; הסכם מסגרת הברזל מתעדכן בנספחי מחיר בכתב, ונספח א׳-2 כולל הצמדה רבעונית למדד תשומות הבנייה", "לו״ז: סיום 02/2027; ארגון אתר מתוקצב ל-16 חודשים", "מחירים: יתרת הברזל לפי נספח א׳-2; חבילות 12, 13, 15, 16 לפי אומדן פנימי"],
      sourcesHe: [`מערכת המידע — ${state.erp.invoices.length} חשבונות, ${state.erp.purchaseOrders.length} הזמנות, ${pkg.contracts.length} חוזים`, `כתב כמויות גרסה ${pkg.project.boqVersion.number}`, `תחזית ${dateHe(previous.controlDate)} (סופית)`, "תיקיית הפרויקט: נספח א׳-2, הצעת י. כהן, חוזה 07-01"],
      correctionLog: corrections,
      inReview: wf.invoicesInReview,
      afterCutoffHe: state.erp.changeLog.filter((c) => c.at >= CURRENT_CONTROL).map((c) => `${dateHe(c.at)} — ${c.recordType === "invoice" ? "חשבון" : c.recordType === "po" ? "הזמנה" : "חוזה"} ${c.recordId}: ${c.before === "—" ? `${c.field}: ${c.after}` : `${c.field} ${c.before} ← ${c.after}`} (${pkg.people.find((p) => p.id === c.byId)?.nameHe})`),
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
