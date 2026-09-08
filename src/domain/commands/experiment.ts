import { doc } from "../../data/documents";
import { formatILS, formatNumber, ils, multiplyQuantity } from "../money";
import { currentForecast } from "../selectors/financial";
import { addActivity, addAudit, bump, byId, replaceById, tick } from "../state-utils";
import type { DemoState, ErpRecord, ForecastVersion, SourceDocument } from "../types";
import { saveErpRecord, scheduleAnalysis } from "./core";

/**
 * "נסה נתונים אחרים": bounded, validated steel-purchase experiment (Section 10.2).
 * Editing the synthetic purchase fixture creates new labeled invoice/order/delivery versions together and
 * replaces the current demo purchase projection. Editing only the ERP row preserves the sources.
 */
export interface SteelExperimentInput {
  purchasedQuantity: number;
  purchaseUnitPrice: number; // agorot
  rawErpQuantity?: number;
}

export function validateExperiment(input: SteelExperimentInput, planned: number): string | null {
  const q = input.purchasedQuantity;
  if (!Number.isFinite(q) || q <= 0) return "כמות הרכישה חייבת להיות גדולה מאפס";
  if (q > planned) return `כמות הרכישה אינה יכולה לעלות על התוכנית (${formatNumber(planned)} טון)`;
  if (Math.round(q * 1000) !== q * 1000) return "דיוק הכמות עד שלוש ספרות אחרי הנקודה";
  if (!Number.isFinite(input.purchaseUnitPrice) || input.purchaseUnitPrice <= 0) return "מחיר הרכישה חייב להיות חיובי";
  if (input.rawErpQuantity != null && (!Number.isFinite(input.rawErpQuantity) || input.rawErpQuantity <= 0)) return "כמות הרשומה בזיו חייבת להיות חיובית";
  return null;
}

