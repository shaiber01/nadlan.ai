import { useEffect, useRef } from "react";
import { DOCUMENT_KIND_HE } from "../data/types";
import { documentFileUrl } from "../db/client";
import { isImage, isPdf, mimeTypeFor } from "../documents/mime";
import { pkg } from "../engine/commands";

/**
 * Renders one simulated source document (invoice, quote, price appendix, contract excerpt, BOQ page)
 * as a paper-like page. `anchor` highlights the block a finding points at and scrolls it into view.
 */
export function DocumentView({ documentId, anchor }: { documentId: string; anchor?: string }) {
  const doc = pkg.documents.find((d) => d.id === documentId);
  const anchoredRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    anchoredRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [documentId, anchor]);
  if (!doc) return <p className="muted">המסמך לא נמצא.</p>;
  const anchoredIndex = anchor ? doc.anchors[anchor] : undefined;
  const supplier = doc.supplierId ? pkg.suppliers.find((s) => s.id === doc.supplierId) : null;

  // a real file: shown as uploaded (PDF in a frame, image inline), with what the tools extracted and the agent recorded
  if (doc.filePath) {
    const url = documentFileUrl(doc.filePath);
    const mime = doc.mimeType ?? mimeTypeFor(doc.fileName);
    const uploader = doc.uploadedById ? pkg.people.find((p) => p.id === doc.uploadedById) : null;
    const facts = doc.facts && Object.keys(doc.facts).length ? doc.facts : null;
    return (
      <div className="h2-doc h2-doc-file" data-testid="document-view" data-document-id={doc.id} data-file="1">
        <div className="h2-doc-tab">
          <span className="h2-doc-file">{doc.fileName}</span>
          <span className="h2-doc-kind">{kindHe(doc.kind)}</span>
          {supplier && <span className="h2-doc-supplier">{supplier.nameHe}</span>}
          <a className="h2-doc-open" href={url} target="_blank" rel="noreferrer">
            פתח בחלון חדש ↗
          </a>
        </div>
        <div className="h2-doc-frame">
          {isPdf(mime) ? <iframe src={url} title={doc.titleHe} /> : isImage(mime) ? <img src={url} alt={doc.titleHe} /> : <a href={url} target="_blank" rel="noreferrer">{doc.fileName}</a>}
        </div>
        <div className="h2-doc-meta">
          <div className="h2-doc-meta-row">
            <strong>עיבוד:</strong> {doc.factsSource ? `${{ seed: "נתוני הבסיס", agent: "נקרא על ידי הסוכן", extraction: "חילוץ אוטומטי" }[doc.factsSource.method] ?? doc.factsSource.method}${doc.factsSource.byId ? ` · ${pkg.people.find((p) => p.id === doc.factsSource!.byId)?.nameHe ?? doc.factsSource.byId}` : ""}${doc.factsSource.at ? ` · ${new Date(doc.factsSource.at).toLocaleString("he-IL")}` : ""}` : "טרם עובד — ממתין לסוכן הבקרה"}
            {uploader ? ` · הועלה על ידי ${uploader.nameHe}` : ""}
          </div>
          {doc.summaryHe ? <div className="h2-doc-meta-row">{doc.summaryHe}</div> : null}
          {facts ? (
            <div className="h2-doc-meta-row">
              <strong>עובדות שנרשמו:</strong> {Object.entries(facts).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
            </div>
          ) : null}
          {doc.text ? (
            <details className="h2-doc-text">
              <summary>טקסט שחולץ מהקובץ</summary>
              <pre>{doc.text}</pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="h2-doc" data-testid="document-view" data-document-id={doc.id}>
      <div className="h2-doc-tab">
        <span className="h2-doc-file">{doc.fileName}</span>
        <span className="h2-doc-kind">{kindHe(doc.kind)}</span>
        {supplier && <span className="h2-doc-supplier">{supplier.nameHe}</span>}
      </div>
      <div className="h2-doc-paper">
        {doc.blocks.map((block, i) => {
          const anchored = i === anchoredIndex;
          const cls = ["h2-doc-block", `h2-doc-${block.kind}`, block.highlight ? "is-highlight" : "", anchored ? "is-anchored" : ""].filter(Boolean).join(" ");
          const ref = anchored ? anchoredRef : undefined;
          switch (block.kind) {
            case "heading":
              return (
                <div key={i} className={cls} ref={ref}>
                  <h3>{block.text}</h3>
                </div>
              );
            case "table":
              return (
                <div key={i} className={cls} ref={ref}>
                  <table>
                    <thead>
                      <tr>{(block.rows?.[0] ?? []).map((c, j) => <th key={j}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(block.rows ?? []).slice(1).map((row, r) => (
                        <tr key={r}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            case "signature":
            case "stamp":
              return (
                <div key={i} className={cls} ref={ref}>
                  <span>{block.text}</span>
                </div>
              );
            default:
              return (
                <div key={i} className={cls} ref={ref}>
                  <p>{block.text}</p>
                </div>
              );
          }
        })}
        <div className="h2-doc-footer">{doc.footerHe}</div>
      </div>
    </div>
  );
}

function kindHe(kind: string): string {
  return (DOCUMENT_KIND_HE as Record<string, string>)[kind] ?? kind;
}
