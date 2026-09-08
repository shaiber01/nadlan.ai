import { useState } from "react";
import { store, useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { saveErpRecord } from "../domain/commands/core";
import { formatDate, formatDateTime } from "../domain/dates";
import { parseMoneyInput, parseQuantityInput, toIls } from "../domain/money";
import { paidByAllocation } from "../domain/selectors/financial";
import { supplierName } from "../domain/state-utils";
import type { ErpRecord } from "../domain/types";
import { documentKindHe } from "./EvidenceList";
import { HistoryList } from "./HistoryList";
import { Badge, Bidi, Button, Field, KeyValue, Money, Notice, Num } from "./primitives";
import { ProposalCard } from "./ProposalCard";
import { ScenarioEventButtons } from "./ScenarioEventButtons";
import { CheckStatusBadge } from "./StatusBadge";

const kindHe: Record<ErpRecord["kind"], string> = {
  invoice: "חשבונית",
  opening_balance: "יתרת פתיחה",
  certificate: "חשבון קבלן",
  accrual: "עבודה שבוצעה וטרם חויבה",
  accrual_reversal: "קיזוז רישום זמני",
  credit: "זיכוי",
  adjustment: "התאמה",
};

export function recordKindHe(kind: ErpRecord["kind"]): string {
  return kindHe[kind];
}

/** Record drawer: original source, current ERP values, proposed values, allocations and payments, history, and the ERP edit form. */
export function RecordView({ recordId, editable = true }: { recordId: string; editable?: boolean }) {
  const { state, analyzing } = useDemo();
  const ui = useUi();
  const record = state.erpRecords.find((r) => r.id === recordId);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [desc, setDesc] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!record) return <Notice tone="amber">הרשומה {recordId} אינה קיימת במצב הנוכחי.</Notice>;
  const source = record.sourceDocumentId ? state.documents.filter((d) => d.id === record.sourceDocumentId).sort((a, b) => b.version - a.version)[0] : undefined;
  const related = record.relatedDocumentIds.map((id) => state.documents.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
  const proposals = state.proposals.filter((p) => p.targetIds.includes(record.id) && p.status !== "superseded").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const findings = state.findings.filter((f) => f.recordIds.includes(record.id) && f.status !== "superseded");
  const paidParts = paidByAllocation(record);
  const pendingForRecord = state.pendingAnalyses.some((p) => p.recordId === record.id);
  const codes = state.costCodes.filter((c) => c.projectId === record.projectId);

  const startEdit = () => {
    setQty(record.quantity != null ? String(record.quantity) : "");
    setPrice(record.unitPrice != null ? String(toIls(record.unitPrice)) : "");
    setDesc(record.descriptionHe);
    setCode(record.allocations[0].costCodeId);
    setError(null);
    setEditing(true);
  };
  const save = () => {
    const input: Parameters<typeof saveErpRecord>[2] = {};
    if (qty !== "" || record.quantity != null) {
      const q = parseQuantityInput(qty);
      if (q == null || q <= 0) {
        setError("הכמות חייבת להיות מספר חיובי (עד שלוש ספרות אחרי הנקודה)");
        return;
      }
      input.quantity = q;
    }
    if (price !== "" || record.unitPrice != null) {
      const p = parseMoneyInput(price);
      if (p == null || p <= 0) {
        setError("המחיר ליחידה חייב להיות מספר חיובי");
        return;
      }
      input.unitPrice = p;
    }
    if (desc !== record.descriptionHe) input.descriptionHe = desc;
    if (code !== record.allocations[0].costCodeId) input.costCodeId = code;
    const ok = store.dispatch((s) => saveErpRecord(s, record.id, input, record.version), "הרשומה נשמרה בזיו; הבדיקה מתחילה אוטומטית");
    if (ok) setEditing(false);
  };

  return (
    <div className="stack-lg">
      <div className="row">
        <Badge tone="navy">{kindHe[record.kind]}</Badge>
        <CheckStatusBadge status={record.checkStatus} />
        {pendingForRecord || (analyzing && record.checkStatus === "pending") ? <Badge tone="amber">בבדיקה…</Badge> : null}
        <span className="muted small">גרסה {record.version}</span>
        {record.historicalSummary ? <Badge tone="neutral">סיכום היסטורי</Badge> : null}
        {record.sourceMissing ? <Badge tone="amber">חשבונית המקור טרם התקבלה</Badge> : null}
      </div>
      <ScenarioEventButtons route="records" recordId={record.id} />

      <section className="stack-sm">
        <h3>מקור מקורי</h3>
        {source ? (
          <div className="card card-muted row-between">
            <div>
              <Bidi className="mono">{source.id}</Bidi> · {documentKindHe(source.kind)} · {source.titleHe}
              <div className="tiny muted">{source.anchors.find((a) => a.id === "line1" || a.id === "text" || a.id === "summary")?.text}</div>
            </div>
            <Button size="sm" onClick={() => ui.openDocument(source.id, source.anchors.find((a) => a.id === "line1")?.id ?? source.anchors[0]?.id)}>
              פתח מסמך
            </Button>
          </div>
        ) : (
          <Notice tone="amber">אין מסמך מקור מקושר לרשומה זו במצב הנוכחי.</Notice>
        )}
        {related.length > 0 ? (
          <div className="row">
            {related.map((d) => (
              <Button key={d.id} size="sm" variant="ghost" onClick={() => ui.openDocument(d.id)}>
                {documentKindHe(d.kind)}: <Bidi>{d.id}</Bidi>
              </Button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="stack-sm">
        <div className="row-between">
          <h3>ערכים נוכחיים בזיו — סביבת הדגמה</h3>
          {editable && !editing ? (
            <Button size="sm" onClick={startEdit} guide="erp-edit">
              ערוך את הרשומה בזיו
            </Button>
          ) : null}
        </div>
        {!editing ? (
          <KeyValue
            rows={[
              { labelHe: "מזהה", value: <Bidi className="mono">{record.id}</Bidi> },
              { labelHe: "תיאור", value: record.descriptionHe },
              { labelHe: "פרויקט", value: state.projects.find((p) => p.id === record.projectId)?.nameHe ?? record.projectId },
              { labelHe: "סעיף תקציב", value: record.allocations.map((al) => `${state.costCodes.find((c) => c.id === al.costCodeId)?.nameHe} (${al.costCodeId})`).join(", ") },
              { labelHe: "ספק", value: supplierName(state, record.supplierId) },
              { labelHe: "תאריך", value: formatDate(record.date) },
              { labelHe: "התקבל", value: formatDateTime(record.receivedAt) },
              ...(record.quantity != null ? [{ labelHe: "כמות", value: <Num value={record.quantity} unit={record.unit ?? undefined} /> }] : []),
              ...(record.verifiedQuantity != null && record.verifiedQuantity !== record.quantity ? [{ labelHe: "כמות מאומתת מהמסמכים", value: <Num value={record.verifiedQuantity} unit={record.unit ?? undefined} /> }] : []),
              ...(record.unitPrice != null ? [{ labelHe: "מחיר ליחידה", value: <Money value={record.unitPrice} /> }] : []),
              { labelHe: "סכום", value: <Money value={record.amount} /> },
              ...(record.cumulativeApproved != null ? [{ labelHe: "מצטבר מאושר", value: <Money value={record.cumulativeApproved} /> }, { labelHe: "מצטבר קודם", value: <Money value={record.priorCumulative ?? 0} /> }, { labelHe: "חשבון קודם מקושר", value: record.priorRecordId ?? "ללא" }] : []),
            ]}
          />
        ) : (
          <div className="card stack">
            <div className="grid-2">
              <Field label="כמות">
                <input className="input num" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="מחיר ליחידה (₪)">
                <input className="input num" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="תיאור">
                <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </Field>
              <Field label="סעיף תקציב">
                <select className="select" value={code} onChange={(e) => setCode(e.target.value)}>
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameHe} ({c.id})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="tiny muted">
              סכום הרשומה נשאר <Money value={record.amount} />. עריכה זו משנה רק את הרשומה בזיו; המסמכים המקוריים נשמרים, וכל שמירה מפעילה בדיקה אוטומטית.
            </div>
            {error ? <span className="error-text">{error}</span> : null}
            <div className="row">
              <Button variant="primary" onClick={save} guide="save-record">
                שמור תנועה
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                ביטול
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="stack-sm">
        <h3>שיוכים ותשלומים לפי הרישומים</h3>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>פרויקט</th>
                <th>סעיף</th>
                <th className="num">סכום</th>
                <th className="num">שולם</th>
                <th>פריט עבודה</th>
                <th>התחייבות</th>
              </tr>
            </thead>
            <tbody>
              {record.allocations.map((al, i) => (
                <tr key={al.id}>
                  <td>{state.projects.find((p) => p.id === al.projectId)?.nameHe}</td>
                  <td>{state.costCodes.find((c) => c.id === al.costCodeId)?.nameHe}</td>
                  <td className="num">
                    <Money value={al.amount} />
                  </td>
                  <td className="num">
                    <Money value={paidParts[i]} />
                  </td>
                  <td className="small">{al.workItemId ? (state.workItems.find((w) => w.id === al.workItemId)?.titleHe ?? al.workItemId) : al.additionalScope ? "תכולה נוספת" : "—"}</td>
                  <td className="small">{al.commitmentId ? (state.commitments.find((c) => c.id === al.commitmentId)?.titleHe ?? al.commitmentId) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tiny muted">
          שולם בפועל <Money value={record.paid} /> מתוך <Money value={record.amount} /> שהוכרו; תשלומים אינם עלות פרויקט נוספת.
        </div>
      </section>

      {proposals.length > 0 ? (
        <section className="stack-sm">
          <h3>ערכים מוצעים ובדיקה</h3>
          <div className="stack">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        </section>
      ) : findings.length > 0 ? (
        <section className="stack-sm">
          <h3>ממצאים</h3>
          <div className="row">
            {findings.map((f) => (
              <Button key={f.id} size="sm" variant="ghost" onClick={() => ui.openFinding(f.id)}>
                {f.titleHe}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="stack-sm">
        <h3>היסטוריה</h3>
        <HistoryList filter={{ recordId: record.id }} />
      </section>
    </div>
  );
}
