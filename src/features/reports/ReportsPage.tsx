import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, routeWith, useRoute } from "../../app/router";
import { store, useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { Badge, Bidi, Button, Chip, EmptyState, Field, Money, Notice, Num, PageHeader, Stat } from "../../components/primitives";
import { ReportView, downloadReportWorkbook } from "../../components/ReportView";
import { ReportStatusBadge } from "../../components/StatusBadge";
import { advanceDemoClock, blockingIssues, generateReport, setReportPreferences } from "../../domain/commands/reports";
import { addDays, formatDate, formatDateTime, isoDateOf, weekdayOf } from "../../domain/dates";
import { activeProjects } from "../../domain/selectors/financial";
import { buildFrozenReport, changeSinceLastReport, reportHasNewerData } from "../../domain/selectors/snapshot";
import type { Channel, ReportLayout } from "../../domain/types";
import { he } from "../../locales/he";
import "./reports.css";

const WEEKDAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"];
const PREP_STEPS_HE = ["מקפיא את נתוני הפרויקט במועד הדוח…", "מצרף מקורות, הנחות פתוחות וסיכונים מותנים…", "מכין קובץ Excel בפריסה שנבחרה…"];

function nextDueDate(clock: string, weekday: number): string {
  let cursor = addDays(clock, 1);
  for (let i = 0; i < 14; i += 1) {
    const date = isoDateOf(cursor);
    if (weekdayOf(date) === weekday) return date;
    cursor = addDays(cursor, 1);
  }
  return isoDateOf(cursor);
}

const layoutHe: Record<ReportLayout, string> = { management_summary: "סיכום להנהלה", cost_code_detail: "פירוט לפי סעיפי תקציב" };
const channelHe: Record<Channel, string> = { email: "מייל", whatsapp: "WhatsApp" };

export function ReportsPage() {
  const { state } = useDemo();
  const route = useRoute();
  const ui = useUi();
  const projects = activeProjects(state);
  const paramProject = route.params.get("project");
  const projectId = projects.some((p) => p.id === paramProject) ? (paramProject as string) : projects.some((p) => p.id === state.activeProjectId) ? state.activeProjectId : (projects[0]?.id ?? "HAD");
  const project = state.projects.find((p) => p.id === projectId);
  const prefs = state.reportPreferences;
  const recipients = state.contacts.filter((c) => c.id !== "REVIEWER");
  const blocking = blockingIssues(state, projectId);
  const [prepStep, setPrepStep] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setFocusId(null);
  }, [projectId]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const preview = useMemo(() => buildFrozenReport(state, projectId, state.clock), [state, projectId]);
  const comparison = useMemo(() => changeSinceLastReport(state, projectId), [state, projectId]);
  const topVariances = useMemo(() => [...preview.lines].sort((a, b) => b.variance - a.variance).slice(0, 3), [preview]);
  const openNotes = preview.notes.filter((n) => n.kind !== "assumption");
  const assumptionNotes = preview.notes.filter((n) => n.kind === "assumption");

  const reports = state.reports.filter((r) => r.projectId === projectId).sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  const projectReportIds = new Set(reports.map((r) => r.id));
  const deliveries = state.deliveries.filter((d) => d.kind === "report" && d.reportId && projectReportIds.has(d.reportId)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const inlineReportId = focusId && projectReportIds.has(focusId) ? focusId : (reports.find((r) => r.status === "pending_review" || r.status === "approved" || r.status === "blocked")?.id ?? null);
  const dueDate = nextDueDate(state.clock, prefs.weekday);
  const scheduledProjects = projects.filter((p) => prefs.projectIds.includes(p.id));

  const setPrefs = (patch: Partial<typeof prefs>) => store.dispatch((s) => setReportPreferences(s, patch));

  const runGenerate = () => {
    let generatedId = "";
    const ok = store.dispatch(
      (s) => {
        const [next, report] = generateReport(s, projectId, { layout: prefs.layout, channel: prefs.channel, recipientId: prefs.recipientId, showPaid: prefs.showPaid, showQuantities: prefs.showQuantities });
        generatedId = report.id;
        return next;
      },
      blocking.length > 0 ? "הוכנה טיוטה פנימית בלבד; המסירה חסומה עד לתיקון הנתון השגוי" : "הדוח הוכן לבדיקת צוות הבקרה",
    );
    if (ok && generatedId) setFocusId(generatedId);
    setPrepStep(null);
  };

  const generate = () => {
    if (prepStep !== null) return;
    if (state.flags.skipMotion) {
      runGenerate();
      return;
    }
    setPrepStep(0);
    timers.current.push(setTimeout(() => setPrepStep(1), 300));
    timers.current.push(setTimeout(() => setPrepStep(2), 600));
    timers.current.push(setTimeout(runGenerate, 900));
  };

  return (
    <div className="stack-lg">
      <PageHeader title={he.nav.reports} subtitle="ארכיון דוחות קפוא, העדפות פריסה וערוץ, הפקה ומסירה מדומה" />

      <div className="row" data-guide="reports-project" aria-label="בחירת פרויקט לדוח">
        {projects.map((p) => (
          <Chip key={p.id} active={p.id === projectId} onClick={() => navigate(routeWith("reports", { project: p.id }))}>
            {p.nameHe}
          </Chip>
        ))}
        <span className="tiny muted">הדוחות מופקים לפרויקטים פעילים; טיוטת תקציב אינה מקבלת דוח.</span>
      </div>

      <div className="reports-layout">
        <section className="card stack">
          <div className="card-title">
            <h3>העדפות הדוח</h3>
            <span className="tiny muted">{he.fin.beforeVat}</span>
          </div>
          <div className="prefs-block">
            <span className="prefs-label">פורמט</span>
            <div className="row">
              <Chip active>Excel (.xlsx)</Chip>
              <span className="tiny muted">הגמישות מודגמת דרך הפריסה, העמודות והערוץ; קובץ Excel הוא הפורמט היחיד בהדגמה.</span>
            </div>
          </div>
          <div className="prefs-block" data-guide="reports-layout">
            <span className="prefs-label">פריסה</span>
            <div className="row">
              {(Object.keys(layoutHe) as ReportLayout[]).map((layout) => (
                <Chip key={layout} active={prefs.layout === layout} onClick={() => setPrefs({ layout })}>
                  {layoutHe[layout]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="prefs-block" data-guide="reports-channel">
            <span className="prefs-label">ערוץ מסירה ונמען</span>
            <div className="row">
              {(Object.keys(channelHe) as Channel[]).map((channel) => (
                <Chip key={channel} active={prefs.channel === channel} onClick={() => setPrefs({ channel })}>
                  {channelHe[channel]}
                </Chip>
              ))}
              <Field label="נמען">
                <select className="select" value={prefs.recipientId} onChange={(e) => setPrefs({ recipientId: e.target.value })} aria-label="נמען הדוח">
                  {recipients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameHe} — {c.roleHe}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          <div className="prefs-block">
            <span className="prefs-label">תדירות</span>
            <div className="row">
              <span className="small">
                בכל יום {WEEKDAYS_HE[prefs.weekday] ?? WEEKDAYS_HE[1]}, {String(prefs.hour).padStart(2, "0")}:00
              </span>
              <Field label="יום בשבוע">
                <select className="select" value={prefs.weekday} onChange={(e) => setPrefs({ weekday: Number(e.target.value) })} aria-label="יום בשבוע לדוח">
                  {WEEKDAYS_HE.map((name, i) => (
                    <option key={name} value={i}>
                      יום {name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          <div className="prefs-block">
            <span className="prefs-label">פרויקטים בתזמון השבועי</span>
            <div className="row">
              {projects.map((p) => {
                const checked = prefs.projectIds.includes(p.id);
                return (
                  <label key={p.id} className="checkbox-row">
                    <input type="checkbox" checked={checked} onChange={() => setPrefs({ projectIds: checked ? prefs.projectIds.filter((id) => id !== p.id) : [...prefs.projectIds, p.id] })} />
                    <span>{p.nameHe}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="prefs-block">
            <span className="prefs-label">עמודות</span>
            <div className="row">
              <Chip active={prefs.showPaid} onClick={() => setPrefs({ showPaid: !prefs.showPaid })}>
                הצג עמודת שולם
              </Chip>
              <Chip active={prefs.showQuantities} onClick={() => setPrefs({ showQuantities: !prefs.showQuantities })}>
                הצג עמודות כמות
              </Chip>
            </div>
          </div>
          <div className="divider" />
          {blocking.length > 0 ? (
            <Notice tone="red">
              קיים נתון שגוי מאומת שטרם תוקן ({blocking.map((id) => id).join(", ")}). עד ליישום התיקון אפשר להפיק טיוטה פנימית בלבד; המסירה ללקוח חסומה.
            </Notice>
          ) : openNotes.length > 0 ? (
            <Notice tone="navy">הדוח יכלול {openNotes.length} הנחות/שאלות פתוחות המוצגות במפורש; הנחה לא ודאית אינה חוסמת מסירה.</Notice>
          ) : null}
          <div className="row">
            <Button variant="primary" size="lg" guide="reports-generate" busy={prepStep !== null} onClick={generate}>
              {he.actions.generateReport}
            </Button>
            <span className="tiny muted">הדוח מוקפא במועד ההפקה, נבדק על ידי צוות הבקרה, ורק אז נמסר.</span>
          </div>
          {prepStep !== null ? (
            <ul className="prep-steps" aria-live="polite">
              {PREP_STEPS_HE.map((step, i) => (
                <li key={step} className={i < prepStep ? "done" : i === prepStep ? "active" : ""}>
                  <span aria-hidden="true">{i < prepStep ? "✓" : i === prepStep ? "●" : "○"}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="card stack">
          <div className="card-title">
            <h3>תצוגה מקדימה — נתונים עדכניים, טרם הופק דוח</h3>
            <Badge tone="navy">{layoutHe[prefs.layout]}</Badge>
          </div>
          <div className="tiny muted">
            {project?.nameHe} · נתונים נכון ל-{formatDateTime(state.clock)} · {he.fin.beforeVat}
          </div>
          {prefs.layout === "management_summary" ? (
            <>
              <div className="grid-2">
                <Stat label={he.fin.budget} value={<Money value={preview.totals.budget} />} />
                <Stat label={he.fin.incurred} value={<Money value={preview.totals.incurred} />} sub={preview.totals.incurredAccrued ? <span>מתוכה עבודה שטרם חויבה <Money value={preview.totals.incurredAccrued} /></span> : he.fin.invoiced} />
                <Stat label={he.fin.eac} value={<Money value={preview.totals.eac} />} tooltip={he.fin.eacTooltip} sub={<span>התחייבויות <Money value={preview.totals.commitments} /> · יתרה <Money value={preview.totals.uncommitted} /></span>} />
                <Stat label={preview.totals.variance >= 0 ? he.fin.variance : he.fin.varianceFavorable} value={<Money value={preview.totals.variance} signed tone="variance" />} sub={prefs.showPaid ? <span>{he.fin.paid} <Money value={preview.totals.paid} /> (בנפרד)</span> : undefined} />
              </div>
              <div className="stack-sm">
                <h4 className="muted">שינוי לעומת הדוח האחרון שנמסר</h4>
                {comparison.comparedToReportId ? (
                  <div className="small">
                    בהשוואה לדוח מתאריך {formatDate(comparison.comparedToDate)} (<Bidi className="mono">{comparison.comparedToReportId}</Bidi>): <Money value={comparison.before?.eac ?? 0} /> ← <Money value={comparison.after.eac} /> ({comparison.delta === 0 ? "ללא שינוי" : <Money value={comparison.delta} signed tone="variance" />})
                    {comparison.changedLines.length > 0 ? (
                      <ul className="plain" style={{ marginTop: 4 }}>
                        {comparison.changedLines.map((l) => (
                          <li key={l.costCodeId}>
                            {l.nameHe}: <Money value={l.delta} signed tone="variance" />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <span className="small muted">{he.general.noPriorReport}</span>
                )}
              </div>
              <div className="stack-sm">
                <h4 className="muted">שלוש החריגות המאושרות הגדולות</h4>
                <ul className="plain small">
                  {topVariances.map((l) => (
                    <li key={l.costCodeId}>
                      {l.nameHe}: <Money value={l.variance} signed tone="variance" /> (תחזית <Money value={l.eac} /> מול תקציב <Money value={l.budget} />)
                    </li>
                  ))}
                </ul>
              </div>
              <div className="row small">
                <Badge tone={openNotes.length ? "amber" : "green"}>{openNotes.length ? `${openNotes.length} הנחות/שאלות פתוחות` : "אין שאלות פתוחות"}</Badge>
                <Badge tone="neutral">{assumptionNotes.length} הנחות תחזית</Badge>
              </div>
            </>
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>סעיף</th>
                    <th className="num">תקציב</th>
                    <th className="num">נצבר</th>
                    <th className="num">התחייבויות</th>
                    <th className="num">יתרה ללא התחייבות</th>
                    <th className="num">תחזית לסיום</th>
                    <th className="num">חריגה</th>
                    {prefs.showPaid ? <th className="num">שולם</th> : null}
                    {prefs.showQuantities ? <th>כמויות</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.costCodeId}>
                      <td>
                        {l.nameHe} <span className="faint tiny">{l.costCodeId}</span>
                      </td>
                      <td className="num"><Money value={l.budget} /></td>
                      <td className="num"><Money value={l.incurred} /></td>
                      <td className="num"><Money value={l.commitments} /></td>
                      <td className="num"><Money value={l.uncommitted} /></td>
                      <td className="num"><Money value={l.eac} /></td>
                      <td className="num"><Money value={l.variance} signed tone="variance" /></td>
                      {prefs.showPaid ? <td className="num"><Money value={l.paid} /></td> : null}
                      {prefs.showQuantities ? <td className="small">{l.quantities ? <span><Num value={l.quantities.purchasedVerified} /> / <Num value={l.quantities.planned} unit={l.quantities.unit} /></span> : "—"}</td> : null}
                    </tr>
                  ))}
                  <tr className="total">
                    <td>סה״כ</td>
                    <td className="num"><Money value={preview.totals.budget} /></td>
                    <td className="num"><Money value={preview.totals.incurred} /></td>
                    <td className="num"><Money value={preview.totals.commitments} /></td>
                    <td className="num"><Money value={preview.totals.uncommitted} /></td>
                    <td className="num"><Money value={preview.totals.eac} /></td>
                    <td className="num"><Money value={preview.totals.variance} signed tone="variance" /></td>
                    {prefs.showPaid ? <td className="num"><Money value={preview.totals.paid} /></td> : null}
                    {prefs.showQuantities ? <td /> : null}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {inlineReportId ? (
        <section className="card stack" data-guide="report-inline">
          <div className="card-title">
            <h3>הדוח שהופק</h3>
            <Button size="sm" variant="ghost" onClick={() => ui.openReport(inlineReportId)}>
              פתח במגירה
            </Button>
          </div>
          <ReportView reportId={inlineReportId} />
        </section>
      ) : null}

      <section className="card stack" data-guide="report-archive">
        <div className="card-title">
          <h3>ארכיון הדוחות — {project?.nameHe}</h3>
          <span className="tiny muted">דוח שנמסר אינו משתנה לעולם; הפקה חוזרת יוצרת מזהה גרסה חדש.</span>
        </div>
        {reports.length === 0 ? (
          <EmptyState>{he.general.emptyReports}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>מזהה</th>
                  <th>תאריך דוח</th>
                  <th className="num">גרסה</th>
                  <th>סטטוס</th>
                  <th>פריסה</th>
                  <th>ערוץ</th>
                  <th>נמען</th>
                  <th>נמסר</th>
                  <th className="num">תחזית לסיום</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const newer = reportHasNewerData(state, r);
                  return (
                    <tr key={r.id} className="clickable" onClick={() => ui.openReport(r.id)}>
                      <td>
                        <Bidi className="mono">{r.id}</Bidi>
                      </td>
                      <td>{formatDate(r.reportDate)}</td>
                      <td className="num">{r.version}</td>
                      <td>
                        <div className="row">
                          <ReportStatusBadge status={r.status} />
                          {r.scheduledPeriod ? <Badge tone="neutral">מתוזמן</Badge> : null}
                          {newer ? <Badge tone="amber">{he.status.newerData}</Badge> : null}
                          {r.seededHistory ? <Badge tone="neutral">היסטוריה</Badge> : null}
                        </div>
                      </td>
                      <td className="small">{layoutHe[r.layout]}</td>
                      <td className="small">{channelHe[r.channel]}</td>
                      <td className="small">{state.contacts.find((c) => c.id === r.recipientId)?.nameHe ?? r.recipientId}</td>
                      <td className="small">{r.deliveredAt ? formatDateTime(r.deliveredAt) : "—"}</td>
                      <td className="num">
                        <Money value={r.frozen.totals.eac} />
                      </td>
                      <td>
                        <div className="row">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocusId(r.id);
                            }}
                          >
                            הצג כאן
                          </Button>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadReportWorkbook(r);
                            }}
                          >
                            הורד Excel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card stack-sm">
          <div className="card-title">
            <h3>תזמון שבועי</h3>
            <Badge tone="primary">בכל יום {WEEKDAYS_HE[prefs.weekday] ?? WEEKDAYS_HE[1]}</Badge>
          </div>
          <div className="small">
            הדוח הבא צפוי ב-<Bidi>{formatDate(dueDate)}</Bidi> בשעה {String(prefs.hour).padStart(2, "0")}:00
            {scheduledProjects.length ? ` עבור ${scheduledProjects.map((p) => p.nameHe).join(", ")}` : " — אין פרויקטים בתזמון"}.
          </div>
          <p className="small muted">התקדמות שעון ההדגמה יוצרת את טיוטת הדוח שהגיע מועדה לבדיקת צוות הבקרה ולמסירה. כל תקופה מיוצרת פעם אחת בלבד; לחיצה חוזרת אינה יוצרת דוח כפול.</p>
          <div className="row">
            <Button variant="primary" guide="advance-week-reports" onClick={() => store.dispatch((s) => advanceDemoClock(s, 7), "השעון התקדם בשבוע")}>
              {he.actions.advanceWeek}
            </Button>
            <span className="tiny muted">
              {he.general.clock}: <Bidi>{formatDateTime(state.clock)}</Bidi>
            </span>
          </div>
        </section>

        <section className="card stack-sm">
          <div className="card-title">
            <h3>מסירות שבוצעו</h3>
            <span className="tiny muted">{he.status.simulatedNote}</span>
          </div>
          {deliveries.length === 0 ? (
            <EmptyState>טרם נמסר דוח לפרויקט זה בהפעלה הנוכחית.</EmptyState>
          ) : (
            <ul className="plain stack-sm">
              {deliveries.map((d) => (
                <li key={d.id} className="row-between small">
                  <span>
                    <Bidi className="mono">{d.reportId}</Bidi> · {channelHe[d.channel]} · {state.contacts.find((c) => c.id === d.recipientId)?.nameHe ?? d.recipientId} · {formatDateTime(d.at)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => ui.openConversation(d.conversationId)}>
                    פתח הודעה
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
