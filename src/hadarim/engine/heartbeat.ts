import type { HChangeLogEntry, HDocument, HadarimPackage, PersonId } from "../data/types";
import { findingIds, findingReported, runChecks, type HFinding } from "./checks";
import type { V2State } from "./model";

/**
 * The heartbeat: what is new since the last one, gathered deterministically so the agent's pass is short.
 * "New" is measured on the change log (every ERP insert or edit is a logged row with an increasing id): the
 * records touched above the watermark, the checks' findings on those records — plus findings the session
 * does not know and no earlier heartbeat reported — and the documents nobody processed yet
 * (`facts_source` empty). Pure: the tools load the state, this decides what needs attention.
 */

export type RecordType = HChangeLogEntry["recordType"];

export interface ChangedRecord {
  type: RecordType;
  id: string;
  /** Inserted in the period (the trigger's intake row), not only edited. */
  isNew: boolean;
  entries: HChangeLogEntry[];
  byIds: PersonId[];
  fieldsHe: string[];
  firstAt: string;
  lastAt: string;
}

export interface HeartbeatWork {
  /** Change-log id the pass starts after (exclusive) and the highest id it covers (the next watermark). */
  sinceChangeLogId: number;
  untilChangeLogId: number;
  pendingDocuments: HDocument[];
  changedRecords: ChangedRecord[];
  /** Findings of a fresh run of the checks that touch a changed record, or that neither the session nor an earlier heartbeat knows. */
  findings: HFinding[];
  /** Findings of the session nobody decided on yet (the control's business, listed for context). */
  sessionOpenFindings: HFinding[];
}

export const INTAKE_FIELD_HE = "קליטה";

export function isUnprocessed(d: HDocument): boolean {
  return !d.factsSource && !d.supersededBy;
}

/** The numeric part of a change-log id: the database's identity ("123") or the offline engine's "CL-123". */
export function changeLogId(e: HChangeLogEntry): number {
  return Number(String(e.id).replace(/^\D+/, "")) || 0;
}

export function groupChanges(entries: HChangeLogEntry[]): ChangedRecord[] {
  const byRecord = new Map<string, ChangedRecord>();
  for (const e of entries) {
    const key = `${e.recordType}:${e.recordId}`;
    const rec = byRecord.get(key) ?? { type: e.recordType, id: e.recordId, isNew: false, entries: [], byIds: [], fieldsHe: [], firstAt: e.at, lastAt: e.at };
    rec.entries.push(e);
    if (e.field === INTAKE_FIELD_HE) rec.isNew = true;
    if (!rec.byIds.includes(e.byId)) rec.byIds.push(e.byId);
    if (!rec.fieldsHe.includes(e.field)) rec.fieldsHe.push(e.field);
    if (e.at < rec.firstAt) rec.firstAt = e.at;
    if (e.at > rec.lastAt) rec.lastAt = e.at;
    byRecord.set(key, rec);
  }
  return [...byRecord.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

export function heartbeatWork(pkg: HadarimPackage, state: V2State, sinceChangeLogId: number, previouslyReported: Iterable<string> = [], today: string = state.clock.slice(0, 10)): HeartbeatWork {
  const log = state.erp.changeLog;
  const untilChangeLogId = log.reduce((m, e) => Math.max(m, changeLogId(e)), sinceChangeLogId);
  const entries = log.filter((e) => changeLogId(e) > sinceChangeLogId);
  const changedRecords = groupChanges(entries);
  const changed = new Set(changedRecords.map((r) => `${r.type}:${r.id}`));

  const c = state.control;
  const draft = pkg.forecasts.find((f) => f.controlDate === c.controlDate && f.sections);
  const fresh = draft ? runChecks(pkg, state.erp, draft, c.controlDate, today).findings : [];
  // a composite card counts as known or reported through its members too, and a member through its record's card
  const known = findingIds(c.findings);
  const reported = new Set(previouslyReported);
  const findings = fresh.filter((f) => changed.has(`${f.record.type}:${f.record.id}`) || (!findingReported(f, known) && !findingReported(f, reported)));
  const sessionOpenFindings = c.findings.filter((f) => {
    const d = c.decisions[f.id];
    return !d || d.status === "open" || !!d.pending;
  });
  return { sinceChangeLogId, untilChangeLogId, pendingDocuments: pkg.documents.filter(isUnprocessed), changedRecords, findings, sessionOpenFindings };
}

/** One Hebrew line the heartbeat record and the CLI print. */
/** What stops a report from being saved as a version or the control from being finalized: data nobody read yet. */
export interface ReportBlocker {
  kind: "pending_documents" | "no_heartbeat" | "unreviewed_findings";
  textHe: string;
}

/**
 * A report version or a final control must not rest on documents nobody read or on changed records whose
 * findings nobody saw: pending documents block; a project with changes but no heartbeat blocks; changes since
 * the last heartbeat block only when the checks raise findings on them that were never presented.
 */
export function reportBlockers(pkg: HadarimPackage, state: V2State, lastHeartbeat: { untilChangeLogId: number } | null, latestChangeLogId: number, previouslyReported: Iterable<string> = [], today: string = state.clock.slice(0, 10)): ReportBlocker[] {
  const out: ReportBlocker[] = [];
  const pending = pkg.documents.filter(isUnprocessed);
  if (pending.length) out.push({ kind: "pending_documents", textHe: `${pending.length} מסמכים בתיקייה טרם נקראו (${pending.map((d) => d.fileName).join(", ")}) — הרץ /bakara-heartbeat ועבד אותם.` });
  if (!lastHeartbeat) {
    if (latestChangeLogId > 0) out.push({ kind: "no_heartbeat", textHe: "לא נרשמה פעימת לב לפרויקט — הרץ /bakara-heartbeat לפני שמירת הדוח." });
  } else if (latestChangeLogId > lastHeartbeat.untilChangeLogId) {
    const work = heartbeatWork(pkg, state, lastHeartbeat.untilChangeLogId, previouslyReported, today);
    // only findings on the records that changed: findings elsewhere are the control's business and the report lists them as open
    const changed = new Set(work.changedRecords.map((r) => `${r.type}:${r.id}`));
    const onChanged = work.findings.filter((f) => changed.has(`${f.record.type}:${f.record.id}`));
    if (onChanged.length) out.push({ kind: "unreviewed_findings", textHe: `${onChanged.length} ממצאים על רשומות שהשתנו מאז פעימת הלב האחרונה טרם הוצגו (${onChanged.map((f) => f.id).join(", ")}) — הרץ /bakara-heartbeat.` });
  }
  return out;
}

export function heartbeatSummaryHe(w: HeartbeatWork): string {
  const parts = [`${w.pendingDocuments.length} מסמכים ממתינים לעיבוד`, `${w.changedRecords.length} רשומות השתנו (${w.changedRecords.filter((r) => r.isNew).length} חדשות)`, `${w.findings.length} ממצאים לבדיקה`];
  if (w.sessionOpenFindings.length) parts.push(`${w.sessionOpenFindings.length} ממצאי בקרה פתוחים`);
  return parts.join(" · ");
}
