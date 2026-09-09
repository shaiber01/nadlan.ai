import { priceAppendixAt } from "../data/generate";
import type { HBoqLine, HContract, HDocument, HForecastVersion, HInvoice, HOpenIssue, HPriceAppendix, HPurchaseOrder, HadarimPackage, QuoteFacts, SectionId } from "../data/types";
import type { ErpState } from "./model";
import { pkg } from "./package";

/**
 * The control checks: generic rules over any project's data. Each finding carries its sources (records
 * and document pages with anchors), its meaning, its estimated effect on the forecast and the decision
 * it needs. Nothing here knows about a specific invoice, order, supplier or document — everything is
 * derived from the package (contracts, appendices, BOQ, forecast) and the live ERP state.
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

/** Control findings (decided card by card) and data-quality findings (the record itself is inconsistent). */
export type FindingKind = "allocation" | "unit" | "price" | "coverage" | "duplicate" | "contract_overrun" | "cumulative" | "retention" | "dates" | "review_aging";
export const DATA_QUALITY_KINDS: FindingKind[] = ["duplicate", "contract_overrun", "cumulative", "retention", "dates", "review_aging"];

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
  record: { type: "invoice" | "po" | "forecast_line" | "boq_line" | "contract"; id: string };
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

export interface CheckResult {
  findings: HFinding[];
  positives: HPositive[];
  checkedHe: string[];
}

/** Short name of a section from the project's data ("ברזל"); the id when the section is unknown. */
export function sectionShort(id: SectionId, p: HadarimPackage = pkg): string {
  return p.sections.find((s) => s.id === id)?.shortHe ?? id;
}

/** "03-ברזל" */
export function sectionLabel(id: SectionId, p: HadarimPackage = pkg): string {
  return `${id}-${sectionShort(id, p)}`;
}

/** The reserve section (kind = contingency): reported on its own, never counted as an estimate. */
export function isContingency(id: SectionId, p: HadarimPackage = pkg): boolean {
  return p.sections.find((s) => s.id === id)?.kind === "contingency";
}

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const num = (v: number) => v.toLocaleString("he-IL");
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");
const KG_PER_TON = 1000;

// ---------------------------------------------------------------------------
// Document facts (what an extraction step produces) normalised for the checks
// ---------------------------------------------------------------------------

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Quote/order facts of a document: quantity, unit, unit price, amount, validity, BOQ line. Tons win over kg when both are present. */
export function quoteFacts(doc: HDocument | undefined): QuoteFacts | null {
  const f = doc?.facts;
  if (!f) return null;
  const qtyTon = asNum(f.qtyTon);
  const qty = qtyTon ?? asNum(f.qty);
  const unit = qtyTon != null ? "טון" : asStr(f.unit);
  const unitPrice = asNum(f.pricePerTon) ?? asNum(f.unitPrice);
  const amount = asNum(f.amount);
  if (qty == null && unitPrice == null && amount == null) return null;
  return { qty, unit, unitPrice, amount, validUntil: asStr(f.validUntil), boqLineId: asStr(f.boqLineId) };
}

export function documentById(pkg: HadarimPackage, id: string | null | undefined): HDocument | undefined {
  return id ? pkg.documents.find((d) => d.id === id) : undefined;
}

/** The BOQ page document that shows a given BOQ line, if any. */
export function boqPageFor(pkg: HadarimPackage, boqLineId: string): HDocument | undefined {
  return pkg.documents.find((d) => d.kind === "boq_page" && (asStr(d.facts?.boqLineId) === boqLineId || JSON.stringify(d.blocks).includes(boqLineId)));
}

export function appendixUnit(a: HPriceAppendix): string {
  return a.unit ?? "טון";
}

/** The framework agreement of a section (a contract priced by appendices), if it has one. */
export function contractWithAppendices(pkg: HadarimPackage, sectionId: SectionId): HContract | undefined {
  return pkg.contracts.find((c) => c.sectionId === sectionId && c.priceAppendices?.length);
}

/**
 * What a purchase order should say, derived from its attached quote when there is one and otherwise from
 * the kg-keyed-as-tons reading (quantity and unit price off by a factor of 1000, amount unchanged).
 */
export function proposedOrderCorrection(pkg: HadarimPackage, po: HPurchaseOrder): { qty: number; unit: string; unitPrice: number; fromQuote: boolean; documentId?: string } {
  const doc = documentById(pkg, po.attachmentId);
  const facts = quoteFacts(doc);
  if (facts && (facts.qty != null || facts.unitPrice != null)) {
    const qty = facts.qty ?? po.qty;
    const unitPrice = facts.unitPrice ?? (qty ? po.amount / qty : po.unitPrice);
    return { qty, unit: facts.unit ?? po.unit, unitPrice, fromQuote: true, documentId: doc!.id };
  }
  return { qty: po.qty / KG_PER_TON, unit: po.unit, unitPrice: po.unitPrice * KG_PER_TON, fromQuote: false };
}

