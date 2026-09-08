import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, routeWith, useRoute } from "../../app/router";
import { useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { FindingCard } from "../../components/FindingCard";
import { HistoryList } from "../../components/HistoryList";
import { ProposalCard } from "../../components/ProposalCard";
import { recordKindHe } from "../../components/RecordView";
import { ScenarioEventButtons } from "../../components/ScenarioEventButtons";
import { CheckStatusBadge } from "../../components/StatusBadge";
import { Badge, Bidi, Button, Chip, EmptyState, Money, Notice, Num, PageHeader, Tabs } from "../../components/primitives";
import { branding } from "../../config/branding";
import { formatDate, formatDateTime } from "../../domain/dates";
import { costCodeName, projectName, supplierName } from "../../domain/state-utils";
import type { CheckStatus, ErpRecord } from "../../domain/types";
import { he } from "../../locales/he";

type Tab = "erp" | "findings" | "proposals" | "history";
const TABS: Tab[] = ["erp", "findings", "proposals", "history"];

const OPEN_FINDING = new Set(["pending_review", "needs_clarification", "conditional", "proposal_created", "question_sent"]);
const OPEN_PROPOSAL = new Set(["pending_review", "apply_failed"]);

const checkStatusOptions: { value: "all" | CheckStatus; labelHe: string }[] = [
  { value: "all", labelHe: he.general.all },
  { value: "verified", labelHe: he.status.verified },
  { value: "pending", labelHe: he.status.provisional },
  { value: "flagged", labelHe: he.status.flagged },
];

export function RecordsPage() {
  const { state, analyzing } = useDemo();
  const route = useRoute();
  const ui = useUi();
  const tabParam = route.params.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "erp";
  const recordParam = route.params.get("record");
  const proposalParam = route.params.get("proposal");
  const isReviewer = state.role === "reviewer";

  const setTab = (next: Tab) => navigate(routeWith("records", { tab: next, project: route.params.get("project") }));

  // ERP filters
  const [statusFilter, setStatusFilter] = useState<"all" | CheckStatus>("all");
  const [codeFilter, setCodeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  // findings / proposals / history filters
  const [findingsOpenOnly, setFindingsOpenOnly] = useState(true);
  const [findingsProject, setFindingsProject] = useState<string>(state.activeProjectId);
  const [proposalsPendingOnly, setProposalsPendingOnly] = useState(true);
  const [historyAllProjects, setHistoryAllProjects] = useState(false);

  useEffect(() => setFindingsProject(state.activeProjectId), [state.activeProjectId]);

  // Auto-open the record / proposal named in the query, once per id.
  const autoOpenedRecord = useRef<string | null>(null);
  const autoOpenedProposal = useRef<string | null>(null);
  useEffect(() => {
    if (!recordParam || tab !== "erp") return;
    if (autoOpenedRecord.current === recordParam) return;
    if (!state.erpRecords.some((r) => r.id === recordParam)) return;
    autoOpenedRecord.current = recordParam;
    ui.openRecord(recordParam);
  }, [recordParam, tab, state.erpRecords, ui]);
  useEffect(() => {
    if (!proposalParam || tab !== "proposals") return;
    if (autoOpenedProposal.current === proposalParam) return;
    if (!state.proposals.some((p) => p.id === proposalParam)) return;
    autoOpenedProposal.current = proposalParam;
    ui.openProposal(proposalParam);
  }, [proposalParam, tab, state.proposals, ui]);

  const updatedRecordIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of state.auditEvents) if (e.kind.startsWith("applied:")) for (const id of e.entityIds) ids.add(id);
    return ids;
  }, [state.auditEvents]);
  const pendingRecordIds = useMemo(() => new Set(state.pendingAnalyses.map((p) => p.recordId)), [state.pendingAnalyses]);

  const records = useMemo(() => {
    return state.erpRecords
      .filter((r) => statusFilter === "all" || r.checkStatus === statusFilter)
      .filter((r) => codeFilter === "all" || r.allocations.some((al) => al.costCodeId === codeFilter))
      .filter((r) => projectFilter === "all" || r.allocations.some((al) => al.projectId === projectFilter))
      .filter((r) => supplierFilter === "all" || (supplierFilter === "none" ? r.supplierId === null : r.supplierId === supplierFilter))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  }, [state.erpRecords, statusFilter, codeFilter, projectFilter, supplierFilter]);

  const openFindingsCount = state.findings.filter((f) => f.projectId === state.activeProjectId && OPEN_FINDING.has(f.status)).length;
  const pendingProposalsCount = state.proposals.filter((p) => OPEN_PROPOSAL.has(p.status)).length;

  const findings = useMemo(
    () =>
      state.findings
        .filter((f) => f.status !== "superseded")
        .filter((f) => (findingsOpenOnly ? OPEN_FINDING.has(f.status) : true))
        .filter((f) => findingsProject === "all" || f.projectId === findingsProject)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [state.findings, findingsOpenOnly, findingsProject],
  );

  const proposals = useMemo(() => {
    const rank = (s: string) => (OPEN_PROPOSAL.has(s) ? 0 : s === "approved" ? 1 : 2);
    return state.proposals
      .filter((p) => p.status !== "superseded")
      .filter((p) => (proposalsPendingOnly ? OPEN_PROPOSAL.has(p.status) || p.status === "approved" : true))
      .sort((a, b) => rank(a.status) - rank(b.status) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [state.proposals, proposalsPendingOnly]);

  const codesForFilter = state.costCodes.filter((c) => projectFilter === "all" || c.projectId === projectFilter);

  return (
    <div className="stack-lg">
      <PageHeader
        title={he.nav.records}
        subtitle={
          <span className="row" style={{ gap: 12 }}>
            <span>{he.status.autoAnalysis}</span>
            <span>
              {he.general.lastReceived}: <Bidi>{formatDateTime(state.lastReceivedAt)}</Bidi>
            </span>
            {analyzing ? <Badge tone="amber">{he.status.analyzing}</Badge> : null}
          </span>
        }
      />

      <Tabs
        tabs={[
          { id: "erp", labelHe: branding.sourceSystemLabel, count: state.erpRecords.length },
          { id: "findings", labelHe: "ממצאים", count: openFindingsCount || undefined },
          { id: "proposals", labelHe: "הצעות לבדיקה", count: pendingProposalsCount || undefined },
          { id: "history", labelHe: he.actions.history },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "erp" ? (
        <div className="stack">
          <div className="row-between">
            <div className="stack-sm">
              <h2>{branding.sourceSystemLabel}</h2>
              <span className="muted small">{he.general.simulatedErpNote}</span>
            </div>
          </div>
          <ScenarioEventButtons route="records" />
          <div className="row" role="group" aria-label="סינון רשומות">
            <label className="row small muted" style={{ gap: 6 }}>
              <span>{he.general.status}</span>
              <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | CheckStatus)}>
                {checkStatusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.labelHe}
                  </option>
                ))}
              </select>
            </label>
            <label className="row small muted" style={{ gap: 6 }}>
              <span>{he.general.project}</span>
              <select
                className="select"
                value={projectFilter}
                onChange={(e) => {
                  setProjectFilter(e.target.value);
                  setCodeFilter("all");
                }}
              >
                <option value="all">{he.general.all}</option>
                {state.projects
                  .filter((p) => p.status === "active")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameHe}
                    </option>
                  ))}
              </select>
            </label>
            <label className="row small muted" style={{ gap: 6 }}>
              <span>{he.general.costCode}</span>
              <select className="select" value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
                <option value="all">{he.general.all}</option>
                {codesForFilter.map((c) => (
                  <option key={c.id} value={c.id}>
                    {projectFilter === "all" ? `${projectName(state, c.projectId)} · ` : ""}
                    {c.nameHe} ({c.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="row small muted" style={{ gap: 6 }}>
              <span>{he.general.supplier}</span>
              <select className="select" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                <option value="all">{he.general.all}</option>
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameHe}
                  </option>
                ))}
                <option value="none">{he.general.openingBalance}</option>
              </select>
            </label>
            {statusFilter !== "all" || codeFilter !== "all" || projectFilter !== "all" || supplierFilter !== "all" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setStatusFilter("all");
                  setCodeFilter("all");
                  setProjectFilter("all");
                  setSupplierFilter("all");
                }}
              >
                נקה סינון
              </Button>
            ) : null}
          </div>

          {records.length === 0 ? (
            <EmptyState>{he.status.noResults}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>מזהה</th>
                    <th>{he.general.date}</th>
                    <th>סוג</th>
                    <th>{he.general.description}</th>
                    <th>
                      {he.general.project} / {he.general.costCode}
                    </th>
                    <th>{he.general.supplier}</th>
                    <th className="num">כמות × מחיר ליחידה</th>
                    <th className="num">{he.general.amount}</th>
                    <th className="num">{he.fin.paid}</th>
                    <th>{he.general.status}</th>
                    <th className="num">{he.general.version}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <RecordRow key={r.id} record={r} highlighted={r.id === recordParam} pending={pendingRecordIds.has(r.id)} updated={updatedRecordIds.has(r.id)} onOpen={() => ui.openRecord(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="tiny muted">
            {records.length} רשומות מוצגות מתוך {state.erpRecords.length}. {he.fin.beforeVat}. תשלומים מוצגים בנפרד ואינם עלות נוספת.
          </div>
        </div>
      ) : null}

      {tab === "findings" ? (
        <div className="stack" data-guide="finding-list">
          <div className="row">
            <Chip active={findingsOpenOnly} onClick={() => setFindingsOpenOnly(true)}>
              פתוחים
            </Chip>
            <Chip active={!findingsOpenOnly} onClick={() => setFindingsOpenOnly(false)}>
              {he.general.all}
            </Chip>
            <label className="row small muted" style={{ gap: 6 }}>
              <span>{he.general.project}</span>
              <select className="select" value={findingsProject} onChange={(e) => setFindingsProject(e.target.value)}>
                <option value="all">כל הפרויקטים</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameHe}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {findings.length === 0 ? (
            <EmptyState>אין ממצאים פתוחים כרגע — {he.status.autoAnalysis}</EmptyState>
          ) : (
            findings.map((f) => <FindingCard key={f.id} finding={f} />)
          )}
        </div>
      ) : null}

      {tab === "proposals" ? (
        <div className="stack" data-guide="proposal-list">
          {isReviewer ? (
            <Notice tone="navy">שלושה שערי בדיקה: שאלות והתרעות יוצאות נבדקות לפני שחרור; תיקוני זיו ותחזית נבדקים לפני יישום; דוחות נבדקים לפני מסירה.</Notice>
          ) : (
            <Notice tone="navy">{he.status.pendingReview} — הצעות מיושמות בזיו רק לאחר אישור צוות הבקרה. עברו לתצוגת צוות הבקרה כדי לראות איך הנושא מטופל.</Notice>
          )}
          <div className="row">
            <Chip active={proposalsPendingOnly} onClick={() => setProposalsPendingOnly(true)}>
              ממתינים
            </Chip>
            <Chip active={!proposalsPendingOnly} onClick={() => setProposalsPendingOnly(false)}>
              {he.general.all}
            </Chip>
          </div>
          {proposals.length === 0 ? (
            <EmptyState>{he.general.emptyProposals}</EmptyState>
          ) : (
            proposals.map((p) => (
              <div key={p.id} className={p.id === proposalParam ? "card selected" : undefined} style={p.id === proposalParam ? { padding: 4 } : undefined}>
                <ProposalCard proposal={p} />
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="stack">
          <div className="row">
            <Chip active={!historyAllProjects} onClick={() => setHistoryAllProjects(false)}>
              {projectName(state, state.activeProjectId)}
            </Chip>
            <Chip active={historyAllProjects} onClick={() => setHistoryAllProjects(true)}>
              כל הפרויקטים
            </Chip>
          </div>
          <HistoryList filter={historyAllProjects ? undefined : { projectId: state.activeProjectId }} />
        </div>
      ) : null}
    </div>
  );
}

function RecordRow({ record, highlighted, pending, updated, onOpen }: { record: ErpRecord; highlighted: boolean; pending: boolean; updated: boolean; onOpen: () => void }) {
  const { state } = useDemo();
  const allocationsText = record.allocations.map((al) => `${projectName(state, al.projectId)} / ${costCodeName(state, al.costCodeId)} (${al.costCodeId})`);
  return (
    <tr
      className={`clickable${highlighted ? " expanded" : ""}`}
      data-guide={highlighted ? "erp-record" : undefined}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${record.descriptionHe} — פתח רשומה`}
    >
      <td>
        <Bidi className="mono">{record.id}</Bidi>
      </td>
      <td className="nowrap">{formatDate(record.date)}</td>
      <td>{recordKindHe(record.kind)}</td>
      <td>
        {record.descriptionHe}
        {record.sourceMissing ? (
          <div>
            <Badge tone="amber">חשבונית המקור טרם התקבלה</Badge>
          </div>
        ) : null}
      </td>
      <td className="small">
        {allocationsText.map((t, i) => (
          <div key={i}>{t}</div>
        ))}
      </td>
      <td className="small">{supplierName(state, record.supplierId)}</td>
      <td className="num small">
        {record.quantity != null && record.unitPrice != null ? (
          <span>
            <Num value={record.quantity} unit={record.unit ?? undefined} /> × <Money value={record.unitPrice} />
          </span>
        ) : (
          <span className="faint">—</span>
        )}
      </td>
      <td className="num">
        <Money value={record.amount} tone="auto" />
      </td>
      <td className="num">
        <Money value={record.paid} />
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          <CheckStatusBadge status={record.checkStatus} />
          {pending ? <Badge tone="amber">{he.status.analyzing}</Badge> : null}
          {updated ? <Badge tone="green">עודכן</Badge> : null}
        </div>
      </td>
      <td className="num">{record.version}</td>
    </tr>
  );
}
