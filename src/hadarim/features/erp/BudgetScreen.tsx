import { Button } from "../../../components/primitives";
import { store, useV2State } from "../../app/store";
import { CURRENT_CONTROL, recordedBySection } from "../../data/generate";
import { pkg } from "../../engine/commands";
import { dateHe, nis, sectionShort } from "./format";

/** The ERP's own budget view: approved budget, live recorded amounts, commitments and the LAST APPROVED forecast. */
export function BudgetScreen() {
  const state = useV2State();
  const recorded = recordedBySection(state.erp.invoices, CURRENT_CONTROL);
  const lastFinal = [...pkg.forecasts].filter((f) => f.status === "final" && f.sections).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  const rows = pkg.sections.map((s) => {
    const fc = lastFinal.sections!.find((x) => x.sectionId === s.id)!;
    return { id: s.id, nameHe: s.nameHe, budget: s.budget, recorded: recorded[s.id], committed: fc.committed, remaining: Math.max(0, fc.committed - recorded[s.id]), eac: fc.eac };
  });
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const inReview = state.erp.invoices.filter((i) => i.status === "בבדיקה");
  return (
    <div className="erp-screen" data-testid="erp-budget">
      <div className="erp-screen-head">
        <h2>תקציב ותחזית — {pkg.project.nameHe}</h2>
        <div className="erp-actions">
          <span className="erp-count">
            תקציב גרסה {pkg.project.budgetVersion.number} (אושר {dateHe(pkg.project.budgetVersion.approvedAt)}) · כתב כמויות גרסה {pkg.project.boqVersion.number}
          </span>
          <Button size="sm" variant="primary" onClick={() => store.go("control")} data-testid="erp-budget-to-control">
            לבקרה ↗
          </Button>
        </div>
      </div>
      <div className="erp-notice">
        התחזית המוצגת היא התחזית המאושרת האחרונה (בקרה {dateHe(lastFinal.controlDate)}). התחזית לבקרה {dateHe(CURRENT_CONTROL)} מוכנה במערכת הבקרה ומתעדכנת שם לפי ההחלטות; ״נרשם״ מחושב חי מחשבונות שאושרו עד {dateHe(CURRENT_CONTROL)} (חשבונות בבדיקה — {inReview.length}, {nis(inReview.reduce((a, i) => a + i.amount, 0))} — אינם נכללים).
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table" data-testid="erp-budget-table">
          <thead>
            <tr>
              <th>סעיף</th>
              <th>שם הסעיף</th>
              <th className="num">תקציב מאושר</th>
              <th className="num">נרשם</th>
              <th className="num">התחייבויות</th>
              <th className="num">יתרת התחייבות</th>
              <th className="num">תחזית לגמר ({dateHe(lastFinal.controlDate)})</th>
              <th className="num">סטייה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`erp-budget-row-${r.id}`}>
                <td className="mono">{r.id}</td>
                <td>{r.nameHe}</td>
                <td className="num">{nis(r.budget)}</td>
                <td className="num" data-testid={`erp-recorded-${r.id}`}>
                  {nis(r.recorded)}
                </td>
                <td className="num">{r.committed ? nis(r.committed) : "—"}</td>
                <td className="num">{r.committed ? nis(r.remaining) : "—"}</td>
                <td className="num">{nis(r.eac)}</td>
                <td className={`num ${r.eac - r.budget > 0 ? "erp-warn-text" : ""}`}>{r.eac - r.budget === 0 ? "—" : nis(r.eac - r.budget)}</td>
              </tr>
            ))}
            <tr className="total">
              <td />
              <td>סה״כ</td>
              <td className="num">{nis(sum("budget"))}</td>
              <td className="num" data-testid="erp-recorded-total">
                {nis(sum("recorded"))}
              </td>
              <td className="num">{nis(sum("committed"))}</td>
              <td className="num">{nis(sum("remaining"))}</td>
              <td className="num">{nis(sum("eac"))}</td>
              <td className="num">{sum("eac") - sum("budget") === 0 ? "—" : nis(sum("eac") - sum("budget"))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="erp-muted">
        {sectionShort("17")}: יתרת בלתי צפוי מוצגת כתחזית ללא שימוש. תחזיות קודמות: {pkg.forecasts.filter((f) => f.status === "final").map((f) => `${dateHe(f.controlDate)} — ${nis(f.totalEac)}`).join(" · ")}
      </p>
    </div>
  );
}
