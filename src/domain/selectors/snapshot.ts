import { formatILS, sum, type Agorot } from "../money";
import type { CostLineView, DemoState, FrozenNote, FrozenReport, LineWorkItemView, ProjectTotals, ReportSnapshot } from "../types";
import { activeProjects, portfolioTotals, projectLines, totalsOf } from "./financial";

/**
 * Reconstruct the world as it was at `cutoff`: only records/documents/commitments/forecasts
 * received or accepted by then. Work items fulfilled by later records revert to uncommitted forecast,
 * and items committed by later orders revert too. Used to freeze the prior report from a real ledger.
 */
export function priorWorldState(state: DemoState, cutoff: string): DemoState {
  const keepDoc = (receivedAt: string) => receivedAt <= cutoff;
  const documents = state.documents.filter((d) => keepDoc(d.receivedAt));
  const erpRecords = state.erpRecords.filter((r) => r.receivedAt <= cutoff);
  const removedRecordIds = new Set(state.erpRecords.filter((r) => r.receivedAt > cutoff).map((r) => r.id));
  const commitments = state.commitments.filter((c) => c.createdAt <= cutoff).map((c) => ({ ...c, value: c.versions.filter((v) => v.at <= cutoff).slice(-1)[0]?.value ?? c.value }));
  const removedCommitmentIds = new Set(state.commitments.filter((c) => c.createdAt > cutoff).map((c) => c.id));
  const fulfilledByRemoved = new Set<string>();
  for (const r of state.erpRecords) {
    if (!removedRecordIds.has(r.id)) continue;
    for (const al of r.allocations) if (al.workItemId) fulfilledByRemoved.add(al.workItemId);
  }
  const workItems = state.workItems
    .filter((w) => w.createdAt <= cutoff)
    .map((w) => {
      if (w.status === "fulfilled" && fulfilledByRemoved.has(w.id)) return { ...w, status: "uncommitted" as const, commitmentId: null };
      if (w.status === "committed" && w.commitmentId && removedCommitmentIds.has(w.commitmentId)) return { ...w, status: "uncommitted" as const, commitmentId: null };
      return w;
    });
  const forecasts = state.forecasts.filter((f) => f.acceptedAt <= cutoff).map((f) => ({ ...f, status: f.status === "needs_revalidation" ? ("accepted" as const) : f.status }));
  // re-derive "superseded" within the cutoff: latest version by acceptedAt <= cutoff is accepted
  const latestByItem = new Map<string, number>();
  for (const f of forecasts) latestByItem.set(f.workItemId, Math.max(latestByItem.get(f.workItemId) ?? 0, f.version));
  const forecastsFixed = forecasts.map((f) => ({ ...f, status: f.version === latestByItem.get(f.workItemId) ? ("accepted" as const) : ("superseded" as const) }));
  const projects = state.projects.map((p) => ({ ...p, acceptedFinish: undefined, acceptedMonths: undefined }));
  return {
    ...state,
    clock: cutoff,
    documents,
    erpRecords,
    commitments,
    workItems,
    forecasts: forecastsFixed,
    projects,
    findings: state.findings.filter((f) => f.createdAt <= cutoff),
    questions: state.questions.filter((q) => q.createdAt <= cutoff),
    alerts: state.alerts.filter((a) => a.createdAt <= cutoff),
    recoveries: state.recoveries.filter((r) => r.createdAt <= cutoff),
    proposals: state.proposals.filter((p) => p.createdAt <= cutoff),
  };
}

