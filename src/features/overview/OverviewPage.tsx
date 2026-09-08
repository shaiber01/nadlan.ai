import { useState } from "react";
import { navigate, routeWith } from "../../app/router";
import { store, useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { Badge, Bidi, Button, Card, EmptyState, Money, Notice, PageHeader, Stat } from "../../components/primitives";
import { AlertStatusBadge, FindingStatusBadge, ReportStatusBadge } from "../../components/StatusBadge";
import { formatDate, formatDateTime } from "../../domain/dates";
import { draftBudgetTotal, portfolioTotals, projectTotals } from "../../domain/selectors/financial";
import { activeProjectSummaries, changeSinceLastReport, lastDeliveredReport, latestReportOfAnyStatus } from "../../domain/selectors/snapshot";
import type { Finding } from "../../domain/types";
import { he } from "../../locales/he";
import "./overview.css";

const isOpen = (f: Finding) => !["resolved", "dismissed", "superseded"].includes(f.status);
const CONDITIONAL_KINDS = new Set(["price_risk", "cross_project_opportunity", "commitment_conditional"]);

export function OverviewPage() {
  const { state, analyzing } = useDemo();
  const ui = useUi();
  const activeId = state.activeProjectId;
  const project = state.projects.find((p) => p.id === activeId) ?? state.projects[0];
  const isDraft = project.status === "draft";
  const summaries = activeProjectSummaries(state);
  const portfolio = portfolioTotals(state);
  const draftProject = state.projects.find((p) => p.status === "draft");
  const draft = draftProject ? draftBudgetTotal(state, draftProject.id) : null;
  const totals = isDraft ? null : projectTotals(state, project.id);
  const lastReport = isDraft ? undefined : lastDeliveredReport(state, project.id);
  const latestAny = isDraft ? undefined : latestReportOfAnyStatus(state, project.id);
  const deliveredReports = state.reports.filter((r) => r.projectId === project.id && r.status === "delivered").sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  const [compareId, setCompareId] = useState<string>("");
  const comparison = isDraft ? null : changeSinceLastReport(state, project.id, compareId || null);
  const comparedReport = comparison?.comparedToReportId ? state.reports.find((r) => r.id === comparison.comparedToReportId) : undefined;
  const recentAudit = comparedReport ? state.auditEvents.filter((e) => e.reportRelevant && (!e.projectId || e.projectId === project.id) && e.at > comparedReport.generatedAt).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5) : [];
  const projectFindings = state.findings.filter((f) => f.projectId === project.id && isOpen(f));
  const conditional = projectFindings.filter((f) => CONDITIONAL_KINDS.has(f.kind));
  const otherOpen = projectFindings.filter((f) => !CONDITIONAL_KINDS.has(f.kind));
  const riskSum = conditional.filter((f) => f.kind !== "cross_project_opportunity").reduce((acc, f) => acc + (f.amounts.futurePremium ?? f.amounts.amount ?? 0), 0);
  const activity = state.activity.slice(-10).reverse();
  const isManager = state.role === "manager";

  const openIssuesFor = (projectId: string) => state.findings.filter((f) => f.projectId === projectId && isOpen(f)).length;

  const conditionalLabel = (f: Finding) => {
    const alert = state.alerts.find((a) => f.alertIds.includes(a.id));
    if (isManager) {
      if (alert && alert.status === "pending_review") return <Badge tone="navy">{he.general.underProviderReview}</Badge>;
      if (alert) return <AlertStatusBadge status={alert.status} />;
      if (f.status === "pending_review") return <Badge tone="navy">{he.general.underProviderReview}</Badge>;
      return <FindingStatusBadge status={f.status} />;
    }
    return (
      <span className="row">
        <FindingStatusBadge status={f.status} />
        {alert ? <AlertStatusBadge status={alert.status} /> : null}
      </span>
    );
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title={he.nav.overview}
        subtitle={
          <span>
            {state.company.nameHe} · {state.company.descriptionHe} · {he.fin.beforeVat}
          </span>
        }
      />

      <Card>
        <div className="stack">
          <p>{he.general.tourIntro}</p>
          <div className="entry-actions">
            <Button variant="primary" size="lg" onClick={() => store.startTour()}>
              {he.actions.tryGuided}
            </Button>
            <Button size="lg" onClick={() => navigate(routeWith("budget", { project: isDraft ? "HAD" : project.id }))}>
              {he.actions.exploreData}
            </Button>
            <Button size="lg" onClick={() => navigate("#/scenarios")}>
              {he.actions.showScenarios}
            </Button>
          </div>
        </div>
      </Card>

      <section className="stack">
        <div className="section-title">
          <h2>{he.general.activePortfolio}</h2>
          <span className="muted small">{he.fin.beforeVat} · ללא טיוטת נוף הגבעה</span>
        </div>
        <div className="grid-4">
          <Stat label={he.fin.budget} value={<Money value={portfolio.budget} />} sub={`${summaries.length} פרויקטים פעילים`} />
          <Stat label={he.fin.incurred} value={<Money value={portfolio.incurred} />} sub={<span>{he.fin.paid}: <Money value={portfolio.paid} /> (בנפרד)</span>} />
          <Stat label={he.fin.eac} value={<Money value={portfolio.eac} />} tooltip={he.fin.eacTooltip} sub={<span>{he.fin.commitments}: <Money value={portfolio.commitments} /></span>} />
          <Stat label={portfolio.variance >= 0 ? he.fin.variance : he.fin.varianceFavorable} value={<Money value={portfolio.variance} signed tone="variance" />} sub={portfolio.provisional ? he.status.provisional : "תחזית מאושרת"} />
        </div>
        <div className="project-cards">
          {summaries.map(({ project: p, totals: t, lastReport: lr }) => (
            <Card key={p.id} className="project-card" selected={p.id === project.id} onClick={() => navigate(routeWith("overview", { project: p.id }))}>
              <div className="row-between">
                <span className="name">{p.nameHe}</span>
                <Badge tone="green" dot>
                  פעיל
                </Badge>
              </div>
              <div className="muted tiny">{p.cityHe}</div>
              <dl className="rows">
                <dt>{he.fin.budget}</dt>
                <dd>
                  <Money value={t.budget} />
                </dd>
                <dt>{he.fin.incurred}</dt>
                <dd>
                  <Money value={t.incurred} />
                </dd>
                <dt>{he.fin.eac}</dt>
                <dd>
                  <Money value={t.eac} />
                </dd>
                <dt>{he.fin.variance}</dt>
                <dd>
                  <Money value={t.variance} signed tone="variance" />
                </dd>
                <dt>{he.general.openIssues}</dt>
                <dd>{openIssuesFor(p.id)}</dd>
                <dt>{he.general.reportsReady}</dt>
                <dd>{lr ? formatDate(lr.reportDate) : "טרם הופק דוח"}</dd>
              </dl>
            </Card>
          ))}
          {draftProject && draft ? (
            <Card className="project-card" selected={draftProject.id === project.id} onClick={() => navigate(routeWith("overview", { project: draftProject.id }))}>
              <div className="row-between">
                <span className="name">{draftProject.nameHe}</span>
                <Badge tone="amber" dot>
                  {he.general.draftBudget}
                </Badge>
              </div>
              <div className="muted tiny">{draftProject.cityHe}</div>
              <dl className="rows">
                <dt>סך טיוטה (גרסה {draft.version})</dt>
                <dd>
                  <Money value={draft.total} />
                </dd>
                <dt>{he.fin.incurred}</dt>
                <dd>—</dd>
                <dt>{he.fin.budget}</dt>
                <dd>טרם אושר</dd>
              </dl>
              <div className="tiny muted" style={{ marginTop: 6 }}>
                לא נכלל בסך הפרויקטים הפעילים
              </div>
            </Card>
          ) : null}
        </div>
      </section>

      {isDraft ? (
        <Card title={project.nameHe}>
          <div className="stack">
            <Notice tone="amber">לפרויקט זה יש טיוטת תקציב בלבד. אין עלות שנצברה, אין תקציב מאושר, והוא אינו נכלל בסך הפרויקטים הפעילים.</Notice>
            <div className="row">
              <Button variant="primary" onClick={() => navigate(routeWith("projects", { project: project.id }))}>
                פתח את טיוטת התקציב
              </Button>
            </div>
          </div>
        </Card>
      ) : totals ? (
        <div className="overview-layout">
          <div className="stack">
            <section className="stack">
              <div className="section-title">
                <h2>{project.nameHe}</h2>
                <span className="muted small">
                  {project.cityHe}
                  {project.plannedFinish ? ` · סיום מתוכנן ${formatDate(project.plannedFinish)}` : ""}
                  {project.acceptedFinish ? ` · סיום מאושר לפי התחזית ${formatDate(project.acceptedFinish)}` : ""}
                </span>
              </div>
              <div className="grid-4">
                <Stat label={he.fin.budget} value={<Money value={totals.budget} />} />
                <Stat label={he.fin.incurred} value={<Money value={totals.incurred} />} sub={totals.incurredAccrued ? <span>מתוכה {he.fin.accrued}: <Money value={totals.incurredAccrued} /></span> : <span>{he.fin.paid}: <Money value={totals.paid} /></span>} />
                <Stat label={he.fin.eac} value={<Money value={totals.eac} />} tooltip={he.fin.eacTooltip} sub={<span>{he.fin.commitments}: <Money value={totals.commitments} /> · {he.fin.uncommitted}: <Money value={totals.uncommitted} /></span>} />
                <Stat label={totals.variance >= 0 ? he.fin.variance : he.fin.varianceFavorable} value={<Money value={totals.variance} signed tone="variance" />} sub={totals.provisional ? he.status.provisional : he.fin.acceptedForecast} />
              </div>
              <div className="row">
                <Button onClick={() => navigate(routeWith("budget", { project: project.id }))}>{he.nav.budget}</Button>
                <Button variant="ghost" onClick={() => navigate(routeWith("reports", { project: project.id }))}>
                  {he.nav.reports}
                </Button>
                {latestAny ? (
                  <span className="status-line">
                    דוח אחרון: <Bidi className="mono">{latestAny.id}</Bidi> <ReportStatusBadge status={latestAny.status} />
                  </span>
                ) : (
                  <span className="status-line">{he.general.emptyReports}</span>
                )}
              </div>
            </section>

            <Card title={he.general.conditionalPanel} accent="amber" guide="conditional-panel">
              <div className="stack-sm">
                <div className="muted small">{he.general.conditionalPanelNote}</div>
                {conditional.length === 0 ? (
                  <EmptyState>אין כרגע סיכונים מותנים או הזדמנויות פתוחות בפרויקט זה.</EmptyState>
                ) : (
                  <>
                    <div className="grid-2">
                      <div className="card card-muted stack-sm">
                        <span className="muted small">{he.fin.acceptedForecast}</span>
                        <span className="stat-value">
                          <Money value={totals.eac} />
                        </span>
                      </div>
                      <div className="card card-muted stack-sm">
                        <span className="muted small">תרחיש מותנה (אם הסיכונים יתממשו)</span>
                        <span className="stat-value">
                          <Money value={totals.eac + riskSum} />
                        </span>
                        <span className="tiny muted">
                          {he.fin.conditionalRisk}: <Money value={riskSum} /> — אינו נכלל בתחזית המאושרת
                        </span>
                      </div>
                    </div>
                    <div>
                      {conditional.map((f) => {
                        const amount = f.amounts.futurePremium ?? f.amounts.opportunity ?? f.amounts.amount;
                        return (
                          <div key={f.id} className="cond-item">
                            <div className="stack-sm" style={{ minWidth: 0 }}>
                              <div className="row">
                                <Badge tone={f.kind === "cross_project_opportunity" ? "green" : "amber"}>{f.kind === "cross_project_opportunity" ? he.fin.opportunity : he.fin.conditionalRisk}</Badge>
                                {conditionalLabel(f)}
                              </div>
                              <div className="small">{f.titleHe}</div>
                            </div>
                            <div className="row">
                              {amount != null ? (
                                <span className="strong">
                                  <Money value={amount} />
                                </span>
                              ) : null}
                              {f.kind === "price_risk" ? (
                                <Button size="sm" variant="primary" onClick={() => ui.openCalculation(f.id)}>
                                  הצג השפעה על יתרת הפרויקט
                                </Button>
                              ) : (
                                <Button size="sm" onClick={() => ui.openFinding(f.id)}>
                                  פתח
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card title={he.actions.whatChanged}>
              <div className="stack-sm">
                {deliveredReports.length > 0 ? (
                  <div className="row">
                    <label className="row small muted" style={{ gap: 6 }}>
                      <span>{he.general.comparedTo}</span>
                      <select className="select" value={compareId} onChange={(e) => setCompareId(e.target.value)} aria-label="בחירת דוח להשוואה">
                        <option value="">הדוח האחרון שנמסר</option>
                        {deliveredReports.map((r) => (
                          <option key={r.id} value={r.id}>
                            {formatDate(r.reportDate)} · {r.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                {comparison && comparison.comparedToReportId && comparedReport ? (
                  <>
                    <div>
                      בהשוואה לדוח מתאריך {formatDate(comparison.comparedToDate)} (<Bidi className="mono">{comparison.comparedToReportId}</Bidi>): {he.fin.eac} <Money value={comparison.before?.eac ?? 0} /> ← <Money value={comparison.after.eac} />{" "}
                      {comparison.delta === 0 ? <Badge tone="neutral">ללא שינוי</Badge> : <Money value={comparison.delta} signed tone="variance" />}
                    </div>
                    {comparison.changedLines.length > 0 ? (
                      <ul className="plain small stack-sm">
                        {comparison.changedLines.map((l) => (
                          <li key={l.costCodeId}>
                            {l.nameHe}: <Money value={l.before} /> ← <Money value={l.after} /> (<Money value={l.delta} signed tone="variance" />)
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted small">אין שינוי בסעיפי התקציב מאז הדוח.</span>
                    )}
                    {recentAudit.length > 0 ? (
                      <div className="stack-sm">
                        <span className="muted small">שינויים שנרשמו מאז הדוח:</span>
                        <ul className="plain small stack-sm">
                          {recentAudit.map((e) => (
                            <li key={e.id}>
                              <span className="faint">{formatDateTime(e.at)}</span> · {e.textHe}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="row">
                      <Button size="sm" variant="ghost" onClick={() => ui.openReport(comparedReport.id)}>
                        פתח את דוח ההשוואה
                      </Button>
                    </div>
                  </>
                ) : (
                  <span className="muted small">{he.general.noPriorReport}</span>
                )}
              </div>
            </Card>

            <Card title={he.general.openIssues}>
              {otherOpen.length === 0 ? (
                <EmptyState>{he.status.noOpenQuestions}</EmptyState>
              ) : (
                <div>
                  {otherOpen.map((f) => (
                    <div key={f.id} className="cond-item">
                      <div className="row" style={{ minWidth: 0 }}>
                        {isManager && f.status === "pending_review" ? <Badge tone="navy">{he.general.underProviderReview}</Badge> : <FindingStatusBadge status={f.status} />}
                        <span className="small">{f.titleHe}</span>
                      </div>
                      <Button size="sm" onClick={() => ui.openFinding(f.id)}>
                        פתח
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="stack">
            <Card title="הדוח הקודם">
              {lastReport ? (
                <div className="stack-sm">
                  <div className="row">
                    <ReportStatusBadge status={lastReport.status} />
                    <span className="small">
                      {formatDate(lastReport.reportDate)} · גרסה {lastReport.version}
                    </span>
                  </div>
                  <div className="small">
                    {he.fin.eac} בדוח: <Money value={lastReport.frozen.totals.eac} /> מול תקציב <Money value={lastReport.frozen.totals.budget} />
                  </div>
                  <div className="tiny muted">נמסר {formatDateTime(lastReport.deliveredAt)} ל{state.contacts.find((c) => c.id === lastReport.recipientId)?.nameHe}</div>
                  <div className="row">
                    <Button size="sm" variant="primary" onClick={() => ui.openReport(lastReport.id)}>
                      פתח את הדוח
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(routeWith("reports", { project: project.id }))}>
                      ארכיון הדוחות
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState>{he.general.emptyReports}</EmptyState>
              )}
            </Card>

            <Card title={he.status.autoAnalysis} accent="primary">
              <div className="stack-sm">
                <div className="status-line">
                  {he.general.lastReceived}: <Bidi>{formatDateTime(state.lastReceivedAt)}</Bidi>
                </div>
                {analyzing ? <Badge tone="amber">{he.status.analyzing}</Badge> : <Badge tone="green">הבדיקות הושלמו</Badge>}
                <div className="muted small">{he.general.activity}</div>
                {activity.length === 0 ? (
                  <span className="muted small">אין פעילות עדיין.</span>
                ) : (
                  <ul className="activity-feed">
                    {activity.map((a) => (
                      <li key={a.id}>
                        <span className="when">
                          <Bidi>{formatDateTime(a.at)}</Bidi>
                        </span>
                        <span>{a.textHe}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
