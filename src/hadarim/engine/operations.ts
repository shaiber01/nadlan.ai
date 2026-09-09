import type { BuildingTag, ContactChannel, PersonId, SectionId } from "../data/types";
import { peopleInvolved, sectionLabel, type HFinding, type HSource, type InvoiceFixPatch } from "./checks";
import { orderLineHe, pkg, updateInvoiceSection, updatePurchaseOrder, updatePurchaseOrderSection } from "./commands";
import type { ChangeType, ControlNote, ControlQuestion, ControlTask, DataCorrection, ForecastAdjustment, V2State } from "./model";

/**
 * Free-standing control operations — the things a budget controller does outside a finding card:
 * change the forecast with a stated basis, open and close issues, record risks/events/assumptions for
 * the report, and apply instructed ERP corrections with their audit trail. Pure functions over V2State,
 * like `commands.ts`; the tool layer persists the result.
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;

function nextId(state: V2State, prefix: string): [V2State, string] {
  const n = (state.counters[prefix] ?? 0) + 1;
  return [{ ...state, counters: { ...state.counters, [prefix]: n } }, `${prefix}-${n}`];
}

function audit(state: V2State, byId: PersonId, textHe: string, recordRef?: { type: "invoice" | "po" | "forecast"; id: string }): V2State {
  const [s, id] = nextId(state, "AUD");
  return { ...s, audit: [...s.audit, { id, at: s.clock, byId, textHe, recordRef }] };
}

function person(id: PersonId | undefined): string {
  return pkg.people.find((p) => p.id === id)?.nameHe ?? id ?? "";
}

function requireSection(id: string): SectionId {
  if (!pkg.sections.some((s) => s.id === id)) throw new Error(`סעיף ${id} לא קיים בפרויקט (${pkg.sections.map((s) => s.id).join(", ")})`);
  return id as SectionId;
}

function requirePerson(id: string): PersonId {
  if (!pkg.people.some((p) => p.id === id)) throw new Error(`${id} אינו מוגדר בפרויקט (${pkg.people.map((p) => `${p.id}=${p.nameHe}`).join(", ")})`);
  return id as PersonId;
}

// ---------------------------------------------------------------------------
// Forecast adjustments (report standard §4a — every change typed and sourced)
// ---------------------------------------------------------------------------

export interface AdjustmentInput {
  sectionId: string;
  changeType: ChangeType;
  descriptionHe: string;
  basis: ForecastAdjustment["basis"];
  basisHe: string;
  sourceRef: string;
  amount: number;
  documentId?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  replacesLineId?: string;
  findingId?: string;
  id?: string;
}

export function addAdjustment(state: V2State, input: AdjustmentInput): [V2State, ForecastAdjustment] {
  const sectionId = requireSection(input.sectionId);
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("סכום ההתאמה חייב להיות מספר שונה מאפס (חיובי = תוספת לתחזית)");
  if (input.replacesLineId) {
    const draft = pkg.forecasts.find((f) => f.controlDate === state.control.controlDate);
    if (!draft?.sections?.some((s) => s.lines.some((l) => l.id === input.replacesLineId))) throw new Error(`שורת תחזית ${input.replacesLineId} לא נמצאה בטיוטת ${state.control.controlDate}`);
  }
  if (input.documentId && !pkg.documents.some((d) => d.id === input.documentId)) throw new Error(`מסמך ${input.documentId} לא נמצא בתיקיית הפרויקט`);
  const [s1, generated] = nextId(state, "ADJ");
  const adjustment: ForecastAdjustment = {
    id: input.id ?? generated,
    sectionId,
    changeType: input.changeType,
    descriptionHe: input.descriptionHe,
    basisHe: input.basisHe,
    basis: input.basis,
    sourceRef: input.sourceRef,
    ...(input.documentId ? { documentId: input.documentId } : {}),
    amount: Math.round(input.amount),
    ...(input.findingId ? { findingId: input.findingId } : {}),
    ...(input.qty != null ? { qty: input.qty } : {}),
    ...(input.unit ? { unit: input.unit } : {}),
    ...(input.unitPrice != null ? { unitPrice: input.unitPrice } : {}),
    ...(input.replacesLineId ? { replacesLineId: input.replacesLineId } : {}),
  };
  let s: V2State = { ...s1, control: { ...s1.control, adjustments: [...s1.control.adjustments.filter((a) => a.id !== adjustment.id), adjustment] } };
  s = audit(s, s.operatorId, `תחזית ${sectionLabel(sectionId)}: ${adjustment.descriptionHe} · ${adjustment.amount >= 0 ? "+" : "−"}${nis(Math.abs(adjustment.amount))} · בסיס: ${adjustment.basisHe}`, { type: "forecast", id: adjustment.id });
  return [s, adjustment];
}

export function removeAdjustment(state: V2State, id: string): V2State {
  const a = state.control.adjustments.find((x) => x.id === id);
  if (!a) throw new Error(`התאמה ${id} לא נמצאה (${state.control.adjustments.map((x) => x.id).join(", ") || "אין התאמות"})`);
  const s: V2State = { ...state, control: { ...state.control, adjustments: state.control.adjustments.filter((x) => x.id !== id) } };
  return audit(s, s.operatorId, `תחזית ${sectionLabel(a.sectionId)}: ההתאמה ״${a.descriptionHe}״ (${nis(a.amount)}) הוסרה`, { type: "forecast", id });
}

// ---------------------------------------------------------------------------
// Issues / tasks (report standard §8 — owner, due date, impact if ignored)
// ---------------------------------------------------------------------------

export interface TaskInput {
  titleHe: string;
  sectionId?: string | null;
  ownerId: string;
  dueDate?: string | null;
  impactIfIgnoredHe?: string;
  findingId?: string;
}

export function addTask(state: V2State, input: TaskInput): [V2State, ControlTask] {
  const [s1, id] = nextId(state, "TASK");
  const task: ControlTask = {
    id,
    titleHe: input.titleHe,
    sectionId: input.sectionId ? requireSection(input.sectionId) : null,
    ownerId: requirePerson(input.ownerId),
    dueDate: input.dueDate ?? null,
    openedInControl: s1.control.controlDate,
    status: "open",
    closedAt: null,
    ...(input.impactIfIgnoredHe ? { impactIfIgnoredHe: input.impactIfIgnoredHe } : {}),
    ...(input.findingId ? { findingId: input.findingId } : {}),
  };
  const s: V2State = { ...s1, control: { ...s1.control, tasks: [...s1.control.tasks, task] } };
  return [audit(s, s.operatorId, `נפתח נושא לטיפול: ${task.titleHe} · אחראי ${person(task.ownerId)}${task.dueDate ? ` · יעד ${task.dueDate}` : ""}`), task];
}

export function setTaskStatus(state: V2State, id: string, status: ControlTask["status"], closedAt?: string): V2State {
  const task = state.control.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`נושא ${id} לא נמצא (${state.control.tasks.map((t) => t.id).join(", ")})`);
  const next: ControlTask = { ...task, status, closedAt: status === "closed" ? (closedAt ?? state.clock.slice(0, 10)) : null };
  const s: V2State = { ...state, control: { ...state.control, tasks: state.control.tasks.map((t) => (t.id === id ? next : t)) } };
  return audit(s, s.operatorId, `נושא ${id} ״${task.titleHe}״: ${task.status} → ${status}`);
}

// ---------------------------------------------------------------------------
// Controller notes — feed the report's risks (§7), events (§2), decisions (§1) and assumptions (§11)
// ---------------------------------------------------------------------------

export interface NoteInput {
  kind: ControlNote["kind"];
  textHe: string;
  sectionId?: string;
  exposureHe?: string;
  likelihoodHe?: string;
  triggerHe?: string;
  ownerId?: string;
}

export function addNote(state: V2State, input: NoteInput, byId: PersonId = state.operatorId): [V2State, ControlNote] {
  const [s1, id] = nextId(state, "NOTE");
  const note: ControlNote = {
    id,
    kind: input.kind,
    textHe: input.textHe,
    ...(input.sectionId ? { sectionId: requireSection(input.sectionId) } : {}),
    ...(input.exposureHe ? { exposureHe: input.exposureHe } : {}),
    ...(input.likelihoodHe ? { likelihoodHe: input.likelihoodHe } : {}),
    ...(input.triggerHe ? { triggerHe: input.triggerHe } : {}),
    ...(input.ownerId ? { ownerId: requirePerson(input.ownerId) } : {}),
    at: s1.clock,
    byId,
  };
  const s: V2State = { ...s1, control: { ...s1.control, notes: [...s1.control.notes, note] } };
  return [audit(s, byId, `הערת בקרה (${note.kind}): ${note.textHe}`), note];
}

export function removeNote(state: V2State, id: string): V2State {
  if (!state.control.notes.some((n) => n.id === id)) throw new Error(`הערה ${id} לא נמצאה`);
  return { ...state, control: { ...state.control, notes: state.control.notes.filter((n) => n.id !== id) } };
}

// ---------------------------------------------------------------------------
// Questions to people who know what the operator does not (the full system sends them over the person's channel)
// ---------------------------------------------------------------------------

export interface QuestionInput {
  toId: string;
  textHe: string;
  findingId?: string;
}

export const CHANNEL_HE: Record<ContactChannel, string> = { whatsapp: "WhatsApp", email: "דוא״ל", phone: "טלפון" };

/** Put a question to a person; the finding it belongs to stays open until the answer is recorded. */
export function askPerson(state: V2State, input: QuestionInput, byId: PersonId = state.operatorId): [V2State, ControlQuestion] {
  const toId = requirePerson(input.toId);
  const to = pkg.people.find((p) => p.id === toId)!;
  if (!input.textHe.trim()) throw new Error("נדרש נוסח השאלה");
  if (input.findingId && !state.control.findings.some((f) => f.id === input.findingId)) throw new Error(`ממצא ${input.findingId} לא נמצא בבקרה`);
  const [s1, id] = nextId(state, "Q");
  const question: ControlQuestion = { id, toId, channel: to.channel ?? "whatsapp", textHe: input.textHe.trim(), ...(input.findingId ? { findingId: input.findingId } : {}), askedAt: s1.clock, askedById: byId, status: "open" };
  const s: V2State = { ...s1, control: { ...s1.control, questions: [...s1.control.questions, question] } };
  return [audit(s, byId, `שאלה ל${to.nameHe} (${CHANNEL_HE[question.channel]})${input.findingId ? ` על ממצא ${input.findingId}` : ""}: ${question.textHe}`), question];
}

