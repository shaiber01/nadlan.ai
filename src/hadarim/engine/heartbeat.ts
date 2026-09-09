import type { HChangeLogEntry, HDocument, HadarimPackage, PersonId } from "../data/types";
import { runChecks, type HFinding } from "./checks";
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
  return !d.factsSource;
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
  const known = new Set(c.findings.map((f) => f.id));
  const reported = new Set(previouslyReported);
  const findings = fresh.filter((f) => changed.has(`${f.record.type}:${f.record.id}`) || (!known.has(f.id) && !reported.has(f.id)));
  const sessionOpenFindings = c.findings.filter((f) => {
    const d = c.decisions[f.id];
    return !d || d.status === "open" || !!d.pending;
  });
  return { sinceChangeLogId, untilChangeLogId, pendingDocuments: pkg.documents.filter(isUnprocessed), changedRecords, findings, sessionOpenFindings };
}

/** One Hebrew line the heartbeat record and the CLI print. */
export function heartbeatSummaryHe(w: HeartbeatWork): string {
  const parts = [`${w.pendingDocuments.length} מסמכים ממתינים לעיבוד`, `${w.changedRecords.length} רשומות השתנו (${w.changedRecords.filter((r) => r.isNew).length} חדשות)`, `${w.findings.length} ממצאים לבדיקה`];
  if (w.sessionOpenFindings.length) parts.push(`${w.sessionOpenFindings.length} ממצאי בקרה פתוחים`);
  return parts.join(" · ");
}
