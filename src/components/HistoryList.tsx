import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { formatDateTime } from "../domain/dates";
import { reverseCorrection } from "../domain/commands/review";
import type { AuditEvent } from "../domain/types";
import { EvidenceList } from "./EvidenceList";
import { BeforeAfter, Button, EmptyState } from "./primitives";

export function auditMatches(e: AuditEvent, filter?: { projectId?: string; costCodeId?: string; recordId?: string }): boolean {
  if (!filter) return true;
  if (filter.recordId && !e.entityIds.includes(filter.recordId)) return false;
  if (filter.costCodeId && e.costCodeId !== filter.costCodeId) return false;
  if (filter.projectId && e.projectId && e.projectId !== filter.projectId) return false;
  return true;
}

/** Audit trail entries: "07/09/2026 09:12 · נועה, צוות הבקרה · ...". A reversal creates another entry; nothing is deleted. */
export function HistoryList({ filter, limit }: { filter?: { projectId?: string; costCodeId?: string; recordId?: string }; limit?: number }) {
  const { state } = useDemo();
  const ui = useUi();
  const events = state.auditEvents.filter((e) => auditMatches(e, filter)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit ?? 200);
  if (events.length === 0) return <EmptyState>אין רישומי היסטוריה עדיין. תיקונים מאושרים, דחיות, התרעות ודוחות יירשמו כאן עם המקורות שלהם.</EmptyState>;
  return (
    <div className="timeline">
      {events.map((e) => {
        const proposal = e.proposalId ? state.proposals.find((p) => p.id === e.proposalId) : undefined;
        const reversible = state.role === "reviewer" && e.kind === "applied:erp_correction" && proposal?.status === "applied" && !state.auditEvents.some((x) => x.kind === "reversed" && x.proposalId === e.proposalId && x.at > e.at);
        return (
          <div key={e.id} className={`timeline-item${e.kind === "apply_failed" ? " failure" : ""}`}>
            <div className="stack-sm">
              <div>
                <span className="when">{formatDateTime(e.at)}</span> · <span className="strong">{e.actorNameHe}{e.actorRoleHe ? `, ${e.actorRoleHe}` : ""}</span> · {e.textHe}
              </div>
              {e.before && e.after && e.before.length > 0 ? <BeforeAfter before={e.before} after={e.after} /> : null}
              <div className="row">
                <EvidenceList evidence={e.evidence} title={null} />
                {proposal ? (
                  <Button size="sm" variant="ghost" onClick={() => ui.openProposal(proposal.id)}>
                    פתח הצעה
                  </Button>
                ) : null}
                {reversible ? (
                  <Button size="sm" variant="ghost" onClick={() => store.dispatch((s) => reverseCorrection(s, e.id, "REVIEWER"), "התיקון בוטל ברישום חדש; ההיסטוריה נשמרה")}>
                    בטל תיקון (רישום חדש)
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
