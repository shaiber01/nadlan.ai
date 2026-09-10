import { useState, type FormEvent } from "react";
import { Button } from "../../components/primitives";
import { store } from "../../app/store";
import { DOCUMENT_KIND_HE, type DocumentKind, type HDocument, type PersonId } from "../../data/types";
import { pkg } from "../../engine/commands";
import { defaultActor } from "./format";

const RECORD_HE = { invoice: "חשבון", po: "הזמנה", contract: "חוזה" } as const;

export interface UploadPreset {
  recordRef: { type: "invoice" | "po" | "contract"; id: string };
  kind?: DocumentKind;
  supplierId?: string | null;
  /** The document the upload replaces: it stays in the folder marked as replaced; the record, the checks and the agent use the new one. */
  replaces?: HDocument;
}

/**
 * Upload a real file to the project folder — from the folder screen (any record, or none) or from a record's
 * card (record preset, optionally replacing one of its documents). The browser stores the file and its row
 * only; reading it, describing it and recording its facts is the agent's.
 */
export function UploadDocumentForm({ online, defaultDate, onDone, onError, onCancel, preset }: { online: boolean; defaultDate: string; onDone: (doc: HDocument) => void; onError: (textHe: string) => void; onCancel?: () => void; preset?: UploadPreset }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocumentKind>(preset?.replaces?.kind ?? preset?.kind ?? "invoice");
  const [titleHe, setTitleHe] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [supplierId, setSupplierId] = useState(preset?.replaces?.supplierId ?? preset?.supplierId ?? "");
  const [recordType, setRecordType] = useState<"" | "invoice" | "po" | "contract">(preset?.recordRef.type ?? "");
  const [recordId, setRecordId] = useState(preset?.recordRef.id ?? "");
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
      const doc = await store.uploadDocument(file, { kind, titleHe: titleHe.trim() || file.name, date, supplierId: supplierId || null, recordRef: recordType ? { type: recordType, id: recordId.trim() } : null, byId, replacesDocumentId: preset?.replaces?.id ?? null });
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
      {preset?.replaces ? (
        <div className="erp-notice" data-testid="erp-doc-replaces">
          מחליף את ״{preset.replaces.fileName}״. המסמך הישן יישאר בתיקייה מסומן כהוחלף; הרשומה, הבדיקות וסוכן הבקרה יעבדו עם החדש לאחר שייקרא.
        </div>
      ) : null}
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
        {preset ? (
          <label className="erp-field">
            <span>שייך לרשומה</span>
            <input value={`${RECORD_HE[preset.recordRef.type]} ${preset.recordRef.id}`} readOnly data-testid="erp-doc-record" />
          </label>
        ) : (
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
        )}
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
          {preset?.replaces ? "העלה והחלף" : "העלה לתיקייה"}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid="erp-doc-cancel">
            ביטול
          </Button>
        ) : null}
      </div>
    </form>
  );
}
