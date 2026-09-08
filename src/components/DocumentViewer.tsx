import { useEffect, useRef } from "react";
import { useDemoState } from "../app/store";
import { useUi } from "../app/ui";
import { formatDate, formatDateTime } from "../domain/dates";
import { paidByAllocation } from "../domain/selectors/financial";
import { supplierName } from "../domain/state-utils";
import type { SourceDocument } from "../domain/types";
import { documentKindHe } from "./EvidenceList";
import { Badge, Bidi, Button, KeyValue, Money, Notice } from "./primitives";

/** Renders an immutable source document as a readable page, scrolled to the cited anchor. */
export function DocumentViewer({ documentId, anchorId, version }: { documentId: string; anchorId?: string; version?: number }) {
  const state = useDemoState();
  const ui = useUi();
  const versions = state.documents.filter((d) => d.id === documentId).sort((a, b) => b.version - a.version);
  const doc: SourceDocument | undefined = version ? versions.find((d) => d.version === version) ?? versions[0] : versions[0];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-anchor="${anchorId ?? ""}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [anchorId, documentId]);
  if (!doc) return <Notice tone="amber">המסמך {documentId} אינו זמין במצב הנוכחי.</Notice>;
  const superseded = state.documents.find((d) => d.supersedesId === doc.id);
  const linkedRecords = state.erpRecords.filter((r) => r.sourceDocumentId === doc.id || r.relatedDocumentIds.includes(doc.id));
  const newerVersion = versions[0].version > doc.version ? versions[0] : null;
  return (
    <div className="stack" ref={ref}>
      <div className="row">
        <Badge tone="navy">{documentKindHe(doc.kind)}</Badge>
        <span className="muted small">
          תאריך <Bidi>{formatDate(doc.date)}</Bidi> · התקבל <Bidi>{formatDateTime(doc.receivedAt)}</Bidi>
        </span>
        {doc.version > 1 || versions.length > 1 ? <Badge tone="neutral">גרסה {doc.version}</Badge> : null}
        {doc.generated ? <Badge tone="neutral">נוצר מהרישומים</Badge> : null}
        {doc.scenarioOnly ? <Badge tone="neutral">מסמך תרחיש</Badge> : null}
        {superseded ? <Badge tone="amber">הוחלף על ידי {superseded.id}</Badge> : null}
      </div>
      {newerVersion ? (
        <Notice tone="amber">
          זו גרסה {doc.version}. קיימת גרסה חדשה יותר ({newerVersion.version}).{" "}
          <Button size="sm" variant="ghost" onClick={() => ui.openDocument(doc.id, anchorId, newerVersion.version)}>
            פתח את הגרסה החדשה
          </Button>
        </Notice>
      ) : null}
      <article className="doc-page" aria-label={doc.titleHe}>
        <div className="doc-head">
          <h3>
            <Bidi>{doc.titleHe}</Bidi>
          </h3>
          <div className="muted small">
            <Bidi className="mono">{doc.id}</Bidi>
            {doc.supplierId ? ` · ${supplierName(state, doc.supplierId)}` : doc.bidderHe ? ` · ${doc.bidderHe}` : ""} · {formatDate(doc.date)}
          </div>
        </div>
        {doc.anchors.map((a) => (
          <div key={a.id} className={`doc-anchor${a.id === anchorId ? " highlight" : ""}`} data-anchor={a.id}>
            <span className="label">{a.labelHe ?? a.id}</span>
            <span>
              <Bidi>{a.text}</Bidi>
            </span>
          </div>
        ))}
      </article>
      {doc.annotationHe ? <div className="doc-annotation">הערת המערכת: {doc.annotationHe}</div> : null}
      {linkedRecords.length > 0 ? (
        <div className="stack-sm">
          <h4 className="muted">תשלומים לפי הרישומים</h4>
          {linkedRecords.map((r) => {
            const paidParts = paidByAllocation(r);
            return (
              <div key={r.id} className="card card-muted stack-sm">
                <div className="row-between">
                  <span>
                    <Bidi className="mono">{r.id}</Bidi> · {r.descriptionHe}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => ui.openRecord(r.id)}>
                    פתח רשומה
                  </Button>
                </div>
                <KeyValue
                  rows={[
                    { labelHe: "סכום שהוכר", value: <Money value={r.amount} /> },
                    { labelHe: "שולם בפועל", value: <Money value={r.paid} /> },
                    { labelHe: "טרם שולם", value: <Money value={r.amount - r.paid} /> },
                    ...(r.allocations.length > 1 ? r.allocations.map((al, i) => ({ labelHe: `שולם — ${state.projects.find((p) => p.id === al.projectId)?.nameHe}`, value: <Money value={paidParts[i]} /> })) : []),
                  ]}
                />
                <div className="tiny faint">סטטוס תשלום והתאמה הם הערות מערכת מחוץ למסמך המקורי.</div>
              </div>
            );
          })}
        </div>
      ) : null}
      {versions.length > 1 ? (
        <div className="row small muted">
          גרסאות:
          {versions.map((v) => (
            <Button key={v.version} size="sm" variant={v.version === doc.version ? "primary" : "ghost"} onClick={() => ui.openDocument(doc.id, anchorId, v.version)}>
              {v.version}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
