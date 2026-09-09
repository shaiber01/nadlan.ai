import type { BuildingTag, PersonId, SectionId } from "../data/types";
import { sectionLabel } from "./checks";
import { orderLineHe, pkg, updateInvoiceSection, updatePurchaseOrder } from "./commands";
import type { ChangeType, ControlNote, ControlTask, DataCorrection, ForecastAdjustment, V2State } from "./model";

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

export function correctPurchaseOrder(state: V2State, poId: number, patch: { qty?: number; unit?: string; priceUnit?: string; unitPrice?: number }, byId: string, noteHe = "תיקון הזמנה לפי הנחיה", asCorrection = true): [V2State, DataCorrection | null] {
  const actor = requirePerson(byId);
  const po = state.erp.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new Error(`הזמנה ${poId} לא נמצאה`);
  const before = orderLineHe(po);
  let s = updatePurchaseOrder(state, poId, patch, actor, noteHe);
  const next = s.erp.purchaseOrders.find((p) => p.id === poId)!;
  const after = orderLineHe(next);
  if (!asCorrection) return [s, null];
  const [s2, id] = nextId(s, "COR");
  const correction: DataCorrection = { id, recordType: "po", recordId: String(poId), fieldHe: "כמות / יחידה / מחיר יח׳", beforeHe: before, afterHe: after, approvedById: actor, crossSectionHe: "ללא השפעה בין סעיפים", at: s2.clock, status: "applied" };
  s = { ...s2, control: { ...s2.control, corrections: [...s2.control.corrections, correction] } };
  return [audit(s, actor, `הזמנה ${poId}: ${before} → ${after} (${noteHe})`, { type: "po", id: String(poId) }), correction];
}

export type { BuildingTag };
