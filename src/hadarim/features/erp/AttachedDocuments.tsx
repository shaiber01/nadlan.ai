import { store } from "../../app/store";
import type { HDocument } from "../../data/types";
import { pkg } from "../../engine/commands";
import { isUnprocessed } from "../../engine/heartbeat";

/** The documents of one ERP record: its seed attachment and the real files uploaded against it (with their processing status). */
export function linkedDocuments(type: "invoice" | "po" | "contract", id: string): HDocument[] {
  return pkg.documents.filter((d) => d.recordRef?.type === type && d.recordRef.id === id);
}

export function AttachedDocuments({ attachment, linked }: { attachment: HDocument | null | undefined; linked: HDocument[] }) {
  const docs = [...(attachment ? [attachment] : []), ...linked.filter((d) => d.id !== attachment?.id)];
  if (!docs.length) return <>—</>;
  return (
    <ul className="erp-doc-links" data-testid="erp-record-documents">
      {docs.map((d) => (
        <li key={d.id}>
          <button type="button" className="erp-link" onClick={() => store.openDocument(d.id)}>
            📎 {d.fileName}
          </button>
          {d.filePath ? <span className={`erp-doc-status is-${isUnprocessed(d) ? "pending" : "done"}`}>{isUnprocessed(d) ? "טרם עובד" : "עובד"}</span> : null}
        </li>
      ))}
    </ul>
  );
}
