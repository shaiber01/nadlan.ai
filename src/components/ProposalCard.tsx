import { useState } from "react";
import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { formatDateTime } from "../domain/dates";
import { approveProposal, overrideProposalCostCode, rejectProposal, retryProposal, simulateWriteFailure, updateProposalDraftPrice } from "../domain/commands/review";
import { setProposalAllocation } from "../domain/commands/scenario-actions";
import { ils, parseMoneyInput, toIls } from "../domain/money";
import type { ChangeProposal } from "../domain/types";
import { EvidenceList } from "./EvidenceList";
import { Badge, BeforeAfter, Bidi, Button, Chip, Field, Notice } from "./primitives";
import { ProposalStatusBadge } from "./StatusBadge";

const WRITE_KINDS = new Set(["erp_correction", "allocation", "accrual", "invoice_match", "credit"]);

export function approveLabel(p: ChangeProposal): string {
  switch (p.kind) {
    case "erp_correction":
    case "allocation":
      return "אשר תיקון";
    case "accrual":
      return "אשר הכרה בעבודה שבוצעה";
    case "invoice_match":
      return "אשר התאמת חשבונית";
    case "credit":
      return "אשר זיכוי";
    case "commitment":
      return "עדכן התחייבות";
    case "forecast":
      return p.evidence.some((e) => e.documentId.startsWith("QUOTE")) ? "עדכן את התחזית לפי ההצעה" : "אשר עדכון תחזית";
    case "draft_budget":
      return "עדכן טיוטה";
    case "duration":
      return "אשר עדכון תחזית";
    case "rule":
      return "אשר כלל";
    case "dismiss_flag":
      return "סגור את הדגל עם הסבר";
  }
}

