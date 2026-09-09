import { useV2State } from "../../app/store";
import { pkg } from "../../engine/commands";
import { budgetChangesBySection, recordedBySection } from "../../engine/forecast";
import { BudgetChangesPanel } from "./BudgetChangesPanel";
import { dateHe, nis } from "./format";

/** The ERP's own budget view: approved budget, live recorded amounts, commitments and the LAST APPROVED forecast. */
export function BudgetScreen() {
  const state = useV2State();
  const CURRENT_CONTROL = pkg.project.currentControlDate;
  const recorded = recordedBySection(pkg.sections, state.erp.invoices, CURRENT_CONTROL);
  const contingency = pkg.sections.find((s) => s.kind === "contingency");
  const lastFinal = [...pkg.forecasts].filter((f) => f.status === "final" && f.sections).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  const deltas = budgetChangesBySection(pkg.budgetChanges, CURRENT_CONTROL);
  const rows = pkg.sections.map((s) => {
    const fc = lastFinal.sections!.find((x) => x.sectionId === s.id)!;
    const changes = deltas[s.id] ?? 0;
    return { id: s.id, nameHe: s.nameHe, chapters: (s.chapters ?? []).join(", "), budget: s.budget, changes, updated: s.budget + changes, recorded: recorded[s.id], committed: fc.committed, remaining: Math.max(0, fc.committed - recorded[s.id]), eac: fc.eac };
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
        </div>
      </div>
      <div className="erp-notice">
        התחזית המוצגת היא התחזית המאושרת האחרונה (בקרה {dateHe(lastFinal.controlDate)}). התחזית לבקרה {dateHe(CURRENT_CONTROL)} נבנית בדוח הבקרה ומתעדכנת שם לפי החלטות הסוכן; ״נרשם״ מחושב חי מחשבונות שאושרו עד {dateHe(CURRENT_CONTROL)} (חשבונות בבדיקה — {inReview.length}, {nis(inReview.reduce((a, i) => a + i.amount, 0))} — אינם נכללים).
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table" data-testid="erp-budget-table">
          <thead>
            <tr>
              <th>סעיף</th>
              <th>שם הסעיף</th>
              <th>פרקי המפרט</th>
              <th className="num">תקציב מקורי</th>
              <th className="num">שינויים</th>
              <th className="num">תקציב מעודכן</th>
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
                <td className="mono erp-muted">{r.chapters || "—"}</td>
                <td className="num">{nis(r.budget)}</td>
                <td className="num">{r.changes ? nis(r.changes) : "—"}</td>
                <td className="num" data-testid={`erp-updated-budget-${r.id}`}>
                  {nis(r.updated)}
                </td>
                <td className="num" data-testid={`erp-recorded-${r.id}`}>
                  {nis(r.recorded)}
                </td>
                <td className="num">{r.committed ? nis(r.committed) : "—"}</td>
                <td className="num">{r.committed ? nis(r.remaining) : "—"}</td>
                <td className="num">{nis(r.eac)}</td>
                <td className={`num ${r.eac - r.updated > 0 ? "erp-warn-text" : ""}`}>{r.eac - r.updated === 0 ? "—" : nis(r.eac - r.updated)}</td>
              </tr>
            ))}
            <tr className="total">
              <td />
              <td>סה״כ</td>
              <td />
              <td className="num">{nis(sum("budget"))}</td>
              <td className="num">{sum("changes") ? nis(sum("changes")) : "—"}</td>
              <td className="num" data-testid="erp-updated-budget-total">
                {nis(sum("updated"))}
              </td>
              <td className="num" data-testid="erp-recorded-total">
                {nis(sum("recorded"))}
              </td>
              <td className="num">{nis(sum("committed"))}</td>
              <td className="num">{nis(sum("remaining"))}</td>
              <td className="num">{nis(sum("eac"))}</td>
              <td className="num">{sum("eac") - sum("updated") === 0 ? "—" : nis(sum("eac") - sum("updated"))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <BudgetChangesPanel />
      <p className="erp-muted">
        {contingency ? `${contingency.shortHe}: יתרת הרזרבה מוצגת כתחזית ללא שימוש. ` : ""}תחזיות קודמות: {pkg.forecasts.filter((f) => f.status === "final").map((f) => `${dateHe(f.controlDate)} — ${nis(f.totalEac)}`).join(" · ")}
      </p>
    </div>
  );
}
