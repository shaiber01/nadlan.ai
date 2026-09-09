import type { HFinding, HPositive } from "../engine/checks";
import { sectionLabel } from "../engine/checks";
import { initialState, pkg, setPackage } from "../engine/commands";
import type { AuditEntry, ControlNote, ControlQuestion, ControlSession, ControlTask, DataCorrection, FindingDecision, ForecastAdjustment, ReportConfig, V2State } from "../engine/model";
import type { HInvoice, PersonId } from "../data/types";
import { db, fromStamp, loadErp, loadPackage, readInvoice, saveInvoice, savePurchaseOrder, toStamp } from "./client";
import { DEFAULT_PROJECT_ID } from "./config";
import type { Json, Tables } from "./types";

/**
 * The control session in the database. `loadState` rebuilds the engine's `V2State` for a project and a
 * control date (package, live ERP, findings, decisions, adjustments, corrections, tasks, audit);
 * `saveState` writes back what a command changed — including ERP rows, which are then re-read so the
 * verification the control reports is a genuine second read from the database.
 */

/** Israel time as "yyyy-mm-ddTHH:MM" — the engine's clock format. */
export function nowStamp(): string {
  return toStamp(new Date().toISOString());
}

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;

/** What the re-read record says about the field a finding's fix touched. */
function describeForKind(inv: HInvoice, kind: HFinding["kind"]): string {
  switch (kind) {
    case "retention":
      return `עכבון ${inv.retentionPct}% = ${nis(inv.retentionAmt)} · לתשלום ${nis(inv.netPayable)}`;
    case "cumulative":
      return `מצטבר ${inv.cumulativePrev != null ? nis(inv.cumulativePrev) : "—"} → ${inv.cumulativeNow != null ? nis(inv.cumulativeNow) : "—"}`;
    case "review_aging":
      return `סטטוס = ${inv.status}${inv.approvedBy ? ` · אישר ${inv.approvedBy}` : ""}`;
    case "dates":
      return `תאריך ${inv.date} · התקבל ${inv.dateReceived}`;
    default:
      return `סעיף = ${sectionLabel(inv.sectionId)}`;
  }
}

