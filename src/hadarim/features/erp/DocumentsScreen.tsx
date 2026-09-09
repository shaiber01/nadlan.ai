import { useState, type FormEvent } from "react";
import { Button } from "../../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import { DOCUMENT_KIND_HE, type DocumentKind, type HDocument, type PersonId } from "../../data/types";
import { pkg } from "../../engine/commands";
import { isUnprocessed } from "../../engine/heartbeat";
import { dateHe, dateTimeHe, defaultActor, num, personName, supplierName } from "./format";

const RECORD_HE = { invoice: "חשבון", po: "הזמנה", contract: "חוזה" } as const;
const FACTS_METHOD_HE: Record<string, string> = { seed: "נתוני הבסיס", agent: "נקרא על ידי הסוכן", extraction: "חילוץ אוטומטי" };

/** A document's processing status: the ERP only shows it; processing is the agent's. */
export function documentStatusHe(d: HDocument): { labelHe: string; tone: "pending" | "done" } {
  if (isUnprocessed(d)) return { labelHe: "טרם עובד", tone: "pending" };
  const src = d.factsSource!;
  return { labelHe: `${FACTS_METHOD_HE[src.method] ?? src.method}${src.byId ? ` · ${personName(src.byId as PersonId)}` : ""}`, tone: "done" };
}

/**
 * תיקיית מסמכים — the project folder in the ERP: the seed's pages and the real files people upload. Uploading
 * only stores the file and its row; reading, describing and extracting facts is the agent's work (the row shows
 * whether it happened). Needs the database; offline the list is read-only.
 */
