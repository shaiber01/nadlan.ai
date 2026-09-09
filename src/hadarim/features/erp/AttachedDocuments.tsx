import { useV2State } from "../../app/store";
import { DocumentFacts } from "../../components/DocumentFacts";
import { recordDocuments, type RecordRefLite } from "../../engine/checks";
import { pkg } from "../../engine/commands";

/**
 * The documents of one ERP record — its attachment, the real files uploaded against it, a contract's excerpt and
 * price appendices — each with who read it and the facts read from it against the record's own values.
 */
export function AttachedDocuments({ record }: { record: RecordRefLite }) {
  const state = useV2State();
  const docs = recordDocuments(pkg, state.erp, record);
  if (!docs.length) return <>—</>;
  return (
    <div className="erp-doc-facts" data-testid="erp-record-documents">
      {docs.map((d) => (
        <DocumentFacts key={d.id} record={record} doc={d} />
      ))}
    </div>
  );
}