export function updateSteelExperiment(state: DemoState, input: SteelExperimentInput): DemoState {
  const record = byId(state.erpRecords, "TX-H-STEEL", "record");
  const code = byId(state.costCodes, "H10", "cost code");
  const planned = code.plannedQuantity ?? 500;
  const error = validateExperiment(input, planned);
  if (error) throw new Error(error);
  const version = state.steelExperiment.version + 1;
  const qty = input.purchasedQuantity;
  const price = input.purchaseUnitPrice;
  const amount = multiplyQuantity(qty, price);
  const rawQty = input.rawErpQuantity ?? qty;
  const rawPrice = rawQty === qty ? price : Math.round(amount / rawQty);
  const label = `גרסת הדגמה ${version}`;
  const mk = (base: SourceDocument, anchors: SourceDocument["anchors"], facts: SourceDocument["facts"]): SourceDocument => ({ ...base, version, anchors, facts, receivedAt: state.clock, date: state.clock.slice(0, 10), annotationHe: `${label}: מסמך סינתטי שנוצר מפאנל ההדגמה; הגרסאות הקודמות נשמרות.` });
  const inv = byId(state.documents.filter((d) => d.id === "INV-H-STEEL-001").sort((a, b) => b.version - a.version), "INV-H-STEEL-001", "document");
  const po = byId(state.documents.filter((d) => d.id === "PO-H-STEEL-001").sort((a, b) => b.version - a.version), "PO-H-STEEL-001", "document");
  const dn = byId(state.documents.filter((d) => d.id === "DN-H-STEEL-001").sort((a, b) => b.version - a.version), "DN-H-STEEL-001", "document");
  const newDocs: SourceDocument[] = [
    mk(inv, [inv.anchors[0], { id: "line1", labelHe: "שורה 1", text: `ברזל לזיון, דגם הדגמה R500, ${formatNumber(qty)} טון × ${formatILS(price)} = ${formatILS(amount)} לפני מע״מ.` }, inv.anchors[2]], { ...inv.facts, quantity: qty, unitPrice: price, amount }),
    mk(po, [{ id: "line1", labelHe: "שורה 1", text: `הזמנה חד-פעמית: ${formatNumber(qty)} טון ברזל R500 במחיר ${formatILS(price)} לטון, כולל הובלה.` }, po.anchors[1]], { ...po.facts, quantity: qty, unitPrice: price, amount }),
    mk(dn, [{ id: "line1", labelHe: "שורה 1", text: `סופקו ${formatNumber(qty)} טון ברזל להזמנה PO-H-STEEL-001, אתר מגורי הדרים.` }, dn.anchors[1]], { ...dn.facts, deliveredQuantity: qty }),
  ];
  const nextRecord: ErpRecord = { ...record, version: record.version + 1, quantity: rawQty, unitPrice: rawPrice, amount, allocations: [{ ...record.allocations[0], amount }], verifiedQuantity: rawQty === qty ? qty : null, checkStatus: "pending", descriptionHe: `ברזל לזיון R500 — ${formatNumber(qty)} טון` };
  const remainingQty = planned - qty;
  let s: DemoState = { ...state, documents: [...state.documents, ...newDocs], erpRecords: replaceById(state.erpRecords, record.id, () => nextRecord), commitments: replaceById(state.commitments, "PO-H-STEEL-001", (c) => ({ ...c, value: amount, quantity: qty, unitPrice: price, versions: [...c.versions, { version: c.versions.length + 1, value: amount, documentId: "PO-H-STEEL-001", at: state.clock, reasonHe: label }] })), workItems: state.workItems.map((w) => (w.id === "H-STEEL-FIRST-20" ? { ...w, quantity: qty } : w.id === "H-STEEL-REMAINING" ? { ...w, quantity: remainingQty } : w)) };
  const remaining = currentForecast(s, "H-STEEL-REMAINING");
  if (remaining) {
    const unitPrice = remaining.unitPrice ?? code.budgetUnitPrice ?? ils(3000);
    const fv: ForecastVersion = { ...remaining, id: `FV-H-STEEL-REMAINING-${remaining.version + 1}`, version: remaining.version + 1, quantity: remainingQty, amount: multiplyQuantity(remainingQty, unitPrice), basisHe: `${remaining.basisHe.replace(/ — לאחר עדכון הדוגמה.*$/, "")} — לאחר עדכון הדוגמה (${label})`, acceptedAt: state.clock };
    s = { ...s, forecasts: [...s.forecasts.map((f) => (f.workItemId === "H-STEEL-REMAINING" && f.status !== "superseded" ? { ...f, status: "superseded" as const } : f)), fv] };
  }
  const first = currentForecast(s, "H-STEEL-FIRST-20");
  if (first) {
    const fv: ForecastVersion = { ...first, id: `FV-H-STEEL-FIRST-20-${first.version + 1}`, version: first.version + 1, quantity: qty, amount: multiplyQuantity(qty, first.unitPrice ?? ils(3000)), acceptedAt: state.clock };
    s = { ...s, forecasts: [...s.forecasts.map((f) => (f.workItemId === "H-STEEL-FIRST-20" && f.status !== "superseded" ? { ...f, status: "superseded" as const } : f)), fv] };
  }
  s = { ...s, steelExperiment: { ...s.steelExperiment, purchasedQuantity: qty, purchaseUnitPrice: price, rawErpQuantity: rawQty, version } };
  s = { ...s, findings: s.findings.map((f) => (f.recordIds.includes(record.id) && !["resolved", "dismissed"].includes(f.status) ? { ...f, status: "superseded" as const } : f)), proposals: s.proposals.map((p) => (p.targetIds.includes(record.id) && p.status === "pending_review" ? { ...p, status: "superseded" as const } : p)) };
  const [s1] = addAudit(s, { actorId: "SYSTEM", kind: "experiment", textHe: `נתוני הדוגמה של רכישת הברזל עודכנו (${label}): ${formatNumber(qty)} טון × ${formatILS(price)} = ${formatILS(amount)}; רשומת זיו ${formatNumber(rawQty)} טון. נוצרו גרסאות חדשות לחשבונית, להזמנה ולתעודת המשלוח; הגרסאות הקודמות נשמרו.`, entityIds: [record.id, "INV-H-STEEL-001"], projectId: "HAD", costCodeId: "H10", reportRelevant: true });
  s = addActivity(s1, "received", `נתוני הדוגמה עודכנו: ${formatNumber(qty)} טון × ${formatILS(price)} (${label})`, [record.id]);
  s = scheduleAnalysis(s, { recordId: record.id });
  return bump(tick(s, 1));
}

