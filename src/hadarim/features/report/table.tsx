import { isValidElement, useMemo, useState, type ReactNode } from "react";

/**
 * The report's table and section primitives. Every table is sortable by any column: a click on the header
 * orders the rows by that column's value — numbers, formatted amounts ("1,250,000 ₪", "−4.5%") and text are
 * all read from the cell — a second click reverses it, a third restores the report's order. Sorting is a
 * view; the totals row and the model stay where the engine put them.
 */

export function scrollToSection(n: string): void {
  document.getElementById(`report-section-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Section({ n, titleHe, children, className, breakBefore }: { n: string; titleHe: string; children: ReactNode; className?: string; breakBefore?: boolean }) {
  return (
    <section className={["h2-report-section", breakBefore ? "h2-report-break" : "", className ?? ""].filter(Boolean).join(" ")} id={`report-section-${n}`} data-testid={`report-section-${n}`}>
      <h2 className="h2-report-h2">
        <span className="h2-report-num">{n}</span>
        {titleHe}
      </h2>
      {children}
    </section>
  );
}

export function SectionLink({ n, children }: { n: string; children: ReactNode }) {
  return (
    <button type="button" className="h2-report-link no-print" onClick={() => scrollToSection(n)}>
      {children}
    </button>
  );
}

/** Text of a cell, for sorting and searching: strings as they are, elements by their text content. */
export function cellText(c: ReactNode): string {
  if (c == null || typeof c === "boolean") return "";
  if (typeof c === "string" || typeof c === "number") return String(c);
  if (Array.isArray(c)) return c.map(cellText).join("");
  if (isValidElement(c)) {
    const props = c.props as { children?: ReactNode; title?: string };
    return cellText(props.children) || props.title || "";
  }
  return "";
}

const NUMBER_RE = /^\s*([+−-])?\s*([\d,]+(?:\.\d+)?)/;

/** The value a cell sorts by: a number when the cell starts with one (signed, thousands-separated), else its text. */
export function cellKey(c: ReactNode): number | string {
  if (typeof c === "number") return c;
  const text = cellText(c).trim();
  if (text === "—" || text === "") return Number.NEGATIVE_INFINITY;
  const m = NUMBER_RE.exec(text);
  if (m) {
    const v = Number(m[2].replace(/,/g, ""));
    if (!Number.isNaN(v)) return m[1] === "−" || m[1] === "-" ? -v : v;
  }
  return text;
}

function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return 1;
  if (typeof b === "number") return -1;
  return a.localeCompare(b, "he");
}

export type SortState = { col: number; dir: "asc" | "desc" } | null;

export function sortIndices(rows: ReactNode[][], sort: SortState, keyOf: (row: ReactNode[], col: number) => number | string = (r, c) => cellKey(r[c])): number[] {
  const idx = rows.map((_, i) => i);
  if (!sort) return idx;
  const keys = rows.map((r) => keyOf(r, sort.col));
  idx.sort((i, j) => {
    const c = compareKeys(keys[i], keys[j]);
    return (sort.dir === "asc" ? c : -c) || i - j;
  });
  return idx;
}

export function SortHeader({ label, active, onClick, className }: { label: ReactNode; active: "asc" | "desc" | null; onClick: () => void; className?: string }) {
  return (
    <th className={[className ?? "", "h2-sortable", active ? `is-sorted is-${active}` : ""].filter(Boolean).join(" ")} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"} onClick={onClick} title="מיון לפי עמודה זו">
      <span className="h2-sort-label">{label}</span>
      <span className="h2-sort-caret no-print" aria-hidden="true">
        {active === "asc" ? "▲" : active === "desc" ? "▼" : "⇅"}
      </span>
    </th>
  );
}

export function nextSort(current: SortState, col: number): SortState {
  if (!current || current.col !== col) return { col, dir: "desc" };
  if (current.dir === "desc") return { col, dir: "asc" };
  return null;
}

export function DataTable({ head, rows, numeric = [], testId, className, rowClass, rowTestId, foot, emptyHe, sortable = true, dense }: { head: ReactNode[]; rows: ReactNode[][]; numeric?: number[]; testId?: string; className?: string; rowClass?: (i: number) => string | undefined; rowTestId?: (i: number) => string | undefined; foot?: ReactNode[]; emptyHe?: string; sortable?: boolean; dense?: boolean }) {
  const [sort, setSort] = useState<SortState>(null);
  const order = useMemo(() => sortIndices(rows, sortable ? sort : null), [rows, sort, sortable]);
  return (
    <div className="table-wrap h2-report-table-wrap">
      <table className={["table", "compact", "h2-report-table", dense ? "is-dense" : "", className ?? ""].filter(Boolean).join(" ")} data-testid={testId} data-sort={sort ? `${sort.col}:${sort.dir}` : undefined}>
        <thead>
          <tr>
            {head.map((h, j) =>
              sortable && rows.length > 1 ? (
                <SortHeader key={j} label={h} className={numeric.includes(j) ? "num" : undefined} active={sort && sort.col === j ? sort.dir : null} onClick={() => setSort((s) => nextSort(s, j))} />
              ) : (
                <th key={j} className={numeric.includes(j) ? "num" : undefined}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyHe ? (
            <tr>
              <td colSpan={head.length} className="muted">
                {emptyHe}
              </td>
            </tr>
          ) : null}
          {order.map((i) => (
            <tr key={i} className={rowClass?.(i)} data-testid={rowTestId?.(i)}>
              {rows[i].map((c, j) => (
                <td key={j} className={numeric.includes(j) ? "num" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {foot ? (
            <tr className="total">
              {foot.map((c, j) => (
                <td key={j} className={numeric.includes(j) ? "num" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
