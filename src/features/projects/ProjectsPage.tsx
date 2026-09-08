import { useState } from "react";
import { navigate, routeWith } from "../../app/router";
import { store, useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { ProposalCard } from "../../components/ProposalCard";
import { ScenarioEventButtons } from "../../components/ScenarioEventButtons";
import { Badge, Bidi, Button, Card, EmptyState, Money, Notice, Num, PageHeader, Stat } from "../../components/primitives";
import { FindingStatusBadge, ReportStatusBadge } from "../../components/StatusBadge";
import { intakeSampleBudget } from "../../domain/commands/scenario-actions";
import { formatDate } from "../../domain/dates";
import { sum } from "../../domain/money";
import { projectTotals } from "../../domain/selectors/financial";
import { lastDeliveredReport } from "../../domain/selectors/snapshot";
import type { BudgetVersion, Finding, Project } from "../../domain/types";
import { he } from "../../locales/he";
import "./projects.css";

const isOpen = (f: Finding) => !["resolved", "dismissed", "superseded"].includes(f.status);

export function ProjectsPage() {
  const { state } = useDemo();
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
  return (
    <div className="stack-lg">
      <PageHeader title={he.nav.projects} subtitle={`${state.company.nameHe} · פרויקטים פעילים לעומת טיוטת תקציב · ${he.fin.beforeVat}`} />
      <div className="projects-grid">
        {state.projects.map((p) => {
          const active = p.status === "active";
          const t = active ? projectTotals(state, p.id) : null;
          const draft = !active ? currentDraft(state.budgetVersions, p.id) : null;
          return (
            <Card key={p.id} selected={p.id === project.id} onClick={() => navigate(routeWith("projects", { project: p.id }))}>
              <div className="row-between">
                <span className="strong">{p.nameHe}</span>
                {active ? (
                  <Badge tone="green" dot>
                    פעיל
                  </Badge>
                ) : (
                  <Badge tone="amber" dot>
                    {he.general.draftBudget}
                  </Badge>
                )}
              </div>
              <div className="muted tiny">{p.cityHe}</div>
              {t ? (
                <div className="small" style={{ marginTop: 8 }}>
                  {he.fin.eac}: <Money value={t.eac} /> · {he.fin.variance}: <Money value={t.variance} signed tone="variance" />
                </div>
              ) : draft ? (
                <div className="small" style={{ marginTop: 8 }}>
                  סך טיוטה (גרסה {draft.version}): <Money value={sum(draft.lines.map((l) => l.amount))} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      {project.status === "active" ? <ActiveProjectDetail project={project} /> : <DraftProjectDetail project={project} />}
    </div>
  );
}

function currentDraft(versions: BudgetVersion[], projectId: string): BudgetVersion | undefined {
  const drafts = versions.filter((b) => b.projectId === projectId && b.kind === "draft").sort((a, b) => b.version - a.version);
  return drafts.find((b) => b.status === "current") ?? drafts[0];
}

function ActiveProjectDetail({ project }: { project: Project }) {
  const { state } = useDemo();
  const ui = useUi();
  const totals = projectTotals(state, project.id);
  const lastReport = lastDeliveredReport(state, project.id);
  const openFindings = state.findings.filter((f) => f.projectId === project.id && isOpen(f));
  return (
    <Card title={project.nameHe}>
      <div className="stack">
        <div className="grid-4">
          <Stat label={he.fin.budget} value={<Money value={totals.budget} />} />
          <Stat label={he.fin.incurred} value={<Money value={totals.incurred} />} sub={<span>{he.fin.paid}: <Money value={totals.paid} /> (בנפרד)</span>} />
          <Stat label={he.fin.eac} value={<Money value={totals.eac} />} tooltip={he.fin.eacTooltip} sub={<span>{he.fin.commitments}: <Money value={totals.commitments} /> · {he.fin.uncommitted}: <Money value={totals.uncommitted} /></span>} />
          <Stat label={totals.variance >= 0 ? he.fin.variance : he.fin.varianceFavorable} value={<Money value={totals.variance} signed tone="variance" />} sub={totals.provisional ? he.status.provisional : he.fin.acceptedForecast} />
        </div>
        <div className="grid-3">
          <div className="card card-muted stack-sm">
            <span className="muted small">לוח זמנים</span>
            <span className="small">
              התחלה: {project.start ? formatDate(project.start) : "—"} · סיום מתוכנן: {project.plannedFinish ? formatDate(project.plannedFinish) : "—"}
              {project.plannedMonths ? ` (${project.plannedMonths} חודשים)` : ""}
            </span>
            {project.acceptedFinish ? (
              <span className="small">
                <Badge tone="amber">סיום מאושר לפי התחזית</Badge> {formatDate(project.acceptedFinish)}
                {project.acceptedMonths ? ` (${project.acceptedMonths} חודשים)` : ""} — התכנון המקורי נשמר כבסיס
              </span>
            ) : null}
          </div>
          <div className="card card-muted stack-sm">
            <span className="muted small">{he.general.reportsReady}</span>
            {lastReport ? (
              <span className="row small">
                <ReportStatusBadge status={lastReport.status} /> {formatDate(lastReport.reportDate)}
                <Button size="sm" variant="ghost" onClick={() => ui.openReport(lastReport.id)}>
                  פתח
                </Button>
              </span>
            ) : (
              <span className="small muted">{he.general.emptyReports}</span>
            )}
          </div>
          <div className="card card-muted stack-sm">
            <span className="muted small">{he.general.openIssues}</span>
            <span className="small">{openFindings.length === 0 ? he.status.noOpenQuestions : `${openFindings.length} נושאים פתוחים`}</span>
            {openFindings.length > 0 ? (
              <div className="row">
                {openFindings.slice(0, 3).map((f) => (
                  <Button key={f.id} size="sm" variant="ghost" onClick={() => ui.openFinding(f.id)}>
                    {f.titleHe.length > 40 ? `${f.titleHe.slice(0, 40)}…` : f.titleHe}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="row">
          <Button variant="primary" onClick={() => navigate(routeWith("budget", { project: project.id }))}>
            {he.nav.budget}
          </Button>
          <Button onClick={() => navigate(routeWith("records", { project: project.id }))}>{he.nav.records}</Button>
          <Button variant="ghost" onClick={() => navigate(routeWith("reports", { project: project.id }))}>
            {he.nav.reports}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DraftProjectDetail({ project }: { project: Project }) {
  const { state, scenario } = useDemo();
  const ui = useUi();
  const [showPreview, setShowPreview] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const drafts = state.budgetVersions.filter((b) => b.projectId === project.id && b.kind === "draft").sort((a, b) => a.version - b.version);
  const current = drafts.find((b) => b.status === "current") ?? drafts[drafts.length - 1];
  const previous = current ? drafts.filter((b) => b.version < current.version).sort((a, b) => b.version - a.version)[0] : undefined;
  if (!current) return <EmptyState>אין טיוטת תקציב לפרויקט זה.</EmptyState>;
  const total = sum(current.lines.map((l) => l.amount));
  const assumptionFindings = state.findings.filter((f) => f.projectId === project.id && f.kind === "budget_assumption").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const openAssumption = assumptionFindings.find(isOpen);
  const latestAssumption = assumptionFindings[0];
  const flaggedLineId = openAssumption?.costCodeId ?? null;
  const intakeEvent = scenario?.events.find((e) => e.id === "S02-INTAKE");
  const intakeDone = state.activity.some((a) => a.textHe.includes("נקלטה טיוטת תקציב לדוגמה")) || assumptionFindings.length > 0;
  const proposals = state.proposals.filter((p) => p.projectId === project.id && p.status !== "superseded").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const quotes = state.documents.filter((d) => d.kind === "quote" && d.projectIds.includes(project.id));
  const contracts = state.documents.filter((d) => d.kind === "contract" && d.projectIds.includes(project.id));
  const today = state.clock.slice(0, 10);

  const intake = () => {
    if (intakeEvent && state.scenario && !(intakeEvent.doneWhen ? intakeEvent.doneWhen(state) : false)) store.receiveScenarioEvent("S02-INTAKE");
    else store.dispatch((s) => intakeSampleBudget(s, project.id), "הטיוטה נקלטה בזיו — הדגמה; בדיקת ההנחות מתחילה אוטומטית");
  };

  const openCheck = () => {
    setShowCheck(true);
    if (latestAssumption) ui.openFinding(latestAssumption.id);
  };

  return (
    <div className="stack-lg">
      <Card
        title={
          <h3>
            {he.general.draftBudget} — {project.nameHe}
          </h3>
        }
        actions={
          <Badge tone="amber" dot>
            טיוטה שטרם אושרה
          </Badge>
        }
      >
        <div className="stack">
          <Notice tone="amber">טיוטה בלבד: אינה תקציב מאושר, אין עלות שנצברה ואין תשלומים, והיא אינה נכללת בסך הפרויקטים הפעילים. אישור התקציב הוא פעולה מפורשת ונפרדת.</Notice>
          <div className="row">
            {drafts.map((d) => (
              <Badge key={d.id} tone={d.status === "current" ? "primary" : "neutral"}>
                גרסה {d.version} · {d.status === "current" ? "נוכחית" : "נשמרה להשוואה"} · {formatDate(d.createdAt)}
              </Badge>
            ))}
            <Button size="sm" variant="ghost" onClick={() => ui.openDocument(current.documentId)}>
              פתח את מסמך הטיוטה
            </Button>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>סעיף</th>
                  <th className="num">כמות</th>
                  <th>יחידה</th>
                  <th className="num">מחיר ליחידה</th>
                  <th className="num">סכום</th>
                  {previous ? <th className="num">גרסה {previous.version}</th> : null}
                </tr>
              </thead>
              <tbody>
                {current.lines.map((l) => {
                  const prevLine = previous?.lines.find((x) => x.id === l.id);
                  return (
                    <tr key={l.id} className={flaggedLineId === l.id ? "flagged" : ""}>
                      <td>
                        {l.nameHe} <span className="faint tiny">{l.id}</span>
                        {flaggedLineId === l.id ? (
                          <>
                            {" "}
                            <Badge tone="amber">הנחת מחיר לבדיקה</Badge>
                          </>
                        ) : null}
                      </td>
                      <td className="num">{l.quantity != null ? <Num value={l.quantity} /> : "—"}</td>
                      <td>{l.unit ?? "—"}</td>
                      <td className="num">{l.unitPrice != null ? <Money value={l.unitPrice} /> : "—"}</td>
                      <td className="num">
                        <Money value={l.amount} />
                      </td>
                      {previous ? <td className="num">{prevLine ? <Money value={prevLine.amount} /> : "—"}</td> : null}
                    </tr>
                  );
                })}
                <tr className="total">
                  <td>סך הטיוטה (גרסה {current.version})</td>
                  <td />
                  <td />
                  <td />
                  <td className="num">
                    <Money value={total} />
                  </td>
                  {previous ? (
                    <td className="num">
                      <Money value={sum(previous.lines.map((l) => l.amount))} />
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </div>
          {current.noteHe ? <div className="small muted">{current.noteHe}</div> : null}
          {previous ? (
            <div className="small muted">
              הפרש לעומת גרסה {previous.version}: <Money value={total - sum(previous.lines.map((l) => l.amount))} signed tone="variance" /> — הגרסה הקודמת נשמרת להשוואה.
            </div>
          ) : null}

          <div className="row">
            <Button variant={intakeDone ? "secondary" : "primary"} guide="draft-intake" onClick={() => setShowPreview((v) => !v)}>
              טען תקציב לדוגמה
            </Button>
            <Button variant={latestAssumption ? "primary" : "secondary"} guide="draft-check" disabled={!latestAssumption} onClick={openCheck}>
              הצג בדיקת הנחות
            </Button>
            <ScenarioEventButtons route="projects" compact />
          </div>

          {showPreview ? (
            <div className="card card-muted stack-sm">
              <div className="row-between">
                <span className="strong small">תצוגה מקדימה של הגיליון לדוגמה ({current.lines.length} שורות)</span>
                <span className="tiny muted">קליטה מוגדרת מראש — לא ניתוח Excel חופשי</span>
              </div>
              <div className="sheet-preview">
                <table>
                  <thead>
                    <tr>
                      <th>שורה</th>
                      <th>כמות</th>
                      <th>יחידה</th>
                      <th>מחיר ליחידה</th>
                      <th>סכום</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.nameHe}</td>
                        <td className="num">{l.quantity != null ? <Num value={l.quantity} /> : ""}</td>
                        <td>{l.unit ?? ""}</td>
                        <td className="num">{l.unitPrice != null ? <Money value={l.unitPrice} /> : ""}</td>
                        <td className="num">
                          <Money value={l.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tiny muted">מיפוי עמודות: ״שורה״ ← שם הסעיף · ״כמות״ ← כמות · ״יחידה״ ← יחידת מידה · ״מחיר ליחידה״ ← מחיר ליחידה · ״סכום״ ← סכום הסעיף</div>
              <div className="row">
                <Button variant="primary" done={intakeDone} onClick={intake}>
                  {intakeDone ? "✓ הטיוטה נקלטה" : "קלוט טיוטה בזיו — הדגמה"}
                </Button>
                <span className="tiny muted">הקליטה מעדכנת את גרסת הטיוטה הקיימת ואינה מוסיפה שורות כפולות; הבדיקה מתחילה אוטומטית.</span>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {showCheck || openAssumption ? (
        <Card title="בדיקת הנחות — השוואת הצעות מחיר" accent="amber">
          <div className="stack">
            {latestAssumption ? (
              <div className="row">
                <FindingStatusBadge status={latestAssumption.status} />
                <span className="small">{latestAssumption.titleHe}</span>
                <Button size="sm" variant="ghost" onClick={() => ui.openFinding(latestAssumption.id)}>
                  פתח את הממצא
                </Button>
              </div>
            ) : (
              <span className="small muted">טרם בוצעה בדיקת הנחות. לחצו ״קלוט טיוטה בזיו — הדגמה״ כדי להתחיל.</span>
            )}
            {quotes.length === 0 && contracts.length === 0 ? (
              <EmptyState>{he.general.emptyDocuments}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>מסמך</th>
                      <th>מציע</th>
                      <th>מפרט</th>
                      <th>מיקום</th>
                      <th>תאריך / תוקף</th>
                      <th className="num">כמות</th>
                      <th>הובלה</th>
                      <th>שאיבה</th>
                      <th>תנאי תשלום</th>
                      <th className="num">מחיר למ״ק</th>
                      <th>סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...contracts, ...quotes].map((d) => {
                      const expired = d.facts.validUntil ? d.facts.validUntil < today : false;
                      return (
                        <tr key={d.id} className="clickable" onClick={() => ui.openDocument(d.id, d.anchors[0]?.id)}>
                          <td>
                            <Bidi className="mono">{d.id}</Bidi>
                          </td>
                          <td>{d.kind === "contract" ? "הסכם תקף" : (d.bidderHe ?? "—")}</td>
                          <td>{d.facts.spec ?? "—"}</td>
                          <td>{d.facts.destinationHe ?? "—"}</td>
                          <td>
                            {formatDate(d.date)}
                            {d.facts.validUntil ? ` · עד ${formatDate(d.facts.validUntil)}` : ""}
                          </td>
                          <td className="num">{d.facts.quantity != null ? <Num value={d.facts.quantity} /> : "—"}</td>
                          <td>{d.facts.freightIncluded === true ? "כלולה" : d.facts.freightIncluded === false ? "לא כלולה (איסוף עצמי)" : "—"}</td>
                          <td>{d.facts.pumpingIncluded === false ? "לא כלולה" : d.facts.pumpingIncluded === true ? "כלולה" : "—"}</td>
                          <td>{d.facts.paymentTermsHe ?? "—"}</td>
                          <td className="num">{d.facts.unitPrice != null ? <Money value={d.facts.unitPrice} /> : "—"}</td>
                          <td>
                            {d.facts.comparable === false ? (
                              <Badge tone="neutral">לא נכלל בהשוואה — מפרט ותנאים שונים</Badge>
                            ) : expired ? (
                              <Badge tone="amber">פג תוקף</Badge>
                            ) : d.kind === "contract" ? (
                              <Badge tone="green">הסכם תקף</Badge>
                            ) : (
                              <Badge tone="primary">נכלל בהשוואה</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {latestAssumption?.amounts.lowGap != null ? (
              <div className="small">
                פער אפשרי בכמות של <Num value={latestAssumption.numbers.quantity} unit={current.lines.find((l) => l.id === latestAssumption.costCodeId)?.unit} />: <Money value={latestAssumption.amounts.lowGap} /> – <Money value={latestAssumption.amounts.highGap ?? 0} />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {proposals.length > 0 ? (
        <section className="stack">
          <div className="section-title">
            <h2>הצעות לעדכון הטיוטה</h2>
            <span className="muted small">עדכון הטיוטה שומר את הגרסה הקודמת; תקציבי הפרויקטים הפעילים אינם משתנים</span>
          </div>
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
