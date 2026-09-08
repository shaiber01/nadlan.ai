import type { ChatScope, CostLineView, DemoState, ProjectTotals, ReportSnapshot } from "../types";
import { formatDate } from "../dates";
import { projectLines, totalsOf, portfolioTotals, activeProjects } from "./financial";
import { reportById } from "./snapshot";

/**
 * A financial view for a chat/report scope: either the live ledger or a frozen report snapshot.
 * Report-scoped answers only cite documents available at the report cutoff.
 */
export interface ScopedView {
  projectId: string | null;
  portfolio: boolean;
  report: ReportSnapshot | null;
  lines: CostLineView[];
  totals: ProjectTotals;
  availableDocumentIds: Set<string> | null;
  labelHe: string;
  asOf: string;
}

export function viewForScope(state: DemoState, scope: ChatScope): ScopedView {
  const report = scope.reportId ? reportById(state, scope.reportId) ?? null : null;
  if (report) {
    return {
      projectId: report.projectId,
      portfolio: false,
      report,
      lines: report.frozen.lines,
      totals: report.frozen.totals,
      availableDocumentIds: new Set(report.frozen.availableDocumentIds),
      labelHe: `לפי הדוח מתאריך ${formatDate(report.reportDate)} (גרסה ${report.version})`,
      asOf: report.dataThrough,
    };
  }
  if (scope.portfolio || !scope.projectId) {
    const lines = activeProjects(state).flatMap((p) => projectLines(state, p.id));
    return { projectId: null, portfolio: true, report: null, lines, totals: portfolioTotals(state), availableDocumentIds: null, labelHe: "נתונים עדכניים · כל הפרויקטים הפעילים", asOf: state.clock };
  }
  const lines = projectLines(state, scope.projectId);
  const project = state.projects.find((p) => p.id === scope.projectId);
  return { projectId: scope.projectId, portfolio: false, report: null, lines, totals: totalsOf(lines), availableDocumentIds: null, labelHe: `נתונים עדכניים · ${project?.nameHe ?? scope.projectId}`, asOf: state.clock };
}

/** Recognized (posted) records that a scoped view may cite: in report scope only those frozen in it. */
export function recordsForView(state: DemoState, view: ScopedView) {
  const ids = view.report ? new Set(view.report.frozen.recordIds) : null;
  return state.erpRecords.filter((r) => (!ids || ids.has(r.id)) && (view.portfolio || r.allocations.some((al) => al.projectId === view.projectId)));
}
