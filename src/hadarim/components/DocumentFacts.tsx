import { store, useV2State } from "../app/store";
import type { HDocument, PersonId } from "../data/types";
import { compareDocument, type RecordRefLite } from "../engine/checks";
import { pkg } from "../engine/commands";
import { isUnprocessed } from "../engine/heartbeat";

const METHOD_HE: Record<string, string> = { seed: "נתוני הבסיס", agent: "נקרא על ידי הסוכן", extraction: "חילוץ אוטומטי" };

/** A document's processing status, as the ERP and the report show it: processing itself is the agent's. */
export function documentStatusHe(d: HDocument): { labelHe: string; tone: "pending" | "done" } {
  if (isUnprocessed(d)) return { labelHe: "טרם עובד", tone: "pending" };
  const src = d.factsSource!;
  const by = src.byId ? pkg.people.find((p) => p.id === (src.byId as PersonId))?.nameHe ?? src.byId : null;
  return { labelHe: `${METHOD_HE[src.method] ?? src.method}${by ? ` · ${by}` : ""}`, tone: "done" };
}

const CHECK_TITLE_HE = { document: "מושווה בבדיקת המסמכים — אי-התאמה הופכת לממצא", unit: "מושווה בבדיקת היחידות — אי-התאמה הופכת לממצא", none: "מושווה לרשומה; אין בדיקה אוטומטית על שדה זה" } as const;

/**
 * One document of a record: the file, who read it, and the facts read from it against the record's own values —
 * the same comparison the checks make, so what the screen marks and what the control raises never differ.
 */
export function DocumentFacts({ record, doc, compact = false }: { record: RecordRefLite; doc: HDocument; compact?: boolean }) {
  const state = useV2State();
  const status = documentStatusHe(doc);
  const pending = isUnprocessed(doc);
  const rows = pending ? [] : compareDocument(pkg, state.erp, record, doc);
  return (
    <div className={`h2-docfacts${compact ? " is-compact" : ""}`} data-testid="document-facts" data-document-id={doc.id}>
      {compact ? null : (
        <div className="h2-docfacts-head">
          <button type="button" className="h2-docfacts-link" onClick={() => store.openDocument(doc.id)}>
            📎 {doc.fileName}
          </button>
          <span className="h2-docfacts-title">{doc.titleHe}</span>
          <span className={`h2-docfacts-status is-${status.tone}`} data-testid="document-facts-status">
            {status.labelHe}
          </span>
        </div>
      )}
      {pending ? (
        <div className="h2-docfacts-empty">המסמך טרם נקרא — אין עובדות להשוואה. סוכן הבקרה קורא אותו בפעימת הלב הבאה.</div>
      ) : rows.length === 0 ? (
        <div className="h2-docfacts-empty">לא נרשמו עובדות מהמסמך.</div>
      ) : (
        <table className="h2-docfacts-table">
          <thead>
            <tr>
              <th>שדה</th>
              <th>במסמך</th>
              <th aria-label="התאמה לרשומה" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.match === false ? "is-mismatch" : r.match === true ? "is-match" : "is-info"} data-fact={r.key} data-match={String(r.match)}>
                <td>{r.fieldHe}</td>
                <td>{r.docHe}</td>
                <td className="h2-docfacts-mark" title={r.match === null ? "עובדה שאין לה שדה מקביל ברשומה" : `${r.match ? "תואם לרשומה" : `שונה מהרשומה — ברשומה: ${r.recordHe ?? "—"}`} · ${CHECK_TITLE_HE[r.check ?? "none"]}`}>
                  {r.match === true ? "✓" : r.match === false ? "✗" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
