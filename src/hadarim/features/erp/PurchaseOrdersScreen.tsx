import { useMemo, useState } from "react";
import { Button } from "../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import type { HPurchaseOrder, PersonId, SectionId } from "../../data/types";
import { orderLineHe, pkg, updatePurchaseOrder, updatePurchaseOrderSection } from "../../engine/commands";
import { AttachedDocuments } from "./AttachedDocuments";
import { ORDER_UNITS, lineValue, pricePerUnitHe } from "../../engine/units";
import { Fieldv, RecordSection } from "./InvoicesScreen";
import { dateHe, dateTimeHe, nis, num, personName, sectionFull, sectionShort, supplierName, defaultActor } from "./format";

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
              <th>לפי יחידה</th>
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
                <td>{p.priceUnit}</td>
                <td className={`num${lineValue(p).amount === p.amount ? "" : " erp-warn-text"}`} title={lineValue(p).amount === p.amount ? undefined : "הסכום אינו שווה לכמות המומרת ליחידת המחיר × מחיר היחידה"}>
                  {nis(p.amount)}
                </td>
                <td>
                  <span className={`erp-status erp-status-${p.status === "פתוחה" ? "ok" : "done"}`}>{p.status}</span>
                </td>
              </tr>
            ))}
            <tr className="total">
              <td />
              <td />
              <td />
              <td />
              <td />
              <td>סה״כ {num(rows.length)} הזמנות</td>
              <td />
              <td />
              <td />
              <td />
              <td className="num" data-testid="erp-po-total">
                {nis(rows.reduce((a, p) => a + p.amount, 0))}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "12,000 ק״ג = 12 טון × 4,800 ₪ לטון = 57,600 ₪" — the sum with the unit conversion spelled out. */
