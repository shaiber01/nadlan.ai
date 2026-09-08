import { useEffect, useRef, useState } from "react";
import { branding } from "../config/branding";
import { navigate, routeWith } from "../app/router";
import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { acknowledgeAlert, recordClientReply } from "../domain/commands/messages";
import { formatDateTime } from "../domain/dates";
import type { Conversation, Message } from "../domain/types";
import { Badge, Bidi, Button, Chip, Notice } from "./primitives";
import { downloadReportWorkbook } from "./ReportView";

/** In-app WhatsApp-like thread or email list, with the reply composer for open client questions. */
export function ConversationView({ conversation }: { conversation: Conversation }) {
  const { state } = useDemo();
  const ui = useUi();
  const contact = state.contacts.find((c) => c.id === conversation.contactId);
  const openQuestions = state.questions.filter((q) => q.conversationId === conversation.id && (q.status === "sent" || q.status === "open"));
  const activeQuestion = openQuestions[openQuestions.length - 1];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.messages.length]);
  useEffect(() => setText(""), [activeQuestion?.id]);

  const send = (value: string) => {
    if (!activeQuestion || !value.trim()) return;
    setBusy(true);
    setTimeout(() => {
      store.dispatch((s) => recordClientReply(s, activeQuestion.id, value.trim()));
      setBusy(false);
    }, state.flags.skipMotion ? 0 : 250);
  };
  const validation = activeQuestion?.parsedReply && !activeQuestion.parsedReply.ok && !activeQuestion.replyMessageId ? activeQuestion.parsedReply.messageHe : activeQuestion?.parsedReply && !activeQuestion.parsedReply.ok && activeQuestion.status === "sent" ? activeQuestion.parsedReply.messageHe : null;

  const renderActions = (m: Message) =>
    m.actions?.length ? (
      <div className="actions">
        {m.actions.map((a) => (
          <Button
            key={a.action + a.targetId}
            size="sm"
            variant="ghost"
            onClick={() => {
              if (a.action === "open_calculation") ui.openCalculation(a.targetId);
              else if (a.action === "open_question") {
                const q = state.questions.find((x) => x.id === a.targetId);
                if (q?.conversationId && q.conversationId !== conversation.id) ui.openConversation(q.conversationId);
                else if (!q?.conversationId) navigate(routeWith("questions", {}));
              } else if (a.action === "open_report") ui.openReport(a.targetId);
            }}
          >
            {a.labelHe}
          </Button>
        ))}
      </div>
    ) : null;

  if (conversation.channel === "email") {
    return (
      <div className="stack">
        <div className="tiny muted">{branding.simulatedDeliveryNote}</div>
        {conversation.messages
          .slice()
          .reverse()
          .map((m) => {
            const report = m.reportId ? state.reports.find((r) => r.id === m.reportId) : undefined;
            return (
              <div key={m.id} className="email-item stack-sm">
                <div className="row-between">
                  <div className="subject">{report ? `דוח בקרה שבועי — ${report.frozen.projectNameHe} — ${report.reportDate.split("-").reverse().join("/")}` : "הודעה"}</div>
                  <span className="tiny faint">{formatDateTime(m.at)}</span>
                </div>
                <div className="tiny muted">
                  מאת: {branding.emailSender} &lt;<Bidi>{branding.emailSenderAddress}</Bidi>&gt; · אל: {contact?.nameHe} &lt;<Bidi>{contact?.email}</Bidi>&gt;
                </div>
                <p className="text-pre">{m.textHe}</p>
                {m.attachments.map((att) => (
                  <div key={att.id} className="row">
                    <span className="attachment">
                      📎 <Bidi>{att.filename}</Bidi>
                    </span>
                    <Button size="sm" onClick={() => report && downloadReportWorkbook(report)} guide="attachment">
                      הורד את הקובץ המצורף
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => ui.openReport(att.reportId)}>
                      פתח את הדוח
                    </Button>
                  </div>
                ))}
                {renderActions(m)}
              </div>
            );
          })}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <Badge tone="green">WhatsApp</Badge>
          <span className="small">
            {branding.whatsappSenderName} ↔ {contact?.nameHe} ({contact?.roleHe})
          </span>
        </div>
        <span className="tiny muted">{branding.simulatedDeliveryNote}</span>
      </div>
      <div className="wa-thread" role="log" aria-label="שיחת WhatsApp מדומה">
        {conversation.messages.map((m) => {
          const report = m.reportId ? state.reports.find((r) => r.id === m.reportId) : undefined;
          const alert = m.alertId ? state.alerts.find((a) => a.id === m.alertId) : undefined;
          return (
            <div key={m.id} className={`wa-bubble ${m.direction === "inbound" ? "inbound" : m.kind === "update" ? "update" : ""}`}>
              {m.textHe}
              {m.attachments.map((att) => (
                <div key={att.id} className="row" style={{ marginTop: 6 }}>
                  <span className="attachment">
                    📎 <Bidi>{att.filename}</Bidi>
                  </span>
                  <Button size="sm" onClick={() => report && downloadReportWorkbook(report)} guide="attachment">
                    הורד
                  </Button>
                </div>
              ))}
              {renderActions(m)}
              <div className="meta">
                <span>{m.direction === "inbound" ? contact?.nameHe : branding.whatsappSenderName}</span>
                <span>{formatDateTime(m.at)}</span>
                {alert && alert.status === "delivered" && state.role === "manager" ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.dispatch((s) => acknowledgeAlert(s, alert.id))}>
                    קראתי
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {activeQuestion ? (
        state.role === "manager" ? (
          <div className="card stack-sm" data-guide="reply-box">
            <div className="small strong">השב כ{contact?.nameHe}</div>
            {activeQuestion.suggestedReplies.length > 0 ? (
              <div className="row">
                {activeQuestion.suggestedReplies.map((r) => (
                  <Chip key={r.id} onClick={() => setText(r.textHe)} active={text === r.textHe}>
                    {r.textHe}
                  </Chip>
                ))}
              </div>
            ) : null}
            <textarea className={`textarea${validation ? " invalid" : ""}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="אפשר לבחור תשובה מוצעת או לכתוב תשובה משלכם" />
            {validation ? <span className="error-text">{validation}</span> : null}
            <div className="row">
              <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => send(text)}>
                שלח תשובה
              </Button>
              <span className="tiny muted">{branding.simulatedDeliveryNote}. תשובה תקינה נרשמת כראיה ומועברת לבדיקת צוות הבקרה.</span>
            </div>
          </div>
        ) : (
          <Notice tone="navy">ממתין לתשובת הלקוח. עברו לתצוגת מנהל החברה כדי לענות כ{contact?.nameHe}.</Notice>
        )
      ) : null}
    </div>
  );
}
