import { useMemo, useState } from "react";
import { Button } from "../../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import type { HPurchaseOrder, PersonId } from "../../data/types";
import { pkg, updatePurchaseOrder } from "../../engine/commands";
import { Fieldv, RecordSection } from "./InvoicesScreen";
import { dateHe, dateTimeHe, nis, num, personName, sectionFull, sectionShort, supplierName } from "./format";

const UNITS = ["ק״ג", "טון", "יח׳", "מ׳", "מ״ר", "מ״ק", "קומפ׳", "חודש", "שעה"];

export function PurchaseOrdersScreen() {
  const ui = useUi();
  if (ui.erp.poId != null) return <PurchaseOrderView poId={ui.erp.poId} />;
  return <PurchaseOrderList />;
}

function openPo(id: number | null, editing = false) {
  store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "purchase_orders", poId: id, editing } }));
}

function PurchaseOrderList() {
  const state = useV2State();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const rows = useMemo(
    () =>
      [...state.erp.purchaseOrders]
        .filter((p) => !status || p.status === status)
        .filter((p) => !search.trim() || String(p.id).includes(search.trim()) || p.descriptionHe.includes(search.trim()) || supplierName(p.supplierId).includes(search.trim()))
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1)),
    [state.erp.purchaseOrders, search, status],
  );
  const open = rows.filter((p) => p.status === "פתוחה");
  return (
    <div className="erp-screen" data-testid="erp-po-list">
      <div className="erp-screen-head">
        <h2>הזמנות רכש</h2>
      </div>
      <div className="erp-filters">
        <label>
          חיפוש
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="מס׳ הזמנה / ספק / תיאור" />
        </label>
        <label>
          סטטוס
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">הכול</option>
            <option value="פתוחה">פתוחה</option>
            <option value="סגורה">סגורה</option>
          </select>
        </label>
        <span className="erp-count">
          {num(rows.length)} הזמנות · {num(open.length)} פתוחות · {nis(open.reduce((a, p) => a + p.amount, 0))}
        </span>
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>מס׳</th>
              <th>תאריך</th>
              <th>ספק</th>
              <th>סעיף תקציבי</th>
              <th>סוג</th>
              <th>תיאור</th>
              <th className="num">כמות</th>
              <th>יחידה</th>
              <th className="num">מחיר יח׳</th>
              <th className="num">סכום</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => openPo(p.id)} data-testid={`erp-po-row-${p.id}`}>
                <td className="mono">{p.id}</td>
                <td>{dateHe(p.date)}</td>
                <td>{supplierName(p.supplierId)}</td>
                <td>{sectionShort(p.sectionId)}</td>
                <td>{p.kind === "blanket" ? "מסגרת" : "חד-פעמית"}</td>
                <td className="erp-desc">{p.descriptionHe}</td>
                <td className="num">{num(p.qty)}</td>
                <td>{p.unit}</td>
                <td className="num">{num(p.unitPrice)}</td>
                <td className="num">{nis(p.amount)}</td>
                <td>
                  <span className={`erp-status erp-status-${p.status === "פתוחה" ? "ok" : "done"}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PurchaseOrderView({ poId }: { poId: number }) {
  const state = useV2State();
  const ui = useUi();
  const po = state.erp.purchaseOrders.find((p) => p.id === poId);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  if (!po) {
    return (
      <div className="erp-screen">
        <p className="erp-error">הזמנה {poId} לא נמצאה.</p>
        <Button size="sm" onClick={() => openPo(null)}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }
  const log = state.erp.changeLog.filter((c) => c.recordType === "po" && c.recordId === String(po.id)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const attachment = po.attachmentId ? pkg.documents.find((d) => d.id === po.attachmentId) : null;
  const contract = po.contractId ? pkg.contracts.find((c) => c.id === po.contractId) : null;
  return (
    <div className="erp-screen" data-testid="erp-po-view" data-po-id={po.id}>
      <div className="erp-screen-head">
        <h2>
          הזמנת רכש <span className="mono">{po.id}</span>
          <span className={`erp-status erp-status-${po.status === "פתוחה" ? "ok" : "done"}`}>{po.status}</span>
        </h2>
        <div className="erp-actions">
          <Button size="sm" variant="ghost" onClick={() => openPo(null)} data-testid="erp-po-back">
            ‹ חזרה לרשימה
          </Button>
          {attachment && (
            <Button size="sm" onClick={() => store.openDocument(attachment.id)} data-testid="erp-po-attachment">
              📎 פתח קובץ מצורף
            </Button>
          )}
          {!ui.erp.editing && (
            <Button size="sm" variant="primary" onClick={() => openPo(po.id, true)} data-testid="erp-po-edit">
              עריכה
            </Button>
          )}
        </div>
      </div>
      {savedNote && (
        <div className="erp-saved" role="status" data-testid="erp-po-saved">
          {savedNote}
        </div>
      )}
      {ui.erp.editing ? (
        <PoEditForm
          po={po}
          onDone={(note) => {
            setSavedNote(note);
            openPo(po.id);
          }}
          onCancel={() => openPo(po.id)}
        />
      ) : (
        <div className="erp-record">
          <RecordSection title="פרטי ההזמנה">
            <Fieldv label="ספק" value={supplierName(po.supplierId)} />
            <Fieldv label="תאריך" value={dateHe(po.date)} />
            <Fieldv label="סוג" value={po.kind === "blanket" ? "הזמנת מסגרת" : "הזמנה חד-פעמית"} />
            <Fieldv label="סעיף תקציבי" value={sectionFull(po.sectionId)} strong />
            <Fieldv label="חוזה" value={contract ? `${contract.id} — ${contract.scopeHe}` : "—"} />
            <Fieldv label="תיאור" value={po.descriptionHe} wide />
          </RecordSection>
          <RecordSection title="כמות ומחיר">
            <Fieldv label="כמות" value={num(po.qty)} strong testId="erp-po-qty" />
            <Fieldv label="יחידה" value={po.unit} strong testId="erp-po-unit" />
            <Fieldv label="מחיר יחידה" value={nis(po.unitPrice)} strong testId="erp-po-unit-price" />
            <Fieldv label="סכום ההזמנה" value={nis(po.amount)} strong />
            <Fieldv label="סופק" value={`${num(po.deliveredQty)} ${po.unit}`} />
            <Fieldv label="חויב" value={nis(po.invoicedAmount)} />
          </RecordSection>
          <RecordSection title="מסמכים">
            <Fieldv
              label="קובץ מצורף"
              value={
                attachment ? (
                  <button type="button" className="erp-link" onClick={() => store.openDocument(attachment.id)}>
                    📎 {attachment.fileName}
                  </button>
                ) : (
                  "—"
                )
              }
            />
          </RecordSection>
        </div>
      )}
      <section className="erp-subsection">
        <h3>יומן שינויים לרשומה</h3>
        {log.length === 0 ? (
          <p className="erp-muted">אין שינויים מתועדים לרשומה זו.</p>
        ) : (
          <table className="erp-table compact">
            <thead>
              <tr>
                <th>מועד</th>
                <th>שדה</th>
                <th>לפני</th>
                <th>אחרי</th>
                <th>מבצע</th>
                <th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id} data-testid="erp-changelog-row">
                  <td>{dateTimeHe(c.at)}</td>
                  <td>{c.field}</td>
                  <td>{c.before}</td>
                  <td>{c.after}</td>
                  <td>{personName(c.byId)}</td>
                  <td className="erp-muted">{c.noteHe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function PoEditForm({ po, onDone, onCancel }: { po: HPurchaseOrder; onDone: (note: string) => void; onCancel: () => void }) {
  const [qty, setQty] = useState(String(po.qty));
  const [unit, setUnit] = useState(po.unit);
  const [unitPrice, setUnitPrice] = useState(String(po.unitPrice));
  const [byId, setById] = useState<PersonId>("EYAL");
  const [error, setError] = useState<string | null>(null);
  const q = Number(qty.replace(/[^\d.]/g, ""));
  const p = Number(unitPrice.replace(/[^\d.]/g, ""));
  const computed = Math.round(q * p);
  const mismatch = Number.isFinite(computed) && computed !== po.amount;

  const save = () => {
    try {
      store.dispatch((s) => updatePurchaseOrder(s, po.id, { qty: q, unit, unitPrice: p }, byId));
      onDone(`נשמר. ${num(po.qty)} ${po.unit} × ${num(po.unitPrice)} ← ${num(q)} ${unit} × ${num(p)} (${personName(byId)}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="erp-form" data-testid="erp-po-edit-form">
      <div className="erp-form-grid">
        <label className="erp-field erp-field-editable">
          <span>כמות *</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="erp-po-qty-input" autoFocus />
        </label>
        <label className="erp-field erp-field-editable">
          <span>יחידה *</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="erp-po-unit-input">
            {[...new Set([po.unit, ...UNITS])].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field erp-field-editable">
          <span>מחיר יחידה *</span>
          <input inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} data-testid="erp-po-price-input" />
        </label>
        <label className="erp-field">
          <span>סכום ההזמנה (קבוע)</span>
          <input value={nis(po.amount)} readOnly />
        </label>
        <label className="erp-field">
          <span>כמות × מחיר</span>
          <input value={Number.isFinite(computed) ? nis(computed) : "—"} readOnly className={mismatch ? "erp-input-warn" : ""} />
        </label>
        <label className="erp-field">
          <span>מבצע השינוי</span>
          <select value={byId} onChange={(e) => setById(e.target.value as PersonId)} data-testid="erp-po-by">
            {pkg.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.nameHe} — {person.roleHe}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mismatch && !error && <p className="erp-warn">כמות × מחיר יחידה ({nis(computed)}) אינם שווים לסכום ההזמנה ({nis(po.amount)}). השמירה תידחה.</p>}
      {error && (
        <p className="erp-error" role="alert" data-testid="erp-po-error">
          {error}
        </p>
      )}
      <div className="erp-form-actions">
        <Button size="sm" variant="primary" onClick={save} data-testid="erp-po-save">
          שמור
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
        <span className="erp-muted">סכום ההזמנה נעול לאחר אישור; ניתן לתקן כמות, יחידה ומחיר יחידה בלבד.</span>
      </div>
    </div>
  );
}