export function DocumentsScreen() {
  const state = useV2State();
  const ui = useUi();
  const online = ui.db.status === "online";
  const pending = pkg.documents.filter(isUnprocessed);
  const rows = [...pkg.documents].sort((a, b) => (isUnprocessed(a) !== isUnprocessed(b) ? (isUnprocessed(a) ? -1 : 1) : (b.uploadedAt ?? b.date).localeCompare(a.uploadedAt ?? a.date)));
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; textHe: string } | null>(null);

  return (
    <div className="erp-screen" data-testid="erp-documents">
      <div className="erp-screen-head">
        <h2>תיקיית מסמכים</h2>
        <div className="erp-actions">
          <Button size="sm" variant="primary" onClick={() => setShowForm((v) => !v)} data-testid="erp-doc-upload-toggle">
            {showForm ? "סגור טופס" : "＋ העלאת מסמך"}
          </Button>
        </div>
      </div>
      {showForm ? (
        <UploadForm
          online={online}
          defaultDate={state.clock.slice(0, 10)}
          onDone={(doc) => {
            setShowForm(false);
            setMessage({ tone: "ok", textHe: `המסמך ${doc.id} (${doc.fileName}) נשמר בתיקייה וממתין לעיבוד על ידי הסוכן.` });
          }}
          onError={(textHe) => setMessage({ tone: "error", textHe })}
        />
      ) : null}
      {message ? (
        <div className={`erp-notice erp-notice-${message.tone}`} role={message.tone === "error" ? "alert" : "status"} data-testid="erp-doc-message">
          {message.textHe}
        </div>
      ) : null}
      <div className="erp-filters">
        <span className="erp-count">{num(rows.length)} מסמכים</span>
        <span className={`erp-count${pending.length ? " erp-count-pending" : ""}`} data-testid="erp-doc-pending">
          {pending.length ? `${num(pending.length)} ממתינים לעיבוד` : "כל המסמכים עובדו"}
        </span>
        <span className="erp-muted">העיבוד (קריאה, סיווג, חילוץ עובדות) נעשה על ידי סוכן הבקרה; המערכת רק שומרת את הקובץ.</span>
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>מזהה</th>
              <th>כותרת</th>
              <th>סוג</th>
              <th>תאריך</th>
              <th>ספק</th>
              <th>רשומה</th>
              <th>קובץ</th>
              <th>הועלה</th>
              <th>עיבוד</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const status = documentStatusHe(d);
              return (
                <tr key={d.id} className="clickable" onClick={() => store.openDocument(d.id)} data-testid={`erp-doc-row-${d.id}`} data-status={status.tone}>
                  <td className="mono">{d.id}</td>
                  <td>
                    {d.titleHe}
                    {d.summaryHe ? <div className="erp-muted">{d.summaryHe}</div> : null}
                  </td>
                  <td>{DOCUMENT_KIND_HE[d.kind] ?? d.kind}</td>
                  <td>{dateHe(d.date)}</td>
                  <td>{supplierName(d.supplierId)}</td>
                  <td className="mono">{d.recordRef ? `${RECORD_HE[d.recordRef.type]} ${d.recordRef.id}` : "—"}</td>
                  <td className="mono">
                    {d.filePath ? "📎 " : ""}
                    {d.fileName}
                  </td>
                  <td className="erp-muted">{d.uploadedById ? `${personName(d.uploadedById as PersonId)} · ${dateTimeHe(d.uploadedAt ? d.uploadedAt.slice(0, 16) : d.date)}` : "—"}</td>
                  <td>
                    <span className={`erp-doc-status is-${status.tone}`}>{status.labelHe}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UploadForm({ online, defaultDate, onDone, onError }: { online: boolean; defaultDate: string; onDone: (doc: HDocument) => void; onError: (textHe: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocumentKind>("invoice");
  const [titleHe, setTitleHe] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [supplierId, setSupplierId] = useState("");
  const [recordType, setRecordType] = useState<"" | "invoice" | "po" | "contract">("");
  const [recordId, setRecordId] = useState("");
  const [byId, setById] = useState<PersonId>(defaultActor("חשבונות"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("בחר קובץ להעלאה.");
    if (recordType && !recordId.trim()) return setError("ציין את מספר הרשומה שאליה המסמך שייך.");
    setBusy(true);
    try {
      const doc = await store.uploadDocument(file, { kind, titleHe: titleHe.trim() || file.name, date, supplierId: supplierId || null, recordRef: recordType ? { type: recordType, id: recordId.trim() } : null, byId });
      onDone(doc);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setError(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="erp-form" onSubmit={submit} data-testid="erp-doc-upload-form">
      {!online ? <div className="erp-notice erp-notice-error">העלאת מסמכים דורשת חיבור למסד הנתונים (כבה ״עבודה מקומית״).</div> : null}
      <div className="erp-form-grid">
        <label className="erp-field">
          <span>קובץ *</span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !titleHe) setTitleHe(f.name.replace(/\.[^.]+$/, "")); }} data-testid="erp-doc-file" />
        </label>
        <label className="erp-field">
          <span>סוג</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} data-testid="erp-doc-kind">
            {(Object.keys(DOCUMENT_KIND_HE) as DocumentKind[]).map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_HE[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field">
          <span>כותרת</span>
          <input value={titleHe} onChange={(e) => setTitleHe(e.target.value)} placeholder="כותרת בעברית (ברירת מחדל: שם הקובץ)" data-testid="erp-doc-title" />
        </label>
        <label className="erp-field">
          <span>תאריך המסמך</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="erp-doc-date" />
        </label>
        <label className="erp-field">
          <span>ספק</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} data-testid="erp-doc-supplier">
            <option value="">— לא ידוע —</option>
            {pkg.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameHe}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field">
          <span>שייך לרשומה</span>
          <span className="erp-field-row">
            <select value={recordType} onChange={(e) => setRecordType(e.target.value as typeof recordType)} data-testid="erp-doc-record-type">
              <option value="">— לא משויך —</option>
              <option value="invoice">חשבון</option>
              <option value="po">הזמנה</option>
              <option value="contract">חוזה</option>
            </select>
            <input value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="מס׳ רשומה" disabled={!recordType} data-testid="erp-doc-record-id" />
          </span>
        </label>
        <label className="erp-field">
          <span>מעלה</span>
          <select value={byId} onChange={(e) => setById(e.target.value as PersonId)} data-testid="erp-doc-by">
            {pkg.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameHe} — {p.roleHe}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div className="error-text" role="alert" data-testid="erp-doc-error">
          {error}
        </div>
      ) : null}
      <div className="erp-actions">
        <Button type="submit" size="sm" variant="primary" busy={busy} disabled={!online} data-testid="erp-doc-submit">
          העלה לתיקייה
        </Button>
      </div>
    </form>
  );
}
