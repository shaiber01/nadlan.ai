import { useState } from "react";
import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { expireRule } from "../domain/commands/rules";
import { formatDate, formatDateTime } from "../domain/dates";
import type { ApprovedRule } from "../domain/types";
import { EvidenceList } from "./EvidenceList";
import { Badge, Bidi, Button, Field, KeyValue, Notice } from "./primitives";

export function RuleView({ rule }: { rule: ApprovedRule }) {
  const { state } = useDemo();
  const ui = useUi();
  const [expiring, setExpiring] = useState(false);
  const [validTo, setValidTo] = useState(rule.validTo);
  const tone = rule.status === "active" ? "green" : rule.status === "expired" ? "amber" : "neutral";
  return (
    <div className="stack-lg">
      <div className="row">
        <Badge tone={tone} dot>{rule.status === "active" ? "פעיל" : rule.status === "expired" ? "פג תוקף" : "הוחלף"}</Badge>
        <Badge tone="navy">גרסה {rule.version}</Badge>
        <span className="tiny faint"><Bidi className="mono">{rule.id}</Bidi></span>
      </div>
      <p>{rule.descriptionHe}</p>
      <KeyValue
        rows={[
          { labelHe: "חברה", value: state.company.nameHe },
          { labelHe: "ספק", value: state.suppliers.find((s) => s.id === rule.supplierId)?.nameHe ?? "—" },
          { labelHe: "מסגרת", value: <Bidi className="mono">{rule.frameworkDocumentId ?? "—"}</Bidi> },
          { labelHe: "היקף", value: rule.scope.map((s) => `${state.projects.find((p) => p.id === s.projectId)?.nameHe} / ${s.costCodeId}`).join(", ") },
          { labelHe: "יחס חלוקה", value: rule.ratio.map((r) => `${r.numerator}/${r.denominator} ${state.projects.find((p) => p.id === r.projectId)?.nameHe}`).join(" · ") },
          { labelHe: "תוקף", value: `${formatDate(rule.validFrom)} – ${formatDate(rule.validTo)}` },
          { labelHe: "אושר", value: `${state.contacts.find((c) => c.id === rule.approvedBy)?.nameHe ?? rule.approvedBy}, ${formatDateTime(rule.approvedAt)}` },
        ]}
      />
      <div className="stack-sm">
        <h4 className="muted">תנאים</h4>
        <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
          {rule.conditionsHe.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
      <EvidenceList evidence={rule.sourceEvidence} title="מקור ההנחיה" />
      <div className="stack-sm" data-guide="rule-history">
        <h4 className="muted">היסטוריה</h4>
        <div className="timeline">
          {rule.applications.map((a) => (
            <div key={a.id} className="timeline-item">
              <div className="stack-sm">
                <div className="row">
                  <Badge tone={a.kind === "origin" ? "navy" : "green"}>{a.kind === "origin" ? "ההחלטה המקורית" : "שימוש חוזר"}</Badge>
                  <span className="when">{formatDateTime(a.at)}</span>
                </div>
                <div className="small">{a.noteHe}</div>
                <div className="row">
                  <Button size="sm" variant="ghost" onClick={() => ui.openRecord(a.recordId)}>
                    רשומה <Bidi>{a.recordId}</Bidi>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => ui.openProposal(a.proposalId)}>
                    הצעה <Bidi>{a.proposalId}</Bidi>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {rule.applications.length === 1 ? <Notice tone="navy">יצירת ההנחיה מהחלטה קודמת אינה יישום אוטומטי; השימוש החוזר הראשון יופיע כאן בנפרד.</Notice> : null}
      </div>
      {state.role === "reviewer" && rule.status === "active" ? (
        <div className="stack-sm">
          {!expiring ? (
            <Button size="sm" variant="ghost" onClick={() => setExpiring(true)}>
              עדכן תוקף
            </Button>
          ) : (
            <div className="row">
              <Field label="בתוקף עד">
                <input className="input" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </Field>
              <Button size="sm" variant="primary" onClick={() => store.dispatch((s) => expireRule(s, rule.id, validTo, "REVIEWER"), "תוקף ההנחיה עודכן")}>
                שמור
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExpiring(false)}>
                ביטול
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