/** "ערוך את הרשומה בזיו": raw ERP edit that keeps the sources, creating a reconciliation issue. */
export function editSteelErpRow(state: DemoState, rawQuantity: number, rawUnitPrice?: number): DemoState {
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) throw new Error("כמות הרשומה חייבת להיות חיובית");
  const record = byId(state.erpRecords, "TX-H-STEEL", "record");
  const unitPrice = rawUnitPrice ?? Math.round(record.amount / rawQuantity);
  let s = saveErpRecord(state, record.id, { quantity: rawQuantity, unitPrice }, record.version);
  s = { ...s, steelExperiment: { ...s.steelExperiment, rawErpQuantity: rawQuantity } };
  return s;
}

export function setCandidateFuturePrice(state: DemoState, price: number): DemoState {
  if (!Number.isFinite(price) || price <= 0) throw new Error("מחיר עתידי חייב להיות חיובי");
  if (price < ils(500) || price > ils(20000)) throw new Error("המחיר מחוץ לטווח סביר להדגמה (500–20,000 ₪ לטון)");
  return { ...state, steelExperiment: { ...state.steelExperiment, candidateFuturePrice: price } };
}

/** What-if preview for the experiment panel (fully uncommitted remainder only). */
export function steelWhatIf(state: DemoState, candidatePrice: number) {
  const code = byId(state.costCodes, "H10", "cost code");
  const budgetPrice = code.budgetUnitPrice ?? ils(3000);
  const planned = code.plannedQuantity ?? 500;
  const record = byId(state.erpRecords, "TX-H-STEEL", "record");
  const purchased = record.verifiedQuantity ?? record.quantity ?? 0;
  const purchasePrice = record.unitPrice ?? 0;
  const committed = state.workItems.filter((w) => w.costCodeId === "H10" && w.status === "committed" && w.id !== "H-STEEL-FIRST-20");
  const committedQty = committed.reduce((a, w) => a + (w.quantity ?? 0), 0);
  const remainingQty = planned - purchased - committedQty;
  const purchaseAmount = record.amount;
  const acceptedRemaining = state.workItems.filter((w) => w.costCodeId === "H10" && w.status === "uncommitted").reduce((a, w) => a + (currentForecast(state, w.id)?.amount ?? 0), 0);
  const committedAmount = committed.reduce((a, w) => a + (currentForecast(state, w.id)?.amount ?? 0), 0);
  const candidateRemaining = multiplyQuantity(remainingQty, candidatePrice);
  return {
    planned,
    purchased,
    purchasePrice,
    purchaseAmount,
    remainingQty,
    committedQty,
    committedAmount,
    acceptedRemaining,
    acceptedSteelEac: purchaseAmount + committedAmount + acceptedRemaining,
    candidateRemaining,
    candidateSteelEac: purchaseAmount + committedAmount + candidateRemaining,
    actualPriceVariance: multiplyQuantity(purchased, purchasePrice - budgetPrice),
    conditionalFutureVariance: multiplyQuantity(remainingQty, candidatePrice - budgetPrice),
    budget: code.budget,
    budgetPrice,
  };
}

export function ambiguousInvoiceVariant(base: SourceDocument, receivedAt: string): SourceDocument {
  return {
    ...doc({
      id: "INV-H-STEEL-001-AMBIG",
      kind: "invoice",
      titleHe: "חשבונית אספקה — ספק ברזל א׳ (גרסה חלופית לתרחיש: תיאור לא מכריע)",
      date: receivedAt.slice(0, 10),
      receivedAt,
      supplierId: base.supplierId,
      projectIds: base.projectIds,
      costCodeIds: [],
      anchors: [{ id: "header", labelHe: "כותרת", text: "ספק ברזל א׳; פרויקט מגורי הדרים." }, { id: "line1", labelHe: "שורה 1", text: "אספקת חומרים לאתר לפי סיכום טלפוני, סה״כ 66,000 ₪ לפני מע״מ." }, { id: "terms", labelHe: "תנאים", text: "תשלום שוטף + 60." }],
      facts: { amount: base.facts.amount, descriptionDecisive: false },
      scenarioOnly: true,
    }),
    annotationHe: "גרסה חלופית לתרחיש 3: ללא תיאור חומר, ללא הזמנה או תעודת משלוח מקושרות.",
  };
}
