import { analyzeCostCode, analyzeDocument, analyzeRecord } from "../../intelligence/deterministic/analysis";
import type { AnalysisResult, FindingDraft } from "../../intelligence/types";
import type { Alert, ChangeProposal, ClientQuestion, DemoState, ErpRecord, Finding, SourceDocument, Task } from "../types";
import { addActivity, bump, nextId, replaceById, tick } from "../state-utils";

/**
 * Core commands: receiving records/documents, scheduling and completing automatic analysis,
 * and merging analysis drafts into findings/proposals/questions/alerts idempotently.
 */

export function scheduleAnalysis(state: DemoState, subject: { recordId?: string; documentId?: string; costCodeId?: string }): DemoState {
  const record = subject.recordId ? state.erpRecords.find((r) => r.id === subject.recordId) : undefined;
  const key = subject.recordId ?? subject.documentId ?? subject.costCodeId ?? "";
  const version = record?.version ?? 1;
  const already = state.pendingAnalyses.some((p) => p.recordId === key && p.recordVersion === version && p.sessionId === state.sessionId);
  if (already) return state;
  const [s1, id] = nextId(state, "ANL");
  return {
    ...s1,
    pendingAnalyses: [...s1.pendingAnalyses, { id, recordId: key, recordVersion: version, sessionId: state.sessionId, scheduledAt: state.clock, documentId: subject.documentId ?? (subject.costCodeId ? `code:${subject.costCodeId}` : undefined) }],
  };
}

export function receiveDocuments(state: DemoState, documents: SourceDocument[], options: { analyze?: boolean; note?: string } = {}): DemoState {
  let s = state;
  const added: string[] = [];
  for (const document of documents) {
    if (s.documents.some((d) => d.id === document.id && d.version === document.version)) continue;
    s = { ...s, documents: [...s.documents, { ...document, receivedAt: document.receivedAt || s.clock }], introducedDocumentIds: [...s.introducedDocumentIds, document.id], lastReceivedAt: document.receivedAt || s.clock };
    added.push(document.id);
    if (options.analyze !== false && ["approval", "credit", "addendum", "change_order", "quote", "purchase_order", "schedule", "budget"].includes(document.kind)) {
      s = scheduleAnalysis(s, { documentId: document.id });
    } else if (options.analyze !== false && document.kind === "invoice" && document.facts.matchesCertificateId) {
      s = scheduleAnalysis(s, { documentId: document.id });
    }
  }
  if (added.length > 0) s = addActivity(s, "received", options.note ?? `התקבלו מסמכים: ${added.join(", ")}`, added);
  return bump(s);
}

export function receiveRecord(state: DemoState, record: ErpRecord, documents: SourceDocument[] = [], noteHe?: string): DemoState {
  let s = receiveDocuments(state, documents, { analyze: false });
  if (record.certificateId && s.processedCertificateIds.includes(record.certificateId)) {
    return addActivity(s, "failure", `החשבון ${record.certificateId} כבר נקלט; לא נוצרה תנועה נוספת`, [record.certificateId]);
  }
  if (s.erpRecords.some((r) => r.id === record.id)) return s;
  const received = { ...record, receivedAt: record.receivedAt || s.clock, checkStatus: "pending" as const };
  s = { ...s, erpRecords: [...s.erpRecords, received], lastReceivedAt: received.receivedAt };
  if (record.certificateId) s = { ...s, processedCertificateIds: [...s.processedCertificateIds, record.certificateId] };
  s = addActivity(s, "received", noteHe ?? `התקבלה רשומה בזיו: ${record.descriptionHe} (${record.id})`, [record.id]);
  s = scheduleAnalysis(s, { recordId: record.id });
  return bump(s);
}

export interface SaveRecordInput {
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number;
  costCodeId?: string;
  descriptionHe?: string;
}

