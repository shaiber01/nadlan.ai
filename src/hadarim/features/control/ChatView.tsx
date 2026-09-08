import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Chip } from "../../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import { confirmQuote, decide, pkg, revealAllSteps, reviewFindings, route, saveConfig, sendReport } from "../../engine/commands";
import { handleUserText, suggestedQuestionsHe } from "../../engine/conversation";
import type { ChatMessage, ChatOption } from "../../engine/model";
import { FindingCard } from "./FindingCard";
import { dateHe, timeHe } from "./fmt";

const SCENE_7_HE = ["תוסיפי השוואה לבקרה הקודמת ומגמות", "תציגי את הטבלה לפי בניין", "תכיני גרסה לדנה — עמוד אחד"];
const START_HE = "תכיני בקרה תקציבית להדרים";

/** The control conversation: messages, finding cards, progressive steps and the composer. */
export function ChatView() {
  const state = useV2State();
  const ui = useUi();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = state.control.messages;

  // Everything after a steps card that is still "running" stays hidden until the steps are revealed.
  const pendingStepsIdx = messages.findIndex((m) => m.kind === "steps" && m.steps?.some((st) => !st.done));
  const visible = pendingStepsIdx >= 0 ? messages.slice(0, pendingStepsIdx + 1) : messages;
  const pendingSteps = pendingStepsIdx >= 0 ? messages[pendingStepsIdx] : null;
  // Options stay active on every system message after the last user turn (the engine may answer with two
  // option-bearing messages, e.g. a report change followed by the save prompt); earlier ones are consumed.
  const activeOptionIds = useMemo(() => {
    const lastUser = visible.map((m) => m.role).lastIndexOf("user");
    return new Set(visible.filter((m, i) => i > lastUser && m.options?.length).map((m) => m.id));
  }, [visible]);
  const activeOptionsId = useMemo(() => [...visible].reverse().find((m) => m.options?.length && activeOptionIds.has(m.id))?.id ?? null, [visible, activeOptionIds]);
  const doneCount = pendingSteps?.steps?.filter((st) => st.done).length ?? -1;

  useEffect(() => {
    if (pendingSteps && state.control.status === "running") store.playSteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSteps?.id, state.control.status]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: ui.presenter.skipMotion ? "auto" : "smooth", block: "end" });
  }, [visible.length, doneCount, ui.presenter.skipMotion]);

  const run = (fn: (s: typeof state) => typeof state) => {
    try {
      setError(null);
      store.dispatch(fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runAction = (option: ChatOption) => {
    const a = option.action;
    switch (a.type) {
      case "decide":
        return run((s) => decide(s, a.findingId, a.choiceId));
      case "route":
        return run((s) => route(s, a.findingId, a.routeId));
      case "confirm_quote":
        return run((s) => confirmQuote(s, a.findingId, a.accept));
      case "review_findings":
        return run(reviewFindings);
      case "save_config":
        return run((s) => saveConfig(s, a.save));
      case "open_document":
        return store.openDocument(a.documentId);
      case "open_record":
        return store.openRecord({ type: a.recordType, id: a.recordId });
      case "open_report":
        return store.setUi((u) => ({ ...u, control: { ...u.control, pane: "report" } }));
      case "export":
        return store.requestExport(a.format);
      case "send":
        return run((s) => sendReport(s, a.toId));
    }
  };

  const send = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    run((s) => handleUserText(s, trimmed));
    setText("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const activeFinding = useMemo(() => {
    const m = visible.find((x) => x.id === activeOptionsId);
    return m?.kind === "finding" ? state.control.findings.find((f) => f.id === m.findingId) : undefined;
  }, [visible, activeOptionsId, state.control.findings]);

  const suggestions = useMemo(() => {
    switch (state.control.status) {
      case "idle":
        return [START_HE];
      case "running":
        return [];
      case "reviewing":
        if (activeFinding?.kind === "coverage") return ["צריך להזמין. יש הצעה בתיקייה"];
        if (activeFinding?.kind === "allocation") return ["כן, זה שייך לפיתוח"];
        return [];
      case "report":
        return [...SCENE_7_HE.filter((_q, i) => !(i === 0 && state.control.reportConfig.includeTrends) && !(i === 1 && state.control.reportConfig.splitByBuilding) && !(i === 2 && state.control.reportConfig.ceoVersion)), ...suggestedQuestionsHe];
    }
  }, [state.control.status, state.control.reportConfig, activeFinding]);

  const previous = pkg.forecasts.find((f) => f.controlDate === "2026-08-01")!;

  return (
    <div className="h2c-chat">
      <div className="h2c-messages" data-testid="chat-messages">
        {visible.length === 0 ? (
          <div className="h2c-welcome" data-testid="chat-welcome">
            <div className="h2c-welcome-title">בקרה תקציבית · {pkg.project.nameHe}</div>
            <div className="muted">
              הבקרה הקודמת {dateHe(previous.controlDate)} · תחזית {(previous.totalEac / 1_000_000).toFixed(1)} מ׳ ₪ · תקציב {(pkg.project.budgetVersion.amount / 1_000_000).toFixed(1)} מ׳ ₪
            </div>
            <div className="muted small">בקשו בקרה חדשה בשיחה. הבדיקות רצות על הנתונים החיים במערכת המידע.</div>
          </div>
        ) : null}
        {visible.map((m) => (
          <Message key={m.id} message={m} active={activeOptionIds.has(m.id)} onOption={runAction} onFreeText={(t) => run((s) => (state.control.decisions[m.findingId!]?.pending?.kind === "quote" ? confirmQuote(s, m.findingId!, /כן|הוסף|מתאים|תואם/.test(t)) : decide(s, m.findingId!, null, t)))} onSkip={() => { store.stopSteps(); run(revealAllSteps); }} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="h2c-composer no-print">
        {suggestions.length ? (
          <div className="h2c-suggestions">
            {suggestions.map((q) => (
              <Chip key={q} onClick={() => send(q)} data-testid="chat-suggestion">
                {q}
              </Chip>
            ))}
          </div>
        ) : null}
        <form className="h2c-input" onSubmit={submit}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={state.control.status === "running" ? "הבקרה רצה…" : "כתבו הודעה למערכת הבקרה…"} aria-label="הודעה" data-testid="chat-input" />
          <Button type="submit" variant="primary" disabled={!text.trim()} data-testid="chat-send">
            שלח
          </Button>
        </form>
        {error ? (
          <div className="h2c-error" role="alert" data-testid="chat-error">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Message({ message, active, onOption, onFreeText, onSkip }: { message: ChatMessage; active: boolean; onOption: (o: ChatOption) => void; onFreeText: (text: string) => void; onSkip: () => void }) {
  const state = useV2State();
  const wrap = (children: React.ReactNode, extra = "") => (
    <div className={`h2c-msg h2c-msg-${message.role} h2c-msg-${message.kind} ${extra}`.trim()} data-testid="chat-message" data-kind={message.kind} data-role={message.role} data-message-id={message.id}>
      {children}
    </div>
  );
  const time = <span className="h2c-time">{timeHe(message.at)}</span>;
  const options = message.options?.length ? (
    <div className="h2c-msg-options row wrap">
      {message.options.map((o) => (
        <Button key={o.id} size="sm" variant={o.id === message.options![0].id && o.action.type !== "open_document" ? "primary" : "secondary"} disabled={!active} onClick={() => onOption(o)} data-testid={`chat-option-${o.id}`}>
          {o.labelHe}
        </Button>
      ))}
    </div>
  ) : null;

  switch (message.kind) {
    case "steps": {
      const steps = message.steps ?? [];
      const firstUndone = steps.findIndex((st) => !st.done);
      const running = firstUndone >= 0;
      return wrap(
        <div className="h2c-steps">
          <div className="h2c-steps-head">
            <strong>{message.textHe}</strong>
            {running ? (
              <Button size="sm" variant="ghost" onClick={onSkip} data-testid="steps-skip">
                דלג
              </Button>
            ) : null}
          </div>
          <ul>
            {steps.map((st, i) => {
              const isCurrent = i === firstUndone;
              const parts = st.spinner && st.textHe.includes(": ") ? st.textHe.split(": ") : null;
              return (
                <li key={i} className={st.done ? "done" : isCurrent ? "current" : "pending"}>
                  <span className="h2c-step-icon" aria-hidden="true">
                    {st.done ? "✓" : isCurrent ? <span className="h2c-spin" /> : "·"}
                  </span>
                  <span className="h2c-step-text">
                    {parts ? (
                      <>
                        {parts[0]}:
                        <span className="h2c-step-sub">
                          {parts[1].split(" · ").map((c, j) => (
                            <span key={j}>{c}</span>
                          ))}
                        </span>
                      </>
                    ) : (
                      st.textHe
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>,
      );
    }
    case "finding": {
      const finding = state.control.findings.find((f) => f.id === message.findingId);
      if (!finding) return null;
      return wrap(<FindingCard finding={finding} decision={state.control.decisions[finding.id]} active={active} options={message.options ?? []} onOption={onOption} onFreeText={onFreeText} />);
    }
    case "log":
      return wrap(
        <div className="h2c-log">
          <span aria-hidden="true">📄</span> {message.textHe}
        </div>,
      );
    case "answer":
      return wrap(
        <div className="h2c-bubble">
          <p>{message.textHe}</p>
          {message.tableRows?.length ? (
            <table className="h2c-table">
              <thead>
                <tr>{message.tableRows[0].map((c, i) => <th key={i}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {message.tableRows.slice(1).map((row, r) => (
                  <tr key={r}>{row.map((c, i) => <td key={i}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {message.sourcesHe?.length || message.documentId ? (
            <div className="h2c-answer-sources">
              <span className="muted small">מקורות:</span>
              {message.sourcesHe?.map((s, i) => (
                <span key={i} className="h2c-source small">
                  {s}
                </span>
              ))}
              {message.documentId ? (
                <button type="button" className="h2c-source is-link small" onClick={() => store.openDocument(message.documentId!)} data-testid="answer-open-document">
                  פתח מסמך ↗
                </button>
              ) : null}
            </div>
          ) : null}
          {options}
          {time}
        </div>,
      );
    case "report":
      return wrap(
        <div className="h2c-bubble h2c-bubble-report">
          <p>{message.textHe}</p>
          {options}
          {time}
        </div>,
      );
    default:
      return wrap(
        <div className="h2c-bubble">
          <p>{message.textHe}</p>
          {message.documentId ? (
            <button type="button" className="h2c-source is-link small" onClick={() => store.openDocument(message.documentId!)} data-testid="message-open-document">
              פתח מסמך ↗
            </button>
          ) : null}
          {options}
          {time}
        </div>,
      );
  }
}
