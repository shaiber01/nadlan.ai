import { useState } from "react";
import { Button } from "../../components/primitives";
import { useUi, useV2State } from "../../app/store";
import { store } from "../../app/store";
import { DocumentFacts } from "../../components/DocumentFacts";
import type { DocumentKind, HDocument, PersonId } from "../../data/types";
import { downloadDocument } from "../../documents/download";
import { recordDocuments, type RecordRefLite } from "../../engine/checks";
import { pkg } from "../../engine/commands";
import { defaultActor, personName } from "./format";
import { UploadDocumentForm } from "./UploadDocumentForm";

const DEFAULT_KIND: Record<RecordRefLite["type"], DocumentKind> = { invoice: "invoice", po: "quote", contract: "contract_excerpt" };

/**
 * The documents of one ERP record — its attachment, the real files uploaded against it, a contract's excerpt and
 * price appendices — each with who read it and the facts read from it against the record's own values. Each can
 * be downloaded, replaced by a new upload (the replaced one stays in the folder, marked) or deleted (file and
 * row, with a change-log entry); a file can be uploaded for the record. Reading a new file is the agent's.
 */
export function AttachedDocuments({ record }: { record: RecordRefLite }) {
  const state = useV2State();
  const ui = useUi();
  const [form, setForm] = useState<{ replaces?: HDocument } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HDocument | null>(null);
  const [deleteBy, setDeleteBy] = useState<PersonId>(defaultActor("חשבונות"));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; textHe: string } | null>(null);
  const docs = recordDocuments(pkg, state.erp, record);
  const supplierId = record.type === "invoice" ? state.erp.invoices.find((i) => String(i.id) === record.id)?.supplierId : record.type === "po" ? state.erp.purchaseOrders.find((x) => String(x.id) === record.id)?.supplierId : pkg.contracts.find((c) => c.id === record.id)?.supplierId;
  const idle = !form && !confirmDelete;

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await store.deleteDocument(confirmDelete, deleteBy);
      setNote({ tone: "ok", textHe: `המסמך ${confirmDelete.fileName} נמחק מהתיקייה (${personName(deleteBy)}); המחיקה נרשמה ביומן השינויים.` });
      setConfirmDelete(null);
    } catch (e) {
      setNote({ tone: "error", textHe: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="erp-doc-facts" data-testid="erp-record-documents">
      {docs.length === 0 ? <div className="erp-muted">אין מסמך לרשומה זו.</div> : null}
      {docs.map((d) => (
        <div key={d.id} className="erp-doc-item">
          <DocumentFacts record={record} doc={d} />
          {idle ? (
            <div className="erp-doc-item-actions">
              <button type="button" className="erp-link" onClick={() => void downloadDocument(d)} data-testid={`erp-doc-download-${d.id}`}>
                {d.filePath ? "הורדה" : "הורדה כטקסט"}
              </button>
              <button type="button" className="erp-link" onClick={() => { setNote(null); setForm({ replaces: d }); }} data-testid={`erp-doc-replace-${d.id}`}>
                החלפה בקובץ חדש
              </button>
              <button type="button" className="erp-link erp-link-danger" onClick={() => { setNote(null); setConfirmDelete(d); }} data-testid={`erp-doc-delete-${d.id}`}>
                מחיקה
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {note ? (
        <div className={note.tone === "ok" ? "erp-saved" : "erp-error"} role={note.tone === "ok" ? "status" : "alert"} data-testid="erp-doc-note">
          {note.textHe}
        </div>
      ) : null}
      {confirmDelete ? (
        <div className="erp-form erp-doc-confirm" data-testid="erp-doc-confirm-delete">
          <p>
            למחוק את ״{confirmDelete.fileName}״ ({confirmDelete.titleHe})? הקובץ ורשומת המסמך יימחקו; המחיקה תירשם ביומן השינויים. {confirmDelete.factsSource ? "העובדות שנקראו ממנו יאבדו, והבדיקות יפסיקו להשוות מולו." : ""}
          </p>
          <div className="erp-form-grid">
            <label className="erp-field">
              <span>מבצע המחיקה</span>
              <select value={deleteBy} onChange={(e) => setDeleteBy(e.target.value as PersonId)} data-testid="erp-doc-delete-by">
                {pkg.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameHe} — {p.roleHe}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="erp-actions">
            <Button size="sm" variant="primary" busy={busy} disabled={ui.db.status !== "online"} onClick={() => void remove()} data-testid="erp-doc-delete-confirm">
              מחק
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)} data-testid="erp-doc-delete-cancel">
              ביטול
            </Button>
            {ui.db.status !== "online" ? <span className="erp-muted">מחיקה דורשת חיבור למסד הנתונים.</span> : null}
          </div>
        </div>
      ) : null}
      {form ? (
        <UploadDocumentForm
          online={ui.db.status === "online"}
          defaultDate={state.clock.slice(0, 10)}
          preset={{ recordRef: record, kind: DEFAULT_KIND[record.type], supplierId: supplierId ?? null, replaces: form.replaces }}
          onDone={(doc) => {
            setForm(null);
            setNote({ tone: "ok", textHe: `המסמך ${doc.fileName} נשמר בתיקייה${form.replaces ? ` במקום ${form.replaces.fileName}` : ""} וממתין לקריאת סוכן הבקרה; הבדיקות ירוצו על מה שייקרא ממנו.` });
          }}
          onError={() => undefined}
          onCancel={() => setForm(null)}
        />
      ) : null}
      {idle ? (
        <div className="erp-doc-actions">
          <Button size="sm" onClick={() => { setNote(null); setForm({}); }} data-testid="erp-doc-upload-open">
            ＋ העלאת מסמך לרשומה
          </Button>
        </div>
      ) : null}
    </div>
  );
}