/** Record the answer a person gave (in the full system: the reply that came back over the channel). */
export function answerQuestion(state: V2State, id: string, answerHe: string, byId?: string): V2State {
  const q = state.control.questions.find((x) => x.id === id);
  if (!q) throw new Error(`שאלה ${id} לא נמצאה (${state.control.questions.map((x) => x.id).join(", ") || "אין שאלות"})`);
  if (!answerHe.trim()) throw new Error("נדרש נוסח התשובה");
  const answeredById = byId ? requirePerson(byId) : q.toId;
  const answered: ControlQuestion = { ...q, status: "answered", answerHe: answerHe.trim(), answeredAt: state.clock, answeredById };
  const s: V2State = { ...state, control: { ...state.control, questions: state.control.questions.map((x) => (x.id === id ? answered : x)) } };
  return audit(s, answeredById, `תשובה מ${person(answeredById)} לשאלה ${id}: ${answered.answerHe}`);
}

// ---------------------------------------------------------------------------
// Findings the agent raises from reading (the deterministic checks are the floor; this is the second pass)
// ---------------------------------------------------------------------------

export interface RaisedFindingInput {
  titleHe: string;
  problemHe: string;
  meaningHe: string;
  sectionId: string;
  record: HFinding["record"];
  sources?: HSource[];
  /** The agent's reasoning: what it read, what does not fit. Shown on the card as notes. */
  reasoningHe?: string;
  questionHe?: string;
  options?: { id: "apply" | "refer" | "accept"; labelHe: string }[];
  impact?: { kind: "none" | "amount" | "unknown"; amount?: number; labelHe?: string };
  proposedFix?: { labelHe: string; patch: InvoiceFixPatch };
  referToId?: string;
}