function amountFormulaHe(po: HPurchaseOrder): string {
  const value = lineValue(po);
  if (value.incommensurable) return `יחידת הכמות (${po.unit}) ויחידת המחיר (${po.priceUnit}) אינן ניתנות להמרה זו לזו — לא ניתן לגזור את הסכום`;
  const converted = value.converted ? `${num(po.qty)} ${po.unit} = ${num(value.pricedQty!)} ${po.priceUnit} × ` : `${num(po.qty)} ${po.unit} × `;
  const derived = `${converted}${pricePerUnitHe(po.unitPrice, po.priceUnit)} = ${nis(value.amount!)}`;
  return value.amount === po.amount ? derived : `${derived} — אינו תואם את סכום ההזמנה ${nis(po.amount)}`;
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
            <Fieldv label="כמות" value={`${num(po.qty)} ${po.unit}`} strong testId="erp-po-qty" />
            <Fieldv label="יחידת הכמות" value={po.unit} strong testId="erp-po-unit" />
            <Fieldv label="מחיר יחידה" value={pricePerUnitHe(po.unitPrice, po.priceUnit)} strong testId="erp-po-unit-price" />
            <Fieldv label="סכום ההזמנה" value={nis(po.amount)} strong />
            <Fieldv label="חישוב הסכום" value={amountFormulaHe(po)} wide testId="erp-po-formula" />
            <Fieldv label="סופק" value={`${num(po.deliveredQty)} ${po.unit}`} />
            <Fieldv label="חויב" value={nis(po.invoicedAmount)} />
          </RecordSection>
          <RecordSection title="מסמכים">
            <Fieldv label="מסמכי ההזמנה והעובדות שנקראו מהם" value={<AttachedDocuments record={{ type: "po", id: String(po.id) }} />} wide />
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
  const state = useV2State();
  const [sectionId, setSectionId] = useState<SectionId>(po.sectionId);
  const [qty, setQty] = useState(String(po.qty));
  const [unit, setUnit] = useState(po.unit);
  const [priceUnit, setPriceUnit] = useState(po.priceUnit);
  const [unitPrice, setUnitPrice] = useState(String(po.unitPrice));
  const [byId, setById] = useState<PersonId>(defaultActor("פרויקט"));
  const [error, setError] = useState<string | null>(null);
  const q = Number(qty.replace(/[^\d.]/g, ""));
  const p = Number(unitPrice.replace(/[^\d.]/g, ""));
  const draft = { qty: q, unit, priceUnit, unitPrice: p };
  const value = Number.isFinite(q) && Number.isFinite(p) ? lineValue(draft) : null;
  const computed = value?.amount ?? null;
  const units = [...new Set([po.unit, po.priceUnit, ...ORDER_UNITS])];
  const sectionChanged = sectionId !== po.sectionId;
  const lineChanged = q !== po.qty || unit !== po.unit || priceUnit !== po.priceUnit || p !== po.unitPrice;
  // the invoices booked against the order keep their own section: moving the order alone splits the two
  const invoicesAgainst = state.erp.invoices.filter((i) => i.poId === po.id);

  const save = () => {
    try {
      store.dispatch((s) => {
        let next = sectionChanged ? updatePurchaseOrderSection(s, po.id, sectionId, byId) : s;
        // the amount is derived: it is recomputed from quantity/unit/price on every save, even when that no longer matches the original order
        if (lineChanged) next = updatePurchaseOrder(next, po.id, { qty: q, unit, priceUnit, unitPrice: p }, byId);
        return next;
      });
      const notes = [sectionChanged ? `סעיף תקציבי: ${sectionShort(po.sectionId)} ← ${sectionShort(sectionId)}` : "", lineChanged ? `${orderLineHe(po)} ← ${orderLineHe(draft)}` : ""].filter(Boolean);
      onDone(notes.length ? `נשמר. ${notes.join(" · ")} (${personName(byId)}).` : "נשמר ללא שינוי.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="erp-form" data-testid="erp-po-edit-form">
      <div className="erp-form-grid">
        <label className="erp-field erp-field-editable">
          <span>סעיף תקציבי *</span>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value as SectionId)} data-testid="erp-po-section-input">
            {pkg.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionFull(s.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field erp-field-editable">
          <span>כמות *</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="erp-po-qty-input" autoFocus />
        </label>
        <label className="erp-field erp-field-editable">
          <span>יחידת הכמות *</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="erp-po-unit-input">
            {units.map((u) => (
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
        <label className="erp-field erp-field-editable">
          <span>המחיר נקוב ל־*</span>
          <select value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} data-testid="erp-po-price-unit-input">
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field erp-field-wide">
          <span>סכום ההזמנה (מחושב)</span>
          <input value={computed == null ? "—" : `${num(value!.pricedQty!)} ${priceUnit} × ${pricePerUnitHe(p, priceUnit)} = ${nis(computed)}`} readOnly data-testid="erp-po-computed" />
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
      {computed == null && !error && (
        <p className="erp-warn">{`יחידת הכמות (${unit}) ויחידת המחיר (${priceUnit}) אינן ניתנות להמרה זו לזו — לא ניתן לגזור את הסכום. השמירה תידחה.`}</p>
      )}
      {sectionChanged && invoicesAgainst.length > 0 && (
        <p className="erp-warn" data-testid="erp-po-section-warn">
          {`${num(invoicesAgainst.length)} חשבונות שנרשמו כנגד ההזמנה נשארים בסעיף ${sectionShort(po.sectionId)}; שיוכם אינו משתנה עם ההזמנה.`}
        </p>
      )}
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
        <span className="erp-muted">ניתן לשנות את הסעיף התקציבי, ולתקן כמות, יחידת הכמות, מחיר יחידה והיחידה שהמחיר נקוב לה — הכמות מומרת ליחידת המחיר לפני הכפל, וסכום ההזמנה מחושב מחדש מהערכים האלה בכל שמירה, גם אם אינו תואם עוד להזמנה המקורית.</span>
      </div>
    </div>
  );
}
