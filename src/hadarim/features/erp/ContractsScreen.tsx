import { useState } from "react";
import { Button } from "../../components/primitives";
import { AttachedDocuments } from "./AttachedDocuments";
import { store, useUi, useV2State } from "../../app/store";
import type { HBoqLine, HContract, PersonId } from "../../data/types";
import { boqLineAmount, boqTotal, unitPriceHe } from "../../engine/boq";
import { pkg } from "../../engine/commands";
import { Fieldv, RecordSection } from "./InvoicesScreen";
import { dateHe, defaultActor, nis, num, personName, sectionFull, sectionShort, supplierName } from "./format";

export function ContractsScreen() {
  const ui = useUi();
  if (ui.erp.contractId) return <ContractView contractId={ui.erp.contractId} />;
  return <ContractList />;
}

function openContract(id: string | null) {
  store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "contracts", contractId: id } }));
}

function ContractList() {
  const state = useV2State();
  const rows = [...pkg.contracts].sort((a, b) => (a.id < b.id ? -1 : 1));
  const invoiced = (id: string) => state.erp.invoices.filter((i) => i.contractId === id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
  return (
    <div className="erp-screen" data-testid="erp-contract-list">
      <div className="erp-screen-head">
        <h2>חוזי קבלני משנה והסכמי מסגרת</h2>
        <span className="erp-count">{num(rows.length)} חוזים</span>
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>מס׳ חוזה</th>
              <th>ספק</th>
              <th>סעיף תקציבי</th>
              <th>היקף</th>
              <th className="num">סכום חוזה</th>
              <th className="num">נרשם עד כה</th>
              <th>נחתם</th>
              <th>עכבון</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => openContract(c.id)} data-testid={`erp-contract-row-${c.id}`}>
                <td className="mono">{c.id}</td>
                <td>{supplierName(c.supplierId)}</td>
                <td>{sectionShort(c.sectionId)}</td>
                <td className="erp-desc">{c.scopeHe}</td>
                <td className="num">{c.amount != null ? nis(c.amount) : "לפי מחירון"}</td>
                <td className="num">{nis(invoiced(c.id))}</td>
                <td>{dateHe(c.signedAt)}</td>
                <td>{c.retentionPct}%</td>
                <td>
                  <span className={`erp-status erp-status-${c.closed ? "done" : "ok"}`}>{c.closed ? "נסגר" : "פעיל"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContractView({ contractId }: { contractId: string }) {
  const state = useV2State();
  const c = pkg.contracts.find((x) => x.id === contractId);
  if (!c) {
    return (
      <div className="erp-screen">
        <p className="erp-error">חוזה {contractId} לא נמצא.</p>
        <Button size="sm" onClick={() => openContract(null)}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }
  const invoices = state.erp.invoices.filter((i) => i.contractId === c.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const recorded = invoices.filter((i) => i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
  const doc = c.documentId ? pkg.documents.find((d) => d.id === c.documentId) : null;
  return (
    <div className="erp-screen" data-testid="erp-contract-view" data-contract-id={c.id}>
      <div className="erp-screen-head">
        <h2>
          חוזה <span className="mono">{c.id}</span>
          <span className={`erp-status erp-status-${c.closed ? "done" : "ok"}`}>{c.closed ? "נסגר" : "פעיל"}</span>
        </h2>
        <div className="erp-actions">
          <Button size="sm" variant="ghost" onClick={() => openContract(null)}>
            ‹ חזרה לרשימה
          </Button>
          {doc && (
            <Button size="sm" onClick={() => store.openDocument(doc.id)} data-testid="erp-contract-document">
              📎 קטע מהחוזה
            </Button>
          )}
        </div>
      </div>
      <div className="erp-record">
        <RecordSection title="פרטי החוזה">
          <Fieldv label="ספק" value={supplierName(c.supplierId)} />
          <Fieldv label="סעיף תקציבי" value={sectionFull(c.sectionId)} strong />
          <Fieldv label="סכום החוזה" value={c.amount != null ? nis(c.amount) : "הסכם מסגרת — לפי נספח מחיר"} strong />
          <Fieldv label="נרשם עד כה" value={nis(recorded)} />
          <Fieldv label="נחתם" value={dateHe(c.signedAt)} />
          <Fieldv label="עכבון" value={`${c.retentionPct}%`} />
          <Fieldv label="היקף" value={c.scopeHe} wide />
          {c.closed && <Fieldv label="נסגר" value={`${dateHe(c.closed.at)} · חשבון סופי ${nis(c.closed.finalAccount)}`} />}
          {c.steelSuppliedByClient && <Fieldv label="ברזל" value={`מסופק על ידי המזמין${pkg.contracts.some((x) => x.priceAppendices?.length) ? ` (הסכם מסגרת ${pkg.contracts.filter((x) => x.priceAppendices?.length).map((x) => `⁨${x.id}⁩`).join(", ")})` : ""}`} />}
          <Fieldv label="התאמה לכתב כמויות" value={c.boqMatchVerified ? "✔ נבדק שורה מול שורה" : "לא נבדק"} />
          {c.noteHe && <Fieldv label="הערה" value={c.noteHe} wide />}
        </RecordSection>
        <RecordSection title="מסמכים">
          <Fieldv label="מסמכי החוזה" value={<AttachedDocuments record={{ type: "contract", id: c.id }} />} wide />
        </RecordSection>
        {c.inclusionsHe.length > 0 && (
          <section className="erp-record-section">
            <h3>כלול בחוזה</h3>
            <ul className="erp-list">
              {c.inclusionsHe.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="erp-record-section">
          <h3>החרגות</h3>
          {c.exclusions.length === 0 ? (
            <p className="erp-muted">אין החרגות רשומות.</p>
          ) : (
            <table className="erp-table compact" data-testid="erp-contract-exclusions">
              <thead>
                <tr>
                  <th>סעיף</th>
                  <th>נוסח</th>
                  <th>מכוסה בחוזה</th>
                </tr>
              </thead>
              <tbody>
                {c.exclusions.map((x, i) => (
                  <tr key={i}>
                    <td className="mono">{x.clause}</td>
                    <td>{x.textHe}</td>
                    <td>{x.coveredByContractId ? <button type="button" className="erp-link" onClick={() => openContract(x.coveredByContractId!)}>{x.coveredByContractId}</button> : <span className="erp-warn-text">לא מכוסה</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <PriceSchedule contract={c} />
        {c.priceAppendices && c.priceAppendices.length > 0 && (
          <section className="erp-record-section">
            <h3>נספחי מחיר</h3>
            <table className="erp-table compact" data-testid="erp-contract-appendices">
              <thead>
                <tr>
                  <th>נספח</th>
                  <th>כותרת</th>
                  <th className="num">מחיר לטון</th>
                  <th>בתוקף מ-</th>
                  <th>מסמך</th>
                </tr>
              </thead>
              <tbody>
                {c.priceAppendices.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.id}</td>
                    <td>{a.titleHe}</td>
                    <td className="num">{nis(a.pricePerTon)}</td>
                    <td>{dateHe(a.validFrom)}</td>
                    <td>
                      <button type="button" className="erp-link" onClick={() => store.openDocument(a.documentId)}>
                        📎 פתח
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <section className="erp-record-section">
          <h3>חשבונות על החוזה ({num(invoices.length)})</h3>
          <table className="erp-table compact">
            <thead>
              <tr>
                <th>מס׳</th>
                <th>תאריך</th>
                <th>סוג</th>
                <th>תיאור</th>
                <th>סעיף תקציבי</th>
                <th className="num">סכום</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "invoices", invoiceId: i.id, editing: false, creating: false } }))}>
                  <td className="mono">{i.id}</td>
                  <td>{dateHe(i.date)}</td>
                  <td>
                    {i.docType}
                    {i.partialNo != null ? ` ${i.partialNo}` : ""}
                  </td>
                  <td className="erp-desc">{i.descriptionHe}</td>
                  <td className={i.sectionId !== c.sectionId ? "erp-warn-text" : ""}>{sectionShort(i.sectionId)}</td>
                  <td className="num">{nis(i.amount)}</td>
                  <td>{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/**
 * The contract's price schedule: the BOQ lines it covers with their unit prices — for a lump-sum contract the
 * breakdown of the contract sum, which the total is read against. A unit price is edited in place, attributed
 * and logged; the line itself stays the bill of quantities' (open it from the line id).
 */
function PriceSchedule({ contract: c }: { contract: HContract }) {
  useV2State(); // re-render after a save (the package is re-read with the session)
  const lines = pkg.boq.filter((l) => l.coveredByContractId === c.id).sort((a, b) => a.id.localeCompare(b.id));
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (lines.length === 0) return null;
  const total = boqTotal(lines);
  const gap = c.amount != null && total.unpricedLines === 0 ? total.amount - c.amount : null;
  const openLine = (id: string) => store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "boq", boqLineId: id, sectionId: c.sectionId } }));
  return (
    <section className="erp-record-section" data-testid="erp-contract-price-schedule">
      <h3>נספח תמחור — כתב כמויות חוזי ({num(lines.length)} שורות)</h3>
      <p className="erp-muted">{c.amount != null ? "הפירוק של סכום החוזה לפי שורות כתב הכמויות שהחוזה מכסה; סכום השורות אמור להתכנס לסכום החוזה." : "השורות שהסכם המסגרת מכסה, במחיר לפי הנספח בתוקף."}</p>
      <table className="erp-table compact" data-testid="erp-contract-boq">
        <thead>
          <tr>
            <th>שורה</th>
            <th>תיאור</th>
            <th className="num">כמות</th>
            <th>יח׳</th>
            <th className="num">מחיר יח׳</th>
            <th className="num">סה״כ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) =>
            editing === l.id ? (
              <PriceEditRow
                key={l.id}
                line={l}
                onDone={(note) => {
                  setEditing(null);
                  setMessage(note);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <tr key={l.id} data-testid={`erp-contract-boq-row-${l.id}`}>
                <td>
                  <button type="button" className="erp-link mono" onClick={() => openLine(l.id)}>
                    {l.id}
                  </button>
                </td>
                <td className="erp-desc">{l.descriptionHe}</td>
                <td className="num">{num(l.qty)}</td>
                <td>{l.unit}</td>
                <td className="num">{l.unitPrice == null ? "—" : num(l.unitPrice)}</td>
                <td className="num">{boqLineAmount(l) == null ? "—" : nis(boqLineAmount(l)!)}</td>
                <td>
                  <button type="button" className="erp-link" onClick={() => setEditing(l.id)} data-testid={`erp-contract-boq-edit-${l.id}`}>
                    ערוך מחיר
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr className="erp-group-row">
            <td colSpan={5}>סה״כ נספח התמחור{total.unpricedLines ? ` (${num(total.unpricedLines)} שורות ללא מחיר)` : ""}</td>
            <td className="num" data-testid="erp-contract-boq-total">
              {nis(total.amount)}
            </td>
            <td></td>
          </tr>
          {c.amount != null && (
            <tr className="erp-group-row">
              <td colSpan={5}>סכום החוזה</td>
              <td className="num">{nis(c.amount)}</td>
              <td></td>
            </tr>
          )}
          {gap != null && gap !== 0 && (
            <tr>
              <td colSpan={5} className="erp-warn-text">
                פער בין נספח התמחור לסכום החוזה
              </td>
              <td className="num erp-warn-text" data-testid="erp-contract-boq-gap">
                {gap > 0 ? "+" : "−"}
                {nis(Math.abs(gap))}
              </td>
              <td></td>
            </tr>
          )}
        </tfoot>
      </table>
      {message && (
        <div className="erp-saved" role="status" data-testid="erp-contract-boq-saved">
          {message}
        </div>
      )}
    </section>
  );
}

function PriceEditRow({ line, onDone, onCancel }: { line: HBoqLine; onDone: (note: string) => void; onCancel: () => void }) {
  const [price, setPrice] = useState(line.unitPrice == null ? "" : String(line.unitPrice));
  const [noteHe, setNoteHe] = useState("");
  const [byId, setById] = useState<PersonId>(defaultActor("פרויקט"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const p = Number(price.replace(/[^\d]/g, ""));
  const preview = Number.isInteger(p) && p > 0 ? p * line.qty : null;
  const save = async () => {
    setSaving(true);
    try {
      await store.setBoqUnitPrice(line.id, p, byId, noteHe.trim() || undefined);
      onDone(`נשמר. שורה ${line.id}: ${unitPriceHe(line)} ← ${unitPriceHe({ unit: line.unit, unitPrice: p })} (${personName(byId)}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  return (
    <>
      <tr className="erp-row-target" data-testid={`erp-contract-boq-editing-${line.id}`}>
        <td className="mono">{line.id}</td>
        <td className="erp-desc">{line.descriptionHe}</td>
        <td className="num">{num(line.qty)}</td>
        <td>{line.unit}</td>
        <td className="num">
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="erp-contract-boq-price-input" autoFocus style={{ width: "6em" }} />
        </td>
        <td className="num">{preview == null ? "—" : nis(preview)}</td>
        <td className="erp-muted">{unitPriceHe(line)} ←</td>
      </tr>
      <tr className="erp-row-target">
        <td colSpan={7}>
          <div className="erp-form" data-testid="erp-contract-boq-edit-form">
            <div className="erp-form-grid">
              <label className="erp-field">
                <span>מבצע השינוי</span>
                <select value={byId} onChange={(e) => setById(e.target.value as PersonId)} data-testid="erp-contract-boq-by">
                  {pkg.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.nameHe} — {person.roleHe}
                    </option>
                  ))}
                </select>
              </label>
              <label className="erp-field erp-field-wide">
                <span>הבסיס לשינוי</span>
                <input value={noteHe} onChange={(e) => setNoteHe(e.target.value)} placeholder="נספח, סיכום עם הקבלן, הצעת מחיר" data-testid="erp-contract-boq-note" />
              </label>
            </div>
            {error && (
              <p className="erp-error" role="alert" data-testid="erp-contract-boq-error">
                {error}
              </p>
            )}
            <div className="erp-form-actions">
              <Button size="sm" variant="primary" onClick={save} disabled={saving || preview == null} data-testid="erp-contract-boq-save">
                שמור
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
                ביטול
              </Button>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}
