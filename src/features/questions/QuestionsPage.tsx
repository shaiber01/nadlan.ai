import { useEffect, useMemo, useState } from "react";
import { navigate, routeWith, useRoute } from "../../app/router";
import { store, useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { ConversationView } from "../../components/ConversationView";
import { Badge, Bidi, Button, Card, Checklist, Chip, EmptyState, Field, Money, Notice, PageHeader, Tabs } from "../../components/primitives";
import { AlertStatusBadge, QuestionStatusBadge } from "../../components/StatusBadge";
import { branding } from "../../config/branding";
import { acknowledgeAlert, reviewAndReleaseAlert, reviewQuestion, sendQuestionBatch, setQuestionContact } from "../../domain/commands/messages";
import { draftSiteQuestion } from "../../domain/commands/scenario-actions";
import { formatDateTime } from "../../domain/dates";
import { contactName, projectName } from "../../domain/state-utils";
import type { Alert, ClientQuestion, Conversation, DemoState, Task } from "../../domain/types";
import { he } from "../../locales/he";
import "./questions.css";

type Tab = "questions" | "messages" | "alerts" | "tasks";
const TABS: Tab[] = ["questions", "messages", "alerts", "tasks"];

const purposeHe: Record<Conversation["purpose"], string> = { clarification: "בירור", alert: "התרעה", report: "דוח" };
const alertKindHe: Record<Alert["kind"], string> = { early_alert: "התרעה מוקדמת", opportunity: "הזדמנות", update: "עדכון" };
const taskKindHe: Record<Task["kind"], string> = { credit_request: "בקשת זיכוי", supplier_clarification: "בירור מול הספק", delivery_followup: "מעקב אספקה" };
const taskStatusHe: Record<Task["status"], [string, "amber" | "green" | "neutral"]> = { open: ["פתוחה", "amber"], done: ["בוצעה", "green"], cancelled: ["בוטלה", "neutral"] };

const OPEN_QUESTION_STATUSES: ClientQuestion["status"][] = ["pending_review", "ready", "sent", "open"];

function findingTitle(state: DemoState, findingId: string): string {
  return state.findings.find((f) => f.id === findingId)?.titleHe ?? "";
}

function findingChecked(state: DemoState, findingId: string): string[] {
  return state.findings.find((f) => f.id === findingId)?.checkedHe ?? [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function QuestionsPage() {
  const { state } = useDemo();
  const route = useRoute();
  const tabParam = route.params.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "questions";
  const isReviewer = state.role === "reviewer";
  const setTab = (next: Tab) => navigate(routeWith("questions", { ...Object.fromEntries(route.params), tab: next }));

  const openQuestionCount = state.questions.filter((q) => OPEN_QUESTION_STATUSES.includes(q.status)).length;
  const alertCount = state.alerts.filter((a) => (isReviewer ? a.status === "pending_review" : a.status === "delivered")).length;
  const openTaskCount = state.tasks.filter((t) => t.status === "open").length;

  return (
    <div className="stack-lg">
      <PageHeader title={he.nav.questions} subtitle="מרכז הודעות אחד: בירורים, התרעות ומסירת דוחות — הכול מוצג בתוך ההדגמה בלבד" />
      <Tabs
        tabs={[
          { id: "questions" as Tab, labelHe: "שאלות ללקוח", count: openQuestionCount },
          { id: "messages" as Tab, labelHe: "מרכז ההודעות", count: state.conversations.length },
          { id: "alerts" as Tab, labelHe: "התרעות", count: alertCount },
          { id: "tasks" as Tab, labelHe: "משימות", count: openTaskCount },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "questions" ? <QuestionsTab draftSite={route.params.get("draft") === "site"} /> : null}
      {tab === "messages" ? <MessagesTab /> : null}
      {tab === "alerts" ? <AlertsTab /> : null}
      {tab === "tasks" ? <TasksTab /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function QuestionsTab({ draftSite }: { draftSite: boolean }) {
  const { state } = useDemo();
  const ui = useUi();
  const isReviewer = state.role === "reviewer";
  const pending = state.questions.filter((q) => q.status === "pending_review" || q.status === "draft");
  const ready = state.questions.filter((q) => q.status === "ready");
  const sentLike = state.questions.filter((q) => ["sent", "open", "answered", "resolved"].includes(q.status)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [siteText, setSiteText] = useState("");
  const activeCode = state.chat.lastContext.costCodeId ? state.costCodes.find((c) => c.id === state.chat.lastContext.costCodeId) : undefined;

  useEffect(() => {
    if (!draftSite) return;
    const codeLabel = activeCode?.nameHe ?? "הפרויקט";
    setSiteText(`כמה עבודה נותרה בשטח בסעיף ${codeLabel}? אין לכך אישור במסמכים.`);
  }, [draftSite, activeCode?.nameHe]);

  const groups = useMemo(() => {
    const map = new Map<string, ClientQuestion[]>();
    for (const q of ready) {
      const arr = map.get(q.contactId) ?? [];
      arr.push(q);
      map.set(q.contactId, arr);
    }
    return [...map.entries()];
  }, [ready]);

  const nothing = pending.length === 0 && ready.length === 0 && sentLike.length === 0;
  const contactOptions = state.contacts.filter((c) => c.id !== "REVIEWER");

  const sendGroup = (contactId: string, questions: ClientQuestion[]) => {
    const ids = questions.filter((q) => !deselected.has(q.id)).map((q) => q.id);
    if (ids.length === 0) {
      store.toast("יש לבחור לפחות שאלה אחת לשליחה", "error");
      return;
    }
    const ok = store.dispatch((s) => sendQuestionBatch(s, ids, contactId), "הבירור נשלח ב-WhatsApp (הדמיה)");
    if (ok) navigate(routeWith("questions", { tab: "messages" }));
  };

  return (
    <div className="stack-lg">
      {draftSite ? (
        <Card title="טיוטת שאלה למנהלת התפעול" accent="primary">
          <div className="stack-sm">
            <Notice tone="navy">{he.general.noSiteInfo}</Notice>
            <Field label="נוסח השאלה (טיוטה פנימית; תישלח רק לאחר בדיקת צוות הבקרה)">
              <textarea className="textarea" value={siteText} onChange={(e) => setSiteText(e.target.value)} />
            </Field>
            <div className="row">
              <Button
                variant="primary"
                disabled={!siteText.trim()}
                onClick={() => {
                  const ok = store.dispatch((s) => draftSiteQuestion(s, s.activeProjectId, siteText.trim()), "נוצרה טיוטה; תישלח רק לאחר בדיקת צוות הבקרה");
                  if (ok) navigate(routeWith("questions", { tab: "questions" }));
                }}
              >
                צור טיוטת שאלה
              </Button>
              <span className="tiny muted">{branding.simulatedDeliveryNote}</span>
            </div>
          </div>
        </Card>
      ) : null}

      {nothing ? <EmptyState>{he.status.noOpenQuestions}</EmptyState> : null}

      {isReviewer && pending.length > 0 ? (
        <section className="stack">
          <div className="section-title">
            <h2>ממתינות לבדיקה</h2>
            <span className="muted small">שאלה יוצאת נבדקת לפני שהיא מצטרפת לבירור המרוכז</span>
          </div>
          {pending.map((q, index) => (
            <Card key={q.id} accent="amber" title={findingTitle(state, q.findingId) || "שאלה ללקוח"}>
              <div className="stack-sm">
                <div className="row">
                  <QuestionStatusBadge status={q.status} />
                  <span className="small muted">
                    ל{contactName(state, q.contactId)} · {projectName(state, q.projectId)}
                  </span>
                  {q.amount != null ? (
                    <span className="small muted">
                      סכום: <Money value={q.amount} />
                    </span>
                  ) : null}
                </div>
                <p>{q.textHe}</p>
                <details>
                  <summary className="small muted">{he.actions.whatWasChecked}</summary>
                  <div style={{ marginTop: 6 }}>
                    <Checklist items={unique([...q.checkedHe, ...findingChecked(state, q.findingId)])} />
                  </div>
                </details>
                <div className="row">
                  <Button variant="primary" size="sm" guide={index === 0 ? "question-review" : undefined} onClick={() => store.dispatch((s) => reviewQuestion(s, q.id, "REVIEWER"), "השאלה נוספה לשאלות המרוכזות")}>
                    אשר והוסף לשאלות המרוכזות
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => ui.openFinding(q.findingId)}>
                    פתח ממצא
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </section>
      ) : null}

      {!isReviewer && pending.length + ready.length > 0 ? (
        <Notice tone="navy">
          {pending.length + ready.length === 1 ? "שאלה אחת" : `${pending.length + ready.length} שאלות`} {he.status.underReview} — יוצגו לאחר אישור ושליחה.
        </Notice>
      ) : null}

      {isReviewer
        ? groups.map(([contactId, questions]) => {
            const checked = unique(questions.flatMap((q) => [...q.checkedHe, ...findingChecked(state, q.findingId)]));
            const selectedCount = questions.filter((q) => !deselected.has(q.id)).length;
            return (
              <Card key={contactId} accent="primary" title={`שאלות מרוכזות ל${contactName(state, contactId)}`}>
                <div className="question-group">
                  <div className="row">
                    <Field label="נמען" hint="מאיה נשארת המתאמת הראשונית; שאלות מחיר אפשר להפנות למנהל הרכש">
                      <select
                        className="select"
                        value={contactId}
                        onChange={(e) => {
                          const next = e.target.value;
                          store.dispatch((s) => questions.reduce((acc, q) => setQuestionContact(acc, q.id, next), s), `הנמען עודכן ל${contactName(state, next)}`);
                        }}
                      >
                        {contactOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nameHe} — {c.roleHe}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <span className="small muted">
                      נבחרו {selectedCount} מתוך {questions.length}
                    </span>
                  </div>
                  {questions.map((q) => (
                    <label key={q.id} className="question-row">
                      <input
                        type="checkbox"
                        checked={!deselected.has(q.id)}
                        onChange={(e) => {
                          const next = new Set(deselected);
                          if (e.target.checked) next.delete(q.id);
                          else next.add(q.id);
                          setDeselected(next);
                        }}
                      />
                      <div className="stack-sm">
                        <span className="small strong">{findingTitle(state, q.findingId)}</span>
                        <span className="small">{q.textHe}</span>
                      </div>
                    </label>
                  ))}
                  <Checklist title={he.actions.whatWasChecked} items={checked} />
                  <div className="row">
                    <Button variant="primary" guide="batch-send" onClick={() => sendGroup(contactId, questions)}>
                      {he.actions.sendBatch}
                    </Button>
                    <span className="tiny muted">{branding.simulatedDeliveryNote}. הודעה אחת עם כל השאלות שנבחרו; לכל שאלה סטטוס ותשובה משלה.</span>
                  </div>
                </div>
              </Card>
            );
          })
        : null}

      {sentLike.length > 0 ? (
        <section className="stack">
          <div className="section-title">
            <h2>נשלחו / פתוחות</h2>
          </div>
          {sentLike.map((q) => {
            const replied = Boolean(q.replyMessageId);
            return (
              <Card key={q.id} title={findingTitle(state, q.findingId) || "שאלה ללקוח"}>
                <div className="stack-sm">
                  <div className="row">
                    <QuestionStatusBadge status={q.status} />
                    <span className="small muted">
                      ל{contactName(state, q.contactId)} · {projectName(state, q.projectId)} · {formatDateTime(q.createdAt)}
                    </span>
                    {!isReviewer && (q.status === "sent" || q.status === "open") ? <Badge tone="amber">ממתין לתשובתך</Badge> : null}
                  </div>
                  <p className="small">{q.textHe}</p>
                  {replied && q.parsedReply ? <div className="small muted">תשובה: {q.parsedReply.messageHe}</div> : null}
                  {q.resolutionHe ? <div className="small muted">סיכום: {q.resolutionHe}</div> : null}
                  <div className="row">
                    {q.conversationId ? (
                      <Button size="sm" variant="primary" onClick={() => ui.openConversation(q.conversationId!)}>
                        פתח שיחה
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => ui.openFinding(q.findingId)}>
                      פתח ממצא
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message center
// ---------------------------------------------------------------------------

type PurposeFilter = "all" | Conversation["purpose"];

function MessagesTab() {
  const { state } = useDemo();
  const [filter, setFilter] = useState<PurposeFilter>("all");
  const sorted = useMemo(() => [...state.conversations].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), [state.conversations]);
  const visible = filter === "all" ? sorted : sorted.filter((c) => c.purpose === filter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0] ?? null;
  const newestId = sorted[0]?.id;

  if (sorted.length === 0) return <EmptyState>{he.general.emptyMessages}</EmptyState>;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          {(
            [
              ["all", "הכול"],
              ["clarification", "בירורים"],
              ["alert", "התרעות"],
              ["report", "דוחות"],
            ] as [PurposeFilter, string][]
          ).map(([id, label]) => (
            <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>
              {label}
            </Chip>
          ))}
        </div>
        <span className="tiny muted">{branding.simulatedDeliveryNote}</span>
      </div>
      {visible.length === 0 ? (
        <EmptyState>{he.status.noResults}</EmptyState>
      ) : (
        <div className="msg-center">
          <div className="msg-list" role="list" aria-label="שיחות">
            {visible.map((c) => {
              const last = c.messages[c.messages.length - 1];
              return (
                <button key={c.id} type="button" role="listitem" className={`conv-item${selected?.id === c.id ? " active" : ""}`} onClick={() => setSelectedId(c.id)} aria-pressed={selected?.id === c.id}>
                  <div className="row">
                    <Badge tone={c.channel === "whatsapp" ? "green" : "navy"}>{c.channel === "whatsapp" ? "WhatsApp" : "מייל"}</Badge>
                    <Badge tone="neutral">{purposeHe[c.purpose]}</Badge>
                  </div>
                  <span className="strong small">{contactName(state, c.contactId)}</span>
                  <span className="excerpt">{last ? last.textHe : "—"}</span>
                  <span className="tiny faint">{formatDateTime(c.updatedAt)}</span>
                </button>
              );
            })}
          </div>
          {selected ? (
            <div className="card stack" data-guide={selected.id === newestId ? "messages-latest" : undefined}>
              <div className="row-between">
                <h3>{selected.titleHe}</h3>
                <span className="tiny muted">
                  <Bidi className="mono">{selected.id}</Bidi>
                </span>
              </div>
              <ConversationView conversation={selected} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function AlertsTab() {
  const { state } = useDemo();
  const alerts = [...state.alerts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (alerts.length === 0) return <EmptyState>אין התרעות עדיין. התרעה מוקדמת נוצרת מבדיקה אוטומטית ומשוחררת ללקוח רק לאחר בדיקת צוות הבקרה.</EmptyState>;
  return (
    <div className="stack">
      {state.role === "reviewer" ? <Notice tone="navy">התרעה מוקדמת ובירור המחיר המקושר הם שני תכנים שונים: ההתרעה נמסרת למנהל החברה, והבירור למנהלת התפעול. שניהם משוחררים לאחר בדיקה — לפני שמופק דוח חדש.</Notice> : null}
      {alerts.map((a, index) => (
        <AlertCard key={a.id} alert={a} first={index === 0} />
      ))}
    </div>
  );
}

function AlertCard({ alert, first }: { alert: Alert; first: boolean }) {
  const { state } = useDemo();
  const ui = useUi();
  const isReviewer = state.role === "reviewer";
  const [combine, setCombine] = useState(false);
  const [recipient, setRecipient] = useState(alert.recipientId);
  const linkedQuestion = alert.linkedQuestionId ? state.questions.find((q) => q.id === alert.linkedQuestionId) : undefined;
  const amounts = (["actualPremium", "futurePremium", "total"] as const).filter((k) => alert.amounts[k] != null);
  const amountLabel: Record<(typeof amounts)[number], string> = { actualPremium: "תוספת בפועל", futurePremium: "תוספת עתידית מותנית", total: "סה״כ בסעיף" };
  const accent = alert.status === "pending_review" ? "amber" : alert.status === "superseded" ? undefined : "primary";
  return (
    <Card accent={accent} title={alert.titleHe}>
      <div className="stack-sm">
        <div className="row">
          <Badge tone={alert.kind === "early_alert" ? "amber" : alert.kind === "opportunity" ? "green" : "navy"}>{alertKindHe[alert.kind]}</Badge>
          <AlertStatusBadge status={alert.status} />
          <span className="small muted">
            ל{contactName(state, alert.recipientId)} ב-{alert.channel === "whatsapp" ? "WhatsApp" : "מייל"} · {projectName(state, alert.projectId)} · {formatDateTime(alert.createdAt)}
          </span>
        </div>
        {isReviewer || alert.status !== "pending_review" ? <p className="small">{alert.textHe}</p> : <Notice tone="navy">{he.status.underReview}</Notice>}
        {amounts.length > 0 ? (
          <div className="row small">
            {amounts.map((k) => (
              <span key={k}>
                {amountLabel[k]}: <Money value={alert.amounts[k]} />
              </span>
            ))}
          </div>
        ) : null}
        <div className="row">
          <Button size="sm" variant="ghost" onClick={() => ui.openCalculation(alert.calculationFindingId)}>
            {he.actions.openCalculation}
          </Button>
          {alert.conversationId ? (
            <Button size="sm" variant="ghost" onClick={() => ui.openConversation(alert.conversationId!)}>
              פתח שיחה
            </Button>
          ) : null}
          {!isReviewer && alert.status === "delivered" ? (
            <Button size="sm" onClick={() => store.dispatch((s) => acknowledgeAlert(s, alert.id))}>
              {he.actions.acknowledge}
            </Button>
          ) : null}
        </div>
        {isReviewer && alert.status === "pending_review" ? (
          <div className="card card-muted stack-sm">
            <div className="row">
              <Field label="נמען ההתרעה">
                <select className="select" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                  {state.contacts
                    .filter((c) => c.id !== "REVIEWER")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameHe} — {c.roleHe}
                      </option>
                    ))}
                </select>
              </Field>
              {linkedQuestion ? (
                <label className="row small">
                  <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
                  <span>שלב את הבירור המקושר באותה הודעה למאיה (במקום שתי הודעות)</span>
                </label>
              ) : null}
            </div>
            {linkedQuestion ? <div className="tiny muted">בירור מקושר ל{contactName(state, linkedQuestion.contactId)}: {linkedQuestion.textHe}</div> : null}
            <div className="row">
              <Button
                variant="primary"
                guide={first ? "alert-release" : undefined}
                onClick={() =>
                  store.dispatch(
                    (s) => reviewAndReleaseAlert({ ...s, alerts: s.alerts.map((x) => (x.id === alert.id ? { ...x, recipientId: combine ? x.recipientId : recipient } : x)) }, alert.id, "REVIEWER", { combineForOps: combine }),
                    "ההתרעה נמסרה ב-WhatsApp (הדמיה)",
                  )
                }
              >
                {he.actions.releaseAlert}
              </Button>
              <span className="tiny muted">{branding.simulatedDeliveryNote}</span>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function TasksTab() {
  const { state } = useDemo();
  const ui = useUi();
  const tasks = [...state.tasks].sort((a, b) => (a.status === b.status ? (a.createdAt < b.createdAt ? 1 : -1) : a.status === "open" ? -1 : 1));
  return (
    <div className="stack" data-guide="task-list">
      {tasks.length === 0 ? (
        <EmptyState>אין משימות פתוחות</EmptyState>
      ) : (
        tasks.map((t) => {
          const [statusLabel, tone] = taskStatusHe[t.status];
          return (
            <Card key={t.id} title={t.titleHe} accent={t.status === "open" ? "amber" : undefined}>
              <div className="stack-sm">
                <div className="row">
                  <Badge tone="navy">{taskKindHe[t.kind]}</Badge>
                  <Badge tone={tone} dot>
                    {statusLabel}
                  </Badge>
                  <span className="small muted">
                    {projectName(state, t.projectId)} · {formatDateTime(t.createdAt)}
                  </span>
                </div>
                <p className="small">{t.descriptionHe}</p>
                <div className="row">
                  {t.recordId ? (
                    <Button size="sm" variant="ghost" onClick={() => ui.openRecord(t.recordId!)}>
                      פתח רשומה <Bidi className="mono">{t.recordId}</Bidi>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => ui.openFinding(t.findingId)}>
                    פתח ממצא
                  </Button>
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
