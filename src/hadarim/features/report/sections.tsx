import { useState, type ReactNode } from "react";
import { Badge, Notice } from "../../../components/primitives";
import { erpRecordUrl, store } from "../../app/store";
import { updateInvoiceBuilding } from "../../engine/commands";
import type { ChangeRow, CorrectionRow, IssueRow, ReportModel, ReportSource, SectionRow, UncoveredRow } from "../../engine/report";
import { mil, nis, num, pct, signedNis, signedPct } from "./format";

/**
 * The report sections, numbered and ordered per `budgetcontrolreportstandard.md` §3:
 * 0 header · 1 executive summary · 2 status · 3 sections table · 4 changes (4a forecast / 4b data)
 * · 5 material sections · 6 contingency · 7 risks · 8 issues · 9 verified matches · 10 trends · 11 appendices.
 * Everything renders from the ReportModel; nothing is computed here.
 */

export const SECTION_TITLES: { n: string; titleHe: string }[] = [
  { n: "0", titleHe: "כותרת ומסגרת" },
  { n: "1", titleHe: "סיכום מנהלים" },
  { n: "2", titleHe: "תמונת מצב הפרויקט" },
  { n: "3", titleHe: "טבלת הסעיפים" },
  { n: "4", titleHe: "הסבר לשינויים מהבקרה הקודמת" },
  { n: "5", titleHe: "ניתוח סעיפים מהותיים" },
  { n: "6", titleHe: "בלתי צפוי, שינויים ותביעות" },
  { n: "7", titleHe: "סיכונים והזדמנויות" },
  { n: "8", titleHe: "נושאים לטיפול" },
  { n: "9", titleHe: "התאמות מאומתות" },
  { n: "10", titleHe: "השוואה לבקרה הקודמת ומגמות" },
  { n: "11", titleHe: "נספחים" },
];

/** A number's origin (standard §1 principle 4): opens the document page at its anchor, the ERP record, or the ERP screen. */
export function SourceLink({ source }: { source: ReportSource }) {
  const open = () => {
    if (source.documentId) return store.openDocument(source.documentId, source.anchor);
    if (source.recordRef) return store.openRecord(source.recordRef);
    if (source.erp) {
      const erp = source.erp;
      return window.open(erpRecordUrl({ screen: erp.screen, invoiceId: erp.invoiceId ?? null, poId: erp.poId ?? null, contractId: erp.contractId ?? null, sectionId: erp.sectionId ?? null }), "_blank", "noopener");
    }
  };
  return (
    <button type="button" className="h2-report-source no-print" onClick={open} data-testid="report-source" title="פתח את המקור">
      {source.labelHe} ↗
    </button>
  );
}

function UncoveredTable({ rows, total, testId, emptyHe }: { rows: UncoveredRow[]; total: number; testId: string; emptyHe: string }) {
  return <DataTable head={["פריט", "סעיף", "בסיס", "₪", "מקור"]} numeric={[3]} testId={testId} rows={rows.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, nis(u.amount), u.source ? <SourceLink key="s" source={u.source} /> : "—"])} foot={["סה״כ", "", "", nis(total), ""]} emptyHe={emptyHe} />;
}

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

function SectionLink({ n, children }: { n: string; children: ReactNode }) {
  return (
    <button type="button" className="h2-report-link no-print" onClick={() => scrollToSection(n)}>
      {children}
    </button>
  );
}