/** Merge uncommitted work items of the same forecast group into one row (e.g. the 500-ton prior steel forecast). */
function mergeGroups(state: DemoState, line: CostLineView): CostLineView {
  const groups = new Map<string, LineWorkItemView[]>();
  const rest: LineWorkItemView[] = [];
  for (const w of line.workItems) {
    const item = state.workItems.find((x) => x.id === w.workItemId);
    if (w.status === "uncommitted" && item?.group) {
      const arr = groups.get(item.group) ?? [];
      arr.push(w);
      groups.set(item.group, arr);
    } else rest.push(w);
  }
  const merged: LineWorkItemView[] = [];
  for (const [group, items] of groups) {
    if (items.length === 1) {
      merged.push(items[0]);
      continue;
    }
    const groupDoc = state.documents.filter((d) => d.id === group || d.supersedesId === group || (d.id.startsWith(group) && d.kind === "forecast")).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))[0];
    const quantity = items.every((i) => i.quantity != null) ? sum(items.map((i) => i.quantity ?? 0)) : undefined;
    const amount = sum(items.map((i) => i.amount));
    const unitPrice = quantity && items.every((i) => i.unitPrice === items[0].unitPrice) ? items[0].unitPrice : undefined;
    merged.push({
      workItemId: `${group}-MERGED`,
      titleHe: groupDoc?.titleHe ?? items[0].titleHe,
      status: "uncommitted",
      amount,
      quantity,
      unit: items[0].unit,
      unitPrice,
      basisHe: items[0].basisHe,
      sourceDocumentId: groupDoc?.id ?? items[0].sourceDocumentId,
      forecastVersionId: null,
      evidence: groupDoc ? [{ documentId: groupDoc.id, anchorId: "summary", version: groupDoc.version }] : items[0].evidence,
      needsRevalidation: false,
    });
  }
  return { ...line, workItems: [...rest, ...merged] };
}

export function frozenNotesFor(state: DemoState, projectId: string): FrozenNote[] {
  const notes: FrozenNote[] = [];
  for (const f of state.findings) {
    if (f.projectId !== projectId) continue;
    if (f.status === "resolved" || f.status === "dismissed" || f.status === "superseded") continue;
    if (f.kind === "price_risk") {
      notes.push({ id: f.id, kind: "conditional_risk", titleHe: f.titleHe, textHe: f.explanationHe, amount: f.amounts.futurePremium, costCodeId: f.costCodeId });
    } else if (f.kind === "cross_project_opportunity") {
      notes.push({ id: f.id, kind: "opportunity", titleHe: f.titleHe, textHe: f.explanationHe, amount: f.amounts.opportunity, costCodeId: f.costCodeId });
    } else if (f.status === "needs_clarification" || f.status === "question_sent") {
      notes.push({ id: f.id, kind: "open_question", titleHe: f.titleHe, textHe: f.explanationHe, amount: f.amounts.amount, costCodeId: f.costCodeId });
    } else {
      notes.push({ id: f.id, kind: "open_issue", titleHe: f.titleHe, textHe: f.explanationHe, costCodeId: f.costCodeId });
    }
  }
  for (const line of projectLines(state, projectId)) {
    for (const w of line.workItems) {
      if (w.status !== "uncommitted" || w.amount === 0) continue;
      notes.push({ id: `ASSUMPTION-${w.workItemId}`, kind: "assumption", titleHe: `${line.nameHe}: ${w.titleHe}`, textHe: `${w.basisHe} — ${formatILS(w.amount)}`, amount: w.amount, costCodeId: line.costCodeId });
    }
  }
  return notes;
}

export function buildFrozenReport(state: DemoState, projectId: string, dataThrough: string, qualificationsHe: string[] = []): FrozenReport {
  const project = state.projects.find((p) => p.id === projectId)!;
  const lines = projectLines(state, projectId).map((l) => mergeGroups(state, l));
  const totals = totalsOf(lines);
  const recordIds = state.erpRecords.filter((r) => r.receivedAt <= dataThrough && r.allocations.some((al) => al.projectId === projectId)).map((r) => r.id);
  const availableDocumentIds = state.documents.filter((d) => d.receivedAt <= dataThrough).map((d) => d.id);
  const evidenceVersions = state.documents.filter((d) => d.receivedAt <= dataThrough && d.projectIds.includes(projectId)).map((d) => ({ documentId: d.id, version: d.version }));
  const quals = [...qualificationsHe];
  for (const r of state.erpRecords) {
    if (r.sourceMissing && r.allocations.some((al) => al.projectId === projectId)) {
      quals.push(`הרישום ${r.id} (${formatILS(r.amount)}) נקלט מרשומת זיו קודמת; חשבונית המקור טרם התקבלה במועד הדוח.`);
    }
  }
  return {
    projectNameHe: project.nameHe,
    lines,
    totals,
    notes: frozenNotesFor(state, projectId),
    availableDocumentIds,
    recordIds,
    acceptedFinish: project.acceptedFinish ?? null,
    plannedFinish: project.plannedFinish ?? null,
    evidenceVersions,
    portfolio: portfolioTotals(state),
    qualificationsHe: quals,
  };
}

export function reportById(state: DemoState, id: string | null | undefined): ReportSnapshot | undefined {
  if (!id) return undefined;
  return state.reports.find((r) => r.id === id);
}

