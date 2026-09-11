import { useState } from "react";
import { Button } from "../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import { DOCUMENT_KIND_HE, type HDocument, type PersonId } from "../../data/types";
import { pkg } from "../../engine/commands";
import { isUnprocessed } from "../../engine/heartbeat";
import { documentStatusHe } from "../../components/DocumentFacts";
import { UploadDocumentForm } from "./UploadDocumentForm";
import { downloadDocument } from "../../documents/download";
import { dateHe, dateTimeHe, num, personName, supplierName } from "./format";

const RECORD_HE = { invoice: "חשבון", po: "הזמנה", contract: "חוזה" } as const;
export { documentStatusHe };

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
  const [form, setForm] = useState<{ replaces?: HDocument } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; textHe: string } | null>(null);

  return (
    <div className="erp-screen" data-testid="erp-documents">
      <div className="erp-screen-head">
        <h2>תיקיית מסמכים</h2>
        <div className="erp-actions">
          <Button size="sm" variant="primary" onClick={() => { setMessage(null); setForm(form && !form.replaces ? null : {}); }} data-testid="erp-doc-upload-toggle">
            {form && !form.replaces ? "סגור טופס" : "＋ העלאת מסמך"}
          </Button>
        </div>
      </div>
      {form ? (
        <UploadDocumentForm
          key={form.replaces?.id ?? "new"}
          online={online}
          defaultDate={state.clock.slice(0, 10)}
          preset={form.replaces ? { replaces: form.replaces } : undefined}
          onCancel={form.replaces ? () => setForm(null) : undefined}
          onDone={(doc) => {
            const replaced = form.replaces;
            setForm(null);
            setMessage({ tone: "ok", textHe: replaced ? `המסמך ${doc.id} (${doc.fileName}) נשמר בתיקייה במקום ${replaced.fileName} וממתין לעיבוד על ידי הסוכן; הישן נשאר מסומן כהוחלף.` : `המסמך ${doc.id} (${doc.fileName}) נשמר בתיקייה וממתין לעיבוד על ידי הסוכן.` });
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
              <th>פעולות</th>
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
                  <td className="erp-doc-actions">
                    <button type="button" className="erp-link" title="הורדה" onClick={(e) => { e.stopPropagation(); void downloadDocument(d); }} data-testid={`erp-doc-download-${d.id}`}>
                      הורדה
                    </button>
                    {!d.supersededBy ? (
                      <button type="button" className="erp-link" title="החלפה בקובץ חדש" disabled={!online} onClick={(e) => { e.stopPropagation(); setMessage(null); setForm({ replaces: d }); }} data-testid={`erp-doc-replace-${d.id}`}>
                        החלפה
                      </button>
                    ) : null}
                  </td>
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