function counterFrom(ids: string[], prefix: string): number {
  return ids.reduce((max, id) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

export async function loadState(projectId = DEFAULT_PROJECT_ID, controlDate?: string): Promise<V2State> {
  const loaded = await loadPackage(projectId);
  setPackage(loaded);
  const base = initialState();
  const date = controlDate ?? loaded.project.currentControlDate;
  const supabase = db();
  const { data: c, error } = await supabase.from("controls").select("*").eq("project_id", projectId).eq("control_date", date).maybeSingle();
  if (error) throw new Error(`controls: ${error.message}`);
  const clock = nowStamp();
  if (!c) return { ...base, clock, control: { ...base.control, controlDate: date } };

  const rows = async <T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string) => {
    const r = await q;
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data ?? [];
  };
  const [decisions, adjustments, corrections, issues, audit, questions] = await Promise.all([
    rows(supabase.from("decisions").select("*").eq("project_id", projectId).eq("control_date", date), "decisions"),
    rows(supabase.from("forecast_adjustments").select("*").eq("project_id", projectId).eq("control_date", date).order("created_at"), "forecast_adjustments"),
    rows(supabase.from("data_corrections").select("*").eq("project_id", projectId).eq("control_date", date).order("at"), "data_corrections"),
    // every issue of the project: carried from earlier controls (no finding) and opened in this one
    rows(supabase.from("open_issues").select("*").eq("project_id", projectId).order("opened_in_control").order("id"), "open_issues"),
    rows(supabase.from("audit").select("*").eq("project_id", projectId).order("at").order("id"), "audit"),
    rows(supabase.from("questions").select("*").eq("project_id", projectId).eq("control_date", date).order("asked_at"), "questions"),
  ]);

  const control: ControlSession = {
    controlDate: date,
    notes: (c.notes as unknown as ControlNote[]) ?? [],
    status: c.status as ControlSession["status"],
    requestedAt: c.requested_at ? toStamp(c.requested_at) : null,
    findings: c.findings as unknown as HFinding[],
    positives: c.positives as unknown as HPositive[],
    checkedHe: c.checked_he,
    decisions: Object.fromEntries(
      decisions.map((d): [string, FindingDecision] => [
        d.finding_id,
        {
          findingId: d.finding_id,
          status: d.status as FindingDecision["status"],
          ...(d.choice_id ? { choiceId: d.choice_id } : {}),
          ...(d.free_text_he ? { freeTextHe: d.free_text_he } : {}),
          ...(d.route_id ? { routeId: d.route_id as FindingDecision["routeId"] } : {}),
          ...(d.owner_id ? { ownerId: d.owner_id as FindingDecision["ownerId"] } : {}),
          ...(d.audit_he ? { auditHe: d.audit_he } : {}),
          ...(d.verified_he ? { verifiedHe: d.verified_he } : {}),
          ...(d.resolved_at ? { resolvedAt: toStamp(d.resolved_at) } : {}),
          ...(d.pending ? { pending: d.pending as unknown as FindingDecision["pending"] } : {}),
        },
      ]),
    ),
    adjustments: adjustments.map(
      (a): ForecastAdjustment => ({
        id: a.id,
        sectionId: a.section_id as ForecastAdjustment["sectionId"],
        changeType: a.change_type as ForecastAdjustment["changeType"],
        descriptionHe: a.description_he,
        basisHe: a.basis_he,
        basis: a.basis as ForecastAdjustment["basis"],
        sourceRef: a.source_ref,
        ...(a.document_id ? { documentId: a.document_id } : {}),
        amount: Number(a.amount),
        ...(a.finding_id ? { findingId: a.finding_id } : {}),
        ...(a.qty != null ? { qty: Number(a.qty) } : {}),
        ...(a.unit ? { unit: a.unit } : {}),
        ...(a.unit_price != null ? { unitPrice: Number(a.unit_price) } : {}),
        ...(a.replaces_line_id ? { replacesLineId: a.replaces_line_id } : {}),
        ...(a.committed_portion ? { committedPortion: a.committed_portion as unknown as ForecastAdjustment["committedPortion"] } : {}),
      }),
    ),
    corrections: corrections.map(
      (x): DataCorrection => ({ id: x.id, recordType: x.record_type as DataCorrection["recordType"], recordId: x.record_id, fieldHe: x.field_he, beforeHe: x.before_he, afterHe: x.after_he, approvedById: x.approved_by_id as DataCorrection["approvedById"], crossSectionHe: x.cross_section_he, ...(x.finding_id ? { findingId: x.finding_id } : {}), at: toStamp(x.at), status: x.status as DataCorrection["status"] }),
    ),
    tasks: issues.map(
      (t): ControlTask => ({ id: t.id, titleHe: t.title_he, sectionId: t.section_id as ControlTask["sectionId"], ownerId: t.owner_id as ControlTask["ownerId"], dueDate: t.due_date, openedInControl: t.opened_in_control, status: t.status as ControlTask["status"], closedAt: t.closed_at, ...(t.impact_if_ignored_he ? { impactIfIgnoredHe: t.impact_if_ignored_he } : {}), ...(t.finding_id ? { findingId: t.finding_id } : {}) }),
    ),
    questions: questions.map(
      (q): ControlQuestion => ({ id: q.id, toId: q.to_id as PersonId, channel: q.channel as ControlQuestion["channel"], textHe: q.text_he, ...(q.finding_id ? { findingId: q.finding_id } : {}), askedAt: toStamp(q.asked_at), askedById: q.asked_by_id as PersonId, status: q.status as ControlQuestion["status"], ...(q.answer_he ? { answerHe: q.answer_he } : {}), ...(q.answered_at ? { answeredAt: toStamp(q.answered_at) } : {}), ...(q.answered_by_id ? { answeredById: q.answered_by_id as PersonId } : {}) }),
    ),
    messages: [],
    reportConfig: c.report_config as unknown as ReportConfig,
    finalized: c.finalized,
    stepsRevealed: 99,
  };
  const auditOut: AuditEntry[] = audit.map((a) => ({ id: `AUD-${a.id}`, at: toStamp(a.at), byId: a.by_id as AuditEntry["byId"], textHe: a.text_he, ...(a.record_ref ? { recordRef: a.record_ref as unknown as AuditEntry["recordRef"] } : {}) }));
  return {
    ...base,
    clock,
    operatorId: (c.operator_id as V2State["operatorId"]) ?? base.operatorId,
    control,
    audit: auditOut,
    savedConfig: (c.report_config as unknown as ReportConfig).savedAs ? (c.report_config as unknown as ReportConfig) : null,
    counters: { MSG: 0, CL: 0, AUD: audit.length, TASK: counterFrom(issues.map((t) => t.id), "TASK"), COR: counterFrom(corrections.map((x) => x.id), "COR") },
  };
}

export interface SaveResult {
  state: V2State;
  erpWrites: string[];
}

/** Persist everything a command changed between `prev` and `next`; returns the state re-read from the database. */
export async function saveState(prev: V2State, next: V2State, projectId = DEFAULT_PROJECT_ID): Promise<SaveResult> {
  const supabase = db();
  const s = next.control;
  const erpWrites: string[] = [];
  const check = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };

  // ERP rows changed by the command (the trigger writes the change log; attribution from the local entry)
  const newEntries = next.erp.changeLog.slice(prev.erp.changeLog.length);
  const metaFor = (recordType: "invoice" | "po", id: number) => {
    const entry = [...newEntries].reverse().find((x) => x.recordType === recordType && x.recordId === String(id));
    return { byId: entry?.byId ?? next.operatorId, noteHe: entry?.noteHe };
  };
  const prevInvoices = new Map(prev.erp.invoices.map((i) => [i.id, i]));
  for (const invoice of next.erp.invoices) {
    const before = prevInvoices.get(invoice.id);
    if (before === invoice) continue;
    await saveInvoice(invoice, metaFor("invoice", invoice.id), !before, projectId);
    erpWrites.push(`invoice ${invoice.id}`);
  }
  const prevPos = new Map(prev.erp.purchaseOrders.map((p) => [p.id, p]));
  for (const po of next.erp.purchaseOrders) {
    if (prevPos.get(po.id) === po) continue;
    await savePurchaseOrder(po, metaFor("po", po.id), projectId);
    erpWrites.push(`po ${po.id}`);
  }

  // genuine verification: re-read the record a handled decision wrote and record what the database holds
  const decisions = { ...s.decisions };
  for (const d of Object.values(decisions)) {
    if (d.status !== "handled" || d.routeId !== "update") continue;
    const finding = s.findings.find((f) => f.id === d.findingId);
    if (!finding || finding.record.type !== "invoice") continue;
    const fresh = await readInvoice(Number(finding.record.id), projectId);
    if (fresh) decisions[d.findingId] = { ...d, verifiedHe: `חשבון ${fresh.id} נקרא מחדש ממסד הנתונים — ${describeForKind(fresh, finding.kind)}` };
  }

  check(
    await supabase.from("controls").upsert({
      project_id: projectId,
      control_date: s.controlDate,
      status: s.status,
      requested_at: s.requestedAt ? fromStamp(s.requestedAt) : null,
      finalized: s.finalized,
      operator_id: next.operatorId,
      report_config: s.reportConfig as unknown as Json,
      notes: s.notes as unknown as Json,
      findings: s.findings as unknown as Json,
      positives: s.positives as unknown as Json,
      checked_he: s.checkedHe,
      updated_at: new Date().toISOString(),
    }),
    "controls",
  );
  const decisionRows = Object.values(decisions).map((d) => ({ project_id: projectId, control_date: s.controlDate, finding_id: d.findingId, status: d.status, choice_id: d.choiceId ?? null, free_text_he: d.freeTextHe ?? null, route_id: d.routeId ?? null, owner_id: d.ownerId ?? null, audit_he: d.auditHe ?? null, verified_he: d.verifiedHe ?? null, resolved_at: d.resolvedAt ? fromStamp(d.resolvedAt) : null, pending: (d.pending ?? null) as unknown as Json, updated_at: new Date().toISOString() }));
  if (decisionRows.length) check(await supabase.from("decisions").upsert(decisionRows), "decisions");
  const adjustmentRows = s.adjustments.map((a) => ({ project_id: projectId, control_date: s.controlDate, id: a.id, section_id: a.sectionId, change_type: a.changeType, description_he: a.descriptionHe, basis_he: a.basisHe, basis: a.basis, source_ref: a.sourceRef, document_id: a.documentId ?? null, amount: a.amount, finding_id: a.findingId ?? null, qty: a.qty ?? null, unit: a.unit ?? null, unit_price: a.unitPrice ?? null, replaces_line_id: a.replacesLineId ?? null, committed_portion: (a.committedPortion ?? null) as unknown as Json }));
  if (adjustmentRows.length) check(await supabase.from("forecast_adjustments").upsert(adjustmentRows), "forecast_adjustments");
  const removedAdjustments = prev.control.adjustments.filter((a) => !s.adjustments.some((b) => b.id === a.id)).map((a) => a.id);
  if (removedAdjustments.length) check(await supabase.from("forecast_adjustments").delete().eq("project_id", projectId).eq("control_date", s.controlDate).in("id", removedAdjustments), "forecast_adjustments (delete)");
  const correctionRows = s.corrections.map((x) => ({ project_id: projectId, control_date: s.controlDate, id: x.id, record_type: x.recordType, record_id: x.recordId, field_he: x.fieldHe, before_he: x.beforeHe, after_he: x.afterHe, approved_by_id: x.approvedById, cross_section_he: x.crossSectionHe, finding_id: x.findingId ?? null, at: fromStamp(x.at), status: x.status }));
  if (correctionRows.length) check(await supabase.from("data_corrections").upsert(correctionRows), "data_corrections");
  const taskRows = s.tasks.map((t) => ({ project_id: projectId, id: t.id, title_he: t.titleHe, section_id: t.sectionId, owner_id: t.ownerId, due_date: t.dueDate, opened_in_control: t.openedInControl, status: t.status, closed_at: t.closedAt, impact_if_ignored_he: t.impactIfIgnoredHe ?? null, finding_id: t.findingId ?? null }));
  if (taskRows.length) check(await supabase.from("open_issues").upsert(taskRows), "open_issues");
  const questionRows = s.questions.map((q) => ({ project_id: projectId, control_date: s.controlDate, id: q.id, to_id: q.toId, channel: q.channel, text_he: q.textHe, finding_id: q.findingId ?? null, asked_at: fromStamp(q.askedAt), asked_by_id: q.askedById, status: q.status, answer_he: q.answerHe ?? null, answered_at: q.answeredAt ? fromStamp(q.answeredAt) : null, answered_by_id: q.answeredById ?? null }));
  if (questionRows.length) check(await supabase.from("questions").upsert(questionRows), "questions");
  const newAudit = next.audit.slice(prev.audit.length);
  if (newAudit.length) check(await supabase.from("audit").insert(newAudit.map((a) => ({ project_id: projectId, at: fromStamp(a.at), by_id: a.byId, text_he: a.textHe, record_ref: (a.recordRef ?? null) as unknown as Json }))), "audit");

  const erp = await loadErp(projectId);
  return { state: { ...next, erp, control: { ...s, decisions } }, erpWrites };
}

/** Saves a report model as a new version and returns its id. */
export async function saveReportVersion(projectId: string, controlDate: string, model: unknown, createdBy: string, label: string | null, docxPath: string | null): Promise<number> {
  const { data, error } = await db().from("report_versions").insert({ project_id: projectId, control_date: controlDate, model: model as Json, created_by: createdBy, label, docx_path: docxPath }).select("id").single();
  if (error) throw new Error(`report_versions: ${error.message}`);
  return (data as Tables<"report_versions">).id;
}

export { pkg };