/** Record a finding the agent raised; it enters the session like a check's finding and takes the same decisions. */
export function raiseFinding(state: V2State, input: RaisedFindingInput): [V2State, HFinding] {
  if (state.control.status === "idle") throw new Error("אין בקרה פעילה — הרץ run_control תחילה, ואז ניתן להוסיף ממצאים");
  const sectionId = requireSection(input.sectionId);
  const r = input.record;
  const exists =
    r.type === "invoice" ? state.erp.invoices.some((i) => String(i.id) === r.id)
    : r.type === "po" ? state.erp.purchaseOrders.some((p) => String(p.id) === r.id)
    : r.type === "contract" ? pkg.contracts.some((c) => c.id === r.id)
    : r.type === "boq_line" ? pkg.boq.some((l) => l.id === r.id)
    : r.type === "document" ? pkg.documents.some((d) => d.id === r.id)
    : pkg.forecasts.some((f) => f.sections?.some((s) => s.lines.some((l) => l.id === r.id)));
  if (!exists) throw new Error(`הרשומה ${r.type} ${r.id} לא נמצאה`);
  if (input.proposedFix && r.type !== "invoice") throw new Error("תיקון מוצע אפשרי רק על חשבון");
  const referToId = input.referToId ? requirePerson(input.referToId) : undefined;
  if (!input.titleHe.trim() || !input.problemHe.trim()) throw new Error("נדרשים כותרת ותיאור הבעיה");
  const options = input.options?.length ? input.options : [...(input.proposedFix ? [{ id: "apply" as const, labelHe: `לתקן — ${input.proposedFix.labelHe}` }] : []), { id: "refer" as const, labelHe: referToId ? `להעביר ל${person(referToId)}` : "להעביר לתיקון" }, { id: "accept" as const, labelHe: "תקין — לא נדרש תיקון" }];
  const [s1, n] = nextId(state, "REV");
  const finding: HFinding = {
    id: `F-${n}`,
    kind: "review",
    origin: "review",
    titleHe: input.titleHe.trim(),
    problemHe: input.problemHe.trim(),
    sources: input.sources ?? [],
    meaningHe: input.meaningHe.trim() || "—",
    impact: { kind: input.impact?.kind ?? "unknown", amount: input.impact?.amount ?? 0, labelHe: input.impact?.labelHe ?? (input.impact?.kind === "none" ? "ללא שינוי בסה״כ" : "טרם הוערך") },
    decision: { questionHe: input.questionHe?.trim() || "מה לעשות?", options, freeText: true },
    sectionId,
    record: r,
    ...(input.reasoningHe ? { notesHe: [`נימוק הסוכן: ${input.reasoningHe.trim()}`] } : {}),
    ...(input.proposedFix ? { proposedFix: input.proposedFix } : {}),
    ...(referToId ? { referToId } : {}),
  };
  finding.people = peopleInvolved(pkg, s1.erp, finding.record);
  const status = s1.control.status === "report" ? "reviewing" : s1.control.status;
  const s: V2State = { ...s1, control: { ...s1.control, status, findings: [...s1.control.findings, finding] } };
  return [audit(s, s.operatorId, `ממצא מסקירת הסוכן ${finding.id}: ${finding.titleHe}`, r.type === "invoice" || r.type === "po" ? { type: r.type, id: r.id } : undefined), finding];
}