export function DataTable({ head, rows, numeric = [], testId, className, rowClass, rowTestId, foot, emptyHe }: { head: string[]; rows: ReactNode[][]; numeric?: number[]; testId?: string; className?: string; rowClass?: (i: number) => string | undefined; rowTestId?: (i: number) => string | undefined; foot?: ReactNode[]; emptyHe?: string }) {
  return (
    <div className="table-wrap h2-report-table-wrap">
      <table className={["table", "compact", "h2-report-table", className ?? ""].filter(Boolean).join(" ")} data-testid={testId}>
        <thead>
          <tr>
            {head.map((h, j) => (
              <th key={j} className={numeric.includes(j) ? "num" : undefined}>
                {h}
              </th>
            ))}
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
          {rows.map((r, i) => (
            <tr key={i} className={rowClass?.(i)} data-testid={rowTestId?.(i)}>
              {r.map((c, j) => (
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

// ---------------------------------------------------------------------------
// 0. Header
// ---------------------------------------------------------------------------

export function HeaderSection({ report }: { report: ReportModel }) {
  const h = report.header;
  return (
    <Section n="0" titleHe="כותרת ומסגרת">
      <div className="h2-report-masthead">
        <div>
          <h1 className="h2-report-title">דוח בקרה תקציבית — {h.projectHe.split(" — ")[0]}</h1>
          <p className="h2-report-subtitle">
            {h.projectHe} · {h.companyHe}
          </p>
        </div>
        <Badge tone={report.finalized ? "green" : "amber"}>{h.controlLabelHe}</Badge>
      </div>
      <dl className="h2-report-frame">
        <div>
          <dt>מועד חתך</dt>
          <dd>{h.cutoffHe}</dd>
        </div>
        <div>
          <dt>בקרה ומספר גרסה</dt>
          <dd>{h.controlLabelHe}</dd>
        </div>
        <div>
          <dt>בקרה קודמת</dt>
          <dd>{h.previousControlHe.replace("בקרה קודמת: ", "")}</dd>
        </div>
        <div>
          <dt>גרסת תקציב</dt>
          <dd>{h.budgetVersionHe.replace("תקציב: ", "")}</dd>
        </div>
        <div>
          <dt>גרסת כתב כמויות</dt>
          <dd>{h.boqVersionHe.replace("כתב כמויות: ", "")}</dd>
        </div>
        <div>
          <dt>מכין</dt>
          <dd>{h.preparedByHe.replace("מכין: ", "")}</dd>
        </div>
        <div>
          <dt>מאשר</dt>
          <dd>{h.approvedByHe.replace("מאשר: ", "")}</dd>
        </div>
        <div>
          <dt>תפוצה</dt>
          <dd>{h.distributionHe.replace("תפוצה: ", "")}</dd>
        </div>
      </dl>
      <p className="h2-report-sources">{h.sourcesHe}</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 1. Executive summary
// ---------------------------------------------------------------------------

export function KeyTable({ rows, headline }: { rows: ReportModel["executive"]["keyTable"]; headline?: boolean }) {
  return (
    <div className="table-wrap h2-report-table-wrap h2-report-key-wrap">
      <table className="table compact h2-report-table h2-report-key" data-testid="report-key-table">
        <thead>
          <tr>
            <th />
            <th className="num">₪</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.labelHe === "תחזית לגמר" ? "is-headline" : undefined}>
              <td>{r.labelHe}</td>
              <td className="num" data-testid={headline && r.labelHe === "תחזית לגמר" ? "report-headline-eac" : undefined}>
                {r.valueHe}
              </td>
              <td className="num">{r.pctHe || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExecutiveSection({ report }: { report: ReportModel }) {
  const e = report.executive;
  return (
    <Section n="1" titleHe="סיכום מנהלים">
      <p className="h2-report-lead" data-testid="report-exec-paragraph">
        {e.paragraphHe}
      </p>
      <KeyTable rows={e.keyTable} headline />
      <h4 className="h2-report-h4">נקודות לתשומת לב ההנהלה</h4>
      <ul className="h2-report-bullets">
        {e.bulletsHe.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <h4 className="h2-report-h4">החלטות נדרשות</h4>
      {e.decisionsHe.length ? (
        <Notice tone="amber">
          <ul className="h2-report-decisions">
            {e.decisionsHe.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <p className="muted">אין החלטות נדרשות בבקרה זו.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 2. Status
// ---------------------------------------------------------------------------

function Meter({ labelHe, valueHe, value }: { labelHe: string; valueHe: string; value: number }) {
  return (
    <div className="h2-report-meter">
      <div className="h2-report-meter-label">{labelHe}</div>
      <div className="h2-report-meter-value">{valueHe}</div>
      <div className="h2-report-meter-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function StatusSection({ report }: { report: ReportModel }) {
  const s = report.status;
  return (
    <Section n="2" titleHe="תמונת מצב הפרויקט">
      <p className="h2-report-lead">{s.stageHe}</p>
      <div className="h2-report-meters" data-testid="report-meters">
        <Meter labelHe="ביצוע פיזי" valueHe={s.physicalPct != null ? `~${num(s.physicalPct)}%` : "לא נמדד"} value={s.physicalPct ?? 0} />
        <Meter labelHe="הוצאה (נרשם / תחזית)" valueHe={pct(s.expensePct, 0)} value={s.expensePct} />
        <Meter labelHe="התחייבות (נרשם + יתרת התחייבות / תחזית)" valueHe={pct(s.commitmentPct, 0)} value={s.commitmentPct} />
      </div>
      <p className="muted small">שלושת המספרים זה ליד זה — הפער ביניהם הוא הסיפור: מה שבוצע, מה ששולם עליו, ומה שכבר מחויב.</p>
      <h4 className="h2-report-h4">לו״ז</h4>
      <p>{s.scheduleHe}</p>
      <h4 className="h2-report-h4">אירועים מהותיים בתקופה</h4>
      <ul className="h2-report-bullets">
        {s.eventsHe.map((ev, i) => (
          <li key={i}>{ev}</li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 3. Sections table
// ---------------------------------------------------------------------------

function sectionCells(r: SectionRow, isTotal = false): ReactNode[] {
  return [
    isTotal ? "" : r.sectionId,
    isTotal ? "סה״כ" : r.isContingency ? `${r.nameHe} — שורה נפרדת` : r.nameHe,
    nis(r.budget),
    r.changes === 0 ? "—" : signedNis(r.changes),
    nis(r.updatedBudget),
    nis(r.recorded),
    nis(r.committed),
    nis(r.remainingCommitment),
    nis(r.uncovered),
    nis(r.eac),
    signedNis(r.variance),
    signedPct(r.variancePct),
    nis(r.previousEac),
    signedNis(r.change),
    <span key="basis" className={r.basisPct < 70 && !r.isContingency ? "h2-report-soft" : undefined}>
      {`${num(r.basisPct)}%`}
    </span>,
  ];
}

const SECTION_HEAD = ["#", "סעיף", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס"];
const SECTION_NUMERIC = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function SectionsTableSection({ report }: { report: ReportModel }) {
  const sec = report.sections;
  return (
    <Section n="3" titleHe="טבלת הסעיפים — ליבת הדוח" breakBefore className="h2-report-wide">
      <div className="table-wrap h2-report-table-wrap">
        <table className="table compact h2-report-table h2-report-sections" data-testid="report-sections-table">
          <thead>
            <tr>
              {SECTION_HEAD.map((h, j) => (
                <th key={j} className={SECTION_NUMERIC.includes(j) ? "num" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sec.rows.map((r) => (
              <tr key={r.sectionId} className={[r.highlighted ? "is-highlighted" : "", r.isContingency ? "is-contingency" : ""].filter(Boolean).join(" ") || undefined} data-testid={`report-row-${r.sectionId}`}>
                {sectionCells(r).map((c, j) => (
                  <td key={j} className={SECTION_NUMERIC.includes(j) ? "num" : undefined}>
                    {j === 1 && r.highlighted ? (
                      <>
                        {c} <SectionLink n="4">→ סעיף 4</SectionLink>
                      </>
                    ) : (
                      c
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total" data-testid="report-row-total">
              {sectionCells(sec.totals, true).map((c, j) => (
                <td key={j} className={SECTION_NUMERIC.includes(j) ? "num" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {sec.materialityHe}. שורות מודגשות: שינוי מבקרה קודמת או סטייה מעל הסף — ההסבר בסעיף 4. בסיס = אחוז מהתחזית שמכוסה בהתחייבות; מתחת ל-70% מסומן כתחזית רכה.
      </p>
      {sec.byBuilding ? (
        <div className="h2-report-subsection" data-testid="report-by-building">
          <h3 className="h2-report-h3">פילוח משני — לפי בניין (אותן עמודות)</h3>
          <DataTable
            head={["בניין", "תקציב מאושר", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "בסיס"]}
            numeric={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
            rows={sec.byBuilding.map((b) => [b.labelHe, nis(b.budget), nis(b.recorded), nis(b.committed), nis(b.remainingCommitment), nis(b.uncovered), nis(b.eac), signedNis(b.variance), signedPct(b.variancePct), `${num(b.basisPct)}%`])}
            foot={["סה״כ", nis(sec.totals.budget), nis(sec.totals.recorded), nis(sec.totals.committed), nis(sec.totals.remainingCommitment), nis(sec.totals.uncovered), nis(sec.totals.eac), signedNis(sec.totals.variance), signedPct(sec.totals.variancePct), `${num(sec.totals.basisPct)}%`]}
            rowTestId={(i) => `report-building-${sec.byBuilding![i].building}`}
          />
          {sec.byBuildingNoteHe ? (
            <Notice tone="navy">
              <span data-testid="report-by-building-note">הערה: {sec.byBuildingNoteHe}</span>
              {sec.byBuildingChangeable.map((c) => (
                <span key={c.invoiceId} className="h2-report-change-building no-print">
                  {" "}
                  שנה — {c.labelHe}:
                  {sec.byBuildingOptions.map((b) => (
                    <button key={b.id} type="button" className={`btn btn-sm ${c.building === b.id || (!c.building && b.kind === "shared") ? "btn-primary" : "btn-ghost"}`} onClick={() => store.dispatch((s) => updateInvoiceBuilding(s, c.invoiceId, b.id, s.operatorId))} data-testid={`report-building-change-${c.invoiceId}-${b.id}`}>
                      {b.labelHe}
                    </button>
                  ))}
                </span>
              ))}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 4. Changes since previous control (4a forecast / 4b data corrections)
// ---------------------------------------------------------------------------

export function ChangeRows({ changes, total }: { changes: ChangeRow[]; total: number }) {
  return (
    <DataTable
      head={["סעיף", "סוג שינוי", "תיאור", "בסיס/מקור", "השפעה ₪"]}
      numeric={[4]}
      testId="report-changes-4a"
      rows={changes.map((c) => [
        c.sectionHe,
        c.typeHe,
        c.descriptionHe,
        c.documentId ? (
          <button key="doc" type="button" className="h2-report-link" onClick={() => store.openDocument(c.documentId!)} data-testid="report-change-source">
            {c.basisHe} ↗
          </button>
        ) : (
          c.basisHe
        ),
        signedNis(c.amount),
      ])}
      emptyHe="אין שינויים בתחזית לגמר מהבקרה הקודמת."
      foot={["", "", "סה״כ שינוי מבקרה קודמת", "", signedNis(total)]}
    />
  );
}

export function CorrectionRows({ rows, testId }: { rows: CorrectionRow[]; testId?: string }) {
  return <DataTable head={["רשומה", "מה תוקן", "לפני", "אחרי", "מי אישר", "השפעה בין סעיפים", "סטטוס"]} testId={testId} rows={rows.map((c) => [c.recordHe, c.whatHe, c.beforeHe, c.afterHe, c.approvedByHe, c.crossSectionHe, c.statusHe])} emptyHe="אין תיקוני נתונים בתקופה." />;
}

export function ChangesSection({ report }: { report: ReportModel }) {
  return (
    <Section n="4" titleHe="הסבר לשינויים מהבקרה הקודמת">
      <p className="muted small">שתי טבלאות נפרדות: שינויים שמשנים את עלות הפרויקט, ותיקוני נתונים שרק מסדרים אותה. שורת הסיכום של 4א מתחשבנת מול ״שינוי מבקרה קודמת״ בסיכום המנהלים.</p>
      <div className="h2-report-subsection" id="report-section-4a" data-testid="report-section-4a">
        <h3 className="h2-report-h3">4א. שינויים בתחזית לגמר</h3>
        <ChangeRows changes={report.changes.forecast} total={report.changes.forecastTotal} />
      </div>
      <div className="h2-report-subsection h2-report-subsection-alt" id="report-section-4b" data-testid="report-section-4b">
        <h3 className="h2-report-h3">4ב. תיקוני נתונים ללא השפעה על התחזית הכוללת</h3>
        <CorrectionRows rows={report.changes.corrections} testId="report-corrections-4b" />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 5. Material sections
// ---------------------------------------------------------------------------

export function MaterialSection({ report }: { report: ReportModel }) {
  return (
    <Section n="5" titleHe="ניתוח סעיפים מהותיים" breakBefore>
      {report.material.length === 0 ? <p className="muted">אין סעיפים שחצו את סף המהותיות בבקרה זו.</p> : null}
      {report.material.map((m) => (
        <article key={m.sectionId} className="h2-report-material" data-testid={`report-material-${m.sectionId}`}>
          <h3 className="h2-report-h3">{m.titleHe}</h3>
          <p className="muted small">נכלל כי: {m.reasonHe}</p>
          {m.paragraphsHe.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {m.table.length > 1 ? <DataTable head={m.table[0]} rows={m.table.slice(1)} numeric={[1]} className="h2-report-material-table" /> : null}
          <p className="h2-report-recommendation">
            <strong>המלצה:</strong> {m.recommendationHe}
          </p>
          <div className="h2-report-sources">
            <span className="muted small">מקורות:</span>
            {m.sources.map((s, i) => (
              <SourceLink key={i} source={s} />
            ))}
          </div>
        </article>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 6. Contingency, change orders, claims
// ---------------------------------------------------------------------------

export function ContingencySection({ report }: { report: ReportModel }) {
  const c = report.contingency;
  return (
    <Section n="6" titleHe="בלתי צפוי, שינויים ותביעות">
      <DataTable head={["בלתי צפוי", "₪"]} numeric={[1]} rows={[["מקור (תקציב מאושר)", nis(c.original)], ["שימושים שאושרו בתקופה", nis(c.used)], ["יתרה", nis(c.remaining)]]} />
      <dl className="h2-report-frame h2-report-frame-2">
        <div>
          <dt>פקודות שינוי</dt>
          <dd>{c.pendingChangeOrdersHe}</dd>
        </div>
        <div>
          <dt>דרישות / תביעות קבלנים</dt>
          <dd>{c.claimsHe}</dd>
        </div>
      </dl>
      <Notice tone="amber">
        <strong>החלטה למנהלים:</strong> {c.decisionHe}
      </Notice>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 7. Risks and opportunities
// ---------------------------------------------------------------------------

export function RisksSection({ report }: { report: ReportModel }) {
  return (
    <Section n="7" titleHe="סיכונים והזדמנויות (מחוץ לתחזית)">
      <DataTable head={["נושא", "סעיף", "תיאור", "חשיפה ₪ (טווח)", "סבירות", "מה יקבע", "אחראי"]} testId="report-risks" rows={report.risks.map((r) => [r.topicHe, r.sectionHe, r.descriptionHe, r.exposureHe, r.likelihoodHe, r.triggerHe, r.ownerHe])} emptyHe="אין סיכונים או הזדמנויות מחוץ לתחזית." />
      <p className="muted small">כלל ברזל: מה שבתחזית לא מופיע כאן, ומה שכאן לא בתחזית. סיכון שהתממש עובר לסעיף 4 בבקרה הבאה.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 8. Issues
// ---------------------------------------------------------------------------

function issueCells(t: IssueRow, i: number): ReactNode[] {
  return [
    String(i + 1),
    <span key="t">
      {t.titleHe}
      {t.stale ? (
        <>
          {" "}
          <Badge tone="amber">פתוח יותר משתי בקרות</Badge>
        </>
      ) : null}
    </span>,
    t.sectionHe,
    t.ownerHe,
    t.dueHe,
    t.openedHe,
    t.statusHe,
    t.impactHe,
  ];
}

export function IssuesSection({ report }: { report: ReportModel }) {
  const { open, closed } = report.issues;
  return (
    <Section n="8" titleHe="נושאים לטיפול">
      <DataTable head={["#", "נושא", "סעיף", "אחראי", "יעד", "נפתח בבקרה", "סטטוס", "השפעה אם לא יטופל"]} testId="report-issues-open" rows={open.map(issueCells)} rowClass={(i) => (open[i].stale ? "is-stale" : undefined)} rowTestId={(i) => `report-issue-${open[i].id}`} emptyHe="אין נושאים פתוחים." />
      <h4 className="h2-report-h4">נסגרו מאז הבקרה הקודמת</h4>
      {closed.length ? (
        <ul className="h2-report-bullets h2-report-closed" data-testid="report-issues-closed">
          {closed.map((t) => (
            <li key={t.id}>
              {t.titleHe} — נסגר {t.closedHe ?? ""} · {t.ownerHe}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">לא נסגרו נושאים מאז הבקרה הקודמת.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 9. Verified matches
// ---------------------------------------------------------------------------

/** Findings raised by the checks that nobody decided on, and questions still waiting for an answer — stated, not hidden. */
export function OpenFindingsSection({ report }: { report: ReportModel }) {
  if (!report.openFindings.length && !report.openQuestions.length) return null;
  return (
    <Section n="8א" titleHe="ממצאים שטרם הוכרעו ושאלות פתוחות">
      {report.openFindings.length ? <DataTable head={["ממצא", "סעיף", "ההחלטה הנדרשת", "תיקון מומלץ", "מעורבים", "סטטוס"]} testId="report-open-findings" rows={report.openFindings.map((f) => [f.titleHe, f.sectionHe, f.questionHe, f.fixHe, f.peopleHe, f.statusHe])} rowTestId={(i) => `report-open-finding-${report.openFindings[i].id}`} /> : null}
      {report.openQuestions.length ? <DataTable head={["שאלה", "נשאל", "ערוץ", "נשלח"]} testId="report-open-questions" rows={report.openQuestions.map((q) => [q.textHe, q.toHe, q.channelHe, q.askedHe])} rowTestId={(i) => `report-open-question-${report.openQuestions[i].id}`} /> : null}
      <p className="muted small">הדוח אינו סופי כל עוד יש ממצאים שלא הוכרעו; הסכומים שלמעלה אינם כוללים תיקונים שטרם הוחלטו.</p>
    </Section>
  );
}

export function VerifiedSection({ report }: { report: ReportModel }) {
  return (
    <Section n="9" titleHe="התאמות מאומתות (״ממצאים חיוביים״)">
      {report.verified.length === 0 ? (
        <p className="muted">לא נבדקו התאמות בבקרה זו.</p>
      ) : (
        <ul className="h2-report-verified" data-testid="report-verified">
          {report.verified.map((v, i) => (
            <li key={i}>
              <Badge tone="green">נבדק ונמצא תואם</Badge> <strong>{v.titleHe}</strong> — {v.textHe}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">מוצג כהתאמה שנבדקה, לא כחיסכון: אין חיסכון עד שהוא מוכח בחשבון סופי או בחוזה שמכסה את מלוא ההיקף.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 10. Comparison and trends (only when the presenter asked for it)
// ---------------------------------------------------------------------------

export function EacChart({ series, budget }: { series: { labelHe: string; value: number }[]; budget: number }) {
  if (series.length === 0) return null;
  const W = 640;
  const H = 240;
  const L = 58;
  const R = 110;
  const T = 22;
  const B = 36;
  const values = [...series.map((p) => p.value), budget];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(50_000, (hi - lo) * 0.3);
  const step = 200_000;
  const yMin = Math.floor((lo - pad) / step) * step;
  const yMax = Math.ceil((hi + pad) / step) * step;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, series.length - 1);
  const y = (v: number) => T + ((yMax - v) / (yMax - yMin)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1; v += step) ticks.push(v);
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const first = series[0];
  const label = `תחזית לגמר לאורך הבקרות: ${series.map((p) => `${p.labelHe} ${mil(p.value)}`).join(", ")}; תקציב ${mil(budget)}`;
  return (
    <figure className="h2-report-chart" data-testid="report-eac-chart">
      <figcaption>תחזית לגמר לאורך הבקרות (מ׳ ₪) מול התקציב המאושר</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ direction: "ltr" }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="h2-chart-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="h2-chart-tick">
              {(v / 1_000_000).toFixed(1)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(budget)} y2={y(budget)} className="h2-chart-budget" />
        <text x={W - R + 8} y={y(budget) + 4} textAnchor="start" className="h2-chart-label">
          תקציב {mil(budget)}
        </text>
        <path d={path} className="h2-chart-line" />
        {series.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={4.5} className="h2-chart-marker">
              <title>{`${p.labelHe} — ${nis(p.value)}`}</title>
            </circle>
            <text x={x(i)} y={H - B + 18} textAnchor="middle" className="h2-chart-tick">
              {p.labelHe}
            </text>
          </g>
        ))}
        <text x={x(0)} y={y(first.value) - 10} textAnchor="middle" className="h2-chart-label">
          {(first.value / 1_000_000).toFixed(2)}
        </text>
        <text x={x(series.length - 1)} y={y(last.value) - 10} textAnchor="middle" className="h2-chart-label h2-chart-label-strong">
          {(last.value / 1_000_000).toFixed(2)}
        </text>
      </svg>
    </figure>
  );
}

export function TrendsSection({ report }: { report: ReportModel }) {
  const t = report.trends;
  if (!t.comparison) return null;
  return (
    <Section n="10" titleHe="השוואה לבקרה הקודמת ומגמות">
      <DataTable head={t.comparison[0]} rows={t.comparison.slice(1)} numeric={[1, 2, 3]} testId="report-comparison" />
      <div className="h2-report-trend-grid">
        <EacChart series={t.eacSeries} budget={report.working.totalBudget} />
        <DataTable head={["בקרה", "תחזית לגמר"]} numeric={[1]} rows={t.eacSeries.map((p) => [p.labelHe, nis(p.value)])} className="h2-report-trend-table" />
      </div>
      <div className="h2-report-trend-grid">
        <DataTable head={["בקרה", "יתרה לא מכוסה (אומדנים)"]} numeric={[1]} rows={t.uncoveredSeries.map((p) => [p.labelHe, nis(p.value)])} className="h2-report-trend-table" testId="report-uncovered-series" />
        <p data-testid="report-uncovered-commentary">{t.uncoveredCommentaryHe}</p>
      </div>
      <Notice tone="navy">
        <strong>מגמה:</strong> <span data-testid="report-trend-commentary">{t.commentaryHe}</span>
      </Notice>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 11. Appendices
// ---------------------------------------------------------------------------

function Appendix({ id, titleHe, open, onToggle, children }: { id: string; titleHe: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="h2-report-appendix" data-open={open} data-testid={`report-appendix-${id}`}>
      <button type="button" className="h2-report-appendix-head" onClick={onToggle} aria-expanded={open}>
        <span className="h2-report-appendix-caret" aria-hidden="true">
          {open ? "▾" : "◂"}
        </span>
        {titleHe}
      </button>
      <div className="h2-report-appendix-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export function AppendicesSection({ report }: { report: ReportModel }) {
  const a = report.appendices;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const isOpen = (id: string) => all || !!open[id];
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !isOpen(id) }));
  return (
    <Section n="11" titleHe="נספחים" breakBefore>
      <div className="row no-print" style={{ marginBottom: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAll((v) => !v); setOpen({}); }} data-testid="report-appendices-toggle">
          {all ? "כווץ הכול" : "פתח הכול"}
        </button>
      </div>
      <Appendix id="a" titleHe="א. הגדרות ומתודולוגיה" open={isOpen("a")} onToggle={() => toggle("a")}>
        <ul className="h2-report-bullets">
          {a.definitionsHe.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </Appendix>
      <Appendix id="b" titleHe="ב. הנחות התחזית (הצמדה, לו״ז, מחירים)" open={isOpen("b")} onToggle={() => toggle("b")}>
        <ul className="h2-report-bullets">
          {a.assumptionsHe.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </Appendix>
      <Appendix id="c" titleHe="ג. מקורות וגרסאות" open={isOpen("c")} onToggle={() => toggle("c")}>
        <ul className="h2-report-bullets">
          {a.sourcesHe.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </Appendix>
      <Appendix id="d" titleHe="ד. יומן תיקוני נתונים בתקופה (מלא)" open={isOpen("d")} onToggle={() => toggle("d")}>
        <CorrectionRows rows={a.correctionLog} />
      </Appendix>
      <Appendix id="e" titleHe="ה. חשבונות בבדיקה במועד החתך" open={isOpen("e")} onToggle={() => toggle("e")}>
        <p>
          {num(a.inReview.count)} חשבונות בבדיקה בסך {nis(a.inReview.amount)} — אינם נכללים ב״נרשם״ ואינם נעלמים: יוצגו כנרשם רק לאחר אישור.
        </p>
      </Appendix>
      <Appendix id="f" titleHe="ו. אירועים לאחר מועד החתך" open={isOpen("f")} onToggle={() => toggle("f")}>
        {a.afterCutoffHe.length ? (
          <ul className="h2-report-bullets">
            {a.afterCutoffHe.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">אין אירועים לאחר מועד החתך.</p>
        )}
      </Appendix>
      <Appendix id="g" titleHe="ז. פירוט יתרה להשלמה לא מכוסה — שורה שורה, עם בסיס" open={isOpen("g")} onToggle={() => toggle("g")}>
        <UncoveredTable rows={a.uncovered} total={a.uncoveredTotal} testId="report-uncovered" emptyHe="אין יתרה לא מכוסה." />
        <h4 className="h2-report-h4">הקצאות פנימיות — לא רכש (מוצגות בנפרד, אינן נספרות כאומדנים)</h4>
        <UncoveredTable rows={a.allocations} total={a.allocationTotal} testId="report-allocations" emptyHe="אין הקצאות פנימיות." />
      </Appendix>
      <p className="muted small">ח. תזרים 90 יום — לא נכלל (דוח עלות, לא דוח תזרים).</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Footer and the CEO page
// ---------------------------------------------------------------------------

export function ReportFooter() {
  return <div className="h2-report-footer">מסמך הדגמה — נתונים בדויים</div>;
}

export function CeoPage({ report }: { report: ReportModel }) {
  const c = report.ceo;
  const h = report.header;
  return (
    <article className="h2-report-doc h2-report-ceo" data-testid="report-ceo">
      <div className="h2-report-masthead">
        <div>
          <h1 className="h2-report-title">בקרה תקציבית — {h.projectHe.split(" — ")[0]} · גרסה למנכ״לית</h1>
          <p className="h2-report-subtitle">
            {h.controlLabelHe} · {h.cutoffHe} · {h.previousControlHe}
          </p>
        </div>
        <Badge tone={report.finalized ? "green" : "amber"}>{h.controlLabelHe}</Badge>
      </div>
      <p className="h2-report-lead" data-testid="report-ceo-paragraph">
        {c.paragraphHe}
      </p>
      <KeyTable rows={c.keyTable} />
      <h3 className="h2-report-h3">השפעות על התחזית לגמר</h3>
      <ChangeRows changes={c.changes} total={report.changes.forecastTotal} />
      <h3 className="h2-report-h3">נושאים פתוחים ברמת הנהלה</h3>
      <DataTable head={["נושא", "אחראי", "יעד", "סטטוס"]} testId="report-ceo-issues" rows={c.issues.map((t) => [t.titleHe, t.ownerHe, t.dueHe, t.statusHe])} rowClass={(i) => (c.issues[i].stale ? "is-stale" : undefined)} emptyHe="אין נושאים פתוחים." />
      {c.riskLineHe ? (
        <p>
          <strong>סיכון עיקרי:</strong> {c.riskLineHe}
        </p>
      ) : null}
      <p className="h2-report-ceo-note">אותם מספרים, אותם מקורות — מקושר לאותה בקרה ({h.controlLabelHe}). אין כאן מספר שלא נמצא בדוח המלא.</p>
      <ReportFooter />
    </article>
  );
}
