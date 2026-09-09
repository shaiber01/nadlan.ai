import { Surface } from "../../../components/Drawer";
import { Button, KeyValue } from "../../../components/primitives";
import { store, useV2State, type UiState } from "../../app/store";
import { sectionLabel } from "../../engine/checks";
import { pkg } from "../../engine/commands";
import { pricePerUnitHe } from "../../engine/units";
import { dateHe, nis, num, timeHe } from "./fmt";
import "./record.css";

type RecordRef = NonNullable<UiState["viewer"]["recordRef"]>;

/** Read-only view of an ERP record (invoice, PO, contract) with its change log, and a jump into the ERP screen. */
export function RecordModal({ recordRef }: { recordRef: RecordRef }) {
  const state = useV2State();
  const close = () => store.openRecord(null);
  const supplierHe = (id: string) => pkg.suppliers.find((s) => s.id === id)?.nameHe ?? id;
  const personHe = (id: string | null) => (id ? pkg.people.find((p) => p.id === id)?.nameHe ?? id : "—");
  const log = state.erp.changeLog.filter((c) => c.recordType === recordRef.type && c.recordId === recordRef.id);

  let title = "";
  let rows: { labelHe: string; value: React.ReactNode }[] = [];
  let screen: UiState["erp"]["screen"] = "invoices";
  let erpPatch: Partial<UiState["erp"]> = {};

  if (recordRef.type === "invoice") {
    const inv = state.erp.invoices.find((i) => String(i.id) === recordRef.id);
    if (!inv) return null;
    title = `חשבון ${inv.id} — ${supplierHe(inv.supplierId)}`;
    screen = "invoices";
    erpPatch = { invoiceId: inv.id, editing: false, creating: false };
    rows = [
      { labelHe: "מס׳ מסמך ספק", value: <bdi>{inv.supplierDocNo}</bdi> },
      { labelHe: "סוג", value: `${inv.docType}${inv.partialNo ? ` מס׳ ${inv.partialNo}` : ""}` },
      { labelHe: "תאריך / התקבל", value: `${dateHe(inv.date)} / ${dateHe(inv.dateReceived)}` },
      { labelHe: "תיאור", value: inv.descriptionHe },
      { labelHe: "סכום", value: nis(inv.amount) },
      { labelHe: "סעיף תקציבי", value: <strong>{sectionLabel(inv.sectionId)}</strong> },
      { labelHe: "חוזה / הזמנה", value: `${inv.contractId ?? "—"} / ${inv.poId ?? "—"}` },
      ...(inv.cumulativeNow != null ? [{ labelHe: "מצטבר קודם / נוכחי", value: `${nis(inv.cumulativePrev ?? 0)} / ${nis(inv.cumulativeNow)}` }] : []),
      { labelHe: "עכבון", value: `${inv.retentionPct}% · ${nis(inv.retentionAmt)} · לתשלום ${nis(inv.netPayable)}` },
      { labelHe: "בניין", value: inv.building ?? "לא צוין" },
      { labelHe: "סטטוס", value: `${inv.status}${inv.approvedBy ? ` · אישר ${personHe(inv.approvedBy)}` : ""}` },
      { labelHe: "נקלט", value: `${dateHe(inv.enteredAt)} · ${personHe(inv.enteredBy)}` },
      ...(inv.attachmentId ? [{ labelHe: "מסמך מצורף", value: <button type="button" className="h2c-source is-link small" onClick={() => store.openDocument(inv.attachmentId!)}>פתח PDF ↗</button> }] : []),
    ];
  } else if (recordRef.type === "po") {
    const po = state.erp.purchaseOrders.find((p) => String(p.id) === recordRef.id);
    if (!po) return null;
    title = `הזמנת רכש ${po.id} — ${supplierHe(po.supplierId)}`;
    screen = "purchase_orders";
    erpPatch = { poId: po.id, editing: false, creating: false };
    rows = [
      { labelHe: "תאריך", value: dateHe(po.date) },
      { labelHe: "תיאור", value: po.descriptionHe },
      { labelHe: "כמות", value: <bdi>{num(po.qty)}</bdi> },
      { labelHe: "יחידת הכמות", value: po.unit },
      { labelHe: "מחיר יח׳", value: <bdi>{pricePerUnitHe(po.unitPrice, po.priceUnit)}</bdi> },
      { labelHe: "סכום", value: nis(po.amount) },
      { labelHe: "סופק / חויב", value: `${num(po.deliveredQty)} ${po.unit} / ${nis(po.invoicedAmount)}` },
      { labelHe: "סעיף תקציבי", value: sectionLabel(po.sectionId) },
      { labelHe: "חוזה", value: po.contractId ?? "—" },
      { labelHe: "סוג / סטטוס", value: `${po.kind === "blanket" ? "הזמנת מסגרת" : "חד-פעמית"} · ${po.status}` },
      ...(po.attachmentId ? [{ labelHe: "מסמך מצורף", value: <button type="button" className="h2c-source is-link small" onClick={() => store.openDocument(po.attachmentId!)}>פתח PDF ↗</button> }] : []),
    ];
  } else {
    const c = pkg.contracts.find((x) => x.id === recordRef.id);
    if (!c) return null;
    title = `חוזה ${c.id} — ${supplierHe(c.supplierId)}`;
    screen = "contracts";
    erpPatch = { contractId: c.id };
    const recorded = state.erp.invoices.filter((i) => i.contractId === c.id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
    rows = [
      { labelHe: "סעיף", value: sectionLabel(c.sectionId) },
      { labelHe: "היקף", value: c.scopeHe },
      { labelHe: "סכום חוזה", value: c.amount != null ? nis(c.amount) : "הסכם מסגרת — לפי נספח מחיר" },
      { labelHe: "נרשם עד כה", value: nis(recorded) },
      { labelHe: "נחתם", value: dateHe(c.signedAt) },
      { labelHe: "עכבון", value: `${c.retentionPct}%` },
      { labelHe: "כלול", value: c.inclusionsHe.join("; ") || "—" },
      { labelHe: "מוחרג", value: c.exclusions.length ? <ul className="h2c-notes">{c.exclusions.map((e) => <li key={e.clause}>סעיף {e.clause}: {e.textHe}{e.coveredByContractId ? ` (מכוסה בחוזה ${e.coveredByContractId})` : ""}</li>)}</ul> : "—" },
      ...(c.priceAppendices?.length ? [{ labelHe: "נספחי מחיר", value: <ul className="h2c-notes">{c.priceAppendices.map((a) => <li key={a.id}>{a.titleHe} · {num(a.pricePerTon)} ₪/{a.unit ?? "טון"} · מ-{dateHe(a.validFrom)} <button type="button" className="h2c-source is-link small" onClick={() => store.openDocument(a.documentId)}>PDF ↗</button></li>)}</ul> }] : []),
      ...(c.closed ? [{ labelHe: "נסגר", value: `${dateHe(c.closed.at)} · חשבון סופי ${nis(c.closed.finalAccount)}` }] : []),
      ...(c.noteHe ? [{ labelHe: "הערה", value: c.noteHe }] : []),
      ...(c.documentId ? [{ labelHe: "מסמך", value: <button type="button" className="h2c-source is-link small" onClick={() => store.openDocument(c.documentId!)}>פתח PDF ↗</button> }] : []),
    ];
  }

  const openInErp = () => store.setUi((u) => ({ ...u, app: "erp", erp: { ...u.erp, screen, ...erpPatch }, viewer: { ...u.viewer, recordRef: null } }));

  return (
    <Surface
      kind="modal"
      title={title}
      subtitle="רשומה במערכת המידע (קריאה בלבד)"
      onClose={close}
      footer={
        <Button variant="primary" onClick={openInErp} data-testid="record-open-erp">
          פתח במערכת המידע
        </Button>
      }
    >
      <div className="stack" data-testid="record-modal" data-record-type={recordRef.type} data-record-id={recordRef.id}>
        <KeyValue rows={rows} />
        <div>
          <h4 className="muted">יומן שינויים</h4>
          {log.length ? (
            <table className="h2c-table">
              <thead>
                <tr>
                  <th>מועד</th>
                  <th>שדה</th>
                  <th>לפני</th>
                  <th>אחרי</th>
                  <th>מי</th>
                  <th>הערה</th>
                </tr>
              </thead>
              <tbody>
                {log.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {dateHe(c.at)} {c.at.length > 10 ? timeHe(c.at) : ""}
                    </td>
                    <td>{c.field}</td>
                    <td>{c.before}</td>
                    <td>{c.after}</td>
                    <td>{personHe(c.byId)}</td>
                    <td>{c.noteHe ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">אין שינויים ברשומה זו.</p>
          )}
        </div>
      </div>
    </Surface>
  );
}
