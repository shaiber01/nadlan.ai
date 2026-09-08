import { documentFacts } from "../data/documents";
import { priceAppendixAt } from "../data/generate";
import type { HChangeLogEntry, HForecastVersion, HInvoice, HPurchaseOrder, HadarimPackage, SectionId } from "../data/types";

/**
 * The four deterministic checks of the Hadarim control (data spec §9), plus the verified-match positive.
 * Pure functions: they read the current ERP state (which the presenter may have edited live) and the draft forecast.
 */

export interface HSource {
  kind: "invoice" | "po" | "contract" | "document" | "forecast" | "boq" | "changelog" | "history" | "section";
  refId: string;
  labelHe: string;
  fieldHe?: string;
  valueHe?: string;
  documentId?: string;
  anchor?: string;
}

export interface HDecisionOption {
  id: string;
  labelHe: string;
}

export type FindingKind = "allocation" | "unit" | "price" | "coverage";

export interface HFinding {
  id: string;
  kind: FindingKind;
  titleHe: string;
  problemHe: string;
  sources: HSource[];
  checkHe?: string;
  meaningHe: string;
  impact: { kind: "none" | "amount" | "unknown"; amount: number; labelHe: string };
  decision: { questionHe: string; options: HDecisionOption[]; freeText: boolean };
  sectionId: SectionId;
  record: { type: "invoice" | "po" | "forecast_line" | "boq_line"; id: string };
  detailsTable?: string[][];
  notesHe?: string[];
}

export interface HPositive {
  id: string;
  titleHe: string;
  textHe: string;
  sectionId: SectionId;
  sources: HSource[];
}

export interface ErpState {
  invoices: HInvoice[];
  purchaseOrders: HPurchaseOrder[];
  changeLog: HChangeLogEntry[];
}

export interface CheckResult {
  findings: HFinding[];
  positives: HPositive[];
  checkedHe: string[];
}

export const SECTION_SHORT_HE: Record<SectionId, string> = {
  "01": "ארגון אתר",
  "02": "שלד",
  "03": "ברזל",
  "04": "עפר ודיפון",
  "05": "איטום",
  "06": "בנייה וטיח",
  "07": "פיתוח",
  "08": "אינסטלציה",
  "09": "חשמל",
  "10": "מיזוג",
  "11": "אלומיניום",
  "12": "ריצוף",
  "13": "נגרות",
  "14": "מעליות",
  "15": "צבע וגבס",
  "16": "מערכות חניון",
  "17": "בלתי צפוי",
  "18": "הנהלה",
};

export function sectionLabel(id: SectionId): string {
  return `${id}-${SECTION_SHORT_HE[id]}`;
}

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const num = (v: number) => v.toLocaleString("he-IL");
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");

// ---------------------------------------------------------------------------
// Check 1 — allocation of an invoice versus its contract, supplier history and change log
// ---------------------------------------------------------------------------

