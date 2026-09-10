import { Button } from "../../components/primitives";
import { AttachedDocuments } from "./AttachedDocuments";
import { store, useUi, useV2State } from "../../app/store";
import { pkg } from "../../engine/commands";
import { Fieldv, RecordSection } from "./InvoicesScreen";
import { dateHe, nis, num, sectionFull, sectionShort, supplierName } from "./format";

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