/** Close the agent's review pass over the control's data with a summary (the report states it). */
export function recordReviewPass(state: V2State, summaryHe: string, byId: PersonId = state.operatorId): [V2State, ControlNote] {
  if (!summaryHe.trim()) throw new Error("נדרש סיכום הסקירה");
  const [s1, id] = nextId(state, "NOTE");
  const note: ControlNote = { id, kind: "review_pass", textHe: summaryHe.trim(), at: s1.clock, byId };
  const s: V2State = { ...s1, control: { ...s1.control, notes: [...s1.control.notes.filter((n) => n.kind !== "review_pass"), note] } };
  return [audit(s, byId, `סקירת הסוכן הושלמה: ${note.textHe}`), note];
}

// ---------------------------------------------------------------------------
// Instructed ERP corrections (outside a finding) — the write plus the §4b correction row
// ---------------------------------------------------------------------------

/**
 * Move an invoice to another section. `asCorrection` (default) records it as a controller's data correction
 * for the report's §4b; false is plain data entry in the ERP by its user (change log only).
 */
export function reallocateInvoice(state: V2State, invoiceId: number, sectionId: string, byId: string, noteHe = "תיקון שיוך לפי הנחיה", asCorrection = true): [V2State, DataCorrection | null] {
  const target = requireSection(sectionId);
  const actor = requirePerson(byId);
  const invoice = state.erp.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`חשבון ${invoiceId} לא נמצא`);
  if (invoice.sectionId === target) throw new Error(`חשבון ${invoiceId} כבר משויך ל-${sectionLabel(target)}`);
  const before = sectionLabel(invoice.sectionId);
  const after = sectionLabel(target);
  let s = updateInvoiceSection(state, invoiceId, target, actor, noteHe);
  if (!asCorrection) return [s, null];
  const [s2, id] = nextId(s, "COR");
  const correction: DataCorrection = { id, recordType: "invoice", recordId: String(invoiceId), fieldHe: "סעיף תקציבי", beforeHe: before, afterHe: after, approvedById: actor, crossSectionHe: `${before} −${nis(invoice.amount)} · ${after} +${nis(invoice.amount)}`, at: s2.clock, status: "applied" };
  s = { ...s2, control: { ...s2.control, corrections: [...s2.control.corrections, correction] } };
  return [audit(s, actor, `חשבון ${invoiceId}: שיוך ${before} → ${after} (${noteHe})`, { type: "invoice", id: String(invoiceId) }), correction];
}