function checkAllocation(pkg: HadarimPackage, erp: ErpState): HFinding[] {
  const out: HFinding[] = [];
  for (const inv of erp.invoices) {
    if (!inv.contractId) continue;
    const contract = pkg.contracts.find((c) => c.id === inv.contractId);
    if (!contract || contract.sectionId === inv.sectionId) continue;
    const supplier = pkg.suppliers.find((s) => s.id === inv.supplierId);
    const wrong = inv.sectionId;
    const right = contract.sectionId;
    const wrongSection = pkg.sections.find((s) => s.id === wrong)!;
    const wrongMainContract = pkg.contracts.find((c) => c.id === wrongSection.contractIds[0]);
    const history = erp.invoices.filter((i) => i.supplierId === inv.supplierId && i.id !== inv.id);
    const historySections = [...new Set(history.map((i) => i.sectionId))];
    const log = erp.changeLog.filter((c) => c.recordType === "invoice" && c.recordId === String(inv.id));
    const sources: HSource[] = [
      { kind: "invoice", refId: String(inv.id), labelHe: `חשבון ${inv.id} · ${supplier?.nameHe} · ${nis(inv.amount)} · סעיף: ${sectionLabel(wrong)} · תיאור: ״${inv.descriptionHe}״`, fieldHe: "סעיף תקציבי", valueHe: sectionLabel(wrong), documentId: inv.attachmentId ?? undefined, anchor: "description" },
      { kind: "contract", refId: contract.id, labelHe: `חוזה ${supplier?.nameHe} (חוזה ${contract.id}) · היקף: ״${contract.scopeHe}״ · אין סעיפי ${SECTION_SHORT_HE[wrong]}`, documentId: contract.documentId, anchor: "included" },
    ];
    if (wrongMainContract) {
      const mainSupplier = pkg.suppliers.find((s) => s.id === wrongMainContract.supplierId);
      sources.push({ kind: "contract", refId: wrongMainContract.id, labelHe: `חוזה ${SECTION_SHORT_HE[wrong]} (${mainSupplier?.nameHe}, חוזה ${wrongMainContract.id}) · ${supplier?.nameHe} אינו קבלן משנה מאושר` });
    }
    if (history.length) sources.push({ kind: "history", refId: inv.supplierId, labelHe: `${num(history.length)} חשבונות קודמים של ${supplier?.nameHe} — כולם שויכו ל-${historySections.map(sectionLabel).join(", ")}` });
    for (const entry of log) sources.push({ kind: "changelog", refId: entry.id, labelHe: `יומן שינויים: ${entry.field} · ${entry.after} · ${dateHe(entry.at)} ${entry.at.slice(11, 16)} · ${pkg.people.find((p) => p.id === entry.byId)?.nameHe}` });
    out.push({
      id: `F-ALLOC-${inv.id}`,
      kind: "allocation",
      titleHe: `שיוך חשבון ${inv.id} — ${supplier?.nameHe}`,
      problemHe: `חשבון ${inv.id} של ${supplier?.nameHe}, ${nis(inv.amount)}, שויך לסעיף ${sectionLabel(wrong)}. תיאור החשבון והחוזה מצביעים על ${sectionLabel(right)} ${pkg.sections.find((s) => s.id === right)?.nameHe.replace(SECTION_SHORT_HE[right], "").trim() ? "" : ""}.`.replace(" .", "."),
      sources,
      meaningHe: `${SECTION_SHORT_HE[wrong]} יוצג בחריגה של ${nis(inv.amount)} שאינה קיימת; ${SECTION_SHORT_HE[right]} יוצג עם יתרה גבוהה מהאמיתית. הסה״כ לפרויקט לא משתנה.`,
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: { questionHe: `האם העבודה שייכת ל${SECTION_SHORT_HE[right]}?`, options: [{ id: "yes_target", labelHe: `כן, ל${SECTION_SHORT_HE[right]}` }, { id: "no_stay", labelHe: `לא, נשאר ב${SECTION_SHORT_HE[wrong]}` }, { id: "unsure", labelHe: "לא בטוח" }], freeText: true },
      sectionId: wrong,
      record: { type: "invoice", id: String(inv.id) },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 2 — units and quantities on purchase orders versus the attached quote and the price appendix
// ---------------------------------------------------------------------------

function checkUnits(pkg: HadarimPackage, erp: ErpState): HFinding[] {
  const out: HFinding[] = [];
  for (const po of erp.purchaseOrders) {
    if (po.status !== "פתוחה") continue;
    const implausibleTonPrice = po.unit === "טון" && po.unitPrice < 200;
    if (!implausibleTonPrice) continue;
    const supplier = pkg.suppliers.find((s) => s.id === po.supplierId);
    const facts = po.attachmentId === "quote_pladot_12t" ? documentFacts.quote_pladot_12t : null;
    const contract = po.contractId ? pkg.contracts.find((c) => c.id === po.contractId) : undefined;
    const appendix = contract ? priceAppendixAt(contract, po.date) : null;
    const tons = facts ? facts.qtyTon : po.qty / 1000;
    const pricePerTon = facts ? facts.pricePerTon : po.unitPrice * 1000;
    const sources: HSource[] = [
      { kind: "po", refId: String(po.id), labelHe: `הזמנה ${po.id} · ${supplier?.nameHe} · כמות: ${num(po.qty)} · יחידה: ${po.unit} · מחיר יח׳: ${po.unitPrice.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪ · סכום: ${nis(po.amount)}`, fieldHe: "כמות / יחידה / מחיר יח׳", valueHe: `${num(po.qty)} ${po.unit} × ${po.unitPrice}` },
    ];
    if (facts) sources.push({ kind: "document", refId: "quote_pladot_12t", labelHe: `הצעת ספק מצורפת: ״ברזל זיון מצולע — ${num(facts.qtyKg)} ק״ג (${facts.qtyTon} טון) × ${num(facts.pricePerTon)} ₪/טון = ${nis(facts.amount)}״`, documentId: "quote_pladot_12t", anchor: "line" });
    if (appendix) sources.push({ kind: "document", refId: appendix.documentId, labelHe: `נספח מחיר ${supplier?.nameHe}: ${num(appendix.pricePerTon)} ₪/טון`, documentId: appendix.documentId, anchor: "price" });
    out.push({
      id: `F-UNIT-${po.id}`,
      kind: "unit",
      titleHe: `יחידת מידה בהזמנת ברזל ${po.id}`,
      problemHe: `בהזמנת רכש ${po.id} (ברזל זיון) הכמות היא ${num(po.qty)} והיחידה ${po.unit}, אך מחיר היחידה שנרשם הוא ${po.unitPrice.toLocaleString("he-IL", { minimumFractionDigits: 1 })} ₪ — לא ייתכן לטון. הצעת הספק המצורפת: ${tons} טון ב-${num(pricePerTon)} ₪/טון.`,
      sources,
      checkHe: `הסכום ${nis(po.amount)} נכון. הכמות והמחיר הוזנו בק״ג (${num(po.qty)} × ${po.unitPrice}), אך שדה היחידה אומר טון.`,
      meaningHe: `הסכום הכספי תקין — לכן אף אחד לא שם לב. אבל כל חישוב שמסתמך על שדה הכמות — יתרת ברזל להזמנה, קצב צריכה, השוואה לכתב כמויות — רואה ${num(po.qty)} טון במקום ${tons}.`,
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: { questionHe: `ההזמנה היא ל-${tons} טון?`, options: [{ id: "yes_tons", labelHe: `כן, ${tons} טון` }, { id: "open_quote", labelHe: "לא — פתח את ההצעה" }], freeText: false },
      sectionId: po.sectionId,
      record: { type: "po", id: String(po.id) },
      detailsTable: [["שדה", "בהזמנה", "לפי ההצעה"], ["כמות", num(po.qty), String(tons)], ["יחידה", po.unit, "טון"], ["מחיר יח׳", `${po.unitPrice} ₪`, `${num(pricePerTon)} ₪`], ["סכום", nis(po.amount), nis(tons * pricePerTon)]],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 3 — forecast unit prices versus the price appendix in force at the control date
// ---------------------------------------------------------------------------

function checkPrices(pkg: HadarimPackage, erp: ErpState, draft: HForecastVersion, controlDate: string): HFinding[] {
  const out: HFinding[] = [];
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.sections && f.controlDate < controlDate).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  for (const sectionForecast of draft.sections ?? []) {
    for (const line of sectionForecast.lines) {
      if (line.basis !== "appendix" || line.unitPrice == null || line.qty == null) continue;
      const contract = pkg.contracts.find((c) => c.sectionId === line.sectionId && c.priceAppendices?.length);
      if (!contract) continue;
      const current = priceAppendixAt(contract, controlDate);
      if (!current || current.pricePerTon <= line.unitPrice) continue;
      const supplier = pkg.suppliers.find((s) => s.id === contract.supplierId);
      const section = pkg.sections.find((s) => s.id === line.sectionId)!;
      const oldCost = line.amount;
      const newCost = line.qty * current.pricePerTon;
      const impact = newCost - oldCost;
      const openAtNewPrice = erp.purchaseOrders.filter((p) => p.contractId === contract.id && p.status === "פתוחה");
      const closedOld = erp.purchaseOrders.filter((p) => p.contractId === contract.id && p.status === "סגורה" && p.unitPrice < current.pricePerTon && p.date < current.validFrom);
      const sources: HSource[] = [
        { kind: "forecast", refId: line.id, labelHe: `תחזית ${dateHe(previous?.controlDate ?? controlDate)} · ${section.nameHe} · יתרה ${num(line.qty)} ${line.unit} × ${num(line.unitPrice)} ₪ = ${nis(oldCost)}`, fieldHe: "מחיר יח׳", valueHe: `${num(line.unitPrice)} ₪/טון` },
        { kind: "document", refId: current.documentId, labelHe: `נספח מחיר · ${supplier?.nameHe} · בתוקף מ-${dateHe(current.validFrom)} · ${num(current.pricePerTon)} ₪/טון`, documentId: current.documentId, anchor: "price" },
        ...openAtNewPrice.map((p) => ({ kind: "po" as const, refId: String(p.id), labelHe: `הזמנה ${p.id} · ${num(p.attachmentId === "quote_pladot_12t" ? documentFacts.quote_pladot_12t.pricePerTon : p.unitPrice)} ₪/טון — המחיר החדש כבר בשימוש בפועל` })),
      ];
      const recorded = sectionForecast.recorded;
      out.push({
        id: `F-PRICE-${line.id}`,
        kind: "price",
        titleHe: `מחיר יתרת ברזל בתחזית`,
        problemHe: `יתרת הברזל בתחזית (${num(line.qty)} ${line.unit}) מתומחרת לפי ${num(line.unitPrice)} ₪/טון. נספח המחיר העדכני של ${supplier?.nameHe} קובע ${num(current.pricePerTon)} ₪/טון מ-${dateHe(current.validFrom)}.`,
        sources,
        checkHe: `האם חלק מ-${num(line.qty)} הטון מכוסה בהזמנות במחיר הישן? ${openAtNewPrice.length === 1 ? `הזמנה פתוחה אחת בלבד (${openAtNewPrice[0].id}, ${openAtNewPrice[0].attachmentId ? documentFacts.quote_pladot_12t.qtyTon : openAtNewPrice[0].qty} טון) — כבר במחיר החדש.` : `${openAtNewPrice.length} הזמנות פתוחות — כולן במחיר החדש.`}`,
        meaningHe: `תחזית סעיף ${SECTION_SHORT_HE[line.sectionId]}: ${nis(recorded)} + ${nis(newCost)} = ${nis(recorded + newCost)} · תוספת ${nis(impact)} · חריגה של ${(((recorded + newCost - section.budget) / section.budget) * 100).toFixed(0)}% מתקציב הסעיף.`,
        impact: { kind: "amount", amount: impact, labelHe: `+${nis(impact)}` },
        decision: { questionHe: "המחיר החדש חל על כל היתרה?", options: [{ id: "all", labelHe: `כן, על כל ${num(line.qty)} הטון` }, { id: "partial", labelHe: "לא — חלק במחיר ישן" }], freeText: false },
        sectionId: line.sectionId,
        record: { type: "forecast_line", id: line.id },
        detailsTable: [["רכיב", "נתון"], ["תקציב", nis(section.budget)], ["עלות שנרשמה", nis(recorded)], ["יתרה צפויה", `${num(line.qty)} ${line.unit}`], ["עלות היתרה — תחזית קודמת", nis(oldCost)], ["עלות היתרה — לפי הנספח", nis(newCost)]],
        notesHe: closedOld.map((p) => `הזמנה ${p.id} (${num(p.qty)} טון ב-${num(p.unitPrice)} ₪/טון) הונפקה ב-${dateHe(p.date)}, לפני תוקף הנספח, וסופקה במלואה — תקינה, לא סומנה.`),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 4 — BOQ coverage versus contracts and the forecast
// ---------------------------------------------------------------------------

function checkCoverage(pkg: HadarimPackage, draft: HForecastVersion): HFinding[] {
  const out: HFinding[] = [];
  for (const line of pkg.boq) {
    if (line.coverage !== "excluded") continue;
    const sectionForecast = draft.sections?.find((s) => s.sectionId === line.sectionId);
    const estimated = sectionForecast?.lines.some((l) => l.kind === "uncovered" && l.sourceRef?.includes(line.id));
    if (estimated) continue;
    const section = pkg.sections.find((s) => s.id === line.sectionId)!;
    const contract = pkg.contracts.find((c) => c.sectionId === line.sectionId && c.amount != null);
    const exclusion = contract?.exclusions.find((e) => e.textHe.includes("ניקוז")) ?? contract?.exclusions[0];
    const supplier = contract ? pkg.suppliers.find((s) => s.id === contract.supplierId) : undefined;
    const previous = pkg.forecasts.filter((f) => f.status === "final" && f.sections).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
    const previousSection = previous?.sections?.find((s) => s.sectionId === line.sectionId);
    out.push({
      id: `F-COV-${line.id}`,
      kind: "coverage",
      titleHe: `${line.descriptionHe.split(",")[0]} — לא מכוסה בחוזה`,
      problemHe: `בכתב הכמויות (גרסה ${pkg.project.boqVersion.number}) מופיע ${line.descriptionHe.split(",")[0]}, ${num(line.qty)} ${line.unit}. בחוזה ${supplier?.nameHe} העבודה מוחרגת במפורש. בתחזית הקודמת חבילת ה${SECTION_SHORT_HE[line.sectionId]} סומנה ״מכוסה במלואה בחוזה״ ואין אומדן נפרד.`,
      sources: [
        { kind: "boq", refId: line.id, labelHe: `כתב כמויות גרסה ${pkg.project.boqVersion.number} · פרק ${line.chapter} · ״${line.descriptionHe} — ${num(line.qty)} ${line.unit}״`, documentId: "boq_v4_ch57", anchor: "line" },
        ...(contract ? [{ kind: "contract" as const, refId: contract.id, labelHe: `חוזה ${supplier?.nameHe} · סעיף ${exclusion?.clause}: ״${exclusion?.textHe}״`, documentId: contract.documentId, anchor: "exclusion" }] : []),
        { kind: "forecast", refId: `${previous?.controlDate ?? ""}-${line.sectionId}`, labelHe: `תחזית ${dateHe(previous?.controlDate ?? "")} · חבילת ${SECTION_SHORT_HE[line.sectionId]} · ״${previousSection?.coverageNoteHe ?? "מכוסה בחוזה"}״ · אומדן נוסף: 0` },
      ],
      meaningHe: "יש עבודה בכתב הכמויות שאין לה חוזה ואין לה אומדן.",
      impact: { kind: "unknown", amount: 0, labelHe: "טרם הוערך" },
      decision: { questionHe: `${line.descriptionHe.split(",")[0]} מכוסה בחוזה אחר, יבוצע בביצוע עצמי, או שצריך להזמין אותו?`, options: [{ id: "other_contract", labelHe: "חוזה אחר" }, { id: "self", labelHe: "ביצוע עצמי" }, { id: "order", labelHe: "צריך להזמין" }], freeText: true },
      sectionId: line.sectionId,
      record: { type: "boq_line", id: line.id },
      notesHe: [`${section.nameHe}: יתר שורות הפרק מכוסות בחוזה ${contract?.id}`],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verified matches ("positive findings"): only what was actually checked line by line
// ---------------------------------------------------------------------------

function positives(pkg: HadarimPackage, draft: HForecastVersion): HPositive[] {
  const out: HPositive[] = [];
  for (const contract of pkg.contracts) {
    if (!contract.boqMatchVerified) continue;
    const lines = pkg.boq.filter((l) => l.sectionId === contract.sectionId);
    if (lines.length === 0 || !lines.every((l) => l.coverage === "covered" && l.coveredByContractId === contract.id)) continue;
    const sf = draft.sections?.find((s) => s.sectionId === contract.sectionId);
    if (!sf || sf.eac > sf.budget) continue;
    const section = pkg.sections.find((s) => s.id === contract.sectionId)!;
    out.push({
      id: `P-${contract.id}`,
      titleHe: `${section.nameHe}: היקף כתב הכמויות תואם לחוזה (100%)`,
      textHe: `${section.nameHe}: היקף כתב הכמויות תואם לחוזה (100%), התחזית בתוך התקציב. מוצג כהתאמה שנבדקה, לא כחיסכון.`,
      sectionId: contract.sectionId,
      sources: [{ kind: "contract", refId: contract.id, labelHe: `חוזה ${contract.id} · ${lines.length} שורות כתב כמויות בפרק ${lines[0].chapter} תואמות להיקף החוזה` }],
    });
  }
  return out;
}

export const CHECK_STEPS_HE = ["שיוך חשבונות מול חוזים והיסטוריית הספק", "יחידות וכמויות בהזמנות מול הצעות ונספחי מחיר", "מחירים בתחזית מול נספחי מחיר בתוקף", "כיסוי חוזי מול כתב כמויות"];

export function runChecks(pkg: HadarimPackage, erp: ErpState, draft: HForecastVersion, controlDate: string): CheckResult {
  const findings = [...checkAllocation(pkg, erp), ...checkUnits(pkg, erp), ...checkPrices(pkg, erp, draft, controlDate), ...checkCoverage(pkg, draft)];
  return { findings, positives: positives(pkg, draft), checkedHe: CHECK_STEPS_HE };
}
