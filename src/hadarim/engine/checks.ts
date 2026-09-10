import { chapterLabelHe, chapterTermsIn, contentWords, wordMatches } from "../data/bluebook";
import { priceAppendixAt } from "../data/generate";
import type { HBoqLine, HContract, HDocument, HSection, HForecastVersion, HInvoice, HOpenIssue, HPriceAppendix, HPurchaseOrder, HadarimPackage, PersonId, QuoteFacts, SectionId } from "../data/types";
import type { ErpState } from "./model";
import { pkg } from "./package";
import { convertQuantity, lineValue } from "./units";

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
export type FindingKind = "allocation" | "unit" | "price" | "coverage" | "duplicate" | "contract_overrun" | "cumulative" | "retention" | "dates" | "review_aging" | "document" | "review";
export const DATA_QUALITY_KINDS: FindingKind[] = ["duplicate", "contract_overrun", "cumulative", "retention", "dates", "review_aging", "document"];

/** A person connected to the record a finding is about — who to ask when the operator does not know. */
export interface InvolvedPerson {
  id: PersonId;
  nameHe: string;
  roleHe: string;
  relationHe: string;
}

/** Invoice fields a data-quality card may correct on approval. */
export type InvoiceFixPatch = Partial<Pick<HInvoice, "amount" | "supplierDocNo" | "retentionPct" | "retentionAmt" | "netPayable" | "cumulativePrev" | "cumulativeNow" | "date" | "dateReceived" | "status" | "approvedBy">>;
/** What a card may propose on an invoice: its fields, and/or a move to another budget section. */
export type InvoiceFix = InvoiceFixPatch & { sectionId?: SectionId };
/** What a card may propose on a purchase order: its line (the amount stays locked), and/or a move to another budget section. */
export type OrderFixPatch = { sectionId?: SectionId; qty?: number; unit?: string; priceUnit?: string; unitPrice?: number };
export const INVOICE_FIX_KEYS = ["sectionId", "amount", "supplierDocNo", "retentionPct", "retentionAmt", "netPayable", "cumulativePrev", "cumulativeNow", "date", "dateReceived", "status", "approvedBy"] as const;
export const ORDER_FIX_KEYS = ["sectionId", "qty", "unit", "priceUnit", "unitPrice"] as const;

