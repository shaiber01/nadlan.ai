import { useState, type FormEvent } from "react";
import { Badge, Button } from "../../../components/primitives";
import { store } from "../../app/store";
import { sectionLabel, type HFinding, type HSource } from "../../engine/checks";
import type { ChatOption, FindingDecision } from "../../engine/model";
import { pkg } from "../../engine/commands";
import { FINDING_KIND_HE, dateHe, decisionStatusHe, timeHe } from "./fmt";

const SOURCE_KIND_HE: Record<HSource["kind"], string> = { invoice: "חשבון", po: "הזמנה", contract: "חוזה", document: "מסמך", forecast: "תחזית", boq: "כתב כמויות", changelog: "יומן שינויים", history: "היסטוריה", section: "סעיף" };
const KIND_ACCENT: Record<HFinding["kind"], string> = { allocation: "amber", unit: "navy", price: "red", coverage: "amber" };

/**
 * One finding as the spec's card: הבעיה / המקורות / (הבדיקה) / המשמעות / ההחלטה הנדרשת.
 * Sources are clickable: documents open the viewer at the anchored block, ERP records open the record modal.
 */
export function FindingCard({ finding, decision, active, options, onOption, onFreeText }: { finding: HFinding; decision?: FindingDecision; active: boolean; options: ChatOption[]; onOption: (option: ChatOption) => void; onFreeText: (text: string) => void }) {
  const [text, setText] = useState("");
  const status = decisionStatusHe(decision);
  const resolved = !!decision && decision.status !== "open";
  const chosenLabel = decision?.freeTextHe ?? finding.decision.options.find((o) => o.id === decision?.choiceId)?.labelHe;
  const owner = decision?.ownerId ? pkg.people.find((p) => p.id === decision.ownerId) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onFreeText(value);
    setText("");
  };

  return (
    <article className={`h2c-finding accent-${KIND_ACCENT[finding.kind]}`} data-testid="finding-card" data-kind={finding.kind} data-finding-id={finding.id}>
      <header className="h2c-finding-head">
        <div className="h2c-finding-title">
          <Badge tone={KIND_ACCENT[finding.kind] as "amber" | "navy" | "red"}>ממצא · {FINDING_KIND_HE[finding.kind]}</Badge>
          <h3>{finding.titleHe}</h3>
        </div>
        <div className="h2c-finding-meta">
          <span className="muted small">{sectionLabel(finding.sectionId)}</span>
          <Badge tone={status.tone} dot>
            {status.labelHe}
          </Badge>
        </div>
      </header>

      <section className="h2c-block">
        <h4>הבעיה</h4>
        <p>{finding.problemHe}</p>
      </section>

      <section className="h2c-block">
        <h4>המקורות</h4>
        <ul className="h2c-sources">
          {finding.sources.map((s, i) => (
            <li key={i}>
              <SourceChip source={s} />
            </li>
          ))}
        </ul>
      </section>

      {finding.checkHe ? (
        <section className="h2c-block">
          <h4>הבדיקה</h4>
          <p>{finding.checkHe}</p>
        </section>
      ) : null}

      {finding.detailsTable ? (
        <div className="h2c-table-wrap">
          <table className="h2c-table">
            <thead>
              <tr>{finding.detailsTable[0].map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {finding.detailsTable.slice(1).map((row, r) => (
                <tr key={r}>{row.map((c, i) => <td key={i}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <section className="h2c-block">
        <h4>המשמעות</h4>
        <p>{finding.meaningHe}</p>
        <div className={`h2c-impact h2c-impact-${finding.impact.kind}`}>
          <span className="muted">השפעה על התחזית:</span> <strong>{finding.impact.labelHe}</strong>
        </div>
        {finding.notesHe?.length ? (
          <ul className="h2c-notes">
            {finding.notesHe.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="h2c-block h2c-decision">
        <h4>ההחלטה הנדרשת</h4>
        <p>{finding.decision.questionHe}</p>
        {resolved ? (
          <div className="h2c-decided">
            <div>
              <span className="muted">ההחלטה:</span> <strong>{chosenLabel ?? status.labelHe}</strong>
              {decision?.routeId ? <span className="muted"> · {ROUTE_HE[decision.routeId]}</span> : null}
              {owner ? <span className="muted"> · אחראי: {owner.nameHe}</span> : null}
            </div>
            {decision?.auditHe ? <div className="h2c-audit-line">📄 {decision.auditHe}</div> : null}
            {decision?.verifiedHe ? <div className="h2c-audit-line h2c-verified">✓ אימות: {decision.verifiedHe}</div> : null}
            {decision?.resolvedAt ? (
              <div className="muted small">
                {dateHe(decision.resolvedAt)} {timeHe(decision.resolvedAt)}
              </div>
            ) : null}
          </div>
        ) : decision?.pending ? (
          <div className="h2c-decided muted">
            {chosenLabel ? (
              <>
                <span>ההחלטה:</span> <strong>{chosenLabel}</strong> · ממתין להשלמה בשיחה
              </>
            ) : (
              "ממתין להשלמת ההחלטה בשיחה"
            )}
          </div>
        ) : (
          <div className="h2c-options">
            <div className="row wrap">
              {options.map((o) => (
                <Button key={o.id} variant={o.id === finding.decision.options[0]?.id ? "primary" : "secondary"} size="sm" disabled={!active} onClick={() => onOption(o)} data-testid={`chat-option-${o.id}`}>
                  {o.labelHe}
                </Button>
              ))}
            </div>
            {finding.decision.freeText && active ? (
              <form className="h2c-free" onSubmit={submit}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="או כתבו את ההחלטה במילים שלכם…" aria-label="החלטה בטקסט חופשי" data-testid="finding-free-text" />
                <Button type="submit" size="sm" variant="ghost" disabled={!text.trim()} data-testid="finding-free-send">
                  שלח
                </Button>
              </form>
            ) : null}
          </div>
        )}
      </section>
    </article>
  );
}

const ROUTE_HE: Record<string, string> = { update: "עודכן במערכת המידע", refer_accounting: "הועבר להנהלת חשבונות", forecast_only: "תוקן בתחזית בלבד", refer_roi: "הועבר לרועי לביצוע" };

export function SourceChip({ source }: { source: HSource }) {
  const kindHe = SOURCE_KIND_HE[source.kind];
  const openable = !!source.documentId || source.kind === "invoice" || source.kind === "po" || source.kind === "contract";
  const open = () => {
    if (source.documentId) store.openDocument(source.documentId, source.anchor);
    else if (source.kind === "invoice" || source.kind === "po" || source.kind === "contract") store.openRecord({ type: source.kind, id: source.refId });
  };
  const body = (
    <>
      <span className="h2c-source-kind">{kindHe}</span>
      <span className="h2c-source-label">{source.labelHe}</span>
      {source.fieldHe && source.valueHe ? (
        <span className="h2c-source-field">
          {source.fieldHe}: <bdi>{source.valueHe}</bdi>
        </span>
      ) : null}
    </>
  );
  return openable ? (
    <button type="button" className="h2c-source is-link" onClick={open} data-testid="finding-source" data-source-kind={source.kind} title={source.documentId ? "פתח את המסמך" : "פתח את הרשומה"}>
      {body}
      <span className="h2c-source-open" aria-hidden="true">
        {source.documentId ? "PDF ↗" : "↗"}
      </span>
    </button>
  ) : (
    <span className="h2c-source" data-testid="finding-source" data-source-kind={source.kind}>
      {body}
    </span>
  );
}
