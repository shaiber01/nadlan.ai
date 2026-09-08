import { useState } from "react";
import { navigate, routeWith } from "../app/router";
import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { formatDateTime } from "../domain/dates";
import { reviewAndReleaseAlert, reviewQuestion } from "../domain/commands/messages";
import { dismissFinding } from "../domain/commands/review";
import type { Finding } from "../domain/types";
import { EvidenceList } from "./EvidenceList";
import { Badge, Bidi, Button, Checklist, Field, Money, Notice } from "./primitives";
import { ProposalCard } from "./ProposalCard";
import { AlertStatusBadge, FindingStatusBadge, QuestionStatusBadge, SeverityBadge } from "./StatusBadge";

/** One analyzed finding with what was checked, evidence, and the proposals/questions/alerts it produced. */
export function FindingCard({ finding, showProposals = true, guide }: { finding: Finding; showProposals?: boolean; guide?: string }) {
  const { state } = useDemo();
  const ui = useUi();
  const isReviewer = state.role === "reviewer";
  const [dismissing, setDismissing] = useState(false);
  const [explanation, setExplanation] = useState("");
  const proposals = state.proposals.filter((p) => finding.proposalIds.includes(p.id) && p.status !== "superseded");
  const questions = state.questions.filter((q) => finding.questionIds.includes(q.id));
  const alerts = state.alerts.filter((a) => finding.alertIds.includes(a.id));
  const tasks = state.tasks.filter((t) => finding.taskIds.includes(t.id));
  const code = finding.costCodeId ? state.costCodes.find((c) => c.id === finding.costCodeId) : null;
  const project = state.projects.find((p) => p.id === finding.projectId);
  const accent = finding.severity === "urgent" ? "red" : finding.severity === "opportunity" ? "green" : finding.severity === "risk" ? "amber" : "primary";
  // The manager sees what was found and checked; outgoing question/alert texts stay "בבדיקת צוות הבקרה" until released.
  const managerSeesDetails = true;
  const hasUnreleasedOutbound = !isReviewer && (alerts.some((a) => a.status === "pending_review" || a.status === "draft") || questions.some((q) => ["draft", "pending_review", "ready"].includes(q.status)));

  return (
    <section className={`card accent-${accent}`} data-guide={guide} aria-label={finding.titleHe}>
      <div className="row-between">
        <div className="row">
          <SeverityBadge severity={finding.severity} />
          <FindingStatusBadge status={finding.status} />
          {finding.blocksReport && !["resolved", "dismissed", "superseded"].includes(finding.status) ? <Badge tone="red">חוסם מסירת דוח</Badge> : null}
          <span className="faint tiny">
            {project?.nameHe}
            {code ? ` · ${code.nameHe}` : ""}
          </span>
        </div>
        <span className="faint tiny">{formatDateTime(finding.createdAt)}</span>
      </div>
      <h3 style={{ marginTop: 8 }}>{finding.titleHe}</h3>
      {hasUnreleasedOutbound ? (
        <div style={{ marginTop: 8 }}>
          <Notice tone="navy">בבדיקת צוות הבקרה — ההתרעה או השאלה ללקוח ישוחררו לאחר האישור.</Notice>
        </div>
      ) : null}
      {managerSeesDetails ? (
        <>
          <p style={{ marginTop: 8 }}>{finding.explanationHe}</p>
          {finding.resolutionHe ? <p className="small muted" style={{ marginTop: 6 }}>סיכום: {finding.resolutionHe}</p> : null}
          {finding.kind === "price_risk" ? (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="small">
                תוספת בפועל <Money value={finding.amounts.actualPremium ?? 0} /> · תוספת עתידית מותנית <Money value={finding.amounts.futurePremium ?? 0} /> · סה״כ <Money value={finding.amounts.total ?? 0} />
              </span>
              <Button size="sm" variant="ghost" onClick={() => ui.openCalculation(finding.id)} guide="open-calculation">
                הצג השפעה על יתרת הפרויקט
              </Button>
            </div>
          ) : null}
          {finding.kind === "cross_project_opportunity" && finding.amounts.opportunity ? (
            <div className="small" style={{ marginTop: 8 }}>
              הזדמנות אפשרית <Money value={finding.amounts.opportunity} /> — אינה משנה את התחזית המאושרת עד להצעה תקפה ולאישור.
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Checklist title="מה כבר נבדק" items={finding.checkedHe} />
          </div>
          <div style={{ marginTop: 12 }}>
            <EvidenceList evidence={finding.evidence} />
          </div>
        </>
      ) : null}

      {alerts.length > 0 ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          {alerts.map((a) => (
            <div key={a.id} className="card card-muted row-between">
              <div className="row">
                <Badge tone="amber">התרעה מוקדמת</Badge>
                <AlertStatusBadge status={a.status} />
                <span className="small">ל{state.contacts.find((c) => c.id === a.recipientId)?.nameHe} ב-WhatsApp</span>
              </div>
              <div className="row">
                {a.conversationId ? (
                  <Button size="sm" variant="ghost" onClick={() => ui.openConversation(a.conversationId!)}>
                    פתח שיחה
                  </Button>
                ) : null}
                {isReviewer && a.status === "pending_review" ? (
                  <Button size="sm" variant="primary" guide="alert-release" onClick={() => store.dispatch((s) => reviewAndReleaseAlert(s, a.id, "REVIEWER"), "ההתרעה נמסרה ב-WhatsApp (הדמיה)")}>
                    אשר ושחרר התרעה
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {questions.length > 0 ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          {questions.map((q) => (
            <div key={q.id} className="card card-muted stack-sm">
              <div className="row-between">
                <div className="row">
                  <Badge tone="navy">שאלה ללקוח</Badge>
                  <QuestionStatusBadge status={q.status} />
                  <span className="small">ל{state.contacts.find((c) => c.id === q.contactId)?.nameHe}</span>
                </div>
                <div className="row">
                  {isReviewer && q.status === "pending_review" ? (
                    <Button size="sm" variant="primary" onClick={() => store.dispatch((s) => reviewQuestion(s, q.id, "REVIEWER"), "השאלה נוספה לשאלות המרוכזות")}>
                      אשר והוסף לשאלות המרוכזות
                    </Button>
                  ) : null}
                  {q.conversationId ? (
                    <Button size="sm" variant="ghost" onClick={() => ui.openConversation(q.conversationId!)}>
                      פתח שיחה
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => navigate(routeWith("questions", {}))}>
                      שאלות ותשובות
                    </Button>
                  )}
                </div>
              </div>
              {isReviewer || ["sent", "answered", "open", "resolved"].includes(q.status) ? <p className="small">{q.textHe}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          {tasks.map((t) => (
            <div key={t.id} className="card card-muted row-between">
              <span className="small">
                <Badge tone={t.status === "done" ? "green" : "amber"}>{t.status === "done" ? "בוצע" : "משימה פתוחה"}</Badge> {t.titleHe} — {t.descriptionHe}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {showProposals && proposals.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} compact />
          ))}
        </div>
      ) : null}

      {isReviewer && !["resolved", "dismissed", "superseded"].includes(finding.status) ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          {!dismissing ? (
            <Button size="sm" variant="ghost" onClick={() => setDismissing(true)}>
              סגור ממצא עם הסבר
            </Button>
          ) : (
            <div className="card card-muted stack-sm">
              <Field label="הסבר לסגירה (נדרש; נרשם בהיסטוריה)">
                <textarea className="textarea" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </Field>
              <div className="row">
                <Button size="sm" variant="primary" disabled={!explanation.trim()} onClick={() => store.dispatch((s) => dismissFinding(s, finding.id, explanation.trim(), "REVIEWER"))}>
                  סגור
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDismissing(false)}>
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      <div className="tiny faint" style={{ marginTop: 8 }}>
        <Bidi className="mono">{finding.id}</Bidi>
      </div>
    </section>
  );
}
