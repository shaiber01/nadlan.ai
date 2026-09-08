import { generated } from "../../data/seed";
import { doc } from "../../data/documents";
import { formatDate } from "../dates";
import { formatILS, formatNumber, splitProportionally, sum } from "../money";
import { costLineView, currentForecast, paidByAllocation, projectTotals } from "../selectors/financial";
import { addActivity, addAudit, bump, byId, contactName, costCodeName, evidenceLabel, nextId, projectName, replaceById, supplierName, tick } from "../state-utils";
import type { Allocation, BudgetVersion, ChangeProposal, Commitment, DemoState, ErpRecord, Finding, ForecastVersion, Message, WorkItem } from "../types";
import { scheduleAnalysis, runPendingAnalyses } from "./core";

const WRITE_KINDS = new Set(["erp_correction", "allocation", "accrual", "invoice_match", "credit"]);
const WRITE_FAILED_HE = "העדכון לא הושלם; הנתונים בזיו לא שונו";

function proposal(state: DemoState, id: string): ChangeProposal {
  return byId(state.proposals, id, "proposal");
}

function setProposal(state: DemoState, id: string, patch: Partial<ChangeProposal>): DemoState {
  return { ...state, proposals: replaceById(state.proposals, id, (p) => ({ ...p, ...patch })) };
}

