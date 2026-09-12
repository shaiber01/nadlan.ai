import { useState, type ReactNode } from "react";
import { RANGE_STATUS_HE, type CostGroupRow, type DerivedIndexRow, type MaterialIndexRow, type RangeStatus, type ReportKpis } from "../../engine/kpis";
import type { ReportModel } from "../../engine/report";
import { nis, num, pct, signedNis } from "./format";
import { DataTable, Section } from "./table";

/**
 * Standard §2א — the cost and quantity indices: the KPI strip under the masthead, the section itself (cost per
 * m² by group, material indices against the gross area, two charts) and the material cards §5 attaches to a
 * section measured in quantities. Everything is read from `report.kpis`; nothing is computed here.
 */

const fixed = (v: number | null, digits: number) => (v == null ? "—" : v.toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const PRICE_KIND_HE: Record<MaterialIndexRow["currentPriceKind"], string> = { appendix: "נספח בתוקף", contract: "חוזה", estimate: "אומדן", mixed: "מעורב", none: "" };
const signedNum = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${num(Math.abs(v))}`);

/** Composition of a forecast: fact (recorded) · commitment · estimate — one bar, three segments, hatched for estimates. */
export function BasisBar({ fact, commitment, estimate, compact }: { fact: number; commitment: number; estimate: number; compact?: boolean }) {
  return (
    <span className={["h2-basis-bar", compact ? "is-compact" : ""].filter(Boolean).join(" ")} role="img" aria-label={`עובדה ${fact}% · התחייבות ${commitment}% · אומדן ${estimate}%`} title={`עובדה ${fact}% · התחייבות ${commitment}% · אומדן ${estimate}%`}>
      {fact > 0 ? <i className="is-fact" style={{ width: `${fact}%` }} /> : null}
      {commitment > 0 ? <i className="is-commitment" style={{ width: `${commitment}%` }} /> : null}
      {estimate > 0 ? <i className="is-estimate" style={{ width: `${estimate}%` }} /> : null}
    </span>
  );
}

export function BasisLegend() {
  return (
    <div className="h2-basis-legend" aria-hidden="true">
      <span>
        <i className="is-fact" />
        עובדה — חשבונות מאושרים
      </span>
      <span>
        <i className="is-commitment" />
        התחייבות — חוזים והזמנות
      </span>
      <span>
        <i className="is-estimate" />
        אומדן — הצעות ואומדנים
      </span>
    </div>
  );
}

function RangePill({ status }: { status: RangeStatus }) {
  const tone = status === "within" ? "ok" : status === "none" ? "na" : "warn";
  return (
    <span className={`h2-range-pill is-${tone}`} data-status={status}>
      {RANGE_STATUS_HE[status]}
    </span>
  );
}

/** The value's place inside its reference band: the band is drawn at 20–80 % of the track, so above and below stay visible. */
function RangeTrack({ value, range, digits }: { value: number | null; range: { min: number; max: number } | null; digits: number }) {
  if (value == null || !range || range.max <= range.min) return null;
  const span = range.max - range.min;
  const pos = 20 + ((value - range.min) / span) * 60;
  const left = Math.max(2, Math.min(98, pos));
  return (
    <span className="h2-range-track" title={`טווח ייחוס ${fixed(range.min, digits)}–${fixed(range.max, digits)}`} aria-hidden="true">
      <b />
      <i style={{ left: `${left}%` }} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// The strip under the masthead
// ---------------------------------------------------------------------------

function Sparkline({ series }: { series: { labelHe: string; value: number }[] }) {
  if (series.length < 2) return null;
  const W = 84;
  const H = 24;
  const lo = Math.min(...series.map((p) => p.value));
  const hi = Math.max(...series.map((p) => p.value));
  const y = (v: number) => (hi === lo ? H / 2 : 3 + ((hi - v) / (hi - lo)) * (H - 6));
  const x = (i: number) => 3 + (i * (W - 6)) / (series.length - 1);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <svg className="h2-kpi-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ direction: "ltr" }}>
      <path d={d} fill="none" strokeWidth={2} />
      <circle cx={x(series.length - 1)} cy={y(last.value)} r={3} />
    </svg>
  );
}

export function KpiStrip({ report }: { report: ReportModel }) {
  const k = report.kpis;
  const t = report.sections.totals;
  const s = report.status;
  const contingency = report.contingency;
  return (
    <div className="h2-kpis" data-testid="report-kpi-strip">
      <div className="h2-kpi is-lead">
        <div className="h2-kpi-label">תחזית לגמר (EAC)</div>
        <div className="h2-kpi-value" data-testid="report-kpi-eac">
          {(t.eac / 1_000_000).toFixed(2)}
          <small>מ׳ ₪</small>
        </div>
        <div className="h2-kpi-detail">
          <span className={t.variance > 0 ? "is-up" : t.variance < 0 ? "is-down" : ""}>{t.variance === 0 ? "בתוך התקציב" : `${signedNis(t.variance)} מהתקציב (${pct(Math.abs(t.variancePct), 1)})`}</span>
          <span>· {t.change === 0 ? "ללא שינוי מבקרה קודמת" : `${signedNis(t.change)} מבקרה קודמת`}</span>
        </div>
        <Sparkline series={report.trends.eacSeries} />
      </div>
      {k && k.grossSqm > 0 ? (
        <div className="h2-kpi">
          <div className="h2-kpi-label">עלות למ״ר ברוטו</div>
          <div className="h2-kpi-value" data-testid="report-kpi-per-sqm">
            {num(k.total.eacPerSqm)}
            <small>₪/מ״ר</small>
          </div>
          <div className="h2-kpi-detail">
            <span>תקציב {num(k.total.budgetPerSqm)}</span>
            <span className={k.total.eacPerSqm - k.total.budgetPerSqm > 0 ? "is-up" : k.total.eacPerSqm - k.total.budgetPerSqm < 0 ? "is-down" : ""}>· {signedNum(k.total.eacPerSqm - k.total.budgetPerSqm)}</span>
            {k.total.range ? <RangePill status={k.total.rangeStatus} /> : null}
          </div>
        </div>
      ) : null}
      {k && k.units > 0 ? (
        <div className="h2-kpi">
          <div className="h2-kpi-label">עלות ליח״ד</div>
          <div className="h2-kpi-value" data-testid="report-kpi-per-unit">
            {num(Math.round(k.total.eacPerUnit / 1000))}
            <small>א׳ ₪</small>
          </div>
          <div className="h2-kpi-detail">
            <span>תקציב {num(Math.round(k.total.budgetPerUnit / 1000))} א׳</span>
            <span className={k.total.eacPerUnit - k.total.budgetPerUnit > 0 ? "is-up" : k.total.eacPerUnit - k.total.budgetPerUnit < 0 ? "is-down" : ""}>· {signedNum(Math.round((k.total.eacPerUnit - k.total.budgetPerUnit) / 1000))} א׳</span>
          </div>
        </div>
      ) : null}
      <div className="h2-kpi">
        <div className="h2-kpi-label">בסיס התחזית</div>
        <div className="h2-kpi-value">
          {num(t.basisPct)}%<small>מחויב</small>
        </div>
        <BasisBar fact={t.factPct} commitment={t.commitmentPct} estimate={t.estimatePct} />
        <div className="h2-kpi-detail">
          {t.factPct}% עובדה · {t.commitmentPct}% התחייבות · {t.estimatePct}% אומדן
        </div>
      </div>
      <div className="h2-kpi">
        <div className="h2-kpi-label">ביצוע פיזי מול הוצאה</div>
        <div className="h2-kpi-value">
          {s.physicalPct != null ? `${num(s.physicalPct)}%` : "—"}
          <small>/ {pct(s.expensePct, 0)}</small>
        </div>
        <div className="h2-kpi-detail">בלתי צפוי: {nis(contingency.remaining)}{contingency.original ? ` (${pct((contingency.remaining / contingency.original) * 100, 0)} מהמקור)` : ""}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2א
// ---------------------------------------------------------------------------

function groupCells(g: CostGroupRow, view: "sqm" | "unit"): ReactNode[] {
  const budget = view === "sqm" ? g.budgetPerSqm : g.budgetPerUnit;
  const eac = view === "sqm" ? g.eacPerSqm : g.eacPerUnit;
  const delta = eac - budget;
  return [
    g.labelHe,
    <span key="s" className="muted">
      {g.sectionsHe}
    </span>,
    num(budget),
    num(eac),
    <span key="d" className={delta > 0 ? "h2-num-up" : delta < 0 ? "h2-num-down" : undefined}>
      {signedNum(delta)}
    </span>,
    num(view === "sqm" ? g.recordedPerSqm : g.recordedPerUnit),
    `${g.sharePct.toLocaleString("he-IL", { maximumFractionDigits: 1 })}%`,
    g.id === "contingency" ? (
      <span key="b" className="muted">
        רזרבה
      </span>
    ) : (
      <span key="b" className="h2-basis-cell">
        <BasisBar fact={g.factPct} commitment={g.commitmentPct} estimate={g.estimatePct} compact />
        <span className={g.basisPct < 70 ? "h2-report-soft" : undefined}>{num(g.basisPct)}%</span>
      </span>
    ),
  ];
}

function materialCells(m: MaterialIndexRow): ReactNode[] {
  return [
    <span key="l">
      <strong>{m.labelHe}</strong> <span className="muted">(פרק {m.chapter}, {m.unit})</span>
    </span>,
    `${num(m.boqQty)} ${m.unit}`,
    <strong key="p">{m.perSqm == null ? "—" : `${fixed(m.perSqm, m.digits)} ${m.perSqmUnitHe}`}</strong>,
    <span key="r" className="h2-range-cell">
      <RangePill status={m.rangeStatus} />
      <RangeTrack value={m.perSqm} range={m.range} digits={m.digits} />
    </span>,
    m.deliveredQty != null ? (
      `${num(Math.round(m.deliveredQty))} ${m.unit}${m.deliveredPct != null ? ` (${num(m.deliveredPct)}%)` : ""}`
    ) : (
      <span key="d" className="muted small" title={m.deliveredNoteHe}>
        {m.deliveredNoteHe.replace("החשבונות ללא כמות — ", "")}
      </span>
    ),
    m.budgetUnitPrice != null ? `${num(m.budgetUnitPrice)} ₪/${m.unit}` : "—",
    m.currentUnitPrice == null ? (
      "—"
    ) : (
      <span key="c" className={m.currentPriceKind === "estimate" ? "h2-report-soft" : m.budgetUnitPrice != null && m.currentUnitPrice > m.budgetUnitPrice ? "h2-num-up" : undefined} title={m.currentPriceBasisHe}>
        {num(m.currentUnitPrice)} ₪/{m.unit} <span className="h2-price-kind">{PRICE_KIND_HE[m.currentPriceKind]}</span>
      </span>
    ),
    m.costPerSqm == null ? (
      "—"
    ) : (
      <span key="cs" title={m.costBasisHe}>
        {num(m.costPerSqm)}
      </span>
    ),
  ];
}

function derivedCells(d: DerivedIndexRow): ReactNode[] {
  return [
    <span key="l" title={d.noteHe}>
      <strong>{d.labelHe}</strong> <span className="muted">(נגזר)</span>
    </span>,
    "—",
    <strong key="p">{d.value == null ? "—" : `${fixed(d.value, d.digits)} ${d.unitHe}`}</strong>,
    <span key="r" className="h2-range-cell">
      <RangePill status={d.rangeStatus} />
      <RangeTrack value={d.value} range={d.range} digits={d.digits} />
    </span>,
    "—",
    "—",
    "—",
    "—",
  ];
}

/** Line chart of a per-m² series against the budget line. */
function PerSqmChart({ series, budget }: { series: { labelHe: string; value: number }[]; budget: number }) {
  if (series.length === 0) return null;
  const W = 460;
  const H = 170;
  const L = 52;
  const R = 24;
  const T = 24;
  const B = 32;
  const values = [...series.map((p) => p.value), budget];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(10, (hi - lo) * 0.35);
  const step = Math.max(10, Math.pow(10, Math.floor(Math.log10(Math.max(1, hi - lo + pad * 2)))) / 2);
  const yMin = Math.floor((lo - pad) / step) * step;
  const yMax = Math.ceil((hi + pad) / step) * step;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, series.length - 1);
  const y = (v: number) => T + ((yMax - v) / Math.max(1, yMax - yMin)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 0.001; v += step) ticks.push(v);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <figure className="h2-report-chart h2-kpi-chart" data-testid="report-kpi-chart">
      <figcaption>עלות למ״ר ברוטו לאורך הבקרות (₪/מ״ר) מול התקציב</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`תחזית לגמר למ״ר: ${series.map((p) => `${p.labelHe} ${num(p.value)}`).join(", ")}; תקציב ${num(budget)}`} style={{ direction: "ltr" }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="h2-chart-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="h2-chart-tick">
              {num(v)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(budget)} y2={y(budget)} className="h2-chart-budget" />
        <text x={W - R} y={y(budget) - 5} textAnchor="end" className="h2-chart-label">
          תקציב {num(budget)}
        </text>
        <path d={d} className="h2-chart-line" />
        {series.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={i === series.length - 1 ? 5 : 4} className="h2-chart-marker">
              <title>{`${p.labelHe} — ${num(p.value)} ₪/מ״ר`}</title>
            </circle>
            <text x={x(i)} y={H - B + 18} textAnchor="middle" className="h2-chart-tick">
              {p.labelHe}
            </text>
          </g>
        ))}
        <text x={x(series.length - 1)} y={y(last.value) - 11} textAnchor="middle" className="h2-chart-label h2-chart-label-strong">
          {num(last.value)}
        </text>
      </svg>
    </figure>
  );
}

/** Horizontal bars: what each cost group contributes to the m². One hue, darkest for the largest. */
function GroupBars({ groups, view }: { groups: CostGroupRow[]; view: "sqm" | "unit" }) {
  const rows = [...groups].sort((a, b) => b.eac - a.eac);
  const max = Math.max(1, ...rows.map((g) => (view === "sqm" ? g.eacPerSqm : g.eacPerUnit)));
  return (
    <figure className="h2-report-chart h2-kpi-chart" data-testid="report-kpi-groups-chart">
      <figcaption>מה מרכיב את {view === "sqm" ? "המ״ר" : "היח״ד"} — תחזית לגמר לפי קבוצת עלות</figcaption>
      <div className="h2-group-bars">
        {rows.map((g, i) => {
          const v = view === "sqm" ? g.eacPerSqm : g.eacPerUnit;
          return (
            <div key={g.id} className="h2-group-bar" title={`${g.labelHe}: ${g.sectionsHe}`}>
              <span className="h2-group-bar-label">{g.labelHe.split(" (")[0]}</span>
              <span className="h2-group-bar-track">
                <i style={{ width: `${(v / max) * 100}%`, opacity: 1 - i * 0.12 }} />
              </span>
              <span className="h2-group-bar-value">{num(v)}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function KpisSection({ report }: { report: ReportModel }) {
  const k = report.kpis;
  const [view, setView] = useState<"sqm" | "unit">("sqm");
  if (!k) return null;
  const unitHe = view === "sqm" ? "₪/מ״ר" : "₪/יח״ד";
  const t = k.total;
  return (
    <Section n="2א" titleHe="מדדי עלות וכמות">
      <p className="h2-report-lead">המדדים שמאפשרים להשוות את הפרויקט לעצמו (תקציב מול תחזית, בקרה מול בקרה) ולפרויקטים אחרים: עלות למ״ר לפי קבוצת עלות, וכמויות החומרים העיקריים ביחס לשטח הבנוי. המכנה: {k.denominatorHe}.</p>
      <div className="h2-table-tools no-print">
        <span className="h2-seg" role="group" aria-label="יחידת המדד">
          <button type="button" aria-pressed={view === "sqm"} onClick={() => setView("sqm")} data-testid="report-kpi-view-sqm">
            ₪ למ״ר
          </button>
          <button type="button" aria-pressed={view === "unit"} onClick={() => setView("unit")} data-testid="report-kpi-view-unit">
            ₪ ליח״ד
          </button>
        </span>
      </div>
      <h3 className="h2-report-h3">א. עלות {view === "sqm" ? "למ״ר" : "ליח״ד"} לפי קבוצת עלות</h3>
      <DataTable
        head={["קבוצה", "סעיפים", `תקציב ${unitHe}`, `תחזית ${unitHe}`, "פער", `נרשם ${unitHe}`, "% מהתחזית", "בסיס"]}
        numeric={[2, 3, 4, 5, 6]}
        testId="report-kpi-groups"
        sortable
        rows={k.groups.map((g) => groupCells(g, view))}
        rowTestId={(i) => `report-kpi-group-${k.groups[i].id}`}
        foot={[
          "סה״כ הפרויקט",
          "",
          num(view === "sqm" ? t.budgetPerSqm : t.budgetPerUnit),
          num(view === "sqm" ? t.eacPerSqm : t.eacPerUnit),
          signedNum((view === "sqm" ? t.eacPerSqm : t.eacPerUnit) - (view === "sqm" ? t.budgetPerSqm : t.budgetPerUnit)),
          num(view === "sqm" ? t.recordedPerSqm : t.recordedPerUnit),
          "100%",
          <span key="b" className="h2-basis-cell">
            <BasisBar fact={report.sections.totals.factPct} commitment={report.sections.totals.commitmentPct} estimate={report.sections.totals.estimatePct} compact />
            <span>{num(report.sections.totals.basisPct)}%</span>
          </span>,
        ]}
      />
      <p className="muted small">{k.notesHe[1]}{t.range ? ` טווח ייחוס לפרויקט: ${num(t.range.min)}–${num(t.range.max)} ₪/מ״ר — ${RANGE_STATUS_HE[t.rangeStatus]}.` : ""}</p>

      <h3 className="h2-report-h3">ב. מדדי כמות — חומרים עיקריים מול השטח הבנוי</h3>
      <DataTable
        head={["מדד", "כמות בכתב הכמויות", "ליחידת שטח", "טווח ייחוס", "בוצע עד החתך", "מחיר יח׳ — תקציב", "מחיר יח׳ — עדכני", "עלות ₪/מ״ר"]}
        numeric={[1, 2, 4, 5, 6, 7]}
        testId="report-kpi-materials"
        className="h2-kpi-materials"
        dense
        sortable
        rows={[...k.materials.map(materialCells), ...k.derived.map(derivedCells)]}
        rowTestId={(i) => `report-kpi-material-${[...k.materials, ...k.derived][i].id}`}
        emptyHe="כתב הכמויות אינו כולל שורות בפרקים הנמדדים."
      />
      <p className="muted small">
        {k.notesHe[2]} {k.notesHe[3]}
      </p>
      <div className="h2-report-trend-grid h2-kpi-charts">
        <PerSqmChart series={k.eacPerSqmSeries} budget={t.budgetPerSqm} />
        <GroupBars groups={k.groups} view={view} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Material cards (§5)
// ---------------------------------------------------------------------------

export function MaterialCard({ row, kpis }: { row: MaterialIndexRow; kpis: ReportKpis }) {
  const wholeSection = row.costBasisHe.startsWith("תחזית");
  const priceTiles: { labelHe: string; value: number | null; unitHe: string; tone?: "current" | "ok" }[] = [
    { labelHe: "תקציב (כתב כמויות)", value: row.budgetUnitPrice, unitHe: `₪/${row.unit}` },
    { labelHe: "שולם בפועל (ממוצע)", value: row.paidUnitPrice, unitHe: row.paidUnitPrice != null ? `₪/${row.unit}` : "אין כמות בחשבונות" },
    { labelHe: row.currentPriceBasisHe, value: row.currentUnitPrice, unitHe: row.budgetUnitPrice != null && row.currentUnitPrice != null && row.budgetUnitPrice > 0 ? (row.currentUnitPrice === row.budgetUnitPrice ? `₪/${row.unit} · כמו התקציב` : `₪/${row.unit} · ${signedNum(Math.round(((row.currentUnitPrice - row.budgetUnitPrice) / row.budgetUnitPrice) * 100))}% מהתקציב`) : `₪/${row.unit}`, tone: row.currentPriceKind === "contract" ? "ok" : "current" },
  ];
  return (
    <div className="h2-material-card" data-testid={`report-material-card-${row.id}`}>
      <h4>
        כרטיס חומר — {row.labelHe} <span className="muted">(פרק {row.chapter} {row.chapterNameHe}, {row.unit})</span>
      </h4>
      <dl className="h2-material-kv">
        <dt>כמות בכתב הכמויות</dt>
        <dd>
          {num(row.boqQty)} {row.unit}
          {row.perSqm != null ? ` · ${fixed(row.perSqm, row.digits)} ${row.perSqmUnitHe}` : ""}
          {row.range ? <RangePill status={row.rangeStatus} /> : null}
        </dd>
        <dt>בוצע עד החתך</dt>
        <dd>{row.deliveredQty != null ? `${num(Math.round(row.deliveredQty))} ${row.unit}${row.deliveredPct != null ? ` (${num(row.deliveredPct)}%)` : ""} — ${row.deliveredNoteHe}` : row.deliveredNoteHe}</dd>
        {row.id === "concrete" && kpis.structureProgress ? (
          <>
            <dt>קומות יצוקות</dt>
            <dd>
              {kpis.structureProgress.labelHe} ({num(kpis.structureProgress.pct)}%)
            </dd>
          </>
        ) : null}
        <dt>עלות למ״ר ברוטו</dt>
        <dd>
          {row.costPerSqm == null ? "—" : `${num(row.costPerSqm)} ₪/מ״ר`} <span className="muted">({row.costBasisHe})</span>
        </dd>
        {row.boqValue != null && !wholeSection ? (
          <>
            <dt>ערך השורות בכתב הכמויות</dt>
            <dd>{nis(row.boqValue)}</dd>
          </>
        ) : null}
        {row.sensitivityHe ? (
          <>
            <dt>רגישות</dt>
            <dd>{row.sensitivityHe}</dd>
          </>
        ) : null}
      </dl>
      <div className="h2-price-tiles">
        {priceTiles.map((p, i) => (
          <div key={i} className={["h2-price-tile", p.tone === "current" ? "is-current" : "", p.tone === "ok" ? "is-ok" : ""].filter(Boolean).join(" ")}>
            <span className="h2-price-label">{p.labelHe}</span>
            <span className="h2-price-value">{p.value == null ? "—" : num(p.value)}</span>
            <span className="h2-price-label">{p.unitHe}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