export function ProposalCard({ proposal, compact, guide }: { proposal: ChangeProposal; compact?: boolean; guide?: string }) {
  const { state } = useDemo();
  const ui = useUi();
  const isReviewer = state.role === "reviewer";
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [overrideCode, setOverrideCode] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [priceText, setPriceText] = useState(() => (proposal.payload.kind === "draft_budget" ? String(toIls(proposal.payload.unitPrice)) : ""));
  const [splitText, setSplitText] = useState<Record<string, string>>(() => (proposal.payload.kind === "allocation" ? Object.fromEntries(proposal.payload.allocations.map((a) => [a.projectId, String(toIls(a.amount))])) : {}));
  const [splitError, setSplitError] = useState<string | null>(null);
  const pendingLike = proposal.status === "pending_review" || proposal.status === "apply_failed" || proposal.status === "approved";
  const finding = proposal.findingId ? state.findings.find((f) => f.id === proposal.findingId) : undefined;
  const codes = state.costCodes.filter((c) => c.projectId === proposal.projectId);

  const approve = () => store.dispatch((s) => approveProposal(s, proposal.id, "REVIEWER"));
  const retry = () => store.dispatch((s) => retryProposal(s, proposal.id));

  const applySplit = () => {
    if (proposal.payload.kind !== "allocation") return;
    const split: Record<string, number> = {};
    for (const [projectId, text] of Object.entries(splitText)) {
      const value = parseMoneyInput(text);
      if (value == null) {
        setSplitError("יש להזין סכומים תקינים");
        return;
      }
      split[projectId] = value;
    }
    setSplitError(null);
    store.dispatch((s) => setProposalAllocation(s, proposal.id, split), "החלוקה בפועל עודכנה בהצעה");
  };

  return (
    <section className={`card ${proposal.status === "apply_failed" ? "accent-red" : proposal.status === "applied" ? "accent-green" : "accent-primary"}`} data-guide={guide} aria-label={proposal.titleHe}>
      <div className="row-between">
        <div className="row">
          <Badge tone="navy">{proposal.labelHe}</Badge>
          <ProposalStatusBadge status={proposal.status} />
          <span className="faint tiny">
            <Bidi className="mono">{proposal.id}</Bidi>
          </span>
        </div>
        {finding ? (
          <Button size="sm" variant="ghost" onClick={() => ui.openFinding(finding.id)}>
            הצג בדיקה
          </Button>
        ) : null}
      </div>
      <h3 style={{ marginTop: 8 }}>{proposal.titleHe}</h3>
      <p className="muted small" style={{ marginTop: 4 }}>
        {proposal.reasonHe}
      </p>
      {proposal.manualNoteHe ? <Notice tone="amber">בחירה ידנית: {proposal.manualNoteHe}</Notice> : null}
      <div style={{ marginTop: 12 }}>
        <BeforeAfter before={proposal.before} after={proposal.after} />
      </div>
      {!compact ? (
        <div style={{ marginTop: 12 }}>
          <EvidenceList evidence={proposal.evidence} />
        </div>
      ) : null}
      {proposal.sourceReplyMessageId ? <div className="small muted" style={{ marginTop: 8 }}>מקור: תשובת הלקוח ({proposal.sourceReplyMessageId}) — ראיה תומכת; העדכון מחייב בדיקה.</div> : null}
      {proposal.status === "apply_failed" && proposal.failure ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="red">
            {proposal.failure.messageHe} (ניסיון {proposal.failure.attempts}, {formatDateTime(proposal.failure.at)}). ההצעה המאושרת נשמרה.
          </Notice>
        </div>
      ) : null}
      {proposal.status === "rejected" ? <div className="small muted" style={{ marginTop: 8 }}>סיבת הדחייה: {proposal.rejectionReasonHe}</div> : null}
      {proposal.status === "applied" ? (
        <div className="small muted" style={{ marginTop: 8 }}>
          יושם {formatDateTime(proposal.appliedAt)} על ידי {state.contacts.find((c) => c.id === proposal.reviewedBy)?.nameHe ?? proposal.reviewedBy}.{" "}
          <Button size="sm" variant="ghost" onClick={() => ui.openHistory({ recordId: proposal.targetIds[0] })}>
            היסטוריה
          </Button>
        </div>
      ) : null}

      {pendingLike && isReviewer ? (
        <div className="stack" style={{ marginTop: 14 }}>
          {proposal.payload.kind === "allocation" && proposal.status === "pending_review" ? (
            <div className="card card-muted stack-sm">
              <div className="small strong">חלוקה בפועל (סה״כ חייב להתאים לסכום החשבונית)</div>
              <div className="row">
                {proposal.payload.allocations.map((a) => (
                  <Field key={a.projectId} label={state.projects.find((p) => p.id === a.projectId)?.nameHe ?? a.projectId}>
                    <input className="input num" value={splitText[a.projectId] ?? ""} onChange={(e) => setSplitText({ ...splitText, [a.projectId]: e.target.value })} inputMode="decimal" />
                  </Field>
                ))}
                <Button size="sm" onClick={applySplit}>
                  עדכן חלוקה
                </Button>
              </div>
              {splitError ? <span className="error-text">{splitError}</span> : null}
              <div className="tiny muted">פריטי התחזית שמומשו נשארים לפי התכנון; שינוי הנחות לחודשים הבאים מחייב החלטת תחזית נפרדת.</div>
            </div>
          ) : null}
          {proposal.payload.kind === "draft_budget" && proposal.status === "pending_review" ? (
            <div className="card card-muted row" data-guide="draft-price">
              <Field label="מחיר ליחידה מעודכן (₪)">
                <input className="input num" value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" />
              </Field>
              <Button
                size="sm"
                onClick={() => {
                  const v = parseMoneyInput(priceText);
                  if (v == null || v <= 0) {
                    store.toast("המחיר חייב להיות מספר חיובי", "error");
                    return;
                  }
                  store.dispatch((s) => updateProposalDraftPrice(s, proposal.id, v), "הסכום חושב מחדש");
                }}
              >
                חשב מחדש
              </Button>
            </div>
          ) : null}
          <div className="row">
            {proposal.status === "apply_failed" ? (
              <Button variant="primary" onClick={retry} guide="approve-proposal">
                נסה שוב
              </Button>
            ) : (
              <Button variant="primary" onClick={approve} guide="approve-proposal">
                {approveLabel(proposal)}
              </Button>
            )}
            <Button variant="danger" onClick={() => setRejecting((v) => !v)}>
              דחה הצעה
            </Button>
            {proposal.payload.kind === "erp_correction" && proposal.payload.changes.costCodeId ? (
              <Button variant="ghost" onClick={() => setOverriding((v) => !v)}>
                בחר סעיף אחר
              </Button>
            ) : null}
            {WRITE_KINDS.has(proposal.kind) && proposal.status !== "apply_failed" ? (
              <Chip active={state.flags.failNextErpWrite} onClick={() => store.dispatch((s) => simulateWriteFailure(s, !s.flags.failNextErpWrite))}>
                הדמה כשל בעדכון
              </Chip>
            ) : null}
          </div>
          {rejecting ? (
            <div className="card card-muted stack-sm">
              <Field label="סיבת הדחייה (נרשמת בהיסטוריה; הנתונים בזיו לא משתנים)">
                <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="row">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!reason.trim()}
                  onClick={() => {
                    store.dispatch((s) => rejectProposal(s, proposal.id, reason.trim(), "REVIEWER"));
                    setRejecting(false);
                  }}
                >
                  אשר דחייה
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  ביטול
                </Button>
              </div>
            </div>
          ) : null}
          {overriding ? (
            <div className="card card-muted stack-sm">
              <Field label="סעיף תקציב">
                <select className="select" value={overrideCode} onChange={(e) => setOverrideCode(e.target.value)}>
                  <option value="">בחר סעיף</option>
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameHe} ({c.id})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="הסבר לבחירה הידנית (חובה)">
                <textarea className="textarea" value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} />
              </Field>
              <div className="row">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!overrideCode || !overrideNote.trim()}
                  onClick={() => {
                    store.dispatch((s) => overrideProposalCostCode(s, proposal.id, overrideCode, overrideNote.trim()), "נוצרה הצעה ידנית לבדיקה");
                    setOverriding(false);
                  }}
                >
                  צור הצעה לבדיקה
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOverriding(false)}>
                  ביטול
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : pendingLike ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="amber">בבדיקת צוות הבקרה — התיקון ייושם בזיו רק לאחר אישור. עברו לתצוגת צוות הבקרה כדי לראות איך הנושא מטופל.</Notice>
        </div>
      ) : null}
      <div className="tiny faint" style={{ marginTop: 10 }}>
        נוצר {formatDateTime(proposal.createdAt)}
        {ils(0) === 0 ? "" : ""}
      </div>
    </section>
  );
}
