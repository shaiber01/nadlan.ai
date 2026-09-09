import { useState } from "react";
import { Button } from "../../../components/primitives";
import { useUi, useV2State } from "../../app/store";
import { DocumentFacts } from "../../components/DocumentFacts";
import type { DocumentKind, HDocument } from "../../data/types";
import { recordDocuments, type RecordRefLite } from "../../engine/checks";
import { pkg } from "../../engine/commands";
import { UploadDocumentForm } from "./UploadDocumentForm";

const DEFAULT_KIND: Record<RecordRefLite["type"], DocumentKind> = { invoice: "invoice", po: "quote", contract: "contract_excerpt" };

/**
 * The documents of one ERP record — its attachment, the real files uploaded against it, a contract's excerpt and
 * price appendices — each with who read it and the facts read from it against the record's own values; a file
 * can be uploaded for the record here, or replace one of its documents (the replaced one stays in the folder,
 * marked). Reading the new file is the agent's: it shows up as pending in the next heartbeat.
 */
export function AttachedDocuments({ record }: { record: RecordRefLite }) {
  const state = useV2State();
  const ui = useUi();
  const [form, setForm] = useState<{ replaces?: HDocument } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const docs = recordDocuments(pkg, state.erp, record);
  const supplierId = record.type === "invoice" ? state.erp.invoices.find((i) => String(i.id) === record.id)?.supplierId : record.type === "po" ? state.erp.purchaseOrders.find((x) => String(x.id) === record.id)?.supplierId : pkg.contracts.find((c) => c.id === record.id)?.supplierId;
  return (
    <div className="erp-doc-facts" data-testid="erp-record-documents">
      {docs.length === 0 ? <div className="erp-muted">אין מסמך לרשומה זו.</div> : null}
      {docs.map((d) => (
        <div key={d.id} className="erp-doc-item">
          <DocumentFacts record={record} doc={d} />
          {form ? null : (
            <button type="button" className="erp-link erp-doc-replace" onClick={() => { setNote(null); setForm({ replaces: d }); }} data-testid={`erp-doc-replace-${d.id}`}>
              החלפה בקובץ חדש
            </button>
          )}
        </div>
      ))}
      {note ? (
        <div className="erp-saved" role="status" data-testid="erp-doc-note">
          {note}
        </div>
      ) : null}
      {form ? (
        <UploadDocumentForm
          online={ui.db.status === "online"}
          defaultDate={state.clock.slice(0, 10)}
          preset={{ recordRef: record, kind: DEFAULT_KIND[record.type], supplierId: supplierId ?? null, replaces: form.replaces }}
          onDone={(doc) => {
            setForm(null);
            setNote(`המסמך ${doc.fileName} נשמר בתיקייה${form.replaces ? ` במקום ${form.replaces.fileName}` : ""} וממתין לקריאת סוכן הבקרה; הבדיקות ירוצו על מה שייקרא ממנו.`);
          }}
          onError={() => undefined}
          onCancel={() => setForm(null)}
        />
      ) : (
        <div className="erp-doc-actions">
          <Button size="sm" onClick={() => { setNote(null); setForm({}); }} data-testid="erp-doc-upload-open">
            ＋ העלאת מסמך לרשומה
          </Button>
        </div>
      )}
    </div>
  );
}
