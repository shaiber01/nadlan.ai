import { useEffect, useRef, useState } from "react";
import { navigate, useRoute } from "../../app/router";
import { store, useDemo } from "../../app/store";
import { EvidenceList } from "../../components/EvidenceList";
import { Badge, Button, Chip, EmptyState, KeyValue, Notice, PageHeader } from "../../components/primitives";
import { askQuestion, clearChat, setChatScope } from "../../domain/commands/chat";
import { formatDate, formatDateTime } from "../../domain/dates";
import { activeProjects } from "../../domain/selectors/financial";
import type { ChatMessage } from "../../domain/types";
import { suggestedQuestionsHe } from "../../intelligence/deterministic/chat";
import { he } from "../../locales/he";
import "./chat.css";

export function ChatPage() {
  const { state } = useDemo();
  const route = useRoute();
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const appliedParams = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = state.chat.scope;
  const projects = activeProjects(state);
  const scopeProjectId = scope.projectId ?? state.activeProjectId;
  const scopeProject = state.projects.find((p) => p.id === scopeProjectId);
  const scopeReport = scope.reportId ? state.reports.find((r) => r.id === scope.reportId) : undefined;
  const deliveredReports = state.reports.filter((r) => r.projectId === state.activeProjectId && r.status === "delivered").sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  const messages = state.chat.messages;
  const lastAssistantIndex = messages.reduce((acc, m, i) => (m.role === "assistant" ? i : acc), -1);

  useEffect(() => {
    if (appliedParams.current) return;
    appliedParams.current = true;
    const reportParam = route.params.get("report");
    const scopeParam = route.params.get("scope");
    const report = reportParam ? state.reports.find((r) => r.id === reportParam) : undefined;
    if (report) {
      store.dispatch((s) => setChatScope(s, { reportId: report.id, projectId: report.projectId, portfolio: false }));
    } else if (scopeParam === "current") {
      store.dispatch((s) => setChatScope(s, { reportId: null, portfolio: false, projectId: s.activeProjectId }));
    }
  }, [route.params, state.reports]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: state.flags.skipMotion ? "auto" : "smooth" });
  }, [messages.length, thinking, state.flags.skipMotion]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const ask = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || thinking) return;
    setText("");
    const run = () => {
      store.dispatch((s) => askQuestion(s, trimmed));
      setThinking(false);
    };
    if (state.flags.skipMotion) {
      run();
      return;
    }
    setThinking(true);
    timerRef.current = setTimeout(run, 200 + Math.floor(Math.random() * 500));
  };

  const scopeLabel = scope.portfolio ? `${he.status.currentScope} · כל הפרויקטים הפעילים` : scopeReport ? `${he.status.reportScope} ${formatDate(scopeReport.reportDate)} (גרסה ${scopeReport.version})` : `${he.status.currentScope} · ${scopeProject?.nameHe ?? ""}`;

  const precedingUserText = (index: number): string => {
    for (let i = index - 1; i >= 0; i -= 1) if (messages[i].role === "user") return messages[i].textHe;
    return "";
  };

  const renderAssistant = (m: ChatMessage, index: number) => {
    const answer = m.answer;
    const isLatest = index === lastAssistantIndex;
    return (
      <div key={m.id} className="chat-msg assistant" data-guide={isLatest ? "chat-answer" : undefined}>
        <div className="headline">{answer?.headlineHe ?? m.textHe}</div>
        {answer?.breakdownHe.length ? (
          <ul className="breakdown">
            {answer.breakdownHe.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
        {answer?.calculationRows?.length ? <KeyValue rows={answer.calculationRows.map((r) => ({ labelHe: r.labelHe, value: r.value }))} /> : null}
        {answer?.qualificationHe ? <Notice tone="amber">{answer.qualificationHe}</Notice> : null}
        {answer?.evidence.length ? <EvidenceList evidence={answer.evidence} /> : null}
        {answer?.needsProjectChoice ? (
          <div className="row">
            {projects.map((p) => (
              <Chip key={p.id} onClick={() => ask(`${precedingUserText(index)} ב${p.shortNameHe}`)}>
                {p.nameHe}
              </Chip>
            ))}
          </div>
        ) : null}
        {answer?.actions.length ? (
          <div className="row">
            {answer.actions.map((a) => (
              <Button key={a.route + a.labelHe} size="sm" variant="ghost" onClick={() => navigate(a.route)}>
                {a.route.includes("questions?draft=site") ? "פתח בירור מול מנהלת התפעול" : a.labelHe}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="meta">
          {answer?.scopeLabelHe ? <span>{answer.scopeLabelHe}</span> : null}
          <span>{formatDateTime(m.at)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="chat-layout">
      <PageHeader
        title={he.nav.chat}
        subtitle="שאלות בשפה טבעית על נתונים עדכניים או על דוח שנבחר; כל תשובה עם חישוב ומקורות"
        actions={
          messages.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => store.dispatch((s) => clearChat(s))}>
              נקה שיחה
            </Button>
          ) : undefined
        }
      />

      <section className="card stack-sm">
        <div className="chat-scope" data-guide="chat-scope" aria-label="היקף השאלות">
          <span className="small muted">היקף:</span>
          <Chip active={!scope.portfolio && !scope.reportId} onClick={() => store.dispatch((s) => setChatScope(s, { reportId: null, portfolio: false, projectId: s.activeProjectId }))}>
            {he.status.currentScope}
          </Chip>
          {deliveredReports.map((r) => (
            <Chip key={r.id} active={scope.reportId === r.id} onClick={() => store.dispatch((s) => setChatScope(s, { reportId: r.id, projectId: r.projectId, portfolio: false }))}>
              {he.status.reportScope} {formatDate(r.reportDate)}
            </Chip>
          ))}
          <Chip active={scope.portfolio} onClick={() => store.dispatch((s) => setChatScope(s, { portfolio: true, reportId: null }))}>
            כל החברה
          </Chip>
        </div>
        <div className="row small">
          <Badge tone={scopeReport ? "amber" : "primary"}>{scopeLabel}</Badge>
          {scopeReport ? <span className="muted">התשובות מסתמכות רק על הרישומים והמסמכים שהיו זמינים במועד הדוח.</span> : <span className="muted">התשובות מחושבות מהמצב הנוכחי של הרישומים.</span>}
        </div>
      </section>

      <section className="card stack">
        <div className="chat-thread" role="log" aria-live="polite">
          {messages.length === 0 && !thinking ? (
            <EmptyState>
              <div className="stack-sm">
                <div>{he.general.emptyChat}</div>
                <div className="tiny">{he.general.unsupported}</div>
              </div>
            </EmptyState>
          ) : null}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={m.id} className="chat-msg user">
                {m.textHe}
              </div>
            ) : (
              renderAssistant(m, i)
            ),
          )}
          {thinking ? <div className="chat-msg thinking">בודק…</div> : null}
          <div ref={endRef} />
        </div>

        <div className="row" aria-label="שאלות מוצעות">
          {suggestedQuestionsHe.map((q) => (
            <Chip key={q} onClick={() => ask(q)}>
              {q}
            </Chip>
          ))}
        </div>

        <form
          className="chat-input"
          data-guide="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="למשל: כמה צפוי לעלות הברזל בהדרים?" aria-label="שאלה" disabled={thinking} />
          <Button type="submit" variant="primary" busy={thinking} disabled={!text.trim()}>
            שאל
          </Button>
        </form>
        <div className="tiny muted">מענה לשאלה אינו משנה נתונים ואינו מאשר הצעות; פעולה מוצעת מובילה למסך הבדיקה המתאים.</div>
      </section>
    </div>
  );
}