/**
 * An instructed correction of a purchase order: its line (quantity / units / unit price, amount locked) and/or
 * its budget section. The invoices booked against the order keep their own section.
 */
export function correctPurchaseOrder(state: V2State, poId: number, patch: { qty?: number; unit?: string; priceUnit?: string; unitPrice?: number; sectionId?: string }, byId: string, noteHe = "תיקון הזמנה לפי הנחיה", asCorrection = true): [V2State, DataCorrection | null] {
  const actor = requirePerson(byId);
  const po = state.erp.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new Error(`הזמנה ${poId} לא נמצאה`);
  const { sectionId, ...line } = patch;
  const target = sectionId ? requireSection(sectionId) : null;
  const lineChanged = Object.keys(line).length > 0;
  if (target && target === po.sectionId && !lineChanged) throw new Error(`הזמנה ${poId} כבר משויכת ל-${sectionLabel(target)}`);
  let s = target ? updatePurchaseOrderSection(state, poId, target, actor, noteHe) : state;
  if (lineChanged) s = updatePurchaseOrder(s, poId, line, actor, noteHe);
  const next = s.erp.purchaseOrders.find((p) => p.id === poId)!;
  const moved = next.sectionId !== po.sectionId;
  const fields = [...(moved ? ["סעיף תקציבי"] : []), ...(lineChanged ? ["כמות / יחידה / מחיר יח׳"] : [])];
  const before = [...(moved ? [sectionLabel(po.sectionId)] : []), ...(lineChanged ? [orderLineHe(po)] : [])].join(" · ");
  const after = [...(moved ? [sectionLabel(next.sectionId)] : []), ...(lineChanged ? [orderLineHe(next)] : [])].join(" · ");
  if (!asCorrection) return [s, null];
  const [s2, id] = nextId(s, "COR");
  const correction: DataCorrection = { id, recordType: "po", recordId: String(poId), fieldHe: fields.join(" / "), beforeHe: before, afterHe: after, approvedById: actor, crossSectionHe: moved ? `${sectionLabel(po.sectionId)} → ${sectionLabel(next.sectionId)} · התחייבות ${nis(po.amount)}` : "ללא השפעה בין סעיפים", at: s2.clock, status: "applied" };
  s = { ...s2, control: { ...s2.control, corrections: [...s2.control.corrections, correction] } };
  return [audit(s, actor, `הזמנה ${poId}: ${before} → ${after} (${noteHe})`, { type: "po", id: String(poId) }), correction];
}

export type { BuildingTag };
