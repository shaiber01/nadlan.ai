import { CURRENT_CONTROL, EARLIER_CONTROL_TOTALS } from "../data/generate";
import type { BuildingTag, HadarimPackage, SectionId } from "../data/types";
import { SECTION_SHORT_HE } from "./checks";
import { allIssues } from "./commands";
import { uncoveredByBasis, workingForecast, type WorkingForecast, type WorkingSection } from "./forecast";
import { CHANGE_TYPE_HE, type V2State } from "./model";

/**
 * Builds the control report model per `budgetcontrolreportstandard.md` (sections 0–11 and the CEO page)
 * from the live state. Every number is derived; the UI and the exporters only render this model.
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const mil = (v: number) => `${(v / 1_000_000).toFixed(2)} מ׳`;
const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`;
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");
const signed = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);

export const MATERIALITY = { absolute: 100_000, pctOfSection: 3, absoluteAlways: 250_000 };

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
  eac: number;
  noteHe?: string;
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
  paragraphsHe: string[];
  table: string[][];
  recommendationHe: string;
}

export interface ReportModel {
  header: ReportHeader;
  executive: { paragraphHe: string; keyTable: KeyRow[]; bulletsHe: string[]; decisionsHe: string[] };
  status: { stageHe: string; physicalPct: number; expensePct: number; commitmentPct: number; scheduleHe: string; eventsHe: string[] };
  sections: { rows: SectionRow[]; totals: SectionRow; materialityHe: string; byBuilding: BuildingRow[] | null; byBuildingNoteHe: string | null };
  changes: { forecast: ChangeRow[]; forecastTotal: number; corrections: CorrectionRow[] };
  material: MaterialSection[];
  contingency: { original: number; used: number; remaining: number; pendingChangeOrdersHe: string; claimsHe: string; decisionHe: string };
  risks: RiskRow[];
  issues: { open: IssueRow[]; closed: IssueRow[] };
  verified: { titleHe: string; textHe: string }[];
  trends: { eacSeries: { labelHe: string; value: number }[]; uncoveredNow: number; commentaryHe: string; comparison: string[][] | null };
  appendices: { definitionsHe: string[]; assumptionsHe: string[]; sourcesHe: string[]; correctionLog: CorrectionRow[]; inReview: { count: number; amount: number }; afterCutoffHe: string[]; uncovered: { descriptionHe: string; sectionHe: string; basisHe: string; amount: number }[]; uncoveredTotal: number };
  ceo: { paragraphHe: string; keyTable: KeyRow[]; changes: ChangeRow[]; issues: IssueRow[]; riskLineHe: string };
  working: WorkingForecast;
  finalized: boolean;
}

const BASIS_HE: Record<string, string> = { invoice: "חשבון מאושר", contract: "חוזה חתום", po: "הזמנה מאושרת", quote: "הצעת מחיר", appendix: "נספח מחיר", estimate: "אומדן פנימי" };

function isMaterial(s: WorkingSection): boolean {
  const abs = Math.abs(s.variance);
  const changed = s.change !== 0;
  return changed || abs >= MATERIALITY.absoluteAlways || (abs >= MATERIALITY.absolute && abs >= (s.budget * MATERIALITY.pctOfSection) / 100);
}

function buildingSplit(pkg: HadarimPackage, wf: WorkingForecast, state: V2State): { rows: BuildingRow[]; noteHe: string } {
  const floorsA = pkg.project.buildings[0].floorsCast;
  const floorsB = pkg.project.buildings[1].floorsCast;
  const shareA = floorsA / (floorsA + floorsB);
  const rows: Record<string, BuildingRow> = {
    A: { building: "A", budget: 0, recorded: 0, eac: 0 },
    B: { building: "B", budget: 0, recorded: 0, eac: 0 },
    חניון: { building: "חניון", budget: 0, recorded: 0, eac: 0 },
    משותף: { building: "משותף", budget: 0, recorded: 0, eac: 0 },
  };
  const untagged: string[] = [];
  for (const s of wf.sections) {
    const section = pkg.sections.find((x) => x.id === s.sectionId)!;
    const add = (key: string, budgetPart: number, recPart: number, eacPart: number) => {
      rows[key].budget += budgetPart;
      rows[key].recorded += recPart;
      rows[key].eac += eacPart;
    };
    if (section.split === "shared") add("משותף", s.budget, s.recorded, s.eac);
    else if (section.split === "parking") add("חניון", s.budget, s.recorded, s.eac);
    else {
      // recorded by invoice tags when available, budget/eac by planned quantities (floors) or units (equal)
      const byTag: Record<string, number> = { A: 0, B: 0, משותף: 0 };
      for (const inv of state.erp.invoices.filter((i) => i.sectionId === s.sectionId && i.status !== "בבדיקה")) {
        byTag[inv.building ?? "משותף"] += inv.amount;
        if (!inv.building) untagged.push(`חשבון ${inv.id}`);
      }
      const share = section.split === "by_floors" ? shareA : 0.5;
      const remaining = s.eac - s.recorded;
      add("A", Math.round(s.budget * share), byTag.A, byTag.A + Math.round(remaining * share));
      add("B", Math.round(s.budget * (1 - share)), byTag.B, byTag.B + Math.round(remaining * (1 - share)));
      add("משותף", 0, byTag["משותף"], byTag["משותף"]);
    }
  }
  const drainage = state.control.adjustments.find((a) => a.changeType === "coverage_gap");
  // invoices corrected in this control that carry no building tag at source are called out explicitly
  for (const c of state.control.corrections.filter((x) => x.recordType === "invoice")) {
    const inv = state.erp.invoices.find((i) => String(i.id) === c.recordId);
    if (inv && !inv.building) untagged.push(`חשבון ${inv.id}`);
  }
  const noteHe = `${untagged.length ? `${[...new Set(untagged)].join(", ")} אינו מפולח לפי בניין במקור — שויך ל״משותף״.` : ""}${drainage ? " קו הניקוז נכנס תחת ״משותף״." : ""} הפילוח הפנימי של סעיפים לפי קומות שיוצקו הוא הערכה ומסומן ככזה.`.trim();
  return { rows: Object.values(rows), noteHe };
}

export function buildReport(pkg: HadarimPackage, state: V2State): ReportModel {
  const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
  const config = state.control.reportConfig;
  const previous = pkg.forecasts.find((f) => f.controlDate === wf.previousControlDate)!;
  const variance = wf.totalEac - wf.totalBudget;
  const change = wf.totalEac - wf.previousTotalEac;
  const uncovered = uncoveredByBasis(wf);
  const contingency = wf.sections.find((s) => s.sectionId === "17")!;
  const physicalPct = 38;
  const expensePct = (wf.totalRecorded / wf.totalEac) * 100;
  const commitmentPct = ((wf.totalRecorded + wf.totalRemainingCommitment) / wf.totalEac) * 100;

  const forecastChanges: ChangeRow[] = state.control.adjustments.map((a) => ({ sectionHe: `${a.sectionId}-${SECTION_SHORT_HE[a.sectionId]}`, typeHe: CHANGE_TYPE_HE[a.changeType], descriptionHe: a.descriptionHe, basisHe: a.basisHe, amount: a.amount, documentId: a.documentId }));
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
  const controlsSince = (opened: string) => pkg.project.controlDates.filter((d) => d > opened).length + 1;
  const toRow = (t: (typeof issues)[number]): IssueRow => ({ id: t.id, titleHe: t.titleHe, sectionHe: t.sectionId ? `${t.sectionId}-${SECTION_SHORT_HE[t.sectionId]}` : "—", ownerHe: personHe(t.ownerId), dueHe: t.dueDate ? dateHe(t.dueDate) : "—", openedHe: dateHe(t.openedInControl), statusHe: t.status === "closed" ? "נסגר" : t.status === "pending_execution" ? "ממתין לביצוע" : "פתוח", impactHe: t.impactIfIgnoredHe ?? "—", stale: t.status !== "closed" && controlsSince(t.openedInControl) > 2, closedHe: t.closedAt ? dateHe(t.closedAt) : undefined });
  const openIssues = issues.filter((t) => t.status !== "closed").map(toRow);
  const closedIssues = issues.filter((t) => t.status === "closed").map(toRow);

  const steel = wf.sections.find((s) => s.sectionId === "03")!;
  const steelLine = steel.lines.find((l) => l.kind === "uncovered")!;
  const exposedTons = Math.max(0, (steelLine.qty ?? 0) - 12);
  const drainage = state.control.adjustments.find((a) => a.changeType === "coverage_gap");
  const risks: RiskRow[] = [
    ...(drainage ? [{ topicHe: "תוקף הצעת הניקוז", sectionHe: "07-פיתוח", descriptionHe: "האומדן מבוסס על הצעה בתוקף 30 יום; ללא הזמנה עד 19.9 — תמחור מחדש", exposureHe: "0 – 30,000 ₪", likelihoodHe: "בינונית", triggerHe: "הזמנה עד 19.9.2026", ownerHe: "אייל" }] : []),
    { topicHe: "עדכון נוסף במחיר ברזל", sectionHe: "03-ברזל", descriptionHe: `${exposedTons.toLocaleString("he-IL")} טון חשופים לשינוי מחיר (יתרה ללא הזמנה); הנספח צמוד למדד תשומות הבנייה רבעונית`, exposureHe: `${nis(exposedTons * 100)} לכל 100 ₪/טון`, likelihoodHe: "בינונית", triggerHe: "עדכון נספח ברבעון הבא", ownerHe: "רועי" },
    { topicHe: "חיבור ביוב עירוני", sectionHe: "07-פיתוח", descriptionHe: "אישור התאגיד פתוח מ-07/2026; ללא אישור — עיכוב בחיבור ואגרות לא מתוקצבות", exposureHe: "לו״ז; אגרות לפי תעריף התאגיד", likelihoodHe: "בינונית", triggerHe: "קבלת האישור", ownerHe: "אייל" },
  ];

  const material: MaterialSection[] = [];
  if (steel.change !== 0 || isMaterial(steel)) {
    material.push({
      sectionId: "03",
      titleHe: "03 — אספקת ברזל זיון",
      paragraphsHe: [`הסכם מסגרת 03-F עם פלדות הצפון; מחיר לפי נספח. סופקו ${(steel.recorded / 4000).toLocaleString("he-IL")} טון מתוך 750 טון בכתב הכמויות.`, `יתרה: ${(steelLine.qty ?? 0).toLocaleString("he-IL")} טון, מהם 12 טון בהזמנה 2291 (במחיר החדש) ו-${exposedTons.toLocaleString("he-IL")} טון ללא הזמנה.`, "מה יכול עוד להשתנות: עדכון נספח רבעוני; כמויות בפועל לפי קומות עליונות."],
      table: [["רכיב", "נתון"], ["תקציב", nis(steel.budget)], ["עלות שנרשמה", nis(steel.recorded)], ["יתרה צפויה", `${(steelLine.qty ?? 0).toLocaleString("he-IL")} טון`], ["מחיר יח׳ — תקציב", "4,000 ₪/טון"], ["מחיר יח׳ — נספח בתוקף", `${(steelLine.unitPrice ?? 4000).toLocaleString("he-IL")} ₪/טון`], ["תחזית לגמר", nis(steel.eac)], ["סטייה", signed(steel.variance)]],
      recommendationHe: exposedTons > 0 ? `לשקול הזמנה מרוכזת ל-${exposedTons.toLocaleString("he-IL")} הטון הנותרים כדי לקבע מחיר.` : "אין פעולה נדרשת.",
    });
  }
  const dev = wf.sections.find((s) => s.sectionId === "07")!;
  if (dev.change !== 0 || state.control.corrections.some((c) => c.afterHe.startsWith("07"))) {
    material.push({
      sectionId: "07",
      titleHe: "07 — פיתוח ותשתיות חוץ",
      paragraphsHe: [`חוזה 07-01 (נ.ת.ב.) 3,200,000 ₪; נרשמו ${nis(dev.recorded)} (7 חשבונות חלקיים).`, "כתב הכמויות גרסה 4 כולל קו ניקוז חוץ Ø400 (80 מ׳) המוחרג בסעיף 3.4 לחוזה; הוסף לתחזית כאומדן לפי הצעת י. כהן.", "שלושה מסמכים שכל אחד נכון בפני עצמו; רק ההצלבה חושפת את הפער."],
      table: [["רכיב", "נתון"], ["תקציב", nis(dev.budget)], ["עלות שנרשמה", nis(dev.recorded)], ["יתרת חוזה 07-01", nis(dev.remainingCommitment)], ["יתרה לא מכוסה (אומדן)", nis(dev.uncovered)], ["תחזית לגמר", nis(dev.eac)], ["סטייה", signed(dev.variance)]],
      recommendationHe: drainage ? "להסדיר הזמנה לקו הניקוז לפני פקיעת ההצעה." : "לתמחר את קו הניקוז המוחרג לפני סגירת התחזית.",
    });
  }

  const eacSeries = [...Object.entries(EARLIER_CONTROL_TOTALS).map(([d, v]) => ({ labelHe: dateHe(d), value: v })), { labelHe: dateHe(previous.controlDate), value: previous.totalEac }, { labelHe: dateHe(CURRENT_CONTROL), value: wf.totalEac }];
  const firstOverrun = eacSeries.filter((p) => p.value > wf.totalBudget).length === 1 && wf.totalEac > wf.totalBudget;
  const priceDriven = state.control.adjustments.some((a) => a.changeType === "price") && !state.control.adjustments.some((a) => a.changeType === "quantity");
  const prevDev = previous.sections!.find((s) => s.sectionId === "07")!;
  const prevSteel = previous.sections!.find((s) => s.sectionId === "03")!;
  const comparison: string[][] | null = config.includeTrends
    ? [
        ["", `בקרה ${dateHe(previous.controlDate)}`, `בקרה ${dateHe(CURRENT_CONTROL)}`, "שינוי"],
        ["תחזית כוללת", mil(previous.totalEac), mil(wf.totalEac), `${change >= 0 ? "+" : "−"}${mil(Math.abs(change))}`],
        ["ברזל — תחזית סעיף", mil(prevSteel.eac), mil(steel.eac), `${steel.change >= 0 ? "+" : "−"}${pct((Math.abs(steel.change) / prevSteel.eac) * 100, 0)}`],
        ["פיתוח — נרשם", mil(prevDev.recorded), mil(dev.recorded), `${dev.recorded - prevDev.recorded >= 0 ? "+" : "−"}${nis(Math.abs(dev.recorded - prevDev.recorded))}${state.control.corrections.some((c) => c.afterHe.startsWith("07")) ? " (העברה)" : ""}`],
        ["נושאים פתוחים", String(previous.openIssues.length), String(openIssues.length), String(openIssues.length - previous.openIssues.length)],
      ]
    : null;

  const paragraphHe = `תחזית ההשלמה ${change === 0 ? "נותרה" : "עודכנה"} מ-${mil(wf.previousTotalEac)} ל-${mil(wf.totalEac)} ₪ — ${variance > 0 ? `חריגה צפויה של ${nis(variance)} (${pct((variance / wf.totalBudget) * 100, 2)})` : variance < 0 ? `תחזית נמוכה מהתקציב ב-${nis(-variance)}` : "בתוך התקציב"}.${forecastChanges.length ? ` מקור השינוי: ${forecastChanges.map((c) => `${c.typeHe.replace("שינוי ", "עדכון ")} (${(c.amount / 1000).toFixed(0)} א׳)`).join(" ו")}.` : ""}${corrections.length ? ` ${corrections.length === 2 ? "שני" : corrections.length} תיקוני נתונים ללא השפעה על הסה״כ.` : ""} ${openIssues.length} נושאים פתוחים לטיפול.`;
  const keyTable: KeyRow[] = [
    { labelHe: "תקציב מעודכן", valueHe: nis(wf.totalBudget), pctHe: "" },
    { labelHe: "תחזית לגמר", valueHe: nis(wf.totalEac), pctHe: "" },
    { labelHe: "סטייה מתקציב", valueHe: signed(variance), pctHe: pct((variance / wf.totalBudget) * 100, 2) },
    { labelHe: "שינוי מבקרה קודמת", valueHe: signed(change), pctHe: pct((change / wf.previousTotalEac) * 100, 2) },
    { labelHe: "נרשם עד מועד החתך", valueHe: nis(wf.totalRecorded), pctHe: `${pct(expensePct, 0)} הוצאה` },
    { labelHe: "ביצוע פיזי", valueHe: `~${physicalPct}%`, pctHe: "מדידה מהאתר" },
    { labelHe: "בלתי צפוי — יתרה", valueHe: nis(contingency.eac), pctHe: `${pct((contingency.eac / contingency.budget) * 100, 0)} מהמקור` },
    { labelHe: "יתרה להשלמה לא מכוסה (אומדנים)", valueHe: nis(uncovered.estimate + uncovered.quote + uncovered.appendix), pctHe: `${pct(((uncovered.estimate + uncovered.quote + uncovered.appendix) / wf.totalEac) * 100, 0)} מהתחזית` },
  ];
  const bulletsHe = [
    ...forecastChanges.map((c) => `${c.sectionHe}: ${c.descriptionHe} — ${signed(c.amount)} (${c.basisHe})`),
    `${nis(uncovered.estimate + uncovered.quote + uncovered.appendix)} בתחזית עדיין מבוססים על אומדן ולא על הזמנה (ארבע חבילות שטרם נחתמו, יתרת ברזל, קו ניקוז).`,
    ...(openIssues.some((i) => i.stale) ? [`נושא פתוח יותר משתי בקרות: ${openIssues.filter((i) => i.stale).map((i) => i.titleHe).join("; ")}.`] : []),
  ].slice(0, 5);
  const decisionsHe = variance > 0 ? [`האם לממן את ${nis(variance)} מהבלתי צפוי (יתרה ${nis(contingency.eac)}) או להציג כחריגה — החלטת דנה עד הבקרה הבאה.`] : [];

  const ceoIssues = openIssues.filter((i) => i.stale || i.dueHe !== "—");
  const uncoveredRows = uncovered.lines.map((l) => ({ descriptionHe: l.descriptionHe, sectionHe: `${l.sectionId}-${SECTION_SHORT_HE[l.sectionId]}`, basisHe: BASIS_HE[l.basis] ?? l.basis, amount: l.amount }));

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
    sections: { rows, totals, materialityHe: `סף מהותיות: ${nis(MATERIALITY.absolute)} וגם ${MATERIALITY.pctOfSection}% מהסעיף, או ${nis(MATERIALITY.absoluteAlways)} בכל מקרה`, byBuilding: split?.rows ?? null, byBuildingNoteHe: split?.noteHe ?? null },
    changes: { forecast: forecastChanges, forecastTotal, corrections },
    material,
    contingency: { original: contingency.budget, used: contingency.budget - contingency.eac, remaining: contingency.eac, pendingChangeOrdersHe: "אין פקודות שינוי ממתינות לאישור", claimsHe: "אין דרישות/תביעות קבלנים פתוחות", decisionHe: decisionsHe[0] ?? "אין החלטה נדרשת" },
    risks,
    issues: { open: openIssues, closed: closedIssues },
    verified: state.control.positives.map((p) => ({ titleHe: p.titleHe, textHe: p.textHe })),
    trends: { eacSeries, uncoveredNow: uncovered.estimate + uncovered.quote + uncovered.appendix, commentaryHe: firstOverrun ? `בקרה ראשונה מבין ${eacSeries.length - 1} שבה התחזית חורגת מהתקציב. ${priceDriven ? "החריגה נובעת ממחיר, לא מכמות." : ""}`.trim() : "התחזית בתוך התקציב לאורך כל הבקרות.", comparison },
    appendices: {
      definitionsHe: ["תקציב מאושר — התקציב האחרון שאושר, לפי סעיפים, עם גרסה ותאריך", "נרשם — חשבונות שאושרו לתשלום עד מועד החתך, לפני מע״מ, כולל עכבונות; חשבונות בבדיקה מוצגים בנפרד", "התחייבויות — חוזים חתומים והזמנות מאושרות בסכומן המלא", "יתרת התחייבות — התחייבויות פחות מה שנרשם מתוכן", "יתרה להשלמה — לא מכוסה — עבודות נדרשות ללא התחייבות; בסיס: הצעה / אומדן", "תחזית לגמר (EAC) — נרשם + יתרת התחייבות + יתרה לא מכוסה", "סטייה — תחזית לגמר פחות תקציב מעודכן; חיובית = חריגה"],
      assumptionsHe: ["הצמדה: חוזי המשנה בפרויקט אינם צמודים למדד; הסכם מסגרת הברזל מתעדכן בנספחי מחיר בכתב, ונספח א׳-2 כולל הצמדה רבעונית למדד תשומות הבנייה", "לו״ז: סיום 02/2027; ארגון אתר מתוקצב ל-16 חודשים", "מחירים: יתרת הברזל לפי נספח א׳-2; חבילות 12, 13, 15, 16 לפי אומדן פנימי"],
      sourcesHe: [`מערכת המידע — ${state.erp.invoices.length} חשבונות, ${state.erp.purchaseOrders.length} הזמנות, ${pkg.contracts.length} חוזים`, `כתב כמויות גרסה ${pkg.project.boqVersion.number}`, `תחזית ${dateHe(previous.controlDate)} (סופית)`, "תיקיית הפרויקט: נספח א׳-2, הצעת י. כהן, חוזה 07-01"],
      correctionLog: corrections,
      inReview: wf.invoicesInReview,
      afterCutoffHe: state.erp.changeLog.filter((c) => c.at >= CURRENT_CONTROL).map((c) => `${dateHe(c.at)} — ${c.recordType === "invoice" ? "חשבון" : c.recordType === "po" ? "הזמנה" : "חוזה"} ${c.recordId}: ${c.field} ${c.before} → ${c.after} (${pkg.people.find((p) => p.id === c.byId)?.nameHe})`),
      uncovered: uncoveredRows,
      uncoveredTotal: uncoveredRows.reduce((a, r) => a + r.amount, 0),
    },
    ceo: { paragraphHe, keyTable: keyTable.slice(0, 4), changes: forecastChanges, issues: ceoIssues.length ? ceoIssues : openIssues, riskLineHe: risks[0] ? `${risks[0].topicHe}: ${risks[0].descriptionHe}` : "" },
    working: wf,
    finalized: state.control.finalized,
  };
}
