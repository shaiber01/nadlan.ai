import { formatDate } from "../dates";
import { formatILS } from "../money";
import { addActivity, addAudit, bump, byId, contactName, nextId, projectName, replaceById, tick } from "../state-utils";
import type { ApprovedRule, DemoState } from "../types";

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface RuleDraftInput {
  fromProposalId: string;
  validTo: string;
  confirmFutureMonthly: boolean;
  reviewerId?: string;
}

/**
 * Save an approved, scoped rule from an applied allocation proposal (S05 -> S15).
 * Scope: company, supplier, exact framework, project/cost-code set, validity, monthly charge for the same scope.
 */
export function saveApprovedRule(state: DemoState, input: RuleDraftInput): DemoState {
  if (!input.confirmFutureMonthly) throw new Error("נדרש אישור מפורש שהחלוקה מיועדת לחיובים חודשיים עתידיים");
  const p = byId(state.proposals, input.fromProposalId, "proposal");
  if (p.payload.kind !== "allocation" || p.status !== "applied") throw new Error("ניתן ליצור כלל רק מהצעת חלוקה שיושמה");
  const record = byId(state.erpRecords, p.payload.recordId, "record");
  const source = state.documents.find((d) => d.id === record.sourceDocumentId);
  const framework = state.documents.find((d) => d.id === source?.facts.contractId);
  if (!framework) throw new Error("לא נמצאה מסגרת מקושרת");
  const existing = state.approvedRules.find((r) => r.frameworkDocumentId === framework.id && r.status === "active");
  if (existing) return state;
  const amounts = record.allocations.map((al) => al.amount);
  const total = amounts.reduce((a, b) => a + b, 0);
  const g = amounts.reduce((acc, v) => gcd(acc, v), total);
  const ratio = record.allocations.map((al) => ({ projectId: al.projectId, numerator: al.amount / g, denominator: total / g }));
  const [s1, seq] = nextId(state, "RULE-EQ");
  const id = seq.replace(/-(\d{4})$/, (_m, d) => `-${d.slice(2)}`);
  const reviewerId = input.reviewerId ?? "REVIEWER";
  const question = state.questions.find((q) => q.replyMessageId === p.sourceReplyMessageId);
  const rule: ApprovedRule = {
    id,
    version: 1,
    companyId: state.company.id,
    titleHe: `חלוקת חיובי ציוד חודשיים — ${framework.id}`,
    supplierId: record.supplierId,
    frameworkDocumentId: framework.id,
    scope: record.allocations.map((al) => ({ projectId: al.projectId, costCodeId: al.costCodeId })),
    descriptionHe: `חיוב חודשי לאותה תכולת ציוד במסגרת ${framework.id} מתחלק ${ratio.map((r) => `${r.numerator}/${r.denominator} ל${projectName(state, r.projectId)}`).join(" ו-")}. חל רק על חברת ${state.company.nameHe}, על הספק ועל המסגרת המדויקת, ועל האתרים ${record.allocations.map((al) => projectName(state, al.projectId)).join(" ו")}.`,
    ratio,
    validFrom: record.date,
    validTo: input.validTo,
    sourceEvidence: [...(p.sourceReplyMessageId ? [{ documentId: p.sourceReplyMessageId, labelHe: `תשובת ${contactName(state, question?.contactId ?? "OPS")} ב-WhatsApp` }] : []), { documentId: framework.id, anchorId: "billing" }, { documentId: source?.id ?? record.id, anchorId: "allocation" }],
    originQuestionId: question?.id,
    originProposalId: p.id,
    originReplyMessageId: p.sourceReplyMessageId,
    approvedBy: reviewerId,
    approvedAt: state.clock,
    status: "active",
    conditionsHe: ["נדרשת בדיקה מחדש אם החוזה, קבוצת האתרים, התכולה או ההסדר התפעולי משתנים", "הכלל אינו חל על מסגרת אחרת או על ספק אחר", `בתוקף עד ${formatDate(input.validTo)}`],
    applications: [{ id: `${id}-ORIGIN`, kind: "origin", recordId: record.id, proposalId: p.id, at: state.clock, noteHe: `ההחלטה המקורית: חלוקת ${source?.id ?? record.id} (${record.allocations.map((al) => formatILS(al.amount)).join(" / ")}) לפי תשובת הלקוח ואישור צוות הבקרה. יצירת הכלל אינה יישום אוטומטי קודם.` }],
  };
  let s: DemoState = { ...s1, approvedRules: [...s1.approvedRules, rule] };
  const [s2] = addAudit(s, { actorId: reviewerId, kind: "rule_saved", textHe: `נשמרה הנחיה מאושרת ${rule.id}: ${rule.descriptionHe} בתוקף עד ${formatDate(input.validTo)}.`, entityIds: [rule.id, record.id, p.id], evidence: rule.sourceEvidence, projectId: record.projectId });
  s = addActivity(s2, "rule", `נשמרה הנחיה מאושרת ${rule.id} לשימוש חוזר`, [rule.id]);
  return bump(tick(s, 1));
}

export function expireRule(state: DemoState, ruleId: string, validTo: string, reviewerId = "REVIEWER"): DemoState {
  const rule = byId(state.approvedRules, ruleId, "rule");
  let s: DemoState = { ...state, approvedRules: replaceById(state.approvedRules, ruleId, (r) => ({ ...r, validTo, status: validTo < state.clock.slice(0, 10) ? ("expired" as const) : r.status })) };
  const [s1] = addAudit(s, { actorId: reviewerId, kind: "rule_updated", textHe: `תוקף ההנחיה ${rule.id} עודכן ל-${formatDate(validTo)}.`, entityIds: [ruleId] });
  return bump(s1);
}

/** A rule is changed only through a new version; the previous version is kept as superseded. */
export function newRuleVersion(state: DemoState, ruleId: string, patch: Partial<Pick<ApprovedRule, "ratio" | "validTo" | "descriptionHe" | "scope">>, reviewerId = "REVIEWER"): DemoState {
  const rule = byId(state.approvedRules, ruleId, "rule");
  const next: ApprovedRule = { ...rule, ...patch, version: rule.version + 1, approvedAt: state.clock, approvedBy: reviewerId, applications: [], status: "active" };
  let s: DemoState = { ...state, approvedRules: [...replaceById(state.approvedRules, ruleId, (r) => ({ ...r, status: "superseded" as const })), { ...next, id: `${rule.id}-v${next.version}` }] };
  const [s1] = addAudit(s, { actorId: reviewerId, kind: "rule_versioned", textHe: `נוצרה גרסה ${next.version} להנחיה ${rule.id}; הגרסה הקודמת נשמרה.`, entityIds: [ruleId] });
  return bump(s1);
}

export function refreshRuleStatuses(state: DemoState): DemoState {
  const today = state.clock.slice(0, 10);
  const changed = state.approvedRules.some((r) => r.status === "active" && r.validTo < today);
  if (!changed) return state;
  return { ...state, approvedRules: state.approvedRules.map((r) => (r.status === "active" && r.validTo < today ? { ...r, status: "expired" as const } : r)) };
}