/** Simulated ERP save: changes observed posted values (not sources), bumps the version, schedules analysis. */
export function saveErpRecord(state: DemoState, recordId: string, input: SaveRecordInput, expectedVersion?: number): DemoState {
  const record = state.erpRecords.find((r) => r.id === recordId);
  if (!record) throw new Error(`Record ${recordId} not found`);
  if (expectedVersion != null && expectedVersion !== record.version) throw new Error("הרשומה השתנתה בינתיים; טען מחדש לפני שמירה");
  const next: ErpRecord = { ...record, version: record.version + 1, checkStatus: "pending", verifiedQuantity: input.quantity !== undefined ? null : record.verifiedQuantity };
  if (input.quantity !== undefined) next.quantity = input.quantity;
  if (input.unitPrice !== undefined) next.unitPrice = input.unitPrice;
  if (input.descriptionHe !== undefined) next.descriptionHe = input.descriptionHe;
  if (input.amount !== undefined) {
    next.amount = input.amount;
    if (next.allocations.length === 1) next.allocations = [{ ...next.allocations[0], amount: input.amount }];
  }
  if (input.costCodeId !== undefined && next.allocations.length === 1) {
    const code = state.costCodes.find((c) => c.id === input.costCodeId);
    if (!code) throw new Error(`Unknown cost code ${input.costCodeId}`);
    next.allocations = [{ ...next.allocations[0], costCodeId: code.id, projectId: code.projectId }];
    next.projectId = code.projectId;
  }
  let s: DemoState = { ...state, erpRecords: replaceById(state.erpRecords, recordId, () => next), lastReceivedAt: state.clock };
  s = addActivity(s, "received", `נשמרה רשומה בזיו: ${next.descriptionHe} (${next.id}, גרסה ${next.version})`, [next.id]);
  s = scheduleAnalysis(s, { recordId });
  return bump(tick(s, 1));
}

function mergeFinding(state: DemoState, draft: FindingDraft, subjectRecordId: string | null): DemoState {
  const existing = state.findings.find((f) => f.dedupeKey === draft.dedupeKey && f.status !== "superseded");
  if (existing) return state;
  let s = state;
  // supersede older findings the draft explicitly replaces
  if (draft.supersedesKeys?.length) {
    const superseded = s.findings.filter((f) => draft.supersedesKeys!.includes(f.dedupeKey) && f.status !== "resolved");
    const ids = new Set(superseded.map((f) => f.id));
    s = {
      ...s,
      findings: s.findings.map((f) => (ids.has(f.id) ? { ...f, status: "superseded" as const } : f)),
      proposals: s.proposals.map((p) => (p.findingId && ids.has(p.findingId) && p.status === "pending_review" ? { ...p, status: "superseded" as const } : p)),
    };
  }
  const [s1, findingId] = nextId(s, "FND");
  s = s1;
  const proposalIds: string[] = [];
  const questionIds: string[] = [];
  const alertIds: string[] = [];
  const taskIds: string[] = [];
  const proposals: ChangeProposal[] = [];
  for (const p of draft.proposals) {
    const [s2, proposalId] = nextId(s, "PRP");
    s = s2;
    proposalIds.push(proposalId);
    const targetVersions: Record<string, number> = {};
    for (const t of p.targetIds) {
      const record = s.erpRecords.find((r) => r.id === t);
      if (record) targetVersions[t] = record.version;
    }
    const payload = p.payload.kind === "dismiss_flag" ? { ...p.payload, findingId } : p.payload;
    proposals.push({
      id: proposalId,
      kind: p.kind,
      findingId,
      projectId: draft.projectId,
      costCodeId: p.costCodeId ?? draft.costCodeId,
      targetIds: p.targetIds,
      titleHe: p.titleHe,
      reasonHe: p.reasonHe,
      before: p.before,
      after: p.after,
      payload,
      evidence: p.evidence,
      status: p.status ?? "pending_review",
      createdAt: s.clock,
      createdAtRevision: s.revision,
      targetVersions,
      sessionId: s.sessionId,
      ruleId: p.ruleId,
      labelHe: p.labelHe,
    });
  }
  const questions: ClientQuestion[] = [];
  for (const q of draft.questions) {
    const [s2, questionId] = nextId(s, "Q");
    s = s2;
    questionIds.push(questionId);
    questions.push({ id: questionId, findingId, projectId: draft.projectId, contactId: q.contactId, textHe: q.textHe, suggestedReplies: q.suggestedReplies, parser: q.parser, status: "pending_review", checkedHe: q.checkedHe, createdAt: s.clock, amount: q.amount, recordId: q.recordId });
  }
  const alerts: Alert[] = [];
  for (const a of draft.alerts) {
    const [s2, alertId] = nextId(s, "ALR");
    s = s2;
    alertIds.push(alertId);
    alerts.push({ id: alertId, findingId, kind: a.kind, projectId: draft.projectId, titleHe: a.titleHe, textHe: a.textHe, status: "pending_review", recipientId: a.recipientId, channel: a.channel, createdAt: s.clock, amounts: a.amounts, linkedQuestionId: a.linkQuestion ? questionIds[0] : undefined, calculationFindingId: findingId });
  }
  const tasks: Task[] = [];
  for (const t of draft.tasks) {
    const [s2, taskId] = nextId(s, "TSK");
    s = s2;
    taskIds.push(taskId);
    tasks.push({ id: taskId, kind: t.kind, projectId: draft.projectId, recordId: t.recordId, findingId, titleHe: t.titleHe, descriptionHe: t.descriptionHe, status: "open", createdAt: s.clock });
  }
  const finding: Finding = {
    id: findingId,
    kind: draft.kind,
    projectId: draft.projectId,
    costCodeId: draft.costCodeId,
    recordIds: draft.recordIds.length ? draft.recordIds : subjectRecordId ? [subjectRecordId] : [],
    documentIds: draft.documentIds,
    titleHe: draft.titleHe,
    explanationHe: draft.explanationHe,
    status: draft.status,
    severity: draft.severity,
    checkedHe: draft.checkedHe,
    evidence: draft.evidence,
    proposalIds,
    questionIds,
    alertIds,
    taskIds,
    amounts: draft.amounts,
    numbers: draft.numbers,
    blocksReport: draft.blocksReport,
    createdAt: s.clock,
    createdAtRevision: s.revision,
    sessionId: s.sessionId,
    dedupeKey: draft.dedupeKey,
  };
  s = { ...s, findings: [...s.findings, finding], proposals: [...s.proposals, ...proposals], questions: [...s.questions, ...questions], alerts: [...s.alerts, ...alerts], tasks: [...s.tasks, ...tasks] };
  const kindHe = proposals.length ? "נוצרה הצעת תיקון" : questions.length ? "נוצרה טיוטת שאלה ללקוח" : alerts.length ? "נוצרה טיוטת התרעה" : "נמצא ממצא";
  s = addActivity(s, "analyzed", `${kindHe}: ${draft.titleHe}`, [findingId, ...proposalIds]);
  return s;
}

