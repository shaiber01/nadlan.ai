import { useMemo, useState, type ReactNode } from "react";
import { STANDARD_MATERIALITY } from "../../data/types";
import { scaleMoney } from "../../engine/kpis";
import type { ReportModel, SectionRow } from "../../engine/report";
import { BasisBar } from "./kpis";
import { nis, num, signedNis, signedPct } from "./format";
import { SectionLink, SortHeader, nextSort, type SortState } from "./table";

/**
 * Standard §3, the sections table, as a working surface: the fifteen mandatory columns in their order, sorted
 * by any column, filtered to the material rows or the soft forecasts, searched by name, shown in shekels or
 * restated per gross m² / per unit (the engine's rounding), and a row that opens to its forecast lines. The
 * rarely-read columns (approved budget, changes, commitments, previous forecast) fold away on screen and are
 * always in the print and the exports. Nothing here is computed: money is scaled by the engine, the basis
 * composition comes with the row.
 */

const HEAD = ["#", "סעיף", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס"];
const NUMERIC = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
/** Columns folded away in the compact view. */
const EXTRA = new Set([2, 3, 6, 12]);
const MONEY_KEYS: (keyof SectionRow)[] = ["budget", "changes", "updatedBudget", "recorded", "committed", "remainingCommitment", "uncovered", "eac", "variance", "previousEac", "change"];

type View = "nis" | "sqm" | "unit";
type Filter = "all" | "material" | "soft";

function keyOf(r: SectionRow, col: number): number | string {
  switch (col) {
    case 0:
      return r.sectionId;
    case 1:
      return r.nameHe;
    case 2:
      return r.budget;
    case 3:
      return r.changes;
    case 4:
      return r.updatedBudget;
    case 5:
      return r.recorded;
    case 6:
      return r.committed;
    case 7:
      return r.remainingCommitment;
    case 8:
      return r.uncovered;
    case 9:
      return r.eac;
    case 10:
      return r.variance;
    case 11:
      return r.variancePct;
    case 12:
      return r.previousEac;
    case 13:
      return r.change;
    default:
      return r.basisPct;
  }
}

function cells(r: SectionRow, view: View, isTotal = false): ReactNode[] {
  const money = view === "nis" ? nis : (v: number) => num(v);
  const signedMoney = view === "nis" ? signedNis : (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${num(Math.abs(v))}`);
  const tone = (v: number) => (v > 0 ? "h2-num-up" : v < 0 ? "h2-num-down" : undefined);
  return [
    isTotal ? "" : r.sectionId,
    isTotal ? "סה״כ" : r.isContingency ? `${r.nameHe} — שורה נפרדת` : r.nameHe,
    money(r.budget),
    r.changes === 0 ? "—" : signedMoney(r.changes),
    money(r.updatedBudget),
    money(r.recorded),
    money(r.committed),
    money(r.remainingCommitment),
    money(r.uncovered),
    <strong key="eac">{money(r.eac)}</strong>,
    <span key="v" className={tone(r.variance)}>
      {signedMoney(r.variance)}
    </span>,
    <span key="vp" className={tone(r.variance)}>
      {signedPct(r.variancePct)}
    </span>,
    money(r.previousEac),
    <span key="c" className={tone(r.change)}>
      {signedMoney(r.change)}
    </span>,
    <span key="basis" className="h2-basis-cell">
      <BasisBar fact={r.factPct} commitment={r.commitmentPct} estimate={r.estimatePct} compact />
      <span className={r.basisPct < 70 && !r.isContingency ? "h2-report-soft" : undefined}>{`${num(r.basisPct)}%`}</span>
    </span>,
  ];
}

const BASIS_HE: Record<string, string> = { invoice: "חשבון מאושר", contract: "חוזה חתום", po: "הזמנה מאושרת", quote: "הצעת מחיר", appendix: "נספח מחיר", estimate: "אומדן פנימי", allocation: "הקצאה פנימית" };

export function SectionsTable({ report }: { report: ReportModel }) {
  const sec = report.sections;
  const k = report.kpis;
  const [view, setView] = useState<View>("nis");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [allCols, setAllCols] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const softPct = sec.softBasisPct ?? STANDARD_MATERIALITY.softBasisPct;
  const divisor = view === "sqm" ? (k?.grossSqm ?? 0) : view === "unit" ? (k?.units ?? 0) : 1;
  const scaled = useMemo(() => (divisor > 1 ? sec.rows.map((r) => scaleMoney(r, divisor, MONEY_KEYS)) : sec.rows), [sec.rows, divisor]);
  const totals = useMemo(() => (divisor > 1 ? scaleMoney(sec.totals, divisor, MONEY_KEYS) : sec.totals), [sec.totals, divisor]);
  const visible = useMemo(() => {
    const q = query.trim();
    return scaled.map((_, i) => i).filter((i) => {
      const r = scaled[i];
      if (filter === "material" && !r.highlighted) return false;
      if (filter === "soft" && !(r.basisPct < softPct && !r.isContingency)) return false;
      if (q && !`${r.sectionId} ${r.nameHe}`.includes(q)) return false;
      return true;
    });
  }, [scaled, filter, query]);
  const order = useMemo(() => {
    if (!sort) return visible;
    const { col, dir } = sort;
    return [...visible].sort((a, b) => cmp(keyOf(scaled[a], col), keyOf(scaled[b], col)) * (dir === "asc" ? 1 : -1) || a - b);
  }, [visible, scaled, sort]);
  const colClass = (j: number) => [NUMERIC.includes(j) ? "num" : "", EXTRA.has(j) ? "h2-col-extra" : ""].filter(Boolean).join(" ") || undefined;
  const unitHe = view === "sqm" ? "₪ למ״ר ברוטו" : view === "unit" ? "₪ ליח״ד" : "₪";
  const count = (f: Filter) => (f === "all" ? sec.rows.length : f === "material" ? sec.rows.filter((r) => r.highlighted).length : sec.rows.filter((r) => r.basisPct < softPct && !r.isContingency).length);
  return (
    <>
      <div className="h2-table-tools no-print" data-testid="report-sections-tools">
        <span className="h2-seg" role="group" aria-label="יחידת הסכומים">
          <button type="button" aria-pressed={view === "nis"} onClick={() => setView("nis")} data-testid="report-sections-view-nis">
            ₪
          </button>
          {k && k.grossSqm > 0 ? (
            <button type="button" aria-pressed={view === "sqm"} onClick={() => setView("sqm")} data-testid="report-sections-view-sqm">
              ₪ למ״ר
            </button>
          ) : null}
          {k && k.units > 0 ? (
            <button type="button" aria-pressed={view === "unit"} onClick={() => setView("unit")} data-testid="report-sections-view-unit">
              ₪ ליח״ד
            </button>
          ) : null}
        </span>
        {(["all", "material", "soft"] as Filter[]).map((f) => (
          <button key={f} type="button" className="h2-chip" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`report-sections-filter-${f}`}>
            {f === "all" ? "כל הסעיפים" : f === "material" ? "מהותיים בלבד" : `תחזית רכה (בסיס < ${softPct}%)`} <span className="h2-chip-count">{count(f)}</span>
          </button>
        ))}
        <span className="h2-tools-grow" />
        <input className="h2-search" type="search" placeholder="חיפוש סעיף…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="חיפוש סעיף" data-testid="report-sections-search" />
        <button type="button" className="h2-chip" aria-pressed={allCols} onClick={() => setAllCols((v) => !v)} data-testid="report-sections-columns">
          {allCols ? "עמודות עיקריות" : "כל העמודות"}
        </button>
      </div>
      <div className="table-wrap h2-report-table-wrap">
        <table className="table compact h2-report-table h2-report-sections" data-testid="report-sections-table" data-view={view} data-cols={allCols ? "all" : "compact"} data-sort={sort ? `${sort.col}:${sort.dir}` : undefined}>
          <thead>
            <tr>
              {HEAD.map((h, j) => (
                <SortHeader key={j} label={j === 1 ? `${h}${view !== "nis" ? ` (${unitHe})` : ""}` : h} className={colClass(j)} active={sort && sort.col === j ? sort.dir : null} onClick={() => setSort((s) => nextSort(s, j))} />
              ))}
            </tr>
          </thead>
          <tbody>
            {order.length === 0 ? (
              <tr>
                <td colSpan={HEAD.length} className="muted">
                  אין סעיפים שעונים לסינון.
                </td>
              </tr>
            ) : null}
            {order.map((i) => {
              const r = scaled[i];
              const lines = report.working.sections.find((s) => s.sectionId === r.sectionId)?.lines ?? [];
              const isOpen = !!open[r.sectionId];
              return [
                <tr key={r.sectionId} className={[r.highlighted ? "is-highlighted" : "", r.isContingency ? "is-contingency" : "", isOpen ? "is-open" : "", "h2-row-expandable"].filter(Boolean).join(" ") || undefined} data-testid={`report-row-${r.sectionId}`} onClick={() => setOpen((o) => ({ ...o, [r.sectionId]: !o[r.sectionId] }))} aria-expanded={isOpen}>
                  {cells(r, view).map((c, j) => (
                    <td key={j} className={colClass(j)}>
                      {j === 0 ? (
                        <>
                          <span className="h2-row-caret no-print" aria-hidden="true">
                            {isOpen ? "▾" : "▸"}
                          </span>
                          {c}
                        </>
                      ) : j === 1 && r.highlighted ? (
                        <>
                          {c} <SectionLink n="4">→ סעיף 4</SectionLink>
                        </>
                      ) : (
                        c
                      )}
                    </td>
                  ))}
                </tr>,
                isOpen ? (
                  <tr key={`${r.sectionId}-lines`} className="h2-row-lines no-print" data-testid={`report-row-${r.sectionId}-lines`}>
                    <td />
                    <td colSpan={HEAD.length - 1}>
                      <div className="h2-row-lines-body">
                        {r.chaptersHe ? <span className="muted small">פרקי המפרט: {r.chaptersHe}</span> : null}
                        {lines.length === 0 ? (
                          <span className="muted small">אין שורות תחזית — הסעיף נרשם במלואו.</span>
                        ) : (
                          <ul>
                            {lines.map((l) => (
                              <li key={l.id}>
                                <span className={`h2-line-kind is-${l.kind}`}>{l.kind === "uncovered" ? "לא מכוסה" : "יתרת התחייבות"}</span> {l.descriptionHe} · <span className="muted">{BASIS_HE[l.basis] ?? l.basis}</span> · <b>{nis(l.amount)}</b>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            <tr className="total" data-testid="report-row-total">
              {cells(totals, view, true).map((c, j) => (
                <td key={j} className={colClass(j)}>
                  {c}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function cmp(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return 1;
  if (typeof b === "number") return -1;
  return a.localeCompare(b, "he");
}
