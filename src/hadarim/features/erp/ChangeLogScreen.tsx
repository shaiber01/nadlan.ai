import { useMemo, useState } from "react";
import { store, useV2State } from "../../app/store";
import { RECORD_TYPE_HE, type HChangeLogEntry } from "../../data/types";
import { dateTimeHe, num, personName } from "./format";

export function ChangeLogScreen() {
  const state = useV2State();
  const [filter, setFilter] = useState("");
  const rows = useMemo(
    () =>
      [...state.erp.changeLog]
        .filter((c) => !filter.trim() || c.recordId.includes(filter.trim()))
        .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1)),
    [state.erp.changeLog, filter],
  );
  const open = (c: HChangeLogEntry) => {
    if (c.recordType === "invoice") store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "invoices", invoiceId: Number(c.recordId), editing: false, creating: false } }));
    else if (c.recordType === "po") store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "purchase_orders", poId: Number(c.recordId), editing: false } }));
    else if (c.recordType === "budget") store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "budget" } }));
    else if (c.recordType === "document") store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "documents" } }));
    else if (c.recordType === "boq_line") store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "boq", boqLineId: c.recordId } }));
    else store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "contracts", contractId: c.recordId } }));
  };
  return (
    <div className="erp-screen" data-testid="erp-changelog">
      <div className="erp-screen-head">
        <h2>יומן שינויים</h2>
      </div>
      <div className="erp-filters">
        <label>
          מס׳ רשומה
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="מזהה רשומה" data-testid="erp-changelog-filter" />
        </label>
        <span className="erp-count">{num(rows.length)} רשומות</span>
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>מועד</th>
              <th>רשומה</th>
              <th>שדה</th>
              <th>לפני</th>
              <th>אחרי</th>
              <th>מבצע</th>
              <th>הערה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => open(c)} data-testid="erp-changelog-row">
                <td>{dateTimeHe(c.at)}</td>
                <td className="mono">
                  {RECORD_TYPE_HE[c.recordType]} {c.recordId}
                </td>
                <td>{c.field}</td>
                <td>{c.before}</td>
                <td>{c.after}</td>
                <td>{personName(c.byId)}</td>
                <td className="erp-muted">{c.noteHe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