export function applyAnalysisResult(state: DemoState, result: AnalysisResult, subject: { recordId?: string }): DemoState {
  let s = state;
  for (const draft of result.findings) s = mergeFinding(s, draft, subject.recordId ?? null);
  if (subject.recordId) {
    const record = s.erpRecords.find((r) => r.id === subject.recordId);
    if (record) {
      const status = result.recordCheckStatus ?? "verified";
      const verified = status === "verified" && record.verifiedQuantity == null && record.quantity != null && result.findings.length === 0 ? record.quantity : record.verifiedQuantity;
      s = { ...s, erpRecords: replaceById(s.erpRecords, record.id, (r) => ({ ...r, checkStatus: status, verifiedQuantity: verified })) };
    }
  }
  if (result.findings.length === 0 && subject.recordId) {
    s = addActivity(s, "analyzed", `נבדקה רשומה ${subject.recordId}: לא נמצאו אי-התאמות`, [subject.recordId]);
  }
  return { ...s, lastAnalysisAt: s.clock };
}

/** Complete one scheduled analysis. Results from another session are discarded. */
export function completeAnalysis(state: DemoState, pendingId: string, sessionId: string): DemoState {
  const pending = state.pendingAnalyses.find((p) => p.id === pendingId);
  if (!pending) return state;
  const remaining = state.pendingAnalyses.filter((p) => p.id !== pendingId);
  if (pending.sessionId !== sessionId || sessionId !== state.sessionId) return { ...state, pendingAnalyses: remaining };
  let s: DemoState = { ...state, pendingAnalyses: remaining };
  if (pending.documentId?.startsWith("code:")) {
    const codeId = pending.documentId.slice(5);
    s = applyAnalysisResult(s, analyzeCostCode(s, codeId), {});
  } else if (pending.documentId) {
    s = applyAnalysisResult(s, analyzeDocument(s, pending.documentId), {});
  } else {
    const record = s.erpRecords.find((r) => r.id === pending.recordId);
    if (!record || record.version !== pending.recordVersion) return s; // stale
    s = applyAnalysisResult(s, analyzeRecord(s, record.id), { recordId: record.id });
  }
  return bump(tick(s, 1));
}

/** Run all pending analyses synchronously (tests, initialization, or "skip motion"). */
export function runPendingAnalyses(state: DemoState): DemoState {
  let s = state;
  let guard = 0;
  while (s.pendingAnalyses.length > 0 && guard < 50) {
    s = completeAnalysis(s, s.pendingAnalyses[0].id, s.sessionId);
    guard += 1;
  }
  return s;
}

export function analyzeRecordNow(state: DemoState, recordId: string): DemoState {
  return runPendingAnalyses(scheduleAnalysis(state, { recordId }));
}

/** Initial analysis of everything already in the ledger (baseline findings). */
export function analyzeAll(state: DemoState): DemoState {
  let s = state;
  for (const r of s.erpRecords) s = scheduleAnalysis(s, { recordId: r.id });
  return runPendingAnalyses(s);
}
