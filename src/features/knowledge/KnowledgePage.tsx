import { useState } from "react";
import { store, useDemo } from "../../app/store";
import { Badge, Bidi, Button, Card, EmptyState, Field, KeyValue, Notice, PageHeader } from "../../components/primitives";
import { RuleView } from "../../components/RuleView";
import { saveApprovedRule } from "../../domain/commands/rules";
import { formatDate } from "../../domain/dates";
import { projectName, supplierName } from "../../domain/state-utils";
import type { ApprovedRule, ChangeProposal, DemoState } from "../../domain/types";
import { he } from "../../locales/he";
import "./knowledge.css";

const statusHe: Record<ApprovedRule["status"], [string, "green" | "amber" | "neutral"]> = {
  active: ["פעיל", "green"],
  expired: ["פג תוקף", "amber"],
  superseded: ["הוחלף", "neutral"],
};

interface RuleCandidate {
  proposal: ChangeProposal;
  recordId: string;
  frameworkId: string;
  supplierId: string | null;
  projectIds: string[];
  defaultValidTo: string;
}

/** Applied allocation proposals that came from a client reply and whose framework has no active rule yet. */
function ruleCandidates(state: DemoState): RuleCandidate[] {
  const out: RuleCandidate[] = [];
  for (const p of state.proposals) {
    const payload = p.payload;
    if (p.kind !== "allocation" || p.status !== "applied" || !p.sourceReplyMessageId || payload.kind !== "allocation") continue;
    const record = state.erpRecords.find((r) => r.id === payload.recordId);
    if (!record) continue;
    const source = state.documents.find((d) => d.id === record.sourceDocumentId);
    const framework = state.documents.find((d) => d.id === source?.facts.contractId && d.kind === "framework");
    if (!framework) continue;
    if (state.approvedRules.some((r) => r.frameworkDocumentId === framework.id && r.status === "active")) continue;
    out.push({ proposal: p, recordId: record.id, frameworkId: framework.id, supplierId: record.supplierId, projectIds: record.allocations.map((al) => al.projectId), defaultValidTo: framework.facts.validUntil ?? "2026-12-31" });
  }
  return out;
}