export interface HFinding {
  id: string;
  kind: FindingKind;
  /** "check" = a deterministic check; "review" = raised by the agent from reading records and documents. */
  origin?: "check" | "review";
  /** Who a "refer" decision goes to (default: whoever keys the ERP). */
  referToId?: PersonId;
  /** People who entered, approved or changed the record (from the record and the change log). */
  people?: InvolvedPerson[];
  /** When the right values are determined by other stored data: the fix the card offers to apply (an invoice's fields or section; an order's line or section). */
  proposedFix?: { labelHe: string; patch: InvoiceFix | OrderFixPatch };
  titleHe: string;
  problemHe: string;
  sources: HSource[];
  checkHe?: string;
  meaningHe: string;
  impact: { kind: "none" | "amount" | "unknown"; amount: number; labelHe: string };
  decision: { questionHe: string; options: HDecisionOption[]; freeText: boolean };
  sectionId: SectionId;
  record: { type: "invoice" | "po" | "forecast_line" | "boq_line" | "contract" | "document"; id: string };
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

/** The person who handles bookkeeping referrals: the accounting role if there is one, else someone who may write allocations. */
export function accountantPerson(p: HadarimPackage = pkg) {
  return p.people.find((x) => x.roleHe.includes("חשבונות")) ?? p.people.find((x) => x.canWriteAllocation) ?? p.people[0];
}

/** The person who executes order corrections on site, when the project has such a role. */
export function executionPerson(p: HadarimPackage = pkg) {
  return p.people.find((x) => x.roleHe.includes("ביצוע"));
}

/**
 * "Yes, but someone else keys it" — the alternative to applying the fix here and now. Only when the
 * project has an execution role to hand it to; otherwise the card offers approval or nothing.
 */
function referOption(): HDecisionOption[] {
  const person = executionPerson();
  return person ? [{ id: "yes_refer", labelHe: `כן — להעביר ל${person.nameHe} לתיקון` }] : [];
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

/** A processed, newer BOQ page whose recorded facts say a given line was removed from scope. */
export function revisionRemovalDocFor(pkg: HadarimPackage, boqLineId: string): HDocument | undefined {
  return pkg.documents.find((d) => d.kind === "boq_page" && d.facts && Array.isArray(d.facts.removedLineIds) && (d.facts.removedLineIds as unknown[]).includes(boqLineId));
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
export function proposedOrderCorrection(pkg: HadarimPackage, po: HPurchaseOrder): { qty: number; unit: string; priceUnit: string; unitPrice: number; fromQuote: boolean; documentId?: string } {
  const doc = documentById(pkg, po.attachmentId);
  const facts = quoteFacts(doc);
  if (facts && (facts.qty != null || facts.unitPrice != null)) {
    const qty = facts.qty ?? po.qty;
    const unitPrice = facts.unitPrice ?? (qty ? po.amount / qty : po.unitPrice);
    const unit = facts.unit ?? po.unit;
    return { qty, unit, priceUnit: unit, unitPrice, fromQuote: true, documentId: doc!.id };
  }
  return { qty: po.qty / KG_PER_TON, unit: po.unit, priceUnit: po.unit, unitPrice: po.unitPrice * KG_PER_TON, fromQuote: false };
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

/**
 * The section an invoice belongs to when other stored data determines it: its contract's section; else, for
 * an invoice with no contract, the section its own description speaks of (`describedSection`). Null when
 * nothing determines it — including an invoice whose contract id points at no contract.
 */
export function invoiceTargetSection(pkg: HadarimPackage, inv: HInvoice): { sectionId: SectionId; basis: "contract" | "description"; contract?: HContract; described?: DescribedTarget } | null {
  if (inv.contractId) {
    const contract = pkg.contracts.find((c) => c.id === inv.contractId);
    return contract ? { sectionId: contract.sectionId, basis: "contract", contract } : null;
  }
  const described = describedSection(pkg, inv.descriptionHe, inv.sectionId);
  return described ? { sectionId: described.sectionId, basis: "description", described } : null;
}

export function checkAllocation(pkg: HadarimPackage, erp: ErpState, onlyInvoiceId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const inv of erp.invoices) {
    if (onlyInvoiceId != null && inv.id !== onlyInvoiceId) continue;
    // With a contract the contract decides; without one, the invoice's own description does — when it speaks
    // of exactly one other section and of none of the section it sits on.
    const target = invoiceTargetSection(pkg, inv);
    if (!target || target.sectionId === inv.sectionId) continue;
    const { contract, described } = target;
    const supplier = pkg.suppliers.find((s) => s.id === inv.supplierId);
    const wrong = inv.sectionId;
    const right = target.sectionId;
    const wrongSection = pkg.sections.find((s) => s.id === wrong);
    const wrongMainContract = wrongSection?.contractIds[0] ? pkg.contracts.find((c) => c.id === wrongSection.contractIds[0]) : undefined;
    const history = erp.invoices.filter((i) => i.supplierId === inv.supplierId && i.id !== inv.id);
    const historySections = [...new Set(history.map((i) => i.sectionId))];
    const log = erp.changeLog.filter((c) => c.recordType === "invoice" && c.recordId === String(inv.id));
    const sources: HSource[] = [
      { kind: "invoice", refId: String(inv.id), labelHe: `חשבון ${inv.id} · ${supplier?.nameHe} · ${nis(inv.amount)} · סעיף: ${sectionLabel(wrong)} · תיאור: ״${inv.descriptionHe}״`, fieldHe: "סעיף תקציבי", valueHe: sectionLabel(wrong), documentId: inv.attachmentId ?? undefined, anchor: "description" },
      ...(contract
        ? [{ kind: "contract" as const, refId: contract.id, labelHe: `חוזה ${supplier?.nameHe} (חוזה ${contract.id}) · היקף: ״${contract.scopeHe}״ · אין סעיפי ${sectionShort(wrong)}`, documentId: contract.documentId, anchor: "included" }]
        : [{ kind: "contract" as const, refId: `${inv.id}-no-contract`, labelHe: `לחשבון אין חוזה — הסעיף לא נקבע על ידי חוזה` }, describedSource(described!)]),
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
      problemHe: `חשבון ${inv.id} של ${supplier?.nameHe}, ${nis(inv.amount)}, שויך לסעיף ${sectionLabel(wrong)}. ${contract ? `תיאור החשבון והחוזה מצביעים על ${sectionLabel(right)}` : describedBasisHe(described!, wrong, inv.descriptionHe)}.`,
      sources,
      ...(contract ? {} : { checkHe: DESCRIPTION_CHECK_HE }),
      meaningHe: `${sectionShort(wrong)} יוצג בחריגה של ${nis(inv.amount)} שאינה קיימת; ${sectionShort(right)} יוצג עם יתרה גבוהה מהאמיתית. הסה״כ לפרויקט לא משתנה.`,
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: { questionHe: `האם העבודה שייכת ל${sectionShort(right)}?`, options: [{ id: "yes_target", labelHe: `כן — לעדכן ל${sectionShort(right)} במערכת המידע` }, { id: "yes_refer", labelHe: `כן — להעביר ל${accountantPerson().nameHe} לתיקון` }, { id: "no_stay", labelHe: `לא, נשאר ב${sectionShort(wrong)}` }, { id: "unsure", labelHe: "לא בטוח" }], freeText: true },
      sectionId: wrong,
      record: { type: "invoice", id: String(inv.id) },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 1b — a purchase order's section against its contract, the invoices billed against it, and the supplier's records
// ---------------------------------------------------------------------------

/** A section a record's description points at, with the terms and chapters that point there. */
export type DescribedTarget = { sectionId: SectionId; terms: string[]; chapters: string[] };

/**
 * The trade terms of a section that a free text uses: the terms of the Blue Book chapters the section covers
 * (reference data, `CHAPTER_TERMS`) and the words of the section's own name. Nothing scenario-specific — a
 * section says which chapters it covers and what it is called, and the text either speaks of them or does not.
 */
const sectionTermsCache = new Map<string, { terms: string[]; chapters: string[] }>();

export function sectionTermsIn(text: string, section: HSection): { terms: string[]; chapters: string[] } {
  const key = `${section.id}\u0000${section.nameHe}\u0000${text}`;
  const cached = sectionTermsCache.get(key);
  if (cached) return cached;
  const hits = chapterTermsIn(text).filter((h) => (section.chapters ?? []).includes(h.chapter));
  const terms = new Set<string>(hits.flatMap((h) => h.terms));
  const words = contentWords(text);
  for (const nameTerm of contentWords(`${section.nameHe} ${section.shortHe}`)) if (words.some((w) => wordMatches(w, nameTerm))) terms.add(nameTerm);
  const out = { terms: [...terms], chapters: hits.map((h) => h.chapter) };
  if (sectionTermsCache.size > 20_000) sectionTermsCache.clear();
  sectionTermsCache.set(key, out);
  return out;
}

/** A record's description has to speak of at least this many of a section's terms to point at it. */
const DESCRIPTION_TERMS_REQUIRED = 2;

/**
 * The section a record's own description points at, when nothing else determines it. The wording must
 * speak of no term of the section the record sits on, and of at least two terms of exactly one other
 * section (never the reserve) — otherwise the description decides nothing and no finding is raised.
 */
export function describedSection(pkg: HadarimPackage, text: string, current: SectionId): DescribedTarget | null {
  const currentSection = pkg.sections.find((s) => s.id === current);
  if (currentSection && sectionTermsIn(text, currentSection).terms.length) return null;
  const scored = pkg.sections
    .filter((s) => s.id !== current && !isContingency(s.id, pkg))
    .map((s) => ({ sectionId: s.id, ...sectionTermsIn(text, s) }))
    .sort((a, b) => b.terms.length - a.terms.length);
  const best = scored[0];
  if (!best || best.terms.length < DESCRIPTION_TERMS_REQUIRED) return null;
  if (scored[1] && scored[1].terms.length === best.terms.length) return null;
  return best;
}

/** "פרק 01 — עבודות עפר, פרק 23 — כלונסאות קדוחים" */
function chaptersHe(chapters: string[]): string {
  return chapters.map((c) => `פרק ${chapterLabelHe(c)}`).join(", ");
}

/** The description of a record, as the source line of a description-based finding. */
function describedSource(target: DescribedTarget, p: HadarimPackage = pkg): HSource {
  return {
    kind: "section",
    refId: target.sectionId,
    labelHe: `${sectionLabel(target.sectionId, p)} — התיאור מדבר על ${target.terms.map((t) => `״${t}״`).join(", ")}${target.chapters.length ? ` (${chaptersHe(target.chapters)}, מהמפרט הבין-משרדי)` : ""}`,
  };
}

/** What the description check compares, in the words of the card. */
const DESCRIPTION_CHECK_HE = "תיאור הרשומה מול המונחים של הסעיפים (שם הסעיף והפרקים שהוא מכסה במפרט הבין-משרדי), כשאין חוזה, חשבונות או רשומות אחרות של הספק שקובעים את הסעיף.";

/** Why the description points elsewhere, in one sentence. */
function describedBasisHe(target: DescribedTarget, current: SectionId, text: string, p: HadarimPackage = pkg): string {
  const terms = target.terms.map((t) => `״${t}״`).join(", ");
  return `אין לרשומה חוזה, ואף רשומה אחרת אינה קובעת את סעיפה; תיאורה — ״${text}״ — מדבר על ${terms}${target.chapters.length ? ` (${chaptersHe(target.chapters)})` : ""}, שבתחום ${sectionLabel(target.sectionId, p)}, ואינו מזכיר אף מונח של ${sectionLabel(current, p)}`;
}

export type OrderBasis = "contract" | "invoices" | "history" | "description";

/**
 * The section an order belongs to when other stored data determines it: its contract's section; else the one
 * section of the invoices billed against it; else, for an order with neither, the one section every other
 * record of the supplier is on (two or more); else the section its own description speaks of, when it speaks
 * of exactly one and of none of the section it sits on. Null when nothing determines it.
 */
export function orderTargetSection(pkg: HadarimPackage, erp: ErpState, po: HPurchaseOrder): { sectionId: SectionId; basis: OrderBasis; described?: DescribedTarget } | null {
  const contract = po.contractId ? pkg.contracts.find((c) => c.id === po.contractId) : undefined;
  if (contract) return { sectionId: contract.sectionId, basis: "contract" };
  const against = erp.invoices.filter((i) => i.poId === po.id);
  const invoiceSections = [...new Set(against.map((i) => i.sectionId))];
  if (invoiceSections.length === 1) return { sectionId: invoiceSections[0], basis: "invoices" };
  if (against.length) return null;
  const history = [...erp.purchaseOrders.filter((p) => p.supplierId === po.supplierId && p.id !== po.id), ...erp.invoices.filter((i) => i.supplierId === po.supplierId)].map((r) => r.sectionId);
  const historySections = [...new Set(history)];
  if (history.length >= 2 && historySections.length === 1) return { sectionId: historySections[0], basis: "history" };
  const described = describedSection(pkg, po.descriptionHe, po.sectionId);
  if (described) return { sectionId: described.sectionId, basis: "description", described };
  return null;
}

/** An order on a section other than the one its contract, its invoices or the supplier's other records point to. */
export function checkOrderAllocation(pkg: HadarimPackage, erp: ErpState, onlyPoId?: number): HFinding[] {
  const out: HFinding[] = [];
  for (const po of erp.purchaseOrders) {
    if (onlyPoId != null && po.id !== onlyPoId) continue;
    const target = orderTargetSection(pkg, erp, po);
    if (!target || target.sectionId === po.sectionId) continue;
    const wrong = po.sectionId;
    const right = target.sectionId;
    const supplier = pkg.suppliers.find((s) => s.id === po.supplierId);
    const contract = po.contractId ? pkg.contracts.find((c) => c.id === po.contractId) : undefined;
    const against = erp.invoices.filter((i) => i.poId === po.id);
    const otherOrders = erp.purchaseOrders.filter((p) => p.supplierId === po.supplierId && p.id !== po.id);
    const otherInvoices = erp.invoices.filter((i) => i.supplierId === po.supplierId && i.poId !== po.id);
    const historySections = [...new Set([...otherOrders, ...otherInvoices].map((r) => r.sectionId))];
    const log = erp.changeLog.filter((c) => c.recordType === "po" && c.recordId === String(po.id));
    const sources: HSource[] = [
      { kind: "po", refId: String(po.id), labelHe: `הזמנה ${po.id} · ${supplier?.nameHe} · ${nis(po.amount)} · סעיף: ${sectionLabel(wrong)} · תיאור: ״${po.descriptionHe}״`, fieldHe: "סעיף תקציבי", valueHe: sectionLabel(wrong), documentId: po.attachmentId ?? undefined },
    ];
    if (contract) sources.push({ kind: "contract", refId: contract.id, labelHe: `חוזה ${supplier?.nameHe} (חוזה ${contract.id}) · היקף: ״${contract.scopeHe}״ · ${sectionLabel(contract.sectionId)}`, documentId: contract.documentId, anchor: "included" });
    if (target.basis === "description") sources.push({ kind: "contract", refId: `${po.id}-no-contract`, labelHe: `להזמנה אין חוזה, ואין חשבונות שנרשמו כנגדה — הסעיף לא נקבע על ידי אף רשומה אחרת` }, describedSource(target.described!));
    if (against.length) sources.push({ kind: "history", refId: `po-${po.id}-invoices`, labelHe: `${num(against.length)} חשבונות כנגד ההזמנה (${against.map((i) => i.id).join(", ")}) — ${[...new Set(against.map((i) => i.sectionId))].map((id) => sectionLabel(id)).join(", ")}` });
    if (otherOrders.length + otherInvoices.length) sources.push({ kind: "history", refId: po.supplierId, labelHe: `${num(otherOrders.length)} הזמנות ו-${num(otherInvoices.length)} חשבונות אחרים של ${supplier?.nameHe} — ${historySections.map((id) => sectionLabel(id)).join(", ")}` });
    for (const entry of log) sources.push({ kind: "changelog", refId: entry.id, labelHe: `יומן שינויים: ${entry.field} · ${entry.before} → ${entry.after} · ${dateHe(entry.at)} ${entry.at.slice(11, 16)} · ${pkg.people.find((p) => p.id === entry.byId)?.nameHe ?? entry.byId}` });
    const basisHe =
      target.basis === "contract" ? `ההזמנה מחויבת לחוזה ${contract!.id}, השייך ל${sectionLabel(right)}`
      : target.basis === "invoices" ? `החשבונות שנרשמו כנגד ההזמנה משויכים ל${sectionLabel(right)}`
      : target.basis === "history" ? `כל הרשומות האחרות של ${supplier?.nameHe} משויכות ל${sectionLabel(right)}`
      : describedBasisHe(target.described!, wrong, po.descriptionHe);
    out.push({
      id: `F-ALLOC-PO-${po.id}`,
      kind: "allocation",
      titleHe: `שיוך הזמנה ${po.id} — ${supplier?.nameHe}`,
      problemHe: `הזמנה ${po.id} של ${supplier?.nameHe}, ${nis(po.amount)}, משויכת לסעיף ${sectionLabel(wrong)}. ${basisHe}.`,
      sources,
      checkHe:
        target.basis === "contract" ? "סעיף ההזמנה מול סעיף החוזה שהיא מחויבת לו."
        : target.basis === "invoices" ? "סעיף ההזמנה מול סעיף החשבונות שנרשמו כנגדה."
        : target.basis === "history" ? "סעיף ההזמנה מול הסעיף של כל הרשומות האחרות של הספק."
        : DESCRIPTION_CHECK_HE,
      meaningHe: `התחייבות של ${nis(po.amount)} תוצג ב${sectionShort(wrong)} במקום ב${sectionShort(right)}${against.length ? `; החשבונות כנגד ההזמנה נשארים בסעיפם` : ""}. הסה״כ לפרויקט לא משתנה.`,
      impact: { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
      decision: { questionHe: `האם ההזמנה שייכת ל${sectionShort(right)}?`, options: [{ id: "yes_target", labelHe: `כן — לעדכן ל${sectionShort(right)} במערכת המידע` }, ...referOption(), { id: "no_stay", labelHe: `לא, נשארת ב${sectionShort(wrong)}` }, { id: "unsure", labelHe: "לא בטוח" }], freeText: true },
      sectionId: wrong,
      record: { type: "po", id: String(po.id) },
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
    // the order's own arithmetic, with the quantity converted into the unit the price is quoted in
    const value = lineValue(po);
    const misvalued = value.incommensurable || value.amount !== po.amount;
    if (!factsDisagree && !kgLikeTon && !misvalued) continue;

    const rightQty = facts?.qty ?? po.qty / KG_PER_TON;
    const rightUnit = facts?.unit ?? po.unit;
    const rightPrice = facts?.unitPrice ?? po.unitPrice * KG_PER_TON;
    const item = po.descriptionHe.split(",")[0];
    const sources: HSource[] = [
      { kind: "po", refId: String(po.id), labelHe: `הזמנה ${po.id} · ${supplier?.nameHe} · כמות: ${num(po.qty)} · יחידה: ${po.unit} · מחיר יח׳: ${po.unitPrice.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪${po.priceUnit && po.priceUnit !== po.unit ? ` ל${po.priceUnit}` : ""} · סכום: ${nis(po.amount)}`, fieldHe: "כמות / יחידה / מחיר יח׳", valueHe: `${num(po.qty)} ${po.unit} × ${po.unitPrice}` },
    ];
    if (misvalued) sources.push({ kind: "po", refId: String(po.id), labelHe: value.incommensurable ? `יחידת הכמות (${po.unit}) ויחידת המחיר (${po.priceUnit}) אינן ניתנות להמרה — הסכום אינו ניתן לגזירה` : `הכמות ביחידת המחיר: ${num(value.pricedQty!)} ${po.priceUnit} × ${num(po.unitPrice)} ₪ = ${nis(value.amount!)}, ולא ${nis(po.amount)} כרשום`, fieldHe: "סכום גזור", valueHe: value.amount != null ? nis(value.amount) : "—" });
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
      decision: { questionHe: `ההזמנה היא ל-${num(rightQty)} ${rightUnit}?`, options: [{ id: "yes_tons", labelHe: `כן — לתקן ל-${num(rightQty)} ${rightUnit} במערכת המידע` }, ...referOption(), { id: "open_quote", labelHe: quoteDoc ? "לא — פתח את ההצעה" : "לא — נבדוק מול הספק" }], freeText: false },
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
      const orderQty = (p: (typeof openOrders)[number]) => quoteFacts(documentById(pkg, p.attachmentId))?.qty ?? convertQuantity(p.qty, p.unit, unit) ?? p.qty;
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
  // A BOQ line the record still shows as covered, but a newer, processed revision of the BOQ dropped it —
  // the record was never updated to match: the gap surfaces only once the agent reads that document.
  for (const line of pkg.boq) {
    if (onlySectionId && line.sectionId !== onlySectionId) continue;
    if (line.coverage !== "covered" || !line.coveredByContractId) continue;
    const revisionDoc = revisionRemovalDocFor(pkg, line.id);
    if (!revisionDoc) continue;
    const sectionForecast = draft.sections?.find((s) => s.sectionId === line.sectionId);
    const estimated = sectionForecast?.lines.some((l) => l.kind === "uncovered" && l.sourceRef?.includes(line.id));
    if (estimated) continue;
    const section = pkg.sections.find((s) => s.id === line.sectionId)!;
    const contract = pkg.contracts.find((c) => c.id === line.coveredByContractId);
    const supplier = contract ? pkg.suppliers.find((s) => s.id === contract.supplierId) : undefined;
    const page = boqPageFor(pkg, line.id);
    const item = line.descriptionHe.split(",")[0];
    out.push({
      id: `F-COV-${line.id}`,
      kind: "coverage",
      titleHe: `${item} — לא מכוסה בחוזה`,
      problemHe: `שורת ${line.id} בכתב הכמויות במערכת המידע עדיין מסומנת מכוסה בחוזה ${line.coveredByContractId}${supplier ? ` (${supplier.nameHe})` : ""}. ב${revisionDoc.titleHe} — מסמך מעודכן מ-${dateHe(revisionDoc.date)} — הסעיף הוצא מהיקף כתב הכמויות. הרשומה במערכת לא עודכנה בהתאם ואין אומדן נפרד בתחזית.`,
      sources: [
        { kind: "boq", refId: line.id, labelHe: `שורת כתב הכמויות במערכת המידע · ״${line.descriptionHe} — ${num(line.qty)} ${line.unit}״ · מסומנת מכוסה בחוזה ${line.coveredByContractId}`, documentId: page?.id, anchor: page ? "line" : undefined },
        { kind: "document" as const, refId: revisionDoc.id, documentId: revisionDoc.id, labelHe: `${revisionDoc.titleHe} · עובדות: ${revisionDoc.factsSource?.method === "agent" ? "קריאת הסוכן" : revisionDoc.factsSource?.method === "seed" ? "נתוני הבסיס" : "חילוץ"}`, anchor: "removed" },
        ...(contract ? [{ kind: "contract" as const, refId: contract.id, labelHe: `חוזה ${supplier?.nameHe ?? contract.id}`, documentId: contract.documentId }] : []),
      ],
      meaningHe: "שורה בכתב הכמויות הוסרה במסמך מעודכן, אך הרשומה במערכת עדיין מפנה לחוזה כמכוסה — נדרש לוודא אם העבודה עדיין נדרשת ומי מכסה אותה.",
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

/**
 * The standard decision of a data-quality card: apply the proposed fix now (when the right values are known),
 * refer the fix to bookkeeping, or confirm the record is right.
 */
function fixDecision(questionHe: string, fixHe: string, applyHe?: string): HFinding["decision"] {
  return { questionHe, options: [...(applyHe ? [{ id: "apply", labelHe: applyHe }] : []), { id: "refer", labelHe: fixHe }, { id: "accept", labelHe: "תקין — לא נדרש תיקון" }], freeText: true };
}

/** Who entered, approved or changed the record — the people to ask when the operator does not know. */
export function peopleInvolved(pkg: HadarimPackage, erp: ErpState, record: HFinding["record"]): InvolvedPerson[] {
  const out: InvolvedPerson[] = [];
  const add = (id: string | null | undefined, relationHe: string) => {
    const p = id ? pkg.people.find((x) => x.id === id) : undefined;
    if (!p) return;
    const existing = out.find((x) => x.id === p.id);
    if (existing) {
      if (!existing.relationHe.includes(relationHe)) existing.relationHe += `; ${relationHe}`;
      return;
    }
    out.push({ id: p.id, nameHe: p.nameHe, roleHe: p.roleHe, relationHe });
  };
  if (record.type === "invoice") {
    const inv = erp.invoices.find((i) => String(i.id) === record.id);
    if (inv) {
      add(inv.enteredBy, `קלט/ה את החשבון ב-${dateHe(inv.enteredAt)}`);
      add(inv.approvedBy, "אישר/ה את החשבון");
    }
  }
  const logType = record.type === "po" ? "po" : record.type === "contract" ? "contract" : "invoice";
  if (record.type === "invoice" || record.type === "po" || record.type === "contract") {
    for (const c of erp.changeLog.filter((x) => x.recordType === logType && x.recordId === record.id)) add(c.byId, `שינה/תה ״${c.field}״ ב-${dateHe(c.at)}`);
  }
  return out;
}

/** Attach the people involved to each finding. */
export function withPeople(pkg: HadarimPackage, erp: ErpState, findings: HFinding[]): HFinding[] {
  return findings.map((f) => ({ ...f, people: peopleInvolved(pkg, erp, f.record) }));
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
        decision: fixDecision("מה נכון — המצטבר או הסכום?", "לתקן בהנהלת חשבונות", `לתקן את המצטבר ל-${nis(chain ? prev!.cumulativeNow! + inv.amount : expectedNow)}`),
        proposedFix: chain ? { labelHe: `מצטבר קודם ${nis(prev!.cumulativeNow!)} · נוכחי ${nis(prev!.cumulativeNow! + inv.amount)}`, patch: { cumulativePrev: prev!.cumulativeNow!, cumulativeNow: prev!.cumulativeNow! + inv.amount } } : { labelHe: `מצטבר נוכחי ${nis(expectedNow)}`, patch: { cumulativeNow: expectedNow } },
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
      decision: fixDecision("לתקן את העכבון?", "לתקן בהנהלת חשבונות", `לתקן לפי ${rate ? `החוזה (${contract!.retentionPct}%)` : `${inv.retentionPct}%`} — עכבון ${nis(rate ? Math.round((inv.amount * contract!.retentionPct) / 100) : expectedRetention)}`),
      proposedFix: (() => {
        const pct = rate ? contract!.retentionPct : inv.retentionPct;
        const amt = Math.round((inv.amount * pct) / 100);
        return { labelHe: `עכבון ${pct}% = ${nis(amt)} · לתשלום ${nis(inv.amount - amt)}`, patch: { retentionPct: pct, retentionAmt: amt, netPayable: inv.amount - amt } };
      })(),
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
      decision: { questionHe: "מה מעכב את האישור?", options: [{ id: "apply", labelHe: "לאשר את החשבון עכשיו" }, { id: "refer", labelHe: "לזרז אישור — הנהלת חשבונות" }, { id: "accept", labelHe: "נשאר בבדיקה בכוונה" }], freeText: true },
      proposedFix: { labelHe: "סטטוס: אושר", patch: { status: "אושר" } },
      sectionId: inv.sectionId,
      record: { type: "invoice", id: String(inv.id) },
    });
  }
  return out;
}

/**
 * A record against its source document: every field the document's facts state (what the agent or the seed read
 * in it) must match the record — invoice amount, supplier document number, date, retention rate, cumulative
 * amounts, supplier, quantities; an order's amount and supplier. Documents are linked by the record's attachment
 * or by the document's own record reference. The document is the source: for an invoice the fix is the document's
 * values (with the dependent retention, net payable and cumulative recomputed); an order is corrected on
 * instruction. Quantities and units of orders against quotes are the unit check's domain and are not repeated.
 */
export type RecordRefLite = { type: "invoice" | "po" | "contract"; id: string };

/** Hebrew labels of the fact keys documents carry (unknown keys are shown as they are). */
export const FACT_LABEL_HE: Record<string, string> = { amount: "סכום", amountThis: "סכום החשבון", qty: "כמות", qtyKg: "כמות (ק״ג)", qtyTon: "כמות (טון)", unit: "יחידה", unitPrice: "מחיר יחידה", pricePerTon: "מחיר לטון", validFrom: "בתוקף מ-", validUntil: "תוקף עד", supplierId: "ספק", supplierDocNo: "מס׳ מסמך ספק", docNo: "מס׳ מסמך ספק", invoiceNo: "מס׳ מסמך ספק", date: "תאריך", invoiceDate: "תאריך", retentionPct: "שיעור עכבון", cumulativePrev: "מצטבר קודם", cumulativeNow: "מצטבר נוכחי", contractId: "חוזה", invoiceId: "מס׳ חשבון", boqLineId: "שורת כתב כמויות", exclusionClause: "סעיף החרגה" };

/** A fact's value the way a person reads it. */
export function factValueHe(pkg: HadarimPackage, key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (key === "supplierId") return supplierNameOf(pkg, String(value));
  if (typeof value === "number") {
    if (/amount|cumulative|unitPrice/i.test(key)) return nis(value);
    if (key === "pricePerTon") return `${num(value)} ₪/טון`;
    if (key === "retentionPct") return `${value}%`;
    return num(value);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateHe(value);
  return String(value);
}

export function documentHasFacts(d: HDocument): boolean {
  return !!d.facts && Object.keys(d.facts).length > 0;
}

/** The documents of a record: its attachment, the files linked to it, and for a contract its excerpt and price appendices. */
export function recordDocuments(pkg: HadarimPackage, erp: ErpState, record: RecordRefLite): HDocument[] {
  const ids = new Set<string>();
  if (record.type === "invoice") {
    const inv = erp.invoices.find((i) => String(i.id) === record.id);
    if (inv?.attachmentId) ids.add(inv.attachmentId);
  } else if (record.type === "po") {
    const po = erp.purchaseOrders.find((x) => String(x.id) === record.id);
    if (po?.attachmentId) ids.add(po.attachmentId);
  } else {
    const c = pkg.contracts.find((x) => x.id === record.id);
    if (c?.documentId) ids.add(c.documentId);
    for (const a of c?.priceAppendices ?? []) ids.add(a.documentId);
  }
  for (const d of pkg.documents) if (d.recordRef?.type === record.type && d.recordRef.id === record.id) ids.add(d.id);
  // a replaced document is history: the current one stands for the record
  return pkg.documents.filter((d) => ids.has(d.id) && !d.supersededBy);
}

/** The record a document belongs to — its recordRef, or the invoice, order or contract that points at it. Null for a free-standing page (BOQ, a quote nobody ordered). */
export function documentRecord(pkg: HadarimPackage, erp: ErpState, doc: HDocument): RecordRefLite | null {
  if (doc.recordRef && (doc.recordRef.type === "invoice" || doc.recordRef.type === "po" || doc.recordRef.type === "contract")) return { type: doc.recordRef.type, id: doc.recordRef.id };
  const inv = erp.invoices.find((i) => i.attachmentId === doc.id);
  if (inv) return { type: "invoice", id: String(inv.id) };
  const po = erp.purchaseOrders.find((p) => p.attachmentId === doc.id);
  if (po) return { type: "po", id: String(po.id) };
  const c = pkg.contracts.find((x) => x.documentId === doc.id || x.priceAppendices?.some((a) => a.documentId === doc.id));
  if (c) return { type: "contract", id: c.id };
  return null;
}

/**
 * One line of the comparison between a record and the facts read from one of its documents. `match` is null
 * when the fact has no counterpart on the record (shown, not compared); `check` names the deterministic check
 * that raises a finding on a mismatch — the document check, the unit check, or none (compared for the eye only).
 */
export interface DocumentFactRow {
  key: string;
  fieldHe: string;
  docHe: string;
  recordHe: string | null;
  match: boolean | null;
  check: "document" | "unit" | null;
  raw: unknown;
  /** Set when the document check may write the document's value on approval. */
  patchKey?: keyof InvoiceFixPatch;
  anchor?: string;
}

const numOf = (f: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, ""))) return Number(v.replace(/,/g, ""));
  }
  return null;
};
const strOf = (f: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

/**
 * The record against the facts of one document — the single comparison the document check, the ERP record
 * card and the report's record modal all show, so the screen and the check never disagree.
 */
export function compareDocument(pkg: HadarimPackage, erp: ErpState, record: RecordRefLite, doc: HDocument): DocumentFactRow[] {
  const f = (doc.facts ?? {}) as Record<string, unknown>;
  if (!Object.keys(f).length) return [];
  const rows: DocumentFactRow[] = [];
  const used = new Set<string>();
  const present = (...keys: string[]): string | null => keys.find((k) => f[k] != null && f[k] !== "") ?? null;
  const label = (key: string) => FACT_LABEL_HE[key] ?? key;
  const rest = () => {
    for (const k of Object.keys(f)) if (!used.has(k) && f[k] != null && f[k] !== "") rows.push({ key: k, fieldHe: label(k), docHe: factValueHe(pkg, k, f[k]), recordHe: null, match: null, check: null, raw: f[k] });
  };

  if (record.type === "invoice") {
    const inv = erp.invoices.find((i) => String(i.id) === record.id);
    if (!inv) return [];
    const amountKey = present("amountThis", "amount");
    if (amountKey) {
      const v = numOf(f, amountKey);
      used.add("amountThis").add("amount");
      rows.push({ key: "amount", fieldHe: "סכום", docHe: v != null ? nis(v) : String(f[amountKey]), recordHe: nis(inv.amount), match: v != null ? v === inv.amount : null, check: v != null ? "document" : null, raw: v, patchKey: "amount", anchor: "cumulative" });
    }
    const docNoKey = present("supplierDocNo", "docNo", "invoiceNo");
    if (docNoKey) {
      const v = strOf(f, docNoKey);
      used.add("supplierDocNo").add("docNo").add("invoiceNo");
      rows.push({ key: "supplierDocNo", fieldHe: "מס׳ מסמך ספק", docHe: v ?? "—", recordHe: inv.supplierDocNo, match: v ? v === inv.supplierDocNo : null, check: v ? "document" : null, raw: v, patchKey: "supplierDocNo", anchor: "header" });
    }
    const dateKey = present("date", "invoiceDate");
    if (dateKey) {
      const v = strOf(f, dateKey);
      const iso = !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
      used.add("date").add("invoiceDate");
      rows.push({ key: "date", fieldHe: "תאריך", docHe: iso ? dateHe(v!) : (v ?? "—"), recordHe: dateHe(inv.date), match: iso ? v === inv.date : null, check: iso ? "document" : null, raw: v, patchKey: "date", anchor: "header" });
    }
    if (present("retentionPct")) {
      const v = numOf(f, "retentionPct");
      used.add("retentionPct");
      rows.push({ key: "retentionPct", fieldHe: "שיעור עכבון", docHe: v != null ? `${v}%` : String(f.retentionPct), recordHe: `${inv.retentionPct}%`, match: v != null ? v === inv.retentionPct : null, check: v != null ? "document" : null, raw: v, patchKey: "retentionPct", anchor: "retention" });
    }
    for (const [key, fieldHe, recordValue] of [["cumulativePrev", "מצטבר קודם", inv.cumulativePrev], ["cumulativeNow", "מצטבר נוכחי", inv.cumulativeNow]] as const) {
      if (!present(key)) continue;
      const v = numOf(f, key);
      used.add(key);
      const compared = v != null && recordValue != null;
      rows.push({ key, fieldHe, docHe: v != null ? nis(v) : String(f[key]), recordHe: recordValue != null ? nis(recordValue) : null, match: compared ? v === recordValue : null, check: compared ? "document" : null, raw: v, patchKey: key, anchor: "cumulative" });
    }
    if (present("supplierId")) {
      const v = strOf(f, "supplierId");
      used.add("supplierId");
      rows.push({ key: "supplierId", fieldHe: "ספק", docHe: v ? supplierNameOf(pkg, v) : "—", recordHe: supplierNameOf(pkg, inv.supplierId), match: v ? v === inv.supplierId : null, check: v ? "document" : null, raw: v, anchor: "header" });
    }
    if (present("qty")) {
      const v = numOf(f, "qty");
      used.add("qty");
      const compared = v != null && inv.quantity != null;
      rows.push({ key: "qty", fieldHe: "כמות", docHe: v != null ? num(v) : String(f.qty), recordHe: inv.quantity != null ? num(inv.quantity) : null, match: compared ? v === inv.quantity : null, check: compared ? "document" : null, raw: v });
    }
    if (present("unit")) {
      const v = strOf(f, "unit");
      used.add("unit");
      const compared = !!v && !!inv.unit;
      rows.push({ key: "unit", fieldHe: "יחידה", docHe: v ?? "—", recordHe: inv.unit ?? null, match: compared ? v === inv.unit : null, check: compared ? "document" : null, raw: v });
    }
    if (present("unitPrice")) {
      const v = numOf(f, "unitPrice");
      used.add("unitPrice");
      const compared = v != null && inv.unitPrice != null;
      rows.push({ key: "unitPrice", fieldHe: "מחיר יחידה", docHe: v != null ? nis(v) : String(f.unitPrice), recordHe: inv.unitPrice != null ? nis(inv.unitPrice) : null, match: compared ? v === inv.unitPrice : null, check: compared ? "document" : null, raw: v });
    }
    if (present("invoiceId")) {
      used.add("invoiceId");
      rows.push({ key: "invoiceId", fieldHe: "מס׳ חשבון", docHe: String(f.invoiceId), recordHe: String(inv.id), match: String(f.invoiceId) === String(inv.id), check: null, raw: f.invoiceId });
    }
    rest();
    return rows;
  }

  if (record.type === "po") {
    const po = erp.purchaseOrders.find((x) => String(x.id) === record.id);
    if (!po) return [];
    if (present("amount")) {
      const v = numOf(f, "amount");
      used.add("amount");
      rows.push({ key: "amount", fieldHe: "סכום", docHe: v != null ? nis(v) : String(f.amount), recordHe: nis(po.amount), match: v != null ? v === po.amount : null, check: v != null ? "document" : null, raw: v, anchor: "line" });
    }
    if (present("supplierId")) {
      const v = strOf(f, "supplierId");
      used.add("supplierId");
      rows.push({ key: "supplierId", fieldHe: "ספק", docHe: v ? supplierNameOf(pkg, v) : "—", recordHe: supplierNameOf(pkg, po.supplierId), match: v ? v === po.supplierId : null, check: v ? "document" : null, raw: v, anchor: "header" });
    }
    // the line — quantity, unit and unit price — the way the unit check reads a quote (tons win over kilograms)
    const q = quoteFacts(doc);
    if (q && (q.qty != null || q.unit)) {
      for (const k of ["qty", "qtyKg", "qtyTon", "unit"]) used.add(k);
      const mismatch = (q.qty != null && q.qty !== po.qty) || (!!q.unit && q.unit !== po.unit);
      rows.push({ key: "line_qty", fieldHe: "כמות ויחידה", docHe: `${q.qty != null ? num(q.qty) : "—"} ${q.unit ?? ""}`.trim(), recordHe: `${num(po.qty)} ${po.unit}`, match: !mismatch, check: "unit", raw: q.qty, anchor: "line" });
    }
    if (q && q.unitPrice != null) {
      used.add("unitPrice").add("pricePerTon");
      const priceUnit = f.pricePerTon != null ? "טון" : (q.unit ?? po.priceUnit);
      rows.push({ key: "line_price", fieldHe: "מחיר יחידה", docHe: `${num(q.unitPrice)} ₪ ל${priceUnit}`, recordHe: `${num(po.unitPrice)} ₪ ל${po.priceUnit}`, match: Math.abs(q.unitPrice - po.unitPrice) <= 0.005 && priceUnit === po.priceUnit, check: "unit", raw: q.unitPrice, anchor: "line" });
    }
    rest();
    return rows;
  }

  const c = pkg.contracts.find((x) => x.id === record.id);
  if (!c) return [];
  if (present("contractId")) {
    used.add("contractId");
    rows.push({ key: "contractId", fieldHe: "חוזה", docHe: String(f.contractId), recordHe: c.id, match: String(f.contractId) === c.id, check: null, raw: f.contractId });
  }
  if (present("supplierId")) {
    const v = strOf(f, "supplierId");
    used.add("supplierId");
    rows.push({ key: "supplierId", fieldHe: "ספק", docHe: v ? supplierNameOf(pkg, v) : "—", recordHe: supplierNameOf(pkg, c.supplierId), match: v ? v === c.supplierId : null, check: null, raw: v });
  }
  const appendix = c.priceAppendices?.find((a) => a.documentId === doc.id);
  if (present("pricePerTon")) {
    const v = numOf(f, "pricePerTon");
    used.add("pricePerTon");
    rows.push({ key: "pricePerTon", fieldHe: `מחיר ל${appendix ? appendixUnit(appendix) : "טון"}`, docHe: v != null ? `${num(v)} ₪` : String(f.pricePerTon), recordHe: appendix ? `${num(appendix.pricePerTon)} ₪` : null, match: appendix && v != null ? v === appendix.pricePerTon : null, check: null, raw: v, anchor: "price" });
  }
  if (present("validFrom")) {
    const v = strOf(f, "validFrom");
    used.add("validFrom");
    rows.push({ key: "validFrom", fieldHe: "בתוקף מ-", docHe: factValueHe(pkg, "validFrom", v), recordHe: appendix ? dateHe(appendix.validFrom) : null, match: appendix && v ? v === appendix.validFrom : null, check: null, raw: v, anchor: "price" });
  }
  if (present("exclusionClause")) {
    const clause = String(f.exclusionClause);
    const found = c.exclusions.find((e) => e.clause === clause);
    used.add("exclusionClause");
    rows.push({ key: "exclusionClause", fieldHe: "סעיף החרגה", docHe: clause, recordHe: found ? `סעיף ${found.clause}: ${found.textHe}` : null, match: !!found, check: null, raw: clause, anchor: "exclusion" });
  }
  rest();
  return rows;
}

export function checkDocuments(pkg: HadarimPackage, erp: ErpState, only?: { invoiceId?: number; poId?: number }): HFinding[] {
  const out: HFinding[] = [];
  const docSource = (d: HDocument, anchor?: string): HSource => ({ kind: "document", refId: d.id, labelHe: `${d.titleHe} · ${d.fileName}${d.factsSource ? ` · עובדות: ${d.factsSource.method === "seed" ? "נתוני הבסיס" : d.factsSource.method === "agent" ? "קריאת הסוכן" : "חילוץ"}` : ""}`, documentId: d.id, ...(anchor && d.anchors[anchor] != null ? { anchor } : {}) });

  if (only?.poId == null) {
    for (const inv of erp.invoices) {
      if (only?.invoiceId != null && inv.id !== only.invoiceId) continue;
      const record: RecordRefLite = { type: "invoice", id: String(inv.id) };
      const docs = recordDocuments(pkg, erp, record).filter(documentHasFacts);
      if (!docs.length) continue;
      const rows: string[][] = [];
      const sources: HSource[] = [invoiceSource(pkg, inv)];
      const patch: InvoiceFixPatch = {};
      let fixable = true;
      let amountDelta = 0;
      for (const d of docs) {
        for (const r of compareDocument(pkg, erp, record, d)) {
          if (r.check !== "document" || r.match !== false) continue;
          rows.push([r.fieldHe, r.recordHe ?? "—", r.docHe, d.titleHe]);
          if (!sources.some((x) => x.refId === d.id)) sources.push(docSource(d, r.anchor));
          if (r.patchKey) (patch as Record<string, unknown>)[r.patchKey] = r.raw;
          else fixable = false;
          if (r.key === "amount") amountDelta = (r.raw as number) - inv.amount;
        }
      }
      if (!rows.length) continue;
      // the dependent fields follow the document's values, so the fix keeps the invoice's arithmetic
      const next = { ...inv, ...patch };
      const retentionAmt = Math.round((next.amount * next.retentionPct) / 100);
      const full: InvoiceFixPatch = { ...patch, ...(patch.amount !== undefined || patch.retentionPct !== undefined ? { retentionAmt, netPayable: next.amount - retentionAmt } : {}) };
      if (next.cumulativeNow != null && patch.cumulativeNow === undefined && (patch.amount !== undefined || patch.cumulativePrev !== undefined)) full.cumulativeNow = (next.cumulativePrev ?? 0) + next.amount;
      const consistent = next.cumulativeNow == null || full.cumulativeNow === undefined || (next.cumulativePrev ?? 0) + next.amount === full.cumulativeNow;
      const proposed = fixable && consistent && Object.keys(patch).length ? { labelHe: `לתקן לפי המסמך — ${rows.map((r) => `${r[0]} ${r[2]}`).join(" · ")}`, patch: full } : undefined;
      out.push({
        id: `F-DOC-${inv.id}`,
        kind: "document",
        titleHe: `חשבון ${inv.id} — הרשומה אינה תואמת למסמך המקור`,
        problemHe: `בחשבון ${inv.id}: ${rows.map((r) => `${r[0]} — נרשם ${r[1]}, במסמך ${r[2]}`).join("; ")}.`,
        sources,
        checkHe: `הושוו ${num(rows.length)} שדות מול ${docs.length === 1 ? `המסמך ״${docs[0].titleHe}״` : `${num(docs.length)} מסמכים`} — העובדות שנרשמו מהמסמך מול הרשומה.`,
        meaningHe: amountDelta ? `המסמך הוא המקור: הסכום שנרשם לסעיף ${sectionLabel(inv.sectionId, pkg)} ${amountDelta > 0 ? "נמוך" : "גבוה"} ב-${nis(Math.abs(amountDelta))} מהחשבון שהספק הגיש.` : "המסמך הוא המקור: פרטי הרשומה במערכת המידע שגויים, או שהעובדות שנקראו מהמסמך שגויות — יש לפתוח את המסמך.",
        impact: amountDelta ? { kind: "amount", amount: amountDelta, labelHe: `${amountDelta > 0 ? "+" : "−"}${nis(Math.abs(amountDelta))} על הסעיף` } : { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
        decision: fixDecision("לתקן את הרשומה לפי המסמך?", "לתקן בהנהלת חשבונות (או לתקן את עובדות המסמך אם הקריאה שגויה)", proposed?.labelHe),
        ...(proposed ? { proposedFix: proposed } : {}),
        sectionId: inv.sectionId,
        record: { type: "invoice", id: String(inv.id) },
        detailsTable: [["שדה", "נרשם", "במסמך", "מסמך"], ...rows],
      });
    }
  }
  if (only?.invoiceId == null) {
    for (const po of erp.purchaseOrders) {
      if (only?.poId != null && po.id !== only.poId) continue;
      const record: RecordRefLite = { type: "po", id: String(po.id) };
      const docs = recordDocuments(pkg, erp, record).filter(documentHasFacts);
      if (!docs.length) continue;
      const rows: string[][] = [];
      const sources: HSource[] = [{ kind: "po", refId: String(po.id), labelHe: `הזמנה ${po.id} · ${supplierNameOf(pkg, po.supplierId)} · ${nis(po.amount)}`, documentId: po.attachmentId ?? undefined }];
      let amountDelta = 0;
      for (const d of docs) {
        for (const r of compareDocument(pkg, erp, record, d)) {
          if (r.check !== "document" || r.match !== false) continue;
          rows.push([r.fieldHe, r.recordHe ?? "—", r.docHe, d.titleHe]);
          if (r.key === "amount") amountDelta = (r.raw as number) - po.amount;
          if (!sources.some((x) => x.refId === d.id)) sources.push(docSource(d, r.anchor));
        }
      }
      if (!rows.length) continue;
      out.push({
        id: `F-DOC-PO-${po.id}`,
        kind: "document",
        titleHe: `הזמנה ${po.id} — ההזמנה אינה תואמת למסמך המקור`,
        problemHe: `בהזמנה ${po.id}: ${rows.map((r) => `${r[0]} — נרשם ${r[1]}, במסמך ${r[2]}`).join("; ")}.`,
        sources,
        checkHe: `הושוו סכום וספק מול ${docs.length === 1 ? `המסמך ״${docs[0].titleHe}״` : `${num(docs.length)} מסמכים`}; כמויות ויחידות נבדקות בבדיקת היחידות.`,
        meaningHe: amountDelta ? `ההתחייבות שנרשמה לסעיף ${sectionLabel(po.sectionId, pkg)} ${amountDelta > 0 ? "נמוכה" : "גבוהה"} ב-${nis(Math.abs(amountDelta))} מהמסמך.` : "המסמך הוא המקור; פרטי ההזמנה במערכת המידע שגויים או שהעובדות שנקראו מהמסמך שגויות.",
        impact: amountDelta ? { kind: "amount", amount: amountDelta, labelHe: `${amountDelta > 0 ? "+" : "−"}${nis(Math.abs(amountDelta))} התחייבות` } : { kind: "none", amount: 0, labelHe: "ללא שינוי בסה״כ" },
        decision: fixDecision("לתקן את ההזמנה לפי המסמך?", "לתקן ברכש / הנהלת חשבונות (correct_purchase_order)"),
        sectionId: po.sectionId,
        record: { type: "po", id: String(po.id) },
        detailsTable: [["שדה", "נרשם", "במסמך", "מסמך"], ...rows],
      });
    }
  }
  return out;
}

export function runDataQualityChecks(pkg: HadarimPackage, erp: ErpState, controlDate: string, today: string): HFinding[] {
  return [...checkDuplicates(pkg, erp), ...checkContractOverrun(pkg, erp), ...checkCumulative(pkg, erp), ...checkRetention(pkg, erp), ...checkDates(pkg, erp, today), ...checkReviewAging(pkg, erp, controlDate), ...checkDocuments(pkg, erp)];
}

export const CHECK_STEPS_HE = ["שיוך חשבונות והזמנות מול חוזים, היסטוריית הספק ותיאור הרשומה", "יחידות וכמויות בהזמנות מול הצעות ונספחי מחיר", "מחירים בתחזית מול נספחי מחיר בתוקף", "כיסוי חוזי מול כתב כמויות", "איכות נתונים: כפילויות, סכומי חוזה, מצטברים, עכבונות, תאריכים, חשבונות בבדיקה, התאמה למסמכי המקור"];

/** All checks. `today` bounds the date check (the control date when the run is not "live"). */
export function runChecks(pkg: HadarimPackage, erp: ErpState, draft: HForecastVersion, controlDate: string, today: string = controlDate): CheckResult {
  const findings = withPeople(pkg, erp, [...checkAllocation(pkg, erp), ...checkOrderAllocation(pkg, erp), ...checkUnits(pkg, erp), ...checkPrices(pkg, erp, draft, controlDate), ...checkCoverage(pkg, draft), ...runDataQualityChecks(pkg, erp, controlDate, today)]);
  return { findings, positives: positives(pkg, draft), checkedHe: CHECK_STEPS_HE };
}
