import { useMemo, useState } from "react";
import { useRoute } from "../../app/router";
import { useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { documentKindHe } from "../../components/EvidenceList";
import { QuestionStatusBadge } from "../../components/StatusBadge";
import { Badge, Bidi, Button, Chip, EmptyState, PageHeader } from "../../components/primitives";
import { formatDate, formatDateTime } from "../../domain/dates";
import { projectName, supplierName } from "../../domain/state-utils";
import type { DocumentKind, SourceDocument } from "../../domain/types";
import { he } from "../../locales/he";

const KIND_ORDER: DocumentKind[] = ["invoice", "delivery_note", "purchase_order", "contract", "addendum", "change_order", "certificate", "approval", "credit", "quote", "plan", "schedule", "framework", "budget", "opening_balance", "forecast", "commitment_balance", "reply"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[״"'’‘“”]/g, "")
    .replace(/[‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function DocumentsPage() {
  const { state } = useDemo();
  const ui = useUi();
  const route = useRoute();
  const [query, setQuery] = useState(route.params.get("q") ?? "");
  const [projectFilter, setProjectFilter] = useState(route.params.get("project") ?? "all");
  const [kindFilter, setKindFilter] = useState(route.params.get("kind") ?? "all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [showGenerated, setShowGenerated] = useState(false);

  const latestById = useMemo(() => {
    const map = new Map<string, SourceDocument>();
    for (const d of state.documents) {
      const current = map.get(d.id);
      if (!current || d.version > current.version) map.set(d.id, d);
    }
    return map;
  }, [state.documents]);

  const supersededIds = useMemo(() => new Set(state.documents.filter((d) => d.supersedesId).map((d) => d.supersedesId as string)), [state.documents]);
  const versionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of state.documents) counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    return counts;
  }, [state.documents]);

  const availableKinds = useMemo(() => {
    const kinds = new Set<DocumentKind>();
    for (const d of latestById.values()) kinds.add(d.kind);
    return KIND_ORDER.filter((k) => kinds.has(k));
  }, [latestById]);

  const documents = useMemo(() => {
    const q = normalize(query);
    return [...latestById.values()]
      .filter((d) => showGenerated || !d.generated)
      .filter((d) => projectFilter === "all" || d.projectIds.includes(projectFilter))
      .filter((d) => kindFilter === "all" || d.kind === kindFilter)
      .filter((d) => supplierFilter === "all" || (supplierFilter === "none" ? d.supplierId === null : d.supplierId === supplierFilter))
      .filter((d) => {
        if (!q) return true;
        const haystack = normalize([d.id, d.titleHe, d.bidderHe ?? "", ...d.anchors.map((a) => a.text)].join(" "));
        return haystack.includes(q);
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  }, [latestById, query, projectFilter, kindFilter, supplierFilter, showGenerated]);

  const replies = useMemo(
    () =>
      state.conversations
        .flatMap((c) => c.messages.filter((m) => m.direction === "inbound").map((m) => ({ conversation: c, message: m })))
        .sort((a, b) => (a.message.at < b.message.at ? 1 : a.message.at > b.message.at ? -1 : 0)),
    [state.conversations],
  );

  const hasFilters = query !== "" || projectFilter !== "all" || kindFilter !== "all" || supplierFilter !== "all";

  return (
    <div className="stack-lg">
      <PageHeader title={he.nav.documents} subtitle="חשבוניות, חוזים, תעודות משלוח, הצעות מחיר, יתרות פתיחה, תחזיות ותשובות מאושרות — כולם סינתטיים" />

      <div className="row" role="search" aria-label="חיפוש וסינון מסמכים">
        <input className="input" style={{ minWidth: 260 }} type="search" placeholder="חיפוש לפי מזהה, כותרת או טקסט המסמך" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="חיפוש מסמכים" />
        <label className="row small muted" style={{ gap: 6 }}>
          <span>{he.general.project}</span>
          <select className="select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="all">{he.general.all}</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameHe}
              </option>
            ))}
          </select>
        </label>
        <label className="row small muted" style={{ gap: 6 }}>
          <span>סוג</span>
          <select className="select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">{he.general.all}</option>
            {availableKinds.map((k) => (
              <option key={k} value={k}>
                {documentKindHe(k)}
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
            <option value="none">ללא ספק</option>
          </select>
        </label>
        <Chip active={showGenerated} onClick={() => setShowGenerated((v) => !v)}>
          הצג גם מסמכים שנוצרו מהרישומים
        </Chip>
        {hasFilters ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery("");
              setProjectFilter("all");
              setKindFilter("all");
              setSupplierFilter("all");
            }}
          >
            נקה סינון
          </Button>
        ) : null}
      </div>

      {documents.length === 0 ? (
        <EmptyState>{he.general.emptyDocuments}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>מזהה</th>
                <th>סוג</th>
                <th>כותרת</th>
                <th>{he.general.date}</th>
                <th>ספק / מציע</th>
                <th>פרויקטים</th>
                <th className="num">{he.general.version}</th>
                <th>סימונים</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr
                  key={d.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => ui.openDocument(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      ui.openDocument(d.id);
                    }
                  }}
                  aria-label={`${d.titleHe} — פתח מסמך`}
                >
                  <td>
                    <Bidi className="mono">{d.id}</Bidi>
                  </td>
                  <td>
                    <Badge tone="navy">{documentKindHe(d.kind)}</Badge>
                  </td>
                  <td>
                    <Bidi>{d.titleHe}</Bidi>
                  </td>
                  <td className="nowrap">{formatDate(d.date)}</td>
                  <td className="small">{d.supplierId ? supplierName(state, d.supplierId) : d.bidderHe ? d.bidderHe : <span className="faint">—</span>}</td>
                  <td className="small">{d.projectIds.map((id) => projectName(state, id)).join(", ")}</td>
                  <td className="num">
                    {d.version}
                    {(versionCounts.get(d.id) ?? 1) > 1 ? <span className="faint tiny"> / {versionCounts.get(d.id)}</span> : null}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {supersededIds.has(d.id) ? <Badge tone="amber">הוחלף</Badge> : null}
                      {d.scenarioOnly ? <Badge tone="neutral">מסמך תרחיש</Badge> : null}
                      {d.generated ? <Badge tone="neutral">נוצר מהרישומים</Badge> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tiny muted">
        {documents.length} מסמכים מוצגים. מסמכי מקור אינם ניתנים לעריכה; סטטוס תשלום והתאמה מוצגים כהערות מערכת מחוץ למסמך.
      </div>

      <section className="stack">
        <div className="section-title">
          <h2>תשובות מאושרות של הלקוח</h2>
          <span className="muted small">תשובות הלקוח הן ראיות בלתי ניתנות לשינוי; הצעה שנוצרה מתשובה עדיין נבדקת על ידי צוות הבקרה</span>
        </div>
        {replies.length === 0 ? (
          <EmptyState>טרם התקבלו תשובות מהלקוח</EmptyState>
        ) : (
          <div className="stack-sm">
            {replies.map(({ conversation, message }) => {
              const question = state.questions.find((q) => q.replyMessageId === message.id) ?? (message.questionId ? state.questions.find((q) => q.id === message.questionId) : undefined);
              const contact = state.contacts.find((c) => c.id === message.authorId) ?? state.contacts.find((c) => c.id === conversation.contactId);
              return (
                <div key={message.id} className="card stack-sm">
                  <div className="row-between">
                    <div className="row">
                      <Badge tone={conversation.channel === "whatsapp" ? "green" : "navy"}>{conversation.channel === "whatsapp" ? "WhatsApp" : "מייל"}</Badge>
                      <span className="strong">{contact?.nameHe ?? message.authorId}</span>
                      {contact?.roleHe ? <span className="muted small">{contact.roleHe}</span> : null}
                      <span className="faint tiny">
                        <Bidi>{formatDateTime(message.at)}</Bidi>
                      </span>
                      <span className="faint tiny">
                        <Bidi className="mono">{message.id}</Bidi>
                      </span>
                    </div>
                    <div className="row">
                      {question ? <QuestionStatusBadge status={question.status} /> : null}
                      <Button size="sm" variant="ghost" onClick={() => ui.openConversation(conversation.id)}>
                        פתח שיחה
                      </Button>
                    </div>
                  </div>
                  <p className="text-pre">{message.textHe}</p>
                  {question ? <div className="tiny muted">בתשובה לשאלה: {question.textHe}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