export function KnowledgePage() {
  const { state } = useDemo();
  const isReviewer = state.role === "reviewer";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rules = [...state.approvedRules].sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1));
  const selected = rules.find((r) => r.id === selectedId) ?? rules[0] ?? null;
  const candidates = isReviewer ? ruleCandidates(state) : [];

  return (
    <div className="stack-lg">
      <PageHeader title={he.nav.knowledge} subtitle="הנחיות מאושרות, מוגבלות בהיקף ובתוקף, עם מקור, תנאים והיסטוריית שימוש" />
      <Notice tone="navy">הנחיה חלה רק על אותה חברה, אותו ספק, אותה מסגרת מדויקת, אותה קבוצת אתרים ובתוך תקופת התוקף. שינוי בהנחיה יוצר גרסה חדשה והגרסה הקודמת נשמרת. ההדגמה מציגה שימוש חוזר אחד שנרשם כאירוע, לא אחוזי אוטומציה נמדדים.</Notice>

      {rules.length === 0 ? (
        <EmptyState>{he.general.emptyRules}</EmptyState>
      ) : (
        <div className="rules-layout">
          <div className="rules-list" role="list" aria-label="הנחיות מאושרות">
            {rules.map((r) => {
              const [label, tone] = statusHe[r.status];
              const reuseCount = r.applications.filter((a) => a.kind === "reuse").length;
              return (
                <Card key={r.id} title={r.titleHe} selected={selected?.id === r.id} onClick={() => setSelectedId(r.id)}>
                  <div className="stack-sm">
                    <div className="row">
                      <Badge tone={tone} dot>
                        {label}
                      </Badge>
                      <Badge tone="navy">גרסה {r.version}</Badge>
                      <span className="tiny faint">
                        <Bidi className="mono">{r.id}</Bidi>
                      </span>
                    </div>
                    <KeyValue
                      rows={[
                        { labelHe: "מסגרת", value: <Bidi className="mono">{r.frameworkDocumentId ?? "—"}</Bidi> },
                        { labelHe: "אתרים", value: r.scope.map((s) => projectName(state, s.projectId)).join(", ") },
                        { labelHe: "יחס חלוקה", value: r.ratio.map((x) => `${x.numerator}/${x.denominator} ${projectName(state, x.projectId)}`).join(" · ") },
                        { labelHe: "תוקף", value: `${formatDate(r.validFrom)} – ${formatDate(r.validTo)}` },
                        { labelHe: "שימושים חוזרים", value: String(reuseCount) },
                      ]}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
          {selected ? (
            <Card title={selected.titleHe}>
              <RuleView rule={selected} />
            </Card>
          ) : null}
        </div>
      )}

      <section className="stack" data-guide="rule-save">
        <div className="section-title">
          <h2>{he.actions.saveRule}</h2>
          <span className="muted small">הנחיה נוצרת רק מהחלטה שאושרה ויושמה, ורק בידי צוות הבקרה</span>
        </div>
        {!isReviewer ? (
          <Notice tone="navy">הנחיות נוצרות בידי צוות הבקרה מתוך החלטות שאושרו (למשל חלוקת חשבונית ציוד לפי תשובת הלקוח). בתצוגת מנהל החברה הרשימה מוצגת לקריאה בלבד.</Notice>
        ) : candidates.length === 0 ? (
          <EmptyState>אין כרגע החלטה מאושרת שממתינה להפיכה להנחיה. לאחר אישור חלוקה לפי תשובת הלקוח (תרחיש 5) היא תופיע כאן.</EmptyState>
        ) : (
          candidates.map((c) => <RuleCandidateCard key={c.proposal.id} candidate={c} />)
        )}
      </section>
    </div>
  );
}

function RuleCandidateCard({ candidate }: { candidate: RuleCandidate }) {
  const { state } = useDemo();
  const [validTo, setValidTo] = useState(candidate.defaultValidTo);
  const [confirmed, setConfirmed] = useState(false);
  const { proposal } = candidate;
  return (
    <Card accent="primary" title={proposal.titleHe}>
      <div className="stack">
        <div className="grid-2">
          <div className="stack-sm">
            <h4 className="muted">החלוקה שאושרה</h4>
            <KeyValue rows={proposal.after.map((r) => ({ labelHe: r.labelHe, value: <Bidi>{r.value}</Bidi> }))} />
          </div>
          <div className="stack-sm">
            <h4 className="muted">היקף ההנחיה</h4>
            <KeyValue
              rows={[
                { labelHe: "חברה", value: state.company.nameHe },
                { labelHe: "ספק", value: supplierName(state, candidate.supplierId) },
                { labelHe: "מסגרת", value: <Bidi className="mono">{candidate.frameworkId}</Bidi> },
                { labelHe: "אתרים", value: candidate.projectIds.map((id) => projectName(state, id)).join(", ") },
                { labelHe: "רשומה", value: <Bidi className="mono">{candidate.recordId}</Bidi> },
              ]}
            />
          </div>
        </div>
        <div className="row">
          <Field label="בתוקף עד">
            <input className="input" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
        </div>
        <label className="row small">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>אני מאשר/ת שהחלוקה הזו מיועדת לחיובים חודשיים עתידיים באותה מסגרת ובאותם אתרים</span>
        </label>
        <div className="row">
          <Button variant="primary" disabled={!confirmed || !validTo} onClick={() => store.dispatch((s) => saveApprovedRule(s, { fromProposalId: proposal.id, validTo, confirmFutureMonthly: true, reviewerId: "REVIEWER" }), "ההנחיה נשמרה")}>
            {he.actions.saveRule}
          </Button>
          <span className="tiny muted">נדרשת בדיקה מחדש אם החוזה, קבוצת האתרים, התכולה או ההסדר התפעולי משתנים.</span>
        </div>
      </div>
    </Card>
  );
}