function setFinding(state: DemoState, id: string | null, patch: Partial<Finding>): DemoState {
  if (!id || !state.findings.some((f) => f.id === id)) return state;
  return { ...state, findings: replaceById(state.findings, id, (f) => ({ ...f, ...patch })) };
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Approve a proposal and immediately attempt to apply it (one visible button, explicit sequence). */
export function approveProposal(state: DemoState, proposalId: string, reviewerId: string): DemoState {
  const p = proposal(state, proposalId);
  if (p.status === "applied" || p.status === "approved") return applyApprovedProposal(state, proposalId);
  if (p.status !== "pending_review" && p.status !== "apply_failed") throw new Error("ההצעה אינה ממתינה לבדיקה");
  let s = setProposal(state, proposalId, { status: "approved", reviewedBy: reviewerId, reviewedAt: state.clock });
  s = tick(s, 2);
  return applyApprovedProposal(s, proposalId);
}

export function rejectProposal(state: DemoState, proposalId: string, reasonHe: string, reviewerId = "REVIEWER"): DemoState {
  const p = proposal(state, proposalId);
  if (p.status === "applied") throw new Error("הצעה שכבר יושמה אינה ניתנת לדחייה; אפשר ליצור תיקון הפוך");
  let s = setProposal(state, proposalId, { status: "rejected", rejectionReasonHe: reasonHe, reviewedBy: reviewerId, reviewedAt: state.clock });
  const [s1] = addAudit(s, { actorId: reviewerId, kind: "proposal_rejected", textHe: `ההצעה ״${p.titleHe}״ נדחתה. סיבה: ${reasonHe}. הנתונים בזיו לא שונו.`, entityIds: [p.id, ...p.targetIds], proposalId: p.id, projectId: p.projectId, costCodeId: p.costCodeId ?? undefined });
  s = s1;
  s = addActivity(s, "proposal", `ההצעה נדחתה: ${p.titleHe}`, [p.id]);
  return bump(tick(s, 1));
}

export function retryProposal(state: DemoState, proposalId: string): DemoState {
  const p = proposal(state, proposalId);
  if (p.status !== "apply_failed") return state;
  return applyApprovedProposal(state, proposalId);
}

export function simulateWriteFailure(state: DemoState, on = true): DemoState {
  return { ...state, flags: { ...state.flags, failNextErpWrite: on } };
}

/** Manual override of the target cost code (S03 branch): requires an explanation, creates a new proposal for review. */
export function overrideProposalCostCode(state: DemoState, proposalId: string, costCodeId: string, noteHe: string): DemoState {
  if (!noteHe.trim()) throw new Error("נדרש הסבר לבחירת סעיף ידנית");
  const p = proposal(state, proposalId);
  if (p.payload.kind !== "erp_correction") throw new Error("ניתן לשנות סעיף רק בהצעת סיווג");
  const code = byId(state.costCodes, costCodeId, "cost code");
  const [s1, newId] = nextId(state, "PRP");
  const replacement: ChangeProposal = {
    ...p,
    id: newId,
    status: "pending_review",
    titleHe: `שינוי סיווג (בחירה ידנית): ← ${code.nameHe}`,
    reasonHe: `נבחר ידנית על ידי המשתמש. הסבר: ${noteHe}`,
    after: [{ labelHe: "סעיף תקציב", value: `${code.nameHe} (${code.id})` }, ...p.after.slice(1)],
    payload: { ...p.payload, changes: { ...p.payload.changes, costCodeId } },
    manualNoteHe: noteHe,
    createdAt: state.clock,
    createdAtRevision: state.revision,
    reviewedBy: undefined,
    reviewedAt: undefined,
  };
  let s = setProposal(s1, proposalId, { status: "superseded" });
  s = { ...s, proposals: [...s.proposals, replacement] };
  s = setFinding(s, p.findingId, { proposalIds: [...(s.findings.find((f) => f.id === p.findingId)?.proposalIds ?? []), newId] });
  return bump(addActivity(s, "proposal", `נוצרה הצעת סיווג ידנית: ${code.nameHe}`, [newId]));
}

export function applyApprovedProposal(state: DemoState, proposalId: string): DemoState {
  const p = proposal(state, proposalId);
  if (p.status === "applied") return state;
  if (p.status !== "approved" && p.status !== "apply_failed") throw new Error("ניתן ליישם רק הצעה שאושרה");

  // Stale target: recalculate and request review of the updated proposal instead of applying stale values.
  for (const [targetId, version] of Object.entries(p.targetVersions)) {
    const record = state.erpRecords.find((r) => r.id === targetId);
    if (record && record.version !== version && p.payload.kind !== "allocation") {
      let s = setProposal(state, proposalId, { status: "superseded" });
      s = addActivity(s, "proposal", `הרשומה ${targetId} השתנתה מאז החישוב; ההצעה חושבה מחדש ומוגשת לבדיקה נוספת`, [proposalId]);
      s = scheduleAnalysis(s, { recordId: targetId });
      return bump(runPendingAnalyses(s));
    }
  }

  if (WRITE_KINDS.has(p.kind) && state.flags.failNextErpWrite) {
    const attempts = (p.failure?.attempts ?? 0) + 1;
    let s = setProposal(state, proposalId, { status: "apply_failed", failure: { at: state.clock, messageHe: WRITE_FAILED_HE, attempts } });
    s = { ...s, flags: { ...s.flags, failNextErpWrite: false } };
    const [s1] = addAudit(s, { actorId: "SYSTEM", kind: "apply_failed", textHe: `ניסיון עדכון בזיו נכשל עבור ״${p.titleHe}״ (ניסיון ${attempts}). ${WRITE_FAILED_HE}.`, entityIds: [p.id, ...p.targetIds], proposalId: p.id, projectId: p.projectId });
    s = addActivity(s1, "failure", `${WRITE_FAILED_HE}: ${p.titleHe}`, [p.id]);
    return bump(tick(s, 1));
  }

  let s = state;
  let auditText = "";
  let before = p.before;
  let after = p.after;
  const affectedRecordIds: string[] = [];
  const reviewer = p.reviewedBy ?? "REVIEWER";

  switch (p.payload.kind) {
    case "erp_correction": {
      const { recordId, changes } = p.payload;
      const record = byId(s.erpRecords, recordId, "record");
      const next: ErpRecord = { ...record, version: record.version + 1, checkStatus: "verified" };
      const unit = record.unit ?? "";
      const parts: string[] = [];
      if (changes.costCodeId && changes.costCodeId !== record.allocations[0].costCodeId) {
        const code = byId(s.costCodes, changes.costCodeId, "cost code");
        next.allocations = [{ ...record.allocations[0], costCodeId: code.id, projectId: code.projectId }];
        next.projectId = code.projectId;
        parts.push(`הסיווג של ${record.sourceDocumentId ?? record.id} שונה מ${costCodeName(s, record.allocations[0].costCodeId)} ל${code.nameHe}. סכום החשבונית נשאר ${formatILS(record.amount)}`);
      }
      if (changes.quantity !== undefined && changes.quantity !== record.quantity) {
        next.quantity = changes.quantity;
        parts.push(`כמות בחשבונית ${record.sourceDocumentId ?? record.id} תוקנה מ-${formatNumber(record.quantity ?? 0)} ל-${formatNumber(changes.quantity ?? 0)} ${unit}`);
      }
      if (changes.unitPrice !== undefined && changes.unitPrice !== record.unitPrice) {
        next.unitPrice = changes.unitPrice;
        parts.push(`המחיר ליחידה תוקן מ-${formatILS(record.unitPrice ?? 0)} ל-${formatILS(changes.unitPrice ?? 0)}`);
      }
      if (changes.amount !== undefined && changes.amount !== record.amount) {
        next.amount = changes.amount;
        next.allocations = next.allocations.map((al, i) => (i === 0 ? { ...al, amount: changes.amount! } : al));
        parts.push(`סכום הרשומה תוקן מ-${formatILS(record.amount)} ל-${formatILS(changes.amount)}`);
      } else if (changes.quantity !== undefined) {
        parts.push(`סכום החשבונית נשאר ${formatILS(record.amount)}`);
      }
      if (changes.verifiedQuantity !== undefined) next.verifiedQuantity = changes.verifiedQuantity;
      if (changes.priorRecordId !== undefined) {
        next.priorRecordId = changes.priorRecordId;
        if (changes.priorRecordId) parts.push(`קושר לחשבון הקודם ${changes.priorRecordId}`);
      }
      if (changes.sourceDocumentId !== undefined) {
        next.sourceDocumentId = changes.sourceDocumentId;
        next.sourceMissing = false;
      }
      if (changes.cumulativeApproved !== undefined) next.cumulativeApproved = changes.cumulativeApproved;
      if (changes.priorCumulative !== undefined) next.priorCumulative = changes.priorCumulative;
      s = { ...s, erpRecords: replaceById(s.erpRecords, recordId, () => next) };
      affectedRecordIds.push(recordId);
      auditText = `${parts.join(". ")}. מקור: ${p.evidence.map((e) => evidenceLabel(s, e)).slice(0, 3).join(", ")}.`;
      break;
    }
    case "allocation": {
      const { recordId, allocations, ruleId } = p.payload;
      const record = byId(s.erpRecords, recordId, "record");
      const total = sum(allocations.map((a) => a.amount));
      if (total !== record.amount) throw new Error("סכום החלוקה חייב להתאים לסכום החשבונית");
      const month = monthOf(record.date);
      const newAllocations: Allocation[] = allocations.map((a, i) => {
        const existing = record.allocations.find((x) => x.projectId === a.projectId && x.costCodeId === a.costCodeId);
        const periodItem = s.workItems.find((w) => w.costCodeId === a.costCodeId && (w.status === "uncommitted" || (w.status === "fulfilled" && record.allocations.some((x) => x.workItemId === w.id))) && w.period === month);
        return { id: `${record.id}-A${i + 1}`, projectId: a.projectId, costCodeId: a.costCodeId, amount: a.amount, workItemId: a.workItemId ?? periodItem?.id ?? existing?.workItemId ?? null, commitmentId: a.commitmentId ?? existing?.commitmentId ?? null };
      });
      const fulfilledIds = newAllocations.map((a) => a.workItemId).filter((x): x is string => Boolean(x));
      s = {
        ...s,
        erpRecords: replaceById(s.erpRecords, recordId, (r) => ({ ...r, allocations: newAllocations, version: r.version + 1, checkStatus: "verified" })),
        workItems: s.workItems.map((w) => (fulfilledIds.includes(w.id) && w.status === "uncommitted" ? { ...w, status: "fulfilled" as const } : w)),
      };
      affectedRecordIds.push(recordId);
      const updated = byId(s.erpRecords, recordId, "record");
      const paidParts = paidByAllocation(updated);
      before = record.allocations.map((al) => ({ labelHe: `${projectName(s, al.projectId)} · ${costCodeName(s, al.costCodeId)}`, value: formatILS(al.amount) }));
      after = updated.allocations.map((al, i) => ({ labelHe: `${projectName(s, al.projectId)} · ${costCodeName(s, al.costCodeId)}`, value: `${formatILS(al.amount)} (שולם ${formatILS(paidParts[i])})` }));
      const paidText = updated.paid > 0 ? ` התשלום הקיים ${formatILS(updated.paid)} חולק יחסית: ${updated.allocations.map((al, i) => `${formatILS(paidParts[i])} ל${projectName(s, al.projectId)}`).join(", ")}.` : "";
      auditText = `חשבונית ${record.sourceDocumentId ?? record.id} חולקה: ${updated.allocations.map((al) => `${formatILS(al.amount)} ל${projectName(s, al.projectId)}`).join(", ")}.${paidText} ${ruleId ? `לפי הנחיה מאושרת ${ruleId}.` : `מקור: ${p.sourceReplyMessageId ? "תשובת הלקוח ב-WhatsApp" : p.evidence.map((e) => evidenceLabel(s, e)).join(", ")}.`}`;
      if (ruleId) {
        const [s2, appId] = nextId(s, "RAPP");
        s = { ...s2, approvedRules: replaceById(s2.approvedRules, ruleId, (r) => ({ ...r, applications: [...r.applications, { id: appId, kind: "reuse", recordId, proposalId: p.id, at: s2.clock, noteHe: `בחשבונית זו נעשה שימוש בהנחיה קודמת; לא נשלחה שאלה נוספת` }] })) };
      }
      break;
    }
    case "accrual": {
      const { commitmentId, certificateDocumentId, amount, costCodeId, projectId, supplierId } = p.payload;
      const id = `ACC-${certificateDocumentId}`;
      if (!s.erpRecords.some((r) => r.id === id)) {
        const item = s.workItems.find((w) => w.commitmentId === commitmentId && w.status === "committed");
        const record: ErpRecord = { id, kind: "accrual", projectId, supplierId, sourceDocumentId: certificateDocumentId, relatedDocumentIds: [commitmentId], descriptionHe: `עבודה שבוצעה וטרם חויבה — לפי ${certificateDocumentId}`, date: s.clock.slice(0, 10), receivedAt: s.clock, quantity: null, unit: null, unitPrice: null, amount, allocations: [{ id: `${id}-A1`, projectId, costCodeId, amount, workItemId: item?.id ?? null, commitmentId }], paid: 0, version: 1, checkStatus: "verified", accrualOfCertificateId: certificateDocumentId };
        s = { ...s, erpRecords: [...s.erpRecords, record] };
        affectedRecordIds.push(id);
      }
      auditText = `הוכרה עבודה שבוצעה וטרם חויבה בסך ${formatILS(amount)} לפי ${certificateDocumentId}, כנגד ההתחייבות ${commitmentId}. תחזית העלות לסיום אינה משתנה.`;
      break;
    }
    case "invoice_match": {
      const { accrualRecordId, invoiceDocumentId, amount, commitmentId, projectId, costCodeId, supplierId } = p.payload;
      const accrual = byId(s.erpRecords, accrualRecordId, "accrual");
      const invoiceId = `TX-${invoiceDocumentId}`;
      if (!s.erpRecords.some((r) => r.id === invoiceId)) {
        const invoice: ErpRecord = { id: invoiceId, kind: "invoice", projectId, supplierId, sourceDocumentId: invoiceDocumentId, relatedDocumentIds: [accrual.accrualOfCertificateId ?? ""], descriptionHe: `חשבונית ${invoiceDocumentId} — מחליפה רישום זמני`, date: s.clock.slice(0, 10), receivedAt: s.clock, quantity: null, unit: null, unitPrice: null, amount, allocations: [{ id: `${invoiceId}-A1`, projectId, costCodeId, amount, workItemId: accrual.allocations[0].workItemId, commitmentId }], paid: 0, version: 1, checkStatus: "verified" };
        const reversal: ErpRecord = { id: `REV-${accrualRecordId}`, kind: "accrual_reversal", projectId, supplierId, sourceDocumentId: invoiceDocumentId, relatedDocumentIds: [accrualRecordId], descriptionHe: `קיזוז רישום זמני ${accrualRecordId} עם קליטת ${invoiceDocumentId}`, date: s.clock.slice(0, 10), receivedAt: s.clock, quantity: null, unit: null, unitPrice: null, amount: -accrual.amount, allocations: [{ id: `REV-${accrualRecordId}-A1`, projectId, costCodeId, amount: -accrual.amount, workItemId: accrual.allocations[0].workItemId, commitmentId }], paid: 0, version: 1, checkStatus: "verified", reversesRecordId: accrualRecordId };
        s = { ...s, erpRecords: [...s.erpRecords, invoice, reversal] };
        affectedRecordIds.push(invoiceId);
      }
      auditText = `נקלטה חשבונית ${invoiceDocumentId} בסך ${formatILS(amount)} והרישום הזמני ${accrualRecordId} קוזז. העלות שנצברה לא השתנתה; אין הכרה כפולה.`;
      break;
    }
    case "credit": {
      const { originalRecordId, creditDocumentId, amount } = p.payload;
      const original = byId(s.erpRecords, originalRecordId, "record");
      const id = `CR-${creditDocumentId}`;
      if (!s.erpRecords.some((r) => r.id === id)) {
        const credit: ErpRecord = { id, kind: "credit", projectId: original.projectId, supplierId: original.supplierId, sourceDocumentId: creditDocumentId, relatedDocumentIds: [originalRecordId], descriptionHe: `זיכוי שאושר כנגד ${original.sourceDocumentId ?? originalRecordId}`, date: s.clock.slice(0, 10), receivedAt: s.clock, quantity: null, unit: null, unitPrice: null, amount: -amount, allocations: [{ id: `${id}-A1`, projectId: original.projectId, costCodeId: original.allocations[0].costCodeId, amount: -amount, workItemId: null, commitmentId: null, additionalScope: true }], paid: 0, version: 1, checkStatus: "verified", creditOfRecordId: originalRecordId };
        s = { ...s, erpRecords: [...s.erpRecords, credit], tasks: s.tasks.map((t) => (t.recordId === originalRecordId && t.kind === "credit_request" ? { ...t, status: "done" as const } : t)) };
        affectedRecordIds.push(id);
      }
      s = { ...s, findings: s.findings.map((f) => (f.kind === "contract_charge" && f.recordIds.includes(originalRecordId) && f.id !== p.findingId && f.status !== "resolved" ? { ...f, status: "resolved" as const, resolutionHe: `זיכוי שאושר: ${formatILS(amount)}` } : f)) };
      auditText = `זיכוי שאושר: ${formatILS(amount)} נרשם כהתאמת עלות מקושרת כנגד ${original.sourceDocumentId ?? originalRecordId}. החשבונית המקורית והזיכוי נשמרים לעיון; לא בוצע תשלום.`;
      break;
    }
    case "commitment": {
      const payload = p.payload;
      let commitmentId = payload.commitmentId ?? payload.create?.id ?? "";
      if (payload.commitmentId && payload.newValue != null) {
        const c = byId(s.commitments, payload.commitmentId, "commitment");
        s = { ...s, commitments: replaceById(s.commitments, c.id, (x) => ({ ...x, value: payload.newValue!, versions: [...x.versions, { version: x.versions.length + 1, value: payload.newValue!, documentId: p.evidence[0]?.documentId ?? null, at: s.clock, reasonHe: p.reasonHe }] })) };
      } else if (payload.create && !s.commitments.some((c) => c.id === payload.create!.id)) {
        const created: Commitment = { id: payload.create.id, projectId: payload.projectId, costCodeId: payload.costCodeId, supplierId: payload.create.supplierId, kind: payload.create.kind, titleHe: payload.create.titleHe, value: payload.create.value, documentId: payload.create.documentId, status: payload.conditional ? "conditional" : "active", createdAt: s.clock, versions: [{ version: 1, value: payload.create.value, documentId: payload.create.documentId, at: s.clock, reasonHe: p.reasonHe }], quantity: payload.create.quantity, unit: payload.create.unit, unitPrice: payload.create.unitPrice };
        s = { ...s, commitments: [...s.commitments, created] };
        commitmentId = created.id;
      }
      if (!s.workItems.some((w) => w.id === payload.workItem.id)) {
        const item: WorkItem = { id: payload.workItem.id, projectId: payload.projectId, costCodeId: payload.costCodeId, titleHe: payload.workItem.titleHe, status: "committed", commitmentId, quantity: payload.workItem.quantity, unit: payload.workItem.unit, sourceDocumentId: p.evidence[0]?.documentId ?? null, createdAt: s.clock };
        const fv: ForecastVersion = { id: `FV-${item.id}-1`, workItemId: item.id, version: 1, amount: payload.workItem.forecastAmount, quantity: payload.workItem.quantity, unitPrice: payload.create?.unitPrice, basisHe: payload.workItem.basisHe, evidence: payload.workItem.evidence, status: "accepted", acceptedBy: reviewer, acceptedAt: s.clock };
        s = { ...s, workItems: [...s.workItems, item], forecasts: [...s.forecasts, fv] };
      }
      if (payload.consumeWorkItemIds?.length) {
        s = { ...s, workItems: s.workItems.map((w) => (payload.consumeWorkItemIds!.includes(w.id) ? { ...w, status: "committed" as const, commitmentId } : w)) };
      }
      if (payload.reduceWorkItem) {
        const r = payload.reduceWorkItem;
        const current = currentForecast(s, r.workItemId);
        const fv: ForecastVersion = { id: `FV-${r.workItemId}-${(current?.version ?? 0) + 1}`, workItemId: r.workItemId, version: (current?.version ?? 0) + 1, amount: r.amount, quantity: r.quantity, unitPrice: r.unitPrice, basisHe: `${current?.basisHe ?? ""} — לאחר הזמנה במחיר קבוע (${p.evidence[0]?.documentId ?? ""})`, evidence: current?.evidence ?? [], status: "accepted", acceptedBy: reviewer, acceptedAt: s.clock };
        s = { ...s, forecasts: [...s.forecasts.map((f) => (f.workItemId === r.workItemId && f.status !== "superseded" ? { ...f, status: "superseded" as const } : f)), fv], workItems: replaceById(s.workItems, r.workItemId, (w) => ({ ...w, quantity: r.quantity })) };
      }
      if (payload.recovery && !s.recoveries.some((r) => r.id === payload.recovery!.id)) {
        s = { ...s, recoveries: [...s.recoveries, { id: payload.recovery.id, projectId: payload.projectId, costCodeId: payload.costCodeId, documentId: payload.recovery.documentId, amount: payload.recovery.amount, status: "pending_customer_approval", titleHe: payload.recovery.titleHe, createdAt: s.clock }] };
      }
      s = supersedePriceRisks(s, payload.costCodeId, `עודכן: ${p.titleHe}. החשיפה למחיר עתידי חושבה מחדש לפי הכמות שנותרה ללא התחייבות.`);
      for (const r of s.erpRecords) if (r.kind === "invoice" && r.allocations.some((al) => al.costCodeId === payload.costCodeId)) s = scheduleAnalysis(s, { recordId: r.id });
      const line = costLineView(s, payload.costCodeId);
      auditText = `${p.titleHe}. התחייבויות שנותרו בסעיף ${costCodeName(s, payload.costCodeId)}: ${formatILS(line.commitments)}; תחזית עלות לסיום: ${formatILS(line.eac)}. החשבוניות והתשלומים לא השתנו. מקור: ${p.evidence.map((e) => evidenceLabel(s, e)).slice(0, 2).join(", ")}.`;
      break;
    }
    case "forecast": {
      const payload = p.payload;
      for (const change of payload.items) {
        const current = currentForecast(s, change.workItemId);
        const fv: ForecastVersion = { id: `FV-${change.workItemId}-${(current?.version ?? 0) + 1}`, workItemId: change.workItemId, version: (current?.version ?? 0) + 1, amount: change.amount, quantity: change.quantity ?? current?.quantity, unitPrice: change.unitPrice, basisHe: change.basisHe, evidence: change.evidence, status: "accepted", acceptedBy: reviewer, acceptedAt: s.clock, validUntil: change.validUntil };
        s = { ...s, forecasts: [...s.forecasts.map((f) => (f.workItemId === change.workItemId && f.status !== "superseded" ? { ...f, status: "superseded" as const } : f)), fv] };
      }
      for (const nw of payload.newWorkItems ?? []) {
        if (s.workItems.some((w) => w.id === nw.id)) continue;
        const item: WorkItem = { id: nw.id, projectId: payload.projectId, costCodeId: payload.costCodeId, titleHe: nw.titleHe, status: "uncommitted", commitmentId: null, quantity: nw.quantity, unit: nw.unit, sourceDocumentId: nw.evidence[0]?.documentId ?? null, group: nw.group, createdAt: s.clock };
        const fv: ForecastVersion = { id: `FV-${item.id}-1`, workItemId: item.id, version: 1, amount: nw.amount, quantity: nw.quantity, basisHe: nw.basisHe, evidence: nw.evidence, status: "accepted", acceptedBy: reviewer, acceptedAt: s.clock };
        s = { ...s, workItems: [...s.workItems, item], forecasts: [...s.forecasts, fv] };
      }
      if (payload.recovery && !s.recoveries.some((r) => r.id === payload.recovery!.id)) {
        s = { ...s, recoveries: [...s.recoveries, { id: payload.recovery.id, projectId: payload.projectId, costCodeId: payload.costCodeId, documentId: payload.recovery.documentId, amount: payload.recovery.amount, status: "pending_customer_approval", titleHe: payload.recovery.titleHe, createdAt: s.clock }] };
      }
      const line = costLineView(s, payload.costCodeId);
      const totals = projectTotals(s, payload.projectId);
      s = resolvePriceRisks(s, payload.costCodeId, `עודכן: ${p.titleHe}. תחזית הסעיף ${formatILS(line.eac)} (${line.variance >= 0 ? "חריגה צפויה" : "תחזית נמוכה מהתקציב"} ${formatILS(Math.abs(line.variance))}); תחזית הפרויקט ${formatILS(totals.eac)}.`);
      auditText = `${p.titleHe}. תחזית עלות לסיום של ${costCodeName(s, payload.costCodeId)}: ${formatILS(line.eac)}; חריגה צפויה ${formatILS(line.variance)}. התקציב המאושר לא השתנה. מקור: ${p.evidence.map((e) => evidenceLabel(s, e)).slice(0, 3).join(", ")}.`;
      break;
    }
    case "draft_budget": {
      const { projectId, lineId, unitPrice, quantity, noteHe } = p.payload;
      const current = s.budgetVersions.find((b) => b.projectId === projectId && b.kind === "draft" && b.status === "current");
      if (!current) throw new Error("אין טיוטת תקציב נוכחית");
      const version = current.version + 1;
      const id = `BUD-${projectId}-DRAFT-V${version}`;
      const lines = current.lines.map((l) => (l.id === lineId ? { ...l, unitPrice, quantity, amount: Math.round(quantity * unitPrice) } : l));
      const next: BudgetVersion = { id, projectId, version, kind: "draft", documentId: id, createdAt: s.clock, status: "current", lines, noteHe };
      const line = lines.find((l) => l.id === lineId)!;
      const document = generated(
        doc({
          id,
          kind: "budget",
          titleHe: `טיוטת תקציב — ${projectName(s, projectId)} (גרסה ${version})`,
          date: s.clock.slice(0, 10),
          receivedAt: s.clock,
          projectIds: [projectId],
          costCodeIds: lines.map((l) => l.id),
          anchors: lines.map((l) => ({ id: l.id === lineId ? "concrete" : "other", labelHe: l.nameHe, text: l.quantity != null && l.unitPrice != null ? `${l.nameHe}: ${formatNumber(l.quantity)} ${l.unit} × ${formatILS(l.unitPrice)} = ${formatILS(l.amount)}.` : `${l.nameHe}: ${formatILS(l.amount)}.` })).concat([{ id: "status", labelHe: "סטטוס", text: `טיוטה שטרם אושרה. ${noteHe}` }]),
          facts: { material: "concrete", spec: "C30", quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount },
          version: 1,
        }),
      );
      s = { ...s, budgetVersions: [...s.budgetVersions.map((b) => (b.id === current.id ? { ...b, status: "superseded" as const } : b)), next], documents: [...s.documents, document] };
      auditText = `טיוטת התקציב של ${projectName(s, projectId)} עודכנה לגרסה ${version}: ${line.nameHe} ${formatILS(unitPrice)} ל${line.unit}, סה״כ ${formatILS(line.amount)}; סך הטיוטה ${formatILS(sum(lines.map((l) => l.amount)))}. הגרסה הקודמת נשמרה להשוואה. תקציבי הפרויקטים הפעילים לא השתנו.`;
      break;
    }
    case "duration": {
      const payload = p.payload;
      s = { ...s, projects: replaceById(s.projects, payload.projectId, (pr) => ({ ...pr, acceptedMonths: payload.months, acceptedFinish: payload.finish })) };
      if (!s.workItems.some((w) => w.id === payload.workItemId)) {
        const item: WorkItem = { id: payload.workItemId, projectId: payload.projectId, costCodeId: payload.costCodeId, titleHe: `תקורות אתר — ${payload.extraMonths} חודשים נוספים (עד ${formatDate(payload.finish)})`, status: "uncommitted", commitmentId: null, quantity: payload.extraMonths, unit: "חודשים", sourceDocumentId: payload.documentId, createdAt: s.clock };
        const fv: ForecastVersion = { id: `FV-${item.id}-1`, workItemId: item.id, version: 1, amount: payload.extraAmount, quantity: payload.extraMonths, unitPrice: payload.extraMonths ? Math.round(payload.extraAmount / payload.extraMonths) : undefined, basisHe: `הארכת משך האתר ל-${payload.months} חודשים; רכיבים: ${payload.componentIds.join(", ")}`, evidence: p.evidence, status: "accepted", acceptedBy: reviewer, acceptedAt: s.clock };
        s = { ...s, workItems: [...s.workItems, item], forecasts: [...s.forecasts, fv] };
      }
      const line = costLineView(s, payload.costCodeId);
      auditText = `משך האתר המאושר עודכן ל-${payload.months} חודשים (סיום ${formatDate(payload.finish)}); נוספו ${formatILS(payload.extraAmount)} ליתרת העבודה ללא התחייבות בתקורות האתר. תחזית הסעיף: ${formatILS(line.eac)}. התכנון המקורי נשמר כבסיס; לא נוצרה חשבונית או תשלום.`;
      break;
    }
    case "rule": {
      const rule = p.payload.rule;
      if (!s.approvedRules.some((r) => r.id === rule.id)) s = { ...s, approvedRules: [...s.approvedRules, rule] };
      auditText = `נשמרה הנחיה מאושרת ${rule.id}: ${rule.descriptionHe}`;
      break;
    }
    case "dismiss_flag": {
      const { findingId, recordId } = p.payload;
      s = setFinding(s, findingId, { status: "dismissed", resolutionHe: p.reasonHe });
      if (recordId) {
        s = { ...s, erpRecords: replaceById(s.erpRecords, recordId, (r) => ({ ...r, checkStatus: "verified" })), tasks: s.tasks.map((t) => (t.recordId === recordId ? { ...t, status: "done" as const } : t)) };
        s = { ...s, findings: s.findings.map((f) => (f.recordIds.includes(recordId) && f.kind === "contract_charge" && f.status !== "dismissed" ? { ...f, status: "dismissed" as const, resolutionHe: p.reasonHe } : f)) };
      }
      auditText = `הדגל נסגר עם הסבר: ${p.reasonHe}`;
      break;
    }
  }

  const [s1, audit] = addAudit(s, { actorId: reviewer, kind: `applied:${p.kind}`, textHe: auditText, entityIds: [p.id, ...p.targetIds, ...affectedRecordIds], before, after, evidence: p.evidence, proposalId: p.id, projectId: p.projectId, costCodeId: p.costCodeId ?? undefined, reportRelevant: true });
  s = s1;
  s = setProposal(s, proposalId, { status: "applied", appliedAt: s.clock, appliedAuditId: audit.id, before, after });
  const finding = s.findings.find((f) => f.id === p.findingId);
  if (finding && p.payload.kind !== "dismiss_flag") {
    const allApplied = finding.proposalIds.every((pid) => ["applied", "rejected", "superseded"].includes(s.proposals.find((x) => x.id === pid)?.status ?? ""));
    s = setFinding(s, finding.id, { status: allApplied ? "resolved" : finding.status, resolutionHe: allApplied ? `יושם: ${p.titleHe}` : finding.resolutionHe });
    if (allApplied) {
      s = { ...s, questions: s.questions.map((q) => (q.findingId === finding.id && q.status !== "resolved" ? { ...q, status: "resolved" as const, resolutionHe: q.resolutionHe ?? `הבירור הסתיים: ${p.titleHe}` } : q)) };
    }
  }
  s = addActivity(s, "applied", `עודכן בזיו — סביבת הדגמה: ${p.titleHe}`, [p.id, ...affectedRecordIds]);
  for (const recordId of affectedRecordIds) s = scheduleAnalysis(s, { recordId });
  return bump(tick(s, 2));
}

/** After a commitment changes a cost code's exposure, retire the open price-risk finding/alert and note it in the thread. */
function supersedePriceRisks(state: DemoState, costCodeId: string, noteHe: string): DemoState {
  let s = state;
  const open = s.findings.filter((f) => f.kind === "price_risk" && f.costCodeId === costCodeId && !["resolved", "dismissed", "superseded"].includes(f.status));
  for (const f of open) {
    s = setFinding(s, f.id, { status: "superseded", resolutionHe: noteHe });
    for (const alertId of f.alertIds) {
      const alert = s.alerts.find((a) => a.id === alertId);
      if (!alert) continue;
      s = { ...s, alerts: replaceById(s.alerts, alertId, (a) => ({ ...a, status: "superseded" })) };
      if (alert.conversationId) s = appendThreadNote(s, alert.conversationId, noteHe, { alertId });
    }
    s = { ...s, questions: s.questions.map((q) => (q.findingId === f.id && !["answered", "resolved"].includes(q.status) ? { ...q, status: "superseded" as const } : q)), proposals: s.proposals.map((pr) => (pr.findingId === f.id && pr.status === "pending_review" ? { ...pr, status: "superseded" as const } : pr)) };
  }
  return s;
}

function resolvePriceRisks(state: DemoState, costCodeId: string, noteHe: string): DemoState {
  let s = state;
  const open = s.findings.filter((f) => f.kind === "price_risk" && f.costCodeId === costCodeId && !["resolved", "dismissed", "superseded"].includes(f.status));
  for (const f of open) {
    s = setFinding(s, f.id, { status: "resolved", resolutionHe: noteHe });
    for (const alertId of f.alertIds) {
      const alert = s.alerts.find((a) => a.id === alertId);
      if (!alert) continue;
      s = { ...s, alerts: replaceById(s.alerts, alertId, (a) => ({ ...a, status: a.status === "delivered" || a.status === "acknowledged" ? "resolved" : "superseded" })) };
      if (alert.conversationId) s = appendThreadNote(s, alert.conversationId, noteHe, { alertId });
    }
    for (const q of s.questions.filter((x) => x.findingId === f.id)) {
      if (q.conversationId && q.status === "answered") s = appendThreadNote(s, q.conversationId, noteHe, { questionId: q.id });
      s = { ...s, questions: replaceById(s.questions, q.id, (x) => ({ ...x, status: "resolved", resolutionHe: noteHe })) };
    }
  }
  return s;
}

export function appendThreadNote(state: DemoState, conversationId: string, textHe: string, link: { alertId?: string; questionId?: string; reportId?: string } = {}): DemoState {
  if (!state.conversations.some((c) => c.id === conversationId)) return state;
  const [s1, id] = nextId(state, "MSG");
  const message: Message = { id, direction: "outbound", kind: "update", textHe, at: state.clock, attachments: [], authorId: "REVIEWER", ...link };
  return { ...s1, conversations: replaceById(s1.conversations, conversationId, (c) => ({ ...c, messages: [...c.messages, message], updatedAt: state.clock })) };
}

/** A "reverse correction" creates a new audit entry and a new record version; history is never deleted. */
export function reverseCorrection(state: DemoState, auditId: string, reviewerId: string): DemoState {
  const audit = byId(state.auditEvents, auditId, "audit");
  const p = audit.proposalId ? state.proposals.find((x) => x.id === audit.proposalId) : undefined;
  if (!p || p.payload.kind !== "erp_correction") throw new Error("ניתן לבטל רק תיקוני רשומה");
  const record = byId(state.erpRecords, p.payload.recordId, "record");
  const rows = p.before;
  let next: ErpRecord = { ...record, version: record.version + 1 };
  for (const r of rows) {
    if (r.labelHe === "כמות") next = { ...next, quantity: Number(r.value.replace(/[^\d.]/g, "")) };
    if (r.labelHe === "מחיר ליחידה") next = { ...next, unitPrice: Math.round(Number(r.value.replace(/[^\d.]/g, "")) * 100) };
    if (r.labelHe === "סעיף תקציב") {
      const codeId = /\(([A-Z]\d+)\)/.exec(r.value)?.[1];
      const code = codeId ? state.costCodes.find((c) => c.id === codeId) : undefined;
      if (code) next = { ...next, allocations: [{ ...next.allocations[0], costCodeId: code.id, projectId: code.projectId }], projectId: code.projectId };
    }
  }
  let s: DemoState = { ...state, erpRecords: replaceById(state.erpRecords, record.id, () => ({ ...next, checkStatus: "pending" })) };
  const [s1] = addAudit(s, { actorId: reviewerId, kind: "reversed", textHe: `התיקון ״${p.titleHe}״ בוטל ברישום חדש; הערכים הקודמים שוחזרו ברשומה ${record.id} (גרסה ${next.version}). ההיסטוריה נשמרת.`, entityIds: [record.id, p.id], before: p.after, after: p.before, proposalId: p.id, projectId: p.projectId, costCodeId: p.costCodeId ?? undefined, reportRelevant: true });
  s = scheduleAnalysis(s1, { recordId: record.id });
  return bump(tick(s, 1));
}

export function dismissFinding(state: DemoState, findingId: string, explanationHe: string, reviewerId = "REVIEWER"): DemoState {
  if (!explanationHe.trim()) throw new Error("נדרש הסבר לסגירת ממצא");
  let s = setFinding(state, findingId, { status: "dismissed", resolutionHe: explanationHe });
  const f = byId(s.findings, findingId, "finding");
  const [s1] = addAudit(s, { actorId: reviewerId, kind: "finding_dismissed", textHe: `הממצא ״${f.titleHe}״ נסגר עם הסבר: ${explanationHe}`, entityIds: [findingId], projectId: f.projectId, costCodeId: f.costCodeId ?? undefined });
  s = s1;
  s = { ...s, proposals: s.proposals.map((p) => (p.findingId === findingId && p.status === "pending_review" ? { ...p, status: "superseded" as const } : p)), questions: s.questions.map((q) => (q.findingId === findingId && !["resolved", "answered"].includes(q.status) ? { ...q, status: "resolved" as const, resolutionHe: explanationHe } : q)) };
  return bump(tick(s, 1));
}

export function updateProposalDraftPrice(state: DemoState, proposalId: string, unitPrice: number): DemoState {
  const p = proposal(state, proposalId);
  const payload = p.payload;
  if (payload.kind !== "draft_budget") throw new Error("לא הצעת טיוטה");
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error("המחיר חייב להיות חיובי");
  const quantity = payload.quantity;
  const current = state.budgetVersions.find((b) => b.projectId === payload.projectId && b.kind === "draft" && b.status === "current")!;
  const line = current.lines.find((l) => l.id === payload.lineId)!;
  const total = sum(current.lines.map((l) => l.amount));
  const newAmount = Math.round(quantity * unitPrice);
  return setProposal(state, proposalId, {
    payload: { ...payload, unitPrice },
    titleHe: `עדכון מחיר ${line.nameHe} בטיוטה: ${formatILS(line.unitPrice ?? 0)} ← ${formatILS(unitPrice)}`,
    after: [{ labelHe: "מחיר ליחידה", value: formatILS(unitPrice) }, { labelHe: `סה״כ ${line.nameHe}`, value: formatILS(newAmount) }, { labelHe: "סך הטיוטה", value: formatILS(total - line.amount + newAmount) }],
  });
}

export function proposalsAwaitingReview(state: DemoState): ChangeProposal[] {
  return state.proposals.filter((p) => p.status === "pending_review" || p.status === "apply_failed" || p.status === "approved");
}

export function splitPreview(amount: number, weights: number[]): number[] {
  return splitProportionally(amount, weights);
}

export function describeContact(state: DemoState, id: string): string {
  return contactName(state, id);
}

export function describeSupplier(state: DemoState, id: string | null): string {
  return supplierName(state, id);
}