/** Most recently delivered report for a project, optionally before a given report (by delivery time). */
export function lastDeliveredReport(state: DemoState, projectId: string, before?: ReportSnapshot): ReportSnapshot | undefined {
  const delivered = state.reports.filter((r) => r.projectId === projectId && r.status === "delivered" && r.deliveredAt);
  const candidates = before ? delivered.filter((r) => r.id !== before.id && (r.deliveredAt ?? "") < (before.deliveredAt ?? before.generatedAt)) : delivered;
  return candidates.sort((a, b) => ((a.deliveredAt ?? "") < (b.deliveredAt ?? "") ? 1 : -1))[0];
}

export function latestReportOfAnyStatus(state: DemoState, projectId: string): ReportSnapshot | undefined {
  return state.reports.filter((r) => r.projectId === projectId).sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))[0];
}

export interface DeltaLine {
  costCodeId: string;
  nameHe: string;
  before: Agorot;
  after: Agorot;
  delta: Agorot;
}

export interface ReportComparison {
  comparedToReportId: string | null;
  comparedToDate: string | null;
  before: ProjectTotals | null;
  after: ProjectTotals;
  delta: Agorot;
  lines: DeltaLine[];
  changedLines: DeltaLine[];
}

export function compareTotals(before: { totals: ProjectTotals; lines: CostLineView[] } | null, after: { totals: ProjectTotals; lines: CostLineView[] }, comparedTo: ReportSnapshot | null): ReportComparison {
  const lines: DeltaLine[] = after.lines.map((l) => {
    const prev = before?.lines.find((x) => x.costCodeId === l.costCodeId);
    const b = prev?.eac ?? 0;
    return { costCodeId: l.costCodeId, nameHe: l.nameHe, before: b, after: l.eac, delta: l.eac - b };
  });
  return {
    comparedToReportId: comparedTo?.id ?? null,
    comparedToDate: comparedTo?.reportDate ?? null,
    before: before?.totals ?? null,
    after: after.totals,
    delta: before ? after.totals.eac - before.totals.eac : 0,
    lines,
    changedLines: lines.filter((l) => l.delta !== 0),
  };
}

/** Current state versus the last delivered report for the project. */
export function changeSinceLastReport(state: DemoState, projectId: string, explicitReportId?: string | null): ReportComparison {
  const comparedTo = explicitReportId ? reportById(state, explicitReportId) ?? null : lastDeliveredReport(state, projectId) ?? null;
  const lines = projectLines(state, projectId);
  return compareTotals(comparedTo ? { totals: comparedTo.frozen.totals, lines: comparedTo.frozen.lines } : null, { totals: totalsOf(lines), lines }, comparedTo);
}

/** A selected report versus the delivered report preceding it. */
export function changeBetweenReports(state: DemoState, report: ReportSnapshot, explicitReportId?: string | null): ReportComparison {
  const comparedTo = explicitReportId ? reportById(state, explicitReportId) ?? null : lastDeliveredReport(state, report.projectId, report) ?? null;
  return compareTotals(comparedTo ? { totals: comparedTo.frozen.totals, lines: comparedTo.frozen.lines } : null, { totals: report.frozen.totals, lines: report.frozen.lines }, comparedTo);
}

/** True when audit events relevant to reporting happened after the report was generated. */
export function reportHasNewerData(state: DemoState, report: ReportSnapshot): boolean {
  return state.auditEvents.some((e) => e.reportRelevant && e.at > report.generatedAt && (!e.projectId || e.projectId === report.projectId));
}

export function nextReportId(state: DemoState, projectId: string, reportDate: string): { id: string; version: number } {
  const existing = state.reports.filter((r) => r.projectId === projectId && r.reportDate === reportDate);
  const version = existing.length + 1;
  return { id: `RPT-${projectId}-${reportDate}-v${String(version).padStart(2, "0")}`, version };
}

export function attachmentFilename(projectNameHe: string, reportDate: string): string {
  return `דוח_בקרה_${projectNameHe.replace(/\s+/g, "_")}_${reportDate}.xlsx`;
}

export function activeProjectSummaries(state: DemoState) {
  return activeProjects(state).map((p) => ({ project: p, totals: totalsOf(projectLines(state, p.id)), lastReport: lastDeliveredReport(state, p.id) }));
}
