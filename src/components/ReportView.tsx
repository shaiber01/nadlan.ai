import { useState } from "react";
import { navigate, routeWith } from "../app/router";
import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { setChatScope } from "../domain/commands/chat";
import { approveReport, blockingIssues, simulateDeliverReport } from "../domain/commands/reports";
import { formatDate, formatDateTime } from "../domain/dates";
import { changeBetweenReports, reportHasNewerData } from "../domain/selectors/snapshot";
import type { ReportLayout, ReportSnapshot } from "../domain/types";
import { buildReportWorkbook } from "../export/xlsx";
import { EvidenceList } from "./EvidenceList";
import { Badge, Bidi, Button, Chip, Money, Notice, Num, Stat } from "./primitives";
import { ReportStatusBadge } from "./StatusBadge";

export function downloadReportWorkbook(report: ReportSnapshot) {
  const bytes = buildReportWorkbook(report);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = report.attachmentName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  store.toast(`הקובץ ${report.attachmentName} נוצר מהצילום הקפוא של הדוח`, "success");
}

/** On-screen report: frozen values, comparison with the preceding delivered report, notes, and the Excel attachment. */
export function ReportView({ reportId, layoutOverride, showControls = true }: { reportId: string; layoutOverride?: ReportLayout; showControls?: boolean }) {
  const { state } = useDemo();
  const ui = useUi();
  const report = state.reports.find((r) => r.id === reportId);
  const [layout, setLayout] = useState<ReportLayout | null>(null);
  const [showPaid, setShowPaid] = useState<boolean | null>(null);
  const [showQty, setShowQty] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!report) return <Notice tone="amber">הדוח אינו זמין.</Notice>;
  const effectiveLayout = layout ?? layoutOverride ?? report.layout;
  const paid = showPaid ?? report.showPaid;
  const qty = showQty ?? report.showQuantities;
  const f = report.frozen;
  const cmp = changeBetweenReports(state, report);
  const newer = reportHasNewerData(state, report);
  const blocking = blockingIssues(state, report.projectId);
  const topVariances = [...f.lines].sort((a, b) => b.variance - a.variance).slice(0, 3);
  const isReviewer = state.role === "reviewer";
  const recipient = state.contacts.find((c) => c.id === report.recipientId);

  return (
    <div className="stack-lg">
      <div className="row-between">
        <div className="row">
          <ReportStatusBadge status={report.status} />
          <Badge tone="navy">{effectiveLayout === "management_summary" ? "סיכום להנהלה" : "פירוט לפי סעיפי תקציב"}</Badge>
          <span className="small muted">
            תאריך דוח {formatDate(report.reportDate)} · גרסה {report.version} · נתונים עד {formatDateTime(report.dataThrough)}
          </span>
        </div>
        <span className="tiny faint">
          <Bidi className="mono">{report.id}</Bidi>
        </span>
      </div>
      {newer ? <Notice tone="amber">קיימים עדכונים מאז הדוח. הדוח נשאר קפוא; אפשר להפיק דוח חדש עם הנתונים העדכניים.</Notice> : null}
      {report.status === "blocked" ? <Notice tone="red">טיוטה פנימית בלבד: קיים נתון שגוי מאומת שטרם תוקן ({blocking.join(", ")}). המסירה תתאפשר לאחר יישום התיקון.</Notice> : null}
      {f.qualificationsHe.map((q, i) => (
        <Notice key={i} tone="navy">
          {q}
        </Notice>
      ))}

      {showControls ? (
        <div className="row">
          <Chip active={effectiveLayout === "management_summary"} onClick={() => setLayout("management_summary")}>
            סיכום להנהלה
          </Chip>
          <Chip active={effectiveLayout === "cost_code_detail"} onClick={() => setLayout("cost_code_detail")}>
            פירוט לפי סעיפי תקציב
          </Chip>
          <Chip active={paid} onClick={() => setShowPaid(!paid)}>
            עמודת שולם
          </Chip>
          <Chip active={qty} onClick={() => setShowQty(!qty)}>
            עמודות כמות
          </Chip>
        </div>
      ) : null}

      <div className="grid-4">
        <Stat label="תקציב מאושר" value={<Money value={f.totals.budget} />} sub="לפני מע״מ" />
        <Stat label="עלות שנצברה" value={<Money value={f.totals.incurred} />} sub={f.totals.incurredAccrued ? <span>מתוכה עבודה שטרם חויבה <Money value={f.totals.incurredAccrued} /></span> : "חשבוניות שנקלטו"} />
        <Stat label="תחזית עלות לסיום" value={<Money value={f.totals.eac} />} tooltip="העלות הכוללת הצפויה של הפרויקט, כולל העלות שכבר נצברה." sub={<span>התחייבויות <Money value={f.totals.commitments} /> · יתרה <Money value={f.totals.uncommitted} /></span>} />
        <Stat label={f.totals.variance >= 0 ? "חריגה צפויה מהתקציב" : "תחזית נמוכה מהתקציב"} value={<Money value={f.totals.variance} signed tone="variance" />} sub={paid ? <span>שולם בפועל <Money value={f.totals.paid} /> (בנפרד)</span> : undefined} />
      </div>

      {effectiveLayout === "management_summary" ? (
        <>
          <section className="card stack-sm">
            <h3>שינוי לעומת הדוח הקודם</h3>
            {cmp.comparedToReportId ? (
              <>
                <div>
                  בהשוואה לדוח מתאריך {formatDate(cmp.comparedToDate)} (<Bidi className="mono">{cmp.comparedToReportId}</Bidi>): תחזית העלות לסיום <Money value={cmp.before?.eac ?? 0} /> ← <Money value={cmp.after.eac} /> ({cmp.delta === 0 ? "ללא שינוי" : <Money value={cmp.delta} signed tone="variance" />}).
                </div>
                {cmp.changedLines.length > 0 ? (
                  <ul className="plain small">
                    {cmp.changedLines.map((l) => (
                      <li key={l.costCodeId}>
                        {l.nameHe}: <Money value={l.before} /> ← <Money value={l.after} /> (<Money value={l.delta} signed tone="variance" />)
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <span className="muted small">אין דוח קודם להשוואה.</span>
            )}
          </section>
          <section className="card stack-sm">
            <h3>שלוש החריגות המאושרות הגדולות</h3>
            <ul className="plain small">
              {topVariances.map((l) => (
                <li key={l.costCodeId}>
                  {l.nameHe}: <Money value={l.variance} signed tone="variance" /> (תחזית <Money value={l.eac} /> מול תקציב <Money value={l.budget} />)
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <section className="card stack-sm">
        <h3>{effectiveLayout === "management_summary" ? "סעיפי התקציב" : "פירוט לפי סעיפי תקציב"}</h3>
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
                {paid ? <th className="num">שולם</th> : null}
                {qty ? <th>כמויות</th> : null}
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l) => (
                <>
                  <tr key={l.costCodeId} className={`clickable${expanded === l.costCodeId ? " expanded" : ""}`} onClick={() => setExpanded(expanded === l.costCodeId ? null : l.costCodeId)}>
                    <td>
                      {l.nameHe} <span className="faint tiny">{l.costCodeId}</span>
                    </td>
                    <td className="num"><Money value={l.budget} /></td>
                    <td className="num"><Money value={l.incurred} /></td>
                    <td className="num"><Money value={l.commitments} /></td>
                    <td className="num"><Money value={l.uncommitted} /></td>
                    <td className="num"><Money value={l.eac} /></td>
                    <td className="num"><Money value={l.variance} signed tone="variance" /></td>
                    {paid ? <td className="num"><Money value={l.paid} /></td> : null}
                    {qty ? <td className="small">{l.quantities ? <span><Num value={l.quantities.purchasedVerified} /> / <Num value={l.quantities.planned} unit={l.quantities.unit} /></span> : "—"}</td> : null}
                  </tr>
                  {expanded === l.costCodeId ? (
                    <tr key={`${l.costCodeId}-x`} className="subrow">
                      <td colSpan={9}>
                        <div className="stack-sm small">
                          {l.records.map((r) => (
                            <div key={r.recordId} className="row-between">
                              <span>{r.descriptionHe} · {formatDate(r.date)}</span>
                              <span className="row">
                                <Money value={r.amount} />
                                {r.sourceDocumentId ? <Button size="sm" variant="ghost" onClick={() => ui.openDocument(r.sourceDocumentId!, undefined)}>מקור</Button> : null}
                              </span>
                            </div>
                          ))}
                          {l.workItems.filter((w) => w.status !== "historical" && w.status !== "fulfilled").map((w) => (
                            <div key={w.workItemId} className="row-between">
                              <span>{w.titleHe} — {w.basisHe}</span>
                              <span className="row">
                                <Money value={w.amount} />
                                <EvidenceList evidence={w.evidence} title={null} />
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
              <tr className="total">
                <td>סה״כ</td>
                <td className="num"><Money value={f.totals.budget} /></td>
                <td className="num"><Money value={f.totals.incurred} /></td>
                <td className="num"><Money value={f.totals.commitments} /></td>
                <td className="num"><Money value={f.totals.uncommitted} /></td>
                <td className="num"><Money value={f.totals.eac} /></td>
                <td className="num"><Money value={f.totals.variance} signed tone="variance" /></td>
                {paid ? <td className="num"><Money value={f.totals.paid} /></td> : null}
                {qty ? <td /> : null}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack-sm">
        <h3>הנחות פתוחות, שאלות וסיכונים מותנים</h3>
        {f.notes.filter((n) => n.kind !== "assumption").length === 0 ? <span className="muted small">אין נושאים פתוחים בדוח זה.</span> : null}
        <ul className="plain stack-sm small">
          {f.notes
            .filter((n) => n.kind !== "assumption")
            .map((n) => (
              <li key={n.id} className="row">
                <Badge tone={n.kind === "conditional_risk" ? "amber" : n.kind === "opportunity" ? "green" : "navy"}>{n.kind === "conditional_risk" ? "סיכון מותנה" : n.kind === "opportunity" ? "הזדמנות לבדיקה" : n.kind === "open_question" ? "שאלה פתוחה" : "נושא פתוח"}</Badge>
                <span>
                  {n.titleHe}
                  {n.amount != null ? <span> — <Money value={n.amount} /></span> : null}
                </span>
              </li>
            ))}
        </ul>
        <details>
          <summary className="small muted">הנחות תחזית שהתקבלו ({f.notes.filter((n) => n.kind === "assumption").length})</summary>
          <ul className="plain small" style={{ marginTop: 6 }}>
            {f.notes.filter((n) => n.kind === "assumption").map((n) => (
              <li key={n.id}>{n.titleHe}: {n.textHe}</li>
            ))}
          </ul>
        </details>
      </section>

      <div className="row">
        <Button variant="primary" onClick={() => downloadReportWorkbook(report)} guide="attachment">
          הורד Excel — <Bidi>{report.attachmentName}</Bidi>
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            store.dispatch((s) => setChatScope(s, { reportId: report.id, projectId: report.projectId, portfolio: false }));
            navigate(routeWith("chat", { report: report.id }));
            ui.closeAll();
          }}
        >
          שאל על הדוח
        </Button>
        {isReviewer && report.status === "pending_review" ? (
          <Button variant="primary" guide="review-report" onClick={() => store.dispatch((s) => simulateDeliverReport(approveReport(s, report.id, "REVIEWER"), report.id), `הדוח אושר ונמסר ל${recipient?.nameHe} (הדמיה)`)}>
            אשר והעבר ללקוח
          </Button>
        ) : null}
        {isReviewer && report.status === "approved" ? (
          <Button variant="primary" onClick={() => store.dispatch((s) => simulateDeliverReport(s, report.id), "הדוח נמסר (הדמיה)")}>
            העבר ללקוח
          </Button>
        ) : null}
        {!isReviewer && report.status === "pending_review" ? <Notice tone="navy">הדוח בבדיקת צוות הבקרה לפני מסירה.</Notice> : null}
      </div>
      <div className="tiny faint">
        {report.reviewedBy ? `נבדק על ידי ${state.contacts.find((c) => c.id === report.reviewedBy)?.nameHe} · ` : ""}
        {report.deliveredAt ? `נמסר ${formatDateTime(report.deliveredAt)} ל${recipient?.nameHe} ב${report.channel === "email" ? "מייל" : "-WhatsApp"}` : `הופק ${formatDateTime(report.generatedAt)}`}
      </div>
    </div>
  );
}
