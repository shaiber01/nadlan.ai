import { useState, type FormEvent } from "react";
import { Button } from "../../components/primitives";
import { store, useUi } from "../../app/store";
import { BUDGET_CHANGE_KIND_HE, type HBudgetChange, type PersonId, type SectionId } from "../../data/types";
import { pkg } from "../../engine/commands";
import { dateHe, defaultActor, nis, personName, sectionShort } from "./format";

/**
 * Approved budget changes in the ERP: the list, and a form to key one in (transfer between sections, addition,
 * reduction) with the approver. The original budget never changes; the report shows original, changes and
 * updated budget. Online only — the database trigger logs every change.
 */
export function BudgetChangesPanel() {
  const ui = useUi();
  const online = ui.db.status === "online";
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; textHe: string } | null>(null);
  const rows = [...pkg.budgetChanges].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));

  return (
    <section className="erp-subsection" data-testid="erp-budget-changes">
      <div className="erp-screen-head">
        <h3>שינויי תקציב מאושרים</h3>
        <div className="erp-actions">
          <Button size="sm" variant="primary" onClick={() => setOpen((v) => !v)} data-testid="erp-budget-change-toggle">
            {open ? "סגור טופס" : "＋ שינוי תקציב"}
          </Button>
        </div>
      </div>
      {open ? (
        <ChangeForm
          online={online}
          onDone={(c) => {
            setOpen(false);
            setMessage({ tone: "ok", textHe: `${c.id} נרשם: ${BUDGET_CHANGE_KIND_HE[c.kind]} · ${nis(c.amount)} · אישר ${personName(c.approvedById)}. התקציב המעודכן מוצג בטבלה ובדוח הבקרה.` });
          }}
          onError={(textHe) => setMessage({ tone: "error", textHe })}
        />
      ) : null}
      {message ? (
        <div className={`erp-notice erp-notice-${message.tone}`} role={message.tone === "error" ? "alert" : "status"} data-testid="erp-budget-change-message">
          {message.textHe}
        </div>
      ) : null}
      {rows.length ? (
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>מזהה</th>
                <th>תאריך</th>
                <th>סוג</th>
                <th>מסעיף</th>
                <th>לסעיף</th>
                <th className="num">סכום</th>
                <th>נימוק</th>
                <th>אסמכתה</th>
                <th>אישר</th>
                <th>הוזן על ידי</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-testid={`erp-budget-change-${c.id}`}>
                  <td className="mono">{c.id}</td>
                  <td>{dateHe(c.date)}</td>
                  <td>{BUDGET_CHANGE_KIND_HE[c.kind]}</td>
                  <td>{c.fromSectionId ? sectionShort(c.fromSectionId) : "—"}</td>
                  <td>{c.toSectionId ? sectionShort(c.toSectionId) : "—"}</td>
                  <td className="num">{nis(c.amount)}</td>
                  <td>{c.reasonHe}</td>
                  <td className="erp-muted">{c.referenceHe ?? "—"}</td>
                  <td>{personName(c.approvedById)}</td>
                  <td className="erp-muted">{personName(c.createdById)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="erp-muted">אין שינויי תקציב מאושרים; התקציב המעודכן שווה לתקציב המקורי.</p>
      )}
      <p className="erp-muted">שינוי נכלל בבקרה שמועדה אחרי תאריך האישור שלו; שינוי שתאריכו אחרי מועד הבקרה הנוכחית ({dateHe(pkg.project.currentControlDate)}) ייכלל בבקרה הבאה.</p>
    </section>
  );
}

function ChangeForm({ online, onDone, onError }: { online: boolean; onDone: (c: HBudgetChange) => void; onError: (textHe: string) => void }) {
  const works = pkg.sections;
  const [kind, setKind] = useState<HBudgetChange["kind"]>("transfer");
  const [from, setFrom] = useState<string>(works[0]?.id ?? "");
  const [to, setTo] = useState<string>(works[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reasonHe, setReasonHe] = useState("");
  const [referenceHe, setReferenceHe] = useState("");
  const [approvedById, setApprovedById] = useState<PersonId>(defaultActor("מנכ"));
  const [byId, setById] = useState<PersonId>(defaultActor("חשבונות"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isInteger(value) || value <= 0) return setError("סכום בשקלים שלמים, גדול מאפס.");
    if (!reasonHe.trim()) return setError("נימוק חובה.");
    if (kind === "transfer" && from === to) return setError("העברה דורשת שני סעיפים שונים.");
    setBusy(true);
    try {
      const created = await store.addBudgetChange({ date, kind, fromSectionId: kind === "addition" ? null : (from as SectionId), toSectionId: kind === "reduction" ? null : (to as SectionId), amount: value, reasonHe: reasonHe.trim(), ...(referenceHe.trim() ? { referenceHe: referenceHe.trim() } : {}), approvedById, createdById: byId });
      onDone(created);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setError(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  };

  const sectionOptions = works.map((s) => (
    <option key={s.id} value={s.id}>
      {sectionShort(s.id)} · {nis(s.budget)}
    </option>
  ));

  return (
    <form className="erp-form" onSubmit={submit} data-testid="erp-budget-change-form">
      {!online ? <div className="erp-notice erp-notice-error">רישום שינוי תקציב דורש חיבור למסד הנתונים (כבה ״עבודה מקומית״).</div> : null}
      <div className="erp-form-grid">
        <label className="erp-field">
          <span>סוג</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as HBudgetChange["kind"])} data-testid="erp-budget-change-kind">
            {(Object.keys(BUDGET_CHANGE_KIND_HE) as HBudgetChange["kind"][]).map((k) => (
              <option key={k} value={k}>
                {BUDGET_CHANGE_KIND_HE[k]}
              </option>
            ))}
          </select>
        </label>
        {kind !== "addition" ? (
          <label className="erp-field">
            <span>מסעיף</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="erp-budget-change-from">
              {sectionOptions}
            </select>
          </label>
        ) : null}
        {kind !== "reduction" ? (
          <label className="erp-field">
            <span>לסעיף</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} data-testid="erp-budget-change-to">
              {sectionOptions}
            </select>
          </label>
        ) : null}
        <label className="erp-field">
          <span>סכום *</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₪" data-testid="erp-budget-change-amount" />
        </label>
        <label className="erp-field">
          <span>תאריך האישור</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="erp-budget-change-date" />
        </label>
        <label className="erp-field">
          <span>נימוק *</span>
          <input value={reasonHe} onChange={(e) => setReasonHe(e.target.value)} placeholder="למה התקציב משתנה" data-testid="erp-budget-change-reason" />
        </label>
        <label className="erp-field">
          <span>אסמכתה</span>
          <input value={referenceHe} onChange={(e) => setReferenceHe(e.target.value)} placeholder="החלטה, פקודת שינוי, מכתב" data-testid="erp-budget-change-reference" />
        </label>
        <label className="erp-field">
          <span>אישר *</span>
          <select value={approvedById} onChange={(e) => setApprovedById(e.target.value as PersonId)} data-testid="erp-budget-change-approved-by">
            {pkg.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameHe} — {p.roleHe}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field">
          <span>מזין</span>
          <select value={byId} onChange={(e) => setById(e.target.value as PersonId)} data-testid="erp-budget-change-by">
            {pkg.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameHe} — {p.roleHe}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div className="error-text" role="alert" data-testid="erp-budget-change-error">
          {error}
        </div>
      ) : null}
      <div className="erp-actions">
        <Button type="submit" size="sm" variant="primary" busy={busy} disabled={!online} data-testid="erp-budget-change-submit">
          רשום שינוי תקציב
        </Button>
      </div>
    </form>
  );
}