/** A quote in the project folder for a BOQ line: by the extracted BOQ reference first, else by matching words in the title. */
export function findQuoteFor(pkg: HadarimPackage, line: HBoqLine): HDocument | undefined {
  const byRef = pkg.documents.find((d) => d.kind === "quote" && quoteFacts(d)?.boqLineId === line.id);
  if (byRef) return byRef;
  const keywords = line.descriptionHe.split(/[\s,()״"]+/).filter((w) => w.length >= 4);
  return pkg.documents.find((d) => d.kind === "quote" && keywords.filter((w) => d.titleHe.includes(w)).length >= Math.min(2, keywords.length));
}

/** Issues carried into a control from the last final forecast before it (open and recently closed). */
export function carriedIssues(pkg: HadarimPackage, controlDate: string): HOpenIssue[] {
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.controlDate < controlDate).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  return (previous?.openIssues ?? []).map((o) => ({ ...o }));
}

// ---------------------------------------------------------------------------
// Check 1 — allocation of an invoice versus its contract, supplier history and change log
// ---------------------------------------------------------------------------

export function checkAllocation(pkg: HadarimPackage, erp: ErpState, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const inv of erp.invoices) {
    if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) continue;
    if (!inv.contractId) continue;
    const contract = pkg.contracts.find((c) => c.id === inv.contractId);
    if (!contract || contract.sectionId === inv.sectionId) continue;
    const supplier = pkg.suppliers.find((s) => s.id === inv.supplierId);
    const wrong = inv.sectionId;
    const right = contract.sectionId;
    const wrongSection = pkg.sections.find((s) => s.id === wrong);
    const wrongMainContract = wrongSection?.contractIds[0] ? pkg.contracts.find((c) => c.id === wrongSection.contractIds[0]) : undefined;
    const history = erp.invoices.filter((i) => i.supplierId === inv.supplierId && i.id !== inv.id);
    const historySections = [...new Set(history.map((i) => i.sectionId))];
    const log = erp.changeLog.filter((c) => c.recordType === "invoice" && c.recordId === String(inv.id));
    const sources: HSource[] = [
      { kind: "invoice", refId: String(inv.id), labelHe: `חשבון ${inv.id} · ${supplier?.nameHe} · ${nis(inv.amount)} · סעיף: ${sectionLabel(wrong)} · תיאור: ״${inv.descriptionHe}״`, fieldHe: "סעיף תקציבי", valueHe: sectionLabel(wrong), documentId: inv.attachmentId ?? undefined, anchor: "description" },
      { kind: "contract", refId: contract.id, labelHe: `חוזה ${supplier?.nameHe} (חוזה ${contract.id}) · היקף: ״${contract.scopeHe}״ · אין סעיפי ${sectionShort(wrong)}`, documentId: contract.documentId, anchor: "included" },
    ];
    if (wrongMainContract) {
      const mainSupplier = pkg.suppliers.find((s) => s.id === wrongMainContract.supplierId);
      sources.push({ kind: "contract", refId: wrongMainContract.id, labelHe: `חוזה ${sectionShort(wrong)} (${mainSupplier?.nameHe}, חוזה ${wrongMainContract.id}) · ${supplier?.nameHe} אינו קבלן משנה מאושר` });
    }
    if (history.length) sources.push({ kind: "history", refId: inv.supplierId, labelHe: `${num(history.length)} חשבונות קודמים של ${supplier?.nameHe} — כולם שויכו ל-${historySections.map((id) => sectionLabel(id, pkg)).join(", ")}` });
    for (const entry of log) sources.push({ kind: "changelog", refId: entry.id, labelHe: `יומן שינויים: ${entry.field} · ${entry.after} · ${dateHe(entry.at)} ${entry.at.slice(11, 16)} · ${pkg.people.find((p) => p.id === entry.byId)?.nameHe ?? entry.byId}` });
    out.push({
      id: `F-ALLOC-${inv.id}`,
      kind: "allocation",
      titleHe: `שיוך חשבון ${inv.id} — ${supplier?.nameHe}`,
      problemHe: `חשבון ${inv.id} של ${supplier?.nameHe}, ${nis(inv.amount)}, שויך לסעיף ${sectionLabel(wrong)}. תיאור החשבון והחוזה מצביעים על ${sectionLabel(right)}.`,
      sources,
      meaningHe: `${sectionShort(wrong)} יוצג בחריגה של ${nis(inv.amount)} שאינה קיימת; ${sectionShort(right)} יוצג עם יתרה גבוהה מהאמיתית. הסה״כ לפרויקט לא משתנה.`,
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: { questionHe: `האם העבודה שייכת ל${sectionShort(right)}?`, options: [{ id: "yes_target", labelHe: `כן, ל${sectionShort(right)}` }, { id: "no_stay", labelHe: `לא, נשאר ב${sectionShort(wrong)}` }, { id: "unsure", labelHe: "לא בטוח" }], freeText: true },
      sectionId: wrong,
      record: { type: "invoice", id: String(inv.id) },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 2 — units and quantities on purchase orders versus the attached quote and the price appendix
// ---------------------------------------------------------------------------

/**
 * An order is suspicious when (a) its quantity/unit/price disagree with the attached quote while the
 * amount agrees (the classic kg-keyed-as-tons), or (b) without a quote, its unit price is implausible for
 * the unit given the price appendix in force (about 1/1000 of it).
 */
export function checkUnits(pkg: HadarimPackage, erp: ErpState, onlyPoId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const po of erp.purchaseOrders) {
    if (onlyPoId != null && po.id !== onlyPoId) continue;
    if (po.status !== "פתוחה") continue;
    const supplier = pkg.suppliers.find((s) => s.id === po.supplierId);
    const contract = po.contractId ? pkg.contracts.find((c) => c.id === po.contractId) : undefined;
    const appendix = contract ? priceAppendixAt(contract, po.date) : null;
    const quoteDoc = documentById(pkg, po.attachmentId);
    const facts = quoteFacts(quoteDoc);
    const amountMatchesQuote = facts?.amount != null && Math.abs(facts.amount - po.amount) < 1;
    const factsDisagree = !!facts && amountMatchesQuote && ((facts.qty != null && facts.qty !== po.qty) || (facts.unit && facts.unit !== po.unit) || (facts.unitPrice != null && Math.abs(facts.unitPrice - po.unitPrice) > 0.005));
    const kgLikeTon = !facts && !!appendix && po.unit === appendixUnit(appendix) && po.unitPrice > 0 && Math.abs(po.unitPrice * KG_PER_TON - appendix.pricePerTon) / appendix.pricePerTon < 0.1;
    if (!factsDisagree && !kgLikeTon) continue;

    const rightQty = facts?.qty ?? po.qty / KG_PER_TON;
    const rightUnit = facts?.unit ?? po.unit;
    const rightPrice = facts?.unitPrice ?? po.unitPrice * KG_PER_TON;
    const item = po.descriptionHe.split(",")[0];
    const sources: HSource[] = [
      { kind: "po", refId: String(po.id), labelHe: `הזמנה ${po.id} · ${supplier?.nameHe} · כמות: ${num(po.qty)} · יחידה: ${po.unit} · מחיר יח׳: ${po.unitPrice.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪ · סכום: ${nis(po.amount)}`, fieldHe: "כמות / יחידה / מחיר יח׳", valueHe: `${num(po.qty)} ${po.unit} × ${po.unitPrice}` },
    ];
    if (quoteDoc && facts) sources.push({ kind: "document", refId: quoteDoc.id, labelHe: `הצעת ספק מצורפת: ״${item} — ${facts.qty != null ? `${num(facts.qty)} ${facts.unit ?? ""}` : ""}${facts.unitPrice != null ? ` × ${num(facts.unitPrice)} ₪/${facts.unit ?? "יח׳"}` : ""}${facts.amount != null ? ` = ${nis(facts.amount)}` : ""}״`, documentId: quoteDoc.id, anchor: "line" });
    if (appendix) sources.push({ kind: "document", refId: appendix.documentId, labelHe: `נספח מחיר ${supplier?.nameHe}: ${num(appendix.pricePerTon)} ₪/${appendixUnit(appendix)}`, documentId: appendix.documentId, anchor: "price" });
    out.push({
      id: `F-UNIT-${po.id}`,
      kind: "unit",
      titleHe: `יחידת מידה בהזמנה ${po.id} — ${item}`,
      problemHe: `בהזמנת רכש ${po.id} (${item}) הכמות היא ${num(po.qty)} והיחידה ${po.unit}, אך מחיר היחידה שנרשם הוא ${po.unitPrice.toLocaleString("he-IL", { minimumFractionDigits: 1 })} ₪ — לא ייתכן ל${po.unit}. ${facts ? `הצעת הספק המצורפת: ${num(rightQty)} ${rightUnit} ב-${num(rightPrice)} ₪/${rightUnit}.` : `לפי נספח המחיר (${num(appendix!.pricePerTon)} ₪/${appendixUnit(appendix!)}) נראה שהכמות והמחיר הוזנו בק״ג.`}`,
      sources,
      checkHe: `הסכום ${nis(po.amount)} ${facts?.amount != null ? "נכון" : "מתקבל גם כך"}. הכמות והמחיר הוזנו ב${po.unit === "טון" ? "ק״ג" : "יחידה אחרת"} (${num(po.qty)} × ${po.unitPrice}), אך שדה היחידה אומר ${po.unit}.`,
      meaningHe: `הסכום הכספי תקין — לכן אף אחד לא שם לב. אבל כל חישוב שמסתמך על שדה הכמות — יתרה להזמנה, קצב צריכה, השוואה לכתב כמויות — רואה ${num(po.qty)} ${po.unit} במקום ${num(rightQty)}.`,
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: { questionHe: `ההזמנה היא ל-${num(rightQty)} ${rightUnit}?`, options: [{ id: "yes_tons", labelHe: `כן, ${num(rightQty)} ${rightUnit}` }, { id: "open_quote", labelHe: quoteDoc ? "לא — פתח את ההצעה" : "לא — נבדוק מול הספק" }], freeText: false },
      sectionId: po.sectionId,
      record: { type: "po", id: String(po.id) },
      detailsTable: [["שדה", "בהזמנה", facts ? "לפי ההצעה" : "לפי הנספח"], ["כמות", num(po.qty), num(rightQty)], ["יחידה", po.unit, rightUnit], ["מחיר יח׳", `${po.unitPrice} ₪`, `${num(rightPrice)} ₪`], ["סכום", nis(po.amount), nis(Math.round(rightQty * rightPrice))]],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 3 — forecast unit prices versus the price appendix in force at the control date
// ---------------------------------------------------------------------------

export function checkPrices(pkg: HadarimPackage, erp: ErpState, draft: HForecastVersion, controlDate: string, onlySectionId?: SectionId): HFinding[] {
  const out: HFinding[] = [];
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.sections && f.controlDate < controlDate).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  for (const sectionForecast of draft.sections ?? []) {
    if (onlySectionId && sectionForecast.sectionId !== onlySectionId) continue;
    const contract = contractWithAppendices(pkg, sectionForecast.sectionId);
    if (!contract) continue;
    const current = priceAppendixAt(contract, controlDate);
    if (!current) continue;
    const unit = appendixUnit(current);
    for (const line of sectionForecast.lines) {
      if (line.kind !== "uncovered" || line.unitPrice == null || line.qty == null || (line.unit && line.unit !== unit)) continue;
      if (current.pricePerTon <= line.unitPrice) continue;
      const supplier = pkg.suppliers.find((s) => s.id === contract.supplierId);
      const section = pkg.sections.find((s) => s.id === line.sectionId)!;
      const oldCost = line.amount;
      const newCost = line.qty * current.pricePerTon;
      const impact = newCost - oldCost;
      const openOrders = erp.purchaseOrders.filter((p) => p.contractId === contract.id && p.status === "פתוחה");
      const orderPrice = (p: (typeof openOrders)[number]) => quoteFacts(documentById(pkg, p.attachmentId))?.unitPrice ?? p.unitPrice;
      const orderQty = (p: (typeof openOrders)[number]) => quoteFacts(documentById(pkg, p.attachmentId))?.qty ?? p.qty;
      const openAtOldPrice = openOrders.filter((p) => orderPrice(p) < current.pricePerTon);
      const closedOld = erp.purchaseOrders.filter((p) => p.contractId === contract.id && p.status === "סגורה" && p.unitPrice < current.pricePerTon && p.date < current.validFrom);
      const sources: HSource[] = [
        { kind: "forecast", refId: line.id, labelHe: `תחזית ${dateHe(previous?.controlDate ?? controlDate)} · ${section.nameHe} · יתרה ${num(line.qty)} ${unit} × ${num(line.unitPrice)} ₪ = ${nis(oldCost)}`, fieldHe: "מחיר יח׳", valueHe: `${num(line.unitPrice)} ₪/${unit}` },
        { kind: "document", refId: current.documentId, labelHe: `נספח מחיר · ${supplier?.nameHe} · בתוקף מ-${dateHe(current.validFrom)} · ${num(current.pricePerTon)} ₪/${unit}`, documentId: current.documentId, anchor: "price" },
        ...openOrders.map((p) => ({ kind: "po" as const, refId: String(p.id), labelHe: `הזמנה ${p.id} · ${num(orderPrice(p))} ₪/${unit} — ${orderPrice(p) >= current.pricePerTon ? "המחיר החדש כבר בשימוש בפועל" : "במחיר הישן"}` })),
      ];
      const recorded = sectionForecast.recorded;
      const checkHe =
        openOrders.length === 0
          ? `האם חלק מ-${num(line.qty)} ה${unit} מכוסה בהזמנות במחיר הישן? אין הזמנות פתוחות בחוזה.`
          : openAtOldPrice.length === 0
            ? `האם חלק מ-${num(line.qty)} ה${unit} מכוסה בהזמנות במחיר הישן? ${openOrders.length === 1 ? `הזמנה פתוחה אחת בלבד (${openOrders[0].id}, ${num(orderQty(openOrders[0]))} ${unit}) — כבר במחיר החדש.` : `${num(openOrders.length)} הזמנות פתוחות — כולן במחיר החדש.`}`
            : `${num(openAtOldPrice.length)} הזמנות פתוחות במחיר הישן (${openAtOldPrice.map((p) => `${p.id}: ${num(orderQty(p))} ${unit}`).join(", ")}) — הכמות שבהן נשארת במחיר הישן.`;
      out.push({
        id: `F-PRICE-${line.id}`,
        kind: "price",
        titleHe: `מחיר יתרת ${sectionShort(line.sectionId)} בתחזית`,
        problemHe: `יתרת ה${sectionShort(line.sectionId)} בתחזית (${num(line.qty)} ${unit}) מתומחרת לפי ${num(line.unitPrice)} ₪/${unit}. נספח המחיר העדכני של ${supplier?.nameHe} קובע ${num(current.pricePerTon)} ₪/${unit} מ-${dateHe(current.validFrom)}.`,
        sources,
        checkHe,
        meaningHe: `תחזית סעיף ${sectionShort(line.sectionId)}: ${nis(recorded)} + ${nis(newCost)} = ${nis(recorded + newCost)} · תוספת ${nis(impact)} · חריגה של ${(((recorded + newCost - section.budget) / section.budget) * 100).toFixed(0)}% מתקציב הסעיף.`,
        impact: { kind: "amount", amount: impact, labelHe: `+${nis(impact)}` },
        decision: { questionHe: "המחיר החדש חל על כל היתרה?", options: [{ id: "all", labelHe: `כן, על כל ${num(line.qty)} ה${unit}` }, { id: "partial", labelHe: "לא — חלק במחיר ישן" }], freeText: false },
        sectionId: line.sectionId,
        record: { type: "forecast_line", id: line.id },
        detailsTable: [["רכיב", "נתון"], ["תקציב", nis(section.budget)], ["עלות שנרשמה", nis(recorded)], ["יתרה צפויה", `${num(line.qty)} ${unit}`], ["עלות היתרה — תחזית קודמת", nis(oldCost)], ["עלות היתרה — לפי הנספח", nis(newCost)]],
        notesHe: closedOld.map((p) => `הזמנה ${p.id} (${num(p.qty)} ${p.unit} ב-${num(p.unitPrice)} ₪/${p.unit}) הונפקה ב-${dateHe(p.date)}, לפני תוקף הנספח, וסופקה במלואה — תקינה, לא סומנה.`),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 4 — BOQ coverage versus contracts and the forecast
// ---------------------------------------------------------------------------

/** A BOQ line that a contract excludes (or that has no contract) and that no uncovered forecast line estimates. */
export function checkCoverage(pkg: HadarimPackage, draft: HForecastVersion, onlySectionId?: SectionId): HFinding[] {
  const out: HFinding[] = [];
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.sections).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  for (const line of pkg.boq) {
    if (onlySectionId && line.sectionId !== onlySectionId) continue;
    if (line.coverage !== "excluded") continue;
    const sectionForecast = draft.sections?.find((s) => s.sectionId === line.sectionId);
    const estimated = sectionForecast?.lines.some((l) => l.kind === "uncovered" && l.sourceRef?.includes(line.id));
    if (estimated) continue;
    const section = pkg.sections.find((s) => s.id === line.sectionId)!;
    const contract = pkg.contracts.find((c) => c.sectionId === line.sectionId && c.amount != null);
    const keywords = line.descriptionHe.split(/[\s,()״"]+/).filter((w) => w.length >= 4);
    const exclusion = contract?.exclusions.find((e) => e.clause === line.coverageRef) ?? contract?.exclusions.find((e) => keywords.some((w) => e.textHe.includes(w))) ?? contract?.exclusions[0];
    const supplier = contract ? pkg.suppliers.find((s) => s.id === contract.supplierId) : undefined;
    const previousSection = previous?.sections?.find((s) => s.sectionId === line.sectionId);
    const page = boqPageFor(pkg, line.id);
    const item = line.descriptionHe.split(",")[0];
    out.push({
      id: `F-COV-${line.id}`,
      kind: "coverage",
      titleHe: `${item} — לא מכוסה בחוזה`,
      problemHe: `בכתב הכמויות (גרסה ${pkg.project.boqVersion.number}) מופיע ${item}, ${num(line.qty)} ${line.unit}. ${contract ? `בחוזה ${supplier?.nameHe} העבודה מוחרגת במפורש${exclusion ? ` (סעיף ${exclusion.clause})` : ""}.` : "אין חוזה לסעיף."} ${previousSection ? `בתחזית הקודמת חבילת ה${sectionShort(line.sectionId)} סומנה ״${previousSection.coverageNoteHe ?? "מכוסה בחוזה"}״ ואין אומדן נפרד.` : "אין אומדן נפרד בתחזית."}`,
      sources: [
        { kind: "boq", refId: line.id, labelHe: `כתב כמויות גרסה ${pkg.project.boqVersion.number} · פרק ${line.chapter} · ״${line.descriptionHe} — ${num(line.qty)} ${line.unit}״`, documentId: page?.id, anchor: page ? "line" : undefined },
        ...(contract ? [{ kind: "contract" as const, refId: contract.id, labelHe: `חוזה ${supplier?.nameHe}${exclusion ? ` · סעיף ${exclusion.clause}: ״${exclusion.textHe}״` : ""}`, documentId: contract.documentId, anchor: "exclusion" }] : []),
        ...(previous ? [{ kind: "forecast" as const, refId: `${previous.controlDate}-${line.sectionId}`, labelHe: `תחזית ${dateHe(previous.controlDate)} · חבילת ${sectionShort(line.sectionId)} · ״${previousSection?.coverageNoteHe ?? "מכוסה בחוזה"}״ · אומדן נוסף: 0` }] : []),
      ],
      meaningHe: "יש עבודה בכתב הכמויות שאין לה חוזה ואין לה אומדן.",
      impact: { kind: "unknown", amount: 0, labelHe: "טרם הוערך" },
      decision: { questionHe: `${item} מכוסה בחוזה אחר, יבוצע בביצוע עצמי, או שצריך להזמין אותו?`, options: [{ id: "other_contract", labelHe: "חוזה אחר" }, { id: "self", labelHe: "ביצוע עצמי" }, { id: "order", labelHe: "צריך להזמין" }], freeText: true },
      sectionId: line.sectionId,
      record: { type: "boq_line", id: line.id },
      notesHe: contract ? [`${section.nameHe}: יתר שורות הפרק מכוסות בחוזה ${contract.id}`] : [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verified matches ("positive findings"): only what was actually checked line by line
// ---------------------------------------------------------------------------

export function positives(pkg: HadarimPackage, draft: HForecastVersion): HPositive[] {
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

// ---------------------------------------------------------------------------
// Data-quality checks — the record itself is inconsistent: duplicates, contract totals, cumulative chains,
// retention arithmetic, dates, invoices left in review. Each becomes a card; the fix is a referral to the
// person who keys the ERP, a recorded change order, or "checked, correct".
// ---------------------------------------------------------------------------

function supplierNameOf(pkg: HadarimPackage, id: string): string {
  return pkg.suppliers.find((s) => s.id === id)?.nameHe ?? id;
}

function invoiceSource(pkg: HadarimPackage, inv: HInvoice): HSource {
  return { kind: "invoice", refId: String(inv.id), labelHe: `חשבון ${inv.id} · ${supplierNameOf(pkg, inv.supplierId)} · ${nis(inv.amount)} · ${dateHe(inv.date)} · מס׳ מסמך ${inv.supplierDocNo} · ${sectionLabel(inv.sectionId, pkg)}`, documentId: inv.attachmentId ?? undefined };
}

/** The standard decision of a data-quality card: refer the fix to bookkeeping, or confirm the record is right. */
function fixDecision(questionHe: string, fixHe: string): HFinding["decision"] {
  return { questionHe, options: [{ id: "refer", labelHe: fixHe }, { id: "accept", labelHe: "תקין — לא נדרש תיקון" }], freeText: true };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Two invoices of the same supplier with the same document number: the later one is flagged. */
export function checkDuplicates(pkg: HadarimPackage, erp: ErpState, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  const groups = new Map<string, HInvoice[]>();
  for (const inv of erp.invoices) {
    const docNo = inv.supplierDocNo.trim();
    if (!docNo) continue;
    const key = `${inv.supplierId}|${docNo}`;
    groups.set(key, [...(groups.get(key) ?? []), inv]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [first, ...rest] = [...list].sort((a, b) => a.id - b.id);
    for (const inv of rest) {
      if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) continue;
      const sameAmount = inv.amount === first.amount;
      out.push({
        id: `F-DUP-${inv.id}`,
        kind: "duplicate",
        titleHe: `חשבון ${inv.id} — מספר מסמך כפול אצל ${supplierNameOf(pkg, inv.supplierId)}`,
        problemHe: `חשבון ${inv.id} של ${supplierNameOf(pkg, inv.supplierId)} נושא את מספר המסמך ${inv.supplierDocNo} כמו חשבון ${first.id}${sameAmount ? ", ובאותו סכום" : ` (סכומים שונים: ${nis(first.amount)} מול ${nis(inv.amount)})`}.`,
        sources: [invoiceSource(pkg, first), invoiceSource(pkg, inv)],
        checkHe: `שני חשבונות של אותו ספק עם אותו מספר מסמך${sameAmount ? " ואותו סכום" : ""}.`,
        meaningHe: sameAmount ? `אם זה אותו חשבון, ${nis(inv.amount)} נרשמו פעמיים ב-${sectionLabel(inv.sectionId, pkg)} והנרשם גבוה מהאמיתי.` : "ייתכן מספור שגוי אצל הספק או קליטה כפולה עם סכום מתוקן; נדרש בירור.",
        impact: { kind: "amount", amount: -inv.amount, labelHe: `−${nis(inv.amount)} אם כפול` },
        decision: fixDecision("האם זה רישום כפול?", "כפול — לבטל בהנהלת חשבונות"),
        sectionId: inv.sectionId,
        record: { type: "invoice", id: String(inv.id) },
        detailsTable: [["שדה", `חשבון ${first.id}`, `חשבון ${inv.id}`], ["מס׳ מסמך", first.supplierDocNo, inv.supplierDocNo], ["תאריך", dateHe(first.date), dateHe(inv.date)], ["סכום", nis(first.amount), nis(inv.amount)], ["סעיף", sectionLabel(first.sectionId, pkg), sectionLabel(inv.sectionId, pkg)], ["סטטוס", first.status, inv.status]],
      });
    }
  }
  return out;
}

/** Approved invoices on a fixed-price contract exceed its amount. */
export function checkContractOverrun(pkg: HadarimPackage, erp: ErpState, onlyContractId?: string): HFinding[] {
  const out: HFinding[] = [];
  for (const contract of pkg.contracts) {
    if (onlyContractId && contract.id !== onlyContractId) continue;
    if (contract.amount == null || contract.closed) continue;
    const invoices = erp.invoices.filter((i) => i.contractId === contract.id && i.status !== "בבדיקה").sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const recorded = invoices.reduce((a, i) => a + i.amount, 0);
    if (recorded <= contract.amount) continue;
    const over = recorded - contract.amount;
    const last = invoices[invoices.length - 1];
    out.push({
      id: `F-OVER-${contract.id}`,
      kind: "contract_overrun",
      titleHe: `חוזה ${contract.id} — חשבונות מעבר לסכום החוזה`,
      problemHe: `החשבונות המאושרים בחוזה ${contract.id} (${supplierNameOf(pkg, contract.supplierId)}) מסתכמים ב-${nis(recorded)} — ${nis(over)} מעל סכום החוזה ${nis(contract.amount)}.`,
      sources: [{ kind: "contract", refId: contract.id, labelHe: `חוזה ${contract.id} · ${supplierNameOf(pkg, contract.supplierId)} · ${nis(contract.amount)}`, documentId: contract.documentId }, ...(last ? [invoiceSource(pkg, last)] : [])],
      checkHe: `${num(invoices.length)} חשבונות מאושרים; אין פקודת שינוי רשומה בבקרה.`,
      meaningHe: `הנרשם כבר בתחזית; יתרת ההתחייבות בחוזה היא אפס והתוספת ${nis(over)} היא חריגה מהחוזה שדורשת פקודת שינוי מאושרת או בירור מול הקבלן.`,
      impact: { kind: "amount", amount: over, labelHe: `+${nis(over)} מעבר לחוזה` },
      decision: { questionHe: "יש פקודת שינוי מאושרת שמכסה את התוספת?", options: [{ id: "change_order", labelHe: "כן — לרשום פקודת שינוי" }, { id: "refer", labelHe: "לא — לברר מול הקבלן" }, { id: "accept", labelHe: "תקין (חשבון סופי מוסכם)" }], freeText: true },
      sectionId: contract.sectionId,
      record: { type: "contract", id: contract.id },
      detailsTable: [["רכיב", "נתון"], ["סכום החוזה", nis(contract.amount)], ["חשבונות מאושרים", nis(recorded)], ["מעבר לחוזה", nis(over)]],
    });
  }
  return out;
}

/** Cumulative amounts on a contract's partial invoices must add up and chain from one invoice to the next. */
export function checkCumulative(pkg: HadarimPackage, erp: ErpState, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const contract of pkg.contracts) {
    const list = erp.invoices.filter((i) => i.contractId === contract.id && i.cumulativeNow != null).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    list.forEach((inv, idx) => {
      if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) return;
      const prev = idx > 0 ? list[idx - 1] : null;
      const expectedNow = (inv.cumulativePrev ?? 0) + inv.amount;
      const arithmetic = expectedNow !== inv.cumulativeNow;
      const chain = !!prev && prev.cumulativeNow != null && inv.cumulativePrev !== prev.cumulativeNow;
      if (!arithmetic && !chain) return;
      out.push({
        id: `F-CUM-${inv.id}`,
        kind: "cumulative",
        titleHe: `חשבון ${inv.id} — המצטבר אינו מתחבר`,
        problemHe: arithmetic ? `בחשבון ${inv.id} (${supplierNameOf(pkg, inv.supplierId)}, חוזה ${contract.id}): מצטבר קודם ${nis(inv.cumulativePrev ?? 0)} + סכום ${nis(inv.amount)} = ${nis(expectedNow)}, אך נרשם מצטבר נוכחי ${nis(inv.cumulativeNow!)}.` : `בחשבון ${inv.id} נרשם מצטבר קודם ${nis(inv.cumulativePrev ?? 0)}, אך החשבון הקודם בחוזה (${prev!.id}) נסגר במצטבר ${nis(prev!.cumulativeNow!)}.`,
        sources: [...(prev ? [invoiceSource(pkg, prev)] : []), invoiceSource(pkg, inv)],
        meaningHe: "מצטבר שגוי מסתיר תשלום כפול או חסר מול החוזה ומשבש את יתרת ההתחייבות; הסכום שנרשם לסעיף אינו משתנה עד לבירור.",
        impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ עד לבירור" },
        decision: fixDecision("מה נכון — המצטבר או הסכום?", "לתקן בהנהלת חשבונות"),
        sectionId: inv.sectionId,
        record: { type: "invoice", id: String(inv.id) },
        detailsTable: [["שדה", "נרשם", "מתבקש"], ["מצטבר קודם", nis(inv.cumulativePrev ?? 0), prev?.cumulativeNow != null ? nis(prev.cumulativeNow) : "—"], ["סכום", nis(inv.amount), nis(inv.amount)], ["מצטבר נוכחי", nis(inv.cumulativeNow!), nis(expectedNow)]],
      });
    });
  }
  return out;
}

/** Retention arithmetic and the contract's retention rate. */
export function checkRetention(pkg: HadarimPackage, erp: ErpState, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const inv of erp.invoices) {
    if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) continue;
    const expectedRetention = Math.round((inv.amount * inv.retentionPct) / 100);
    const arithmetic = inv.retentionAmt !== expectedRetention || inv.netPayable !== inv.amount - inv.retentionAmt;
    const contract = inv.contractId ? pkg.contracts.find((c) => c.id === inv.contractId) : undefined;
    const rate = !!contract && inv.docType !== "חשבון מקדמה" && inv.retentionPct !== contract.retentionPct;
    if (!arithmetic && !rate) continue;
    out.push({
      id: `F-RET-${inv.id}`,
      kind: "retention",
      titleHe: `חשבון ${inv.id} — ${arithmetic ? "חישוב העכבון אינו מתחבר" : "שיעור עכבון שונה מהחוזה"}`,
      problemHe: arithmetic ? `בחשבון ${inv.id}: ${inv.retentionPct}% מ-${nis(inv.amount)} הם ${nis(expectedRetention)}, אך נרשם עכבון ${nis(inv.retentionAmt)} ולתשלום ${nis(inv.netPayable)} (מתבקש ${nis(inv.amount - expectedRetention)}).` : `בחשבון ${inv.id} נרשם עכבון ${inv.retentionPct}%, אך חוזה ${contract!.id} קובע ${contract!.retentionPct}%.`,
      sources: [invoiceSource(pkg, inv), ...(contract ? [{ kind: "contract" as const, refId: contract.id, labelHe: `חוזה ${contract.id} · עכבון ${contract.retentionPct}%`, documentId: contract.documentId }] : [])],
      meaningHe: "הסכום שנרשם לסעיף אינו משתנה, אך התשלום לספק והעכבון המצטבר שגויים.",
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: fixDecision("לתקן את העכבון?", "לתקן בהנהלת חשבונות"),
      sectionId: inv.sectionId,
      record: { type: "invoice", id: String(inv.id) },
      detailsTable: [["שדה", "נרשם", "מתבקש"], ["שיעור עכבון", `${inv.retentionPct}%`, contract && inv.docType !== "חשבון מקדמה" ? `${contract.retentionPct}%` : `${inv.retentionPct}%`], ["סכום עכבון", nis(inv.retentionAmt), nis(expectedRetention)], ["לתשלום", nis(inv.netPayable), nis(inv.amount - expectedRetention)]],
    });
  }
  return out;
}

/** Dates: an invoice received before it was issued, or dated in the future. */
export function checkDates(pkg: HadarimPackage, erp: ErpState, today: string, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const inv of erp.invoices) {
    if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) continue;
    const before = inv.dateReceived < inv.date;
    const future = inv.date > today || inv.dateReceived > today;
    if (!before && !future) continue;
    out.push({
      id: `F-DATE-${inv.id}`,
      kind: "dates",
      titleHe: `חשבון ${inv.id} — ${future ? "תאריך עתידי" : "התקבל לפני תאריך המסמך"}`,
      problemHe: future ? `חשבון ${inv.id} נושא תאריך ${dateHe(inv.date)} (התקבל ${dateHe(inv.dateReceived)}) — אחרי היום (${dateHe(today)}).` : `חשבון ${inv.id} התקבל ב-${dateHe(inv.dateReceived)}, לפני תאריך המסמך ${dateHe(inv.date)}.`,
      sources: [invoiceSource(pkg, inv)],
      meaningHe: "תאריך הקבלה קובע לאיזו בקרה החשבון נספר; תאריך שגוי מזיז את הנרשם בין בקרות.",
      impact: { kind: "none", amount: 0, labelHe: "עשוי להזיז את הנרשם בין בקרות" },
      decision: fixDecision("איזה תאריך נכון?", "לתקן בהנהלת חשבונות"),
      sectionId: inv.sectionId,
      record: { type: "invoice", id: String(inv.id) },
    });
  }
  return out;
}

/** Invoices left "in review" longer than the project's policy allows are neither recorded nor rejected. */
export function checkReviewAging(pkg: HadarimPackage, erp: ErpState, controlDate: string, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  const limit = pkg.project.checkPolicy.reviewAgingDays;
  for (const inv of erp.invoices) {
    if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) continue;
    if (inv.status !== "בבדיקה") continue;
    const days = daysBetween(inv.dateReceived, controlDate);
    if (days < limit) continue;
    out.push({
      id: `F-REVIEW-${inv.id}`,
      kind: "review_aging",
      titleHe: `חשבון ${inv.id} — בבדיקה ${num(days)} ימים`,
      problemHe: `חשבון ${inv.id} של ${supplierNameOf(pkg, inv.supplierId)} (${nis(inv.amount)}) התקבל ב-${dateHe(inv.dateReceived)} ועדיין בבדיקה — ${num(days)} ימים, מעל ${num(limit)} הימים שהפרויקט מאפשר.`,
      sources: [invoiceSource(pkg, inv)],
      meaningHe: `כל עוד החשבון בבדיקה הוא אינו נספר בנרשם של ${sectionLabel(inv.sectionId, pkg)}; אם יאושר, הנרשם יעלה ב-${nis(inv.amount)}.`,
      impact: { kind: "amount", amount: inv.amount, labelHe: `+${nis(inv.amount)} אם יאושר` },
      decision: { questionHe: "מה מעכב את האישור?", options: [{ id: "refer", labelHe: "לזרז אישור — הנהלת חשבונות" }, { id: "accept", labelHe: "נשאר בבדיקה בכוונה" }], freeText: true },
      sectionId: inv.sectionId,
      record: { type: "invoice", id: String(inv.id) },
    });
  }
  return out;
}

export function runDataQualityChecks(pkg: HadarimPackage, erp: ErpState, controlDate: string, today: string): HFinding[] {
  return [...checkDuplicates(pkg, erp), ...checkContractOverrun(pkg, erp), ...checkCumulative(pkg, erp), ...checkRetention(pkg, erp), ...checkDates(pkg, erp, today), ...checkReviewAging(pkg, erp, controlDate)];
}

export const CHECK_STEPS_HE = ["שיוך חשבונות מול חוזים והיסטוריית הספק", "יחידות וכמויות בהזמנות מול הצעות ונספחי מחיר", "מחירים בתחזית מול נספחי מחיר בתוקף", "כיסוי חוזי מול כתב כמויות", "איכות נתונים: כפילויות, סכומי חוזה, מצטברים, עכבונות, תאריכים, חשבונות בבדיקה"];

/** All checks. `today` bounds the date check (the control date when the run is not "live"). */
export function runChecks(pkg: HadarimPackage, erp: ErpState, draft: HForecastVersion, controlDate: string, today: string = controlDate): CheckResult {
  const findings = [...checkAllocation(pkg, erp), ...checkUnits(pkg, erp), ...checkPrices(pkg, erp, draft, controlDate), ...checkCoverage(pkg, draft), ...runDataQualityChecks(pkg, erp, controlDate, today)];
  return { findings, positives: positives(pkg, draft), checkedHe: CHECK_STEPS_HE };
}
