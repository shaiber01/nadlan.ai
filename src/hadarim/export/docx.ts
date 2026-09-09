import { AlignmentType, Document, Footer, HeadingLevel, PageNumber, PageOrientation, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { ChangeRow, CorrectionRow, IssueRow, ReportModel, SectionRow } from "../engine/report";

/**
 * Real Word export of the control report (full report or the one-page CEO version).
 * Right-to-left paragraphs and tables, Arial 11pt, the demo disclaimer and a page number on every page.
 */

const DEMO_FOOTER = "מסמך הדגמה — נתונים בדויים";
const A4 = { width: 11906, height: 16838 }; // DXA
const MARGIN = 1134; // 2 cm
const PORTRAIT_TEXT_WIDTH = A4.width - 2 * MARGIN;
const LANDSCAPE_TEXT_WIDTH = A4.height - 2 * MARGIN;

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const signed = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);
const signedPct = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);

function run(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}): TextRun {
  return new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size, color: opts.color, italics: opts.italics });
}

function p(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean; after?: number; before?: number } = {}): Paragraph {
  return new Paragraph({ bidirectional: true, alignment: AlignmentType.START, spacing: { after: opts.after ?? 120, before: opts.before ?? 0 }, children: [run(text, opts)] });
}

function label(labelHe: string, text: string): Paragraph {
  return new Paragraph({ bidirectional: true, alignment: AlignmentType.START, spacing: { after: 80 }, children: [run(`${labelHe}: `, { bold: true }), run(text)] });
}

function h(text: string, level: 1 | 2 | 3): Paragraph {
  const heading = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  return new Paragraph({ heading, bidirectional: true, alignment: AlignmentType.START, spacing: { before: level === 1 ? 320 : 240, after: 120 }, children: [run(text, { bold: true })] });
}

function bullets(items: string[]): Paragraph[] {
  if (items.length === 0) return [p("—")];
  return items.map((t) => new Paragraph({ bidirectional: true, alignment: AlignmentType.START, bullet: { level: 0 }, spacing: { after: 60 }, children: [run(t)] }));
}

interface TableOpts {
  widths?: number[]; // relative weights
  textWidth?: number;
  size?: number; // half-points
  boldLast?: boolean;
  highlight?: (rowIndex: number) => string | undefined; // fill colour for body rows (0 = first body row)
}

function table(head: string[], rows: string[][], opts: TableOpts = {}): Table {
  const textWidth = opts.textWidth ?? PORTRAIT_TEXT_WIDTH;
  const weights = opts.widths && opts.widths.length === head.length ? opts.widths : head.map(() => 1);
  const total = weights.reduce((a, w) => a + w, 0);
  const widths = weights.map((w) => Math.floor((textWidth * w) / total));
  const size = opts.size ?? 18;
  const cell = (text: string, width: number, o: { bold?: boolean; fill?: string } = {}) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 50, bottom: 50, left: 70, right: 70 },
      children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.START, spacing: { after: 0 }, children: [run(text, { bold: o.bold, size })] })],
    });
  const headRow = new TableRow({ tableHeader: true, children: head.map((t, j) => cell(t, widths[j], { bold: true, fill: "E8EBF3" })) });
  const bodyRows = rows.length
    ? rows.map((r, i) => {
        const fill = opts.highlight?.(i);
        const bold = opts.boldLast && i === rows.length - 1;
        return new TableRow({ children: head.map((_, j) => cell(r[j] ?? "", widths[j], { bold, fill })) });
      })
    : [new TableRow({ children: [cell("—", widths[0])] })];
  return new Table({ visuallyRightToLeft: true, width: { size: textWidth, type: WidthType.DXA }, columnWidths: widths, rows: [headRow, ...bodyRows] });
}

function keyTable(rows: ReportModel["executive"]["keyTable"]): Table {
  return table(
    ["", "₪", "%"],
    rows.map((r) => [r.labelHe, r.valueHe, r.pctHe || "—"]),
    { widths: [3, 2, 2] },
  );
}

function changesTable(changes: ChangeRow[], total: number): Table {
  return table(["סעיף", "סוג שינוי", "תיאור", "בסיס/מקור", "השפעה ₪"], [...changes.map((c) => [c.sectionHe, c.typeHe, c.descriptionHe, c.basisHe, signed(c.amount)]), ["", "", "סה״כ שינוי מבקרה קודמת", "", signed(total)]], { widths: [1.2, 1.3, 3, 2.4, 1.3], boldLast: true });
}

function correctionsTable(rows: CorrectionRow[]): Table {
  return table(["רשומה", "מה תוקן", "לפני", "אחרי", "מי אישר", "השפעה בין סעיפים", "סטטוס"], rows.map((c) => [c.recordHe, c.whatHe, c.beforeHe, c.afterHe, c.approvedByHe, c.crossSectionHe, c.statusHe]), { widths: [1, 1.4, 1.4, 1.4, 0.9, 2.4, 1.1], size: 16 });
}

function issuesTable(rows: IssueRow[], compact = false): Table {
  if (compact) return table(["נושא", "אחראי", "יעד", "סטטוס"], rows.map((t) => [t.titleHe + (t.stale ? " (פתוח יותר משתי בקרות)" : ""), t.ownerHe, t.dueHe, t.statusHe]), { widths: [3.5, 1, 1, 1.2], highlight: (i) => (rows[i]?.stale ? "FDF1DC" : undefined) });
  return table(["#", "נושא", "סעיף", "אחראי", "יעד", "נפתח בבקרה", "סטטוס", "השפעה אם לא יטופל"], rows.map((t, i) => [String(i + 1), t.titleHe + (t.stale ? " — פתוח יותר משתי בקרות" : ""), t.sectionHe, t.ownerHe, t.dueHe, t.openedHe, t.statusHe, t.impactHe]), { widths: [0.4, 2.6, 1, 0.8, 0.8, 1, 1, 2.4], size: 16, highlight: (i) => (rows[i]?.stale ? "FDF1DC" : undefined) });
}

function sectionRow(r: SectionRow, isTotal = false): string[] {
  return [isTotal ? "" : r.sectionId, isTotal ? "סה״כ" : r.isContingency ? `${r.nameHe} (שורה נפרדת)` : r.nameHe, nis(r.budget), r.changes === 0 ? "—" : signed(r.changes), nis(r.updatedBudget), nis(r.recorded), nis(r.committed), nis(r.remainingCommitment), nis(r.uncovered), nis(r.eac), signed(r.variance), signedPct(r.variancePct), nis(r.previousEac), signed(r.change), `${r.basisPct}%`];
}

function sectionsTable(report: ReportModel): Table {
  const rows = [...report.sections.rows.map((r) => sectionRow(r)), sectionRow(report.sections.totals, true)];
  return table(["#", "סעיף", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס"], rows, {
    textWidth: LANDSCAPE_TEXT_WIDTH,
    widths: [0.5, 3, 1.4, 0.9, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.2, 0.9, 1.4, 1.2, 0.8],
    size: 13,
    boldLast: true,
    highlight: (i) => {
      const r = report.sections.rows[i];
      if (!r) return undefined;
      if (r.isContingency) return "E8EBF3";
      return r.highlighted ? "FDF1DC" : undefined;
    },
  });
}

function footer(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run(`${DEMO_FOOTER} · עמוד `, { size: 16, color: "666666" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "666666" })],
      }),
    ],
  });
}

const portrait = { page: { size: { width: A4.width, height: A4.height, orientation: PageOrientation.PORTRAIT }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } };
const landscape = { page: { size: { width: A4.height, height: A4.width, orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } };

type Block = Paragraph | Table;

function headerBlocks(report: ReportModel, ceo: boolean): Block[] {
  const hd = report.header;
  return [
    new Paragraph({ heading: HeadingLevel.TITLE, bidirectional: true, alignment: AlignmentType.START, spacing: { after: 80 }, children: [run(`דוח בקרה תקציבית — ${hd.projectHe.split(" — ")[0]}${ceo ? " · גרסה למנכ״לית" : ""}`, { bold: true })] }),
    p(`${hd.projectHe} · ${hd.companyHe}`, { color: "5B6478" }),
    label("מועד חתך", hd.cutoffHe),
    label("בקרה", `${hd.controlLabelHe} · ${hd.previousControlHe}`),
    label("גרסאות", `${hd.budgetVersionHe} · ${hd.boqVersionHe}`),
    label("מכין / מאשר", `${hd.preparedByHe.replace("מכין: ", "")} / ${hd.approvedByHe.replace("מאשר: ", "")}`),
    label("תפוצה", hd.distributionHe.replace("תפוצה: ", "")),
    p(hd.sourcesHe, { size: 18, color: "5B6478", after: 200 }),
  ];
}

function fullReportSections(report: ReportModel): { properties: typeof portrait | typeof landscape; children: Block[] }[] {
  const e = report.executive;
  const s = report.status;
  const c = report.contingency;
  const a = report.appendices;
  const t = report.trends;

  const part1: Block[] = [
    ...headerBlocks(report, false),
    h("1. סיכום מנהלים", 1),
    p(e.paragraphHe),
    keyTable(e.keyTable),
    h("נקודות לתשומת לב ההנהלה", 3),
    ...bullets(e.bulletsHe),
    h("החלטות נדרשות", 3),
    ...(e.decisionsHe.length ? bullets(e.decisionsHe) : [p("אין החלטות נדרשות בבקרה זו.")]),
    h("2. תמונת מצב הפרויקט", 1),
    p(s.stageHe),
    table(["ביצוע פיזי", "הוצאה (נרשם / תחזית)", "התחייבות"], [[s.physicalPct != null ? `~${s.physicalPct}%` : "לא נמדד", `${s.expensePct.toFixed(0)}%`, `${s.commitmentPct.toFixed(0)}%`]]),
    label("לו״ז", s.scheduleHe),
    h("אירועים מהותיים בתקופה", 3),
    ...bullets(s.eventsHe),
  ];

  const part2: Block[] = [h("3. טבלת הסעיפים — ליבת הדוח", 1), sectionsTable(report), p(`${report.sections.materialityHe}. שורות מודגשות: שינוי מבקרה קודמת או סטייה מעל הסף — ההסבר בסעיף 4.`, { size: 16, color: "5B6478", before: 120 })];
  if (report.sections.byBuilding) {
    part2.push(h("פילוח משני — לפי בניין", 2));
    part2.push(
      table(["בניין", "תקציב מאושר", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "בסיס"], [...report.sections.byBuilding.map((b) => [b.labelHe, nis(b.budget), nis(b.recorded), nis(b.committed), nis(b.remainingCommitment), nis(b.uncovered), nis(b.eac), signed(b.variance), signedPct(b.variancePct), `${b.basisPct}%`]), ["סה״כ", nis(report.sections.totals.budget), nis(report.sections.totals.recorded), nis(report.sections.totals.committed), nis(report.sections.totals.remainingCommitment), nis(report.sections.totals.uncovered), nis(report.sections.totals.eac), signed(report.sections.totals.variance), signedPct(report.sections.totals.variancePct), `${report.sections.totals.basisPct}%`]], { textWidth: LANDSCAPE_TEXT_WIDTH, boldLast: true }),
    );
    if (report.sections.byBuildingNoteHe) part2.push(p(`הערה: ${report.sections.byBuildingNoteHe}`, { size: 16, color: "5B6478", before: 120 }));
  }

  const part3: Block[] = [
    h("4. הסבר לשינויים מהבקרה הקודמת", 1),
    h("4א. שינויים בתחזית לגמר", 2),
    changesTable(report.changes.forecast, report.changes.forecastTotal),
    h("4ב. תיקוני נתונים ללא השפעה על התחזית הכוללת", 2),
    correctionsTable(report.changes.corrections),
    h("5. ניתוח סעיפים מהותיים", 1),
    ...(report.material.length ? report.material.flatMap((m) => [h(m.titleHe, 2), p(`נכלל כי: ${m.reasonHe}`, { size: 16, color: "5B6478" }), ...m.paragraphsHe.map((x) => p(x)), ...(m.table.length > 1 ? [table(m.table[0], m.table.slice(1), { widths: [2, 1.5] })] : []), label("המלצה", m.recommendationHe), p(`מקורות: ${m.sources.map((s) => s.labelHe).join(" · ")}`, { size: 16, color: "5B6478" })]) : [p("אין סעיפים שחצו את סף המהותיות בבקרה זו.")]),
    h("6. בלתי צפוי, שינויים ותביעות", 1),
    table(["בלתי צפוי", "₪"], [["מקור (תקציב מאושר)", nis(c.original)], ["שימושים שאושרו בתקופה", nis(c.used)], ["יתרה", nis(c.remaining)]], { widths: [3, 2] }),
    label("פקודות שינוי", c.pendingChangeOrdersHe),
    label("דרישות / תביעות קבלנים", c.claimsHe),
    label("החלטה למנהלים", c.decisionHe),
    h("7. סיכונים והזדמנויות (מחוץ לתחזית)", 1),
    table(["נושא", "סעיף", "תיאור", "חשיפה ₪ (טווח)", "סבירות", "מה יקבע", "אחראי"], report.risks.map((r) => [r.topicHe, r.sectionHe, r.descriptionHe, r.exposureHe, r.likelihoodHe, r.triggerHe, r.ownerHe]), { widths: [1.4, 1, 3, 1.4, 0.8, 1.4, 0.8], size: 16 }),
    h("8. נושאים לטיפול", 1),
    issuesTable(report.issues.open),
    h("נסגרו מאז הבקרה הקודמת", 3),
    ...(report.issues.closed.length ? bullets(report.issues.closed.map((x) => `${x.titleHe} — נסגר ${x.closedHe ?? ""} · ${x.ownerHe}`)) : [p("לא נסגרו נושאים מאז הבקרה הקודמת.")]),
    h("9. התאמות מאומתות (״ממצאים חיוביים״)", 1),
    ...(report.verified.length ? bullets(report.verified.map((v) => `נבדק ונמצא תואם — ${v.titleHe}: ${v.textHe}`)) : [p("לא נבדקו התאמות בבקרה זו.")]),
  ];
  if (t.comparison) {
    part3.push(h("10. השוואה לבקרה הקודמת ומגמות", 1));
    part3.push(table(t.comparison[0], t.comparison.slice(1), { widths: [2, 1.2, 1.2, 1.4] }));
    part3.push(h("תחזית לגמר לאורך הבקרות", 3));
    part3.push(table(["בקרה", "תחזית לגמר"], t.eacSeries.map((x) => [x.labelHe, nis(x.value)]), { widths: [1, 1.5] }));
    part3.push(label("יתרה לא מכוסה כיום", nis(t.uncoveredNow)));
    part3.push(label("מגמה", t.commentaryHe));
  }
  part3.push(
    h("11. נספחים", 1),
    h("א. הגדרות ומתודולוגיה", 3),
    ...bullets(a.definitionsHe),
    h("ב. הנחות התחזית", 3),
    ...bullets(a.assumptionsHe),
    h("ג. מקורות וגרסאות", 3),
    ...bullets(a.sourcesHe),
    h("ד. יומן תיקוני נתונים בתקופה", 3),
    correctionsTable(a.correctionLog),
    h("ה. חשבונות בבדיקה במועד החתך", 3),
    p(`${a.inReview.count} חשבונות בבדיקה בסך ${nis(a.inReview.amount)} — אינם נכללים ב״נרשם״.`),
    h("ו. אירועים לאחר מועד החתך", 3),
    ...(a.afterCutoffHe.length ? bullets(a.afterCutoffHe) : [p("אין אירועים לאחר מועד החתך.")]),
    h("ז. פירוט יתרה להשלמה לא מכוסה", 3),
    table(["פריט", "סעיף", "בסיס", "₪"], [...a.uncovered.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, nis(u.amount)]), ["סה״כ", "", "", nis(a.uncoveredTotal)]], { widths: [3, 1.2, 1.2, 1.4], boldLast: true }),
    p("הקצאות פנימיות — לא רכש (מוצגות בנפרד, אינן נספרות כאומדנים)", { bold: true, before: 160 }),
    table(["פריט", "סעיף", "בסיס", "₪"], [...a.allocations.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, nis(u.amount)]), ["סה״כ", "", "", nis(a.allocationTotal)]], { widths: [3, 1.2, 1.2, 1.4], boldLast: true }),
    p("ח. תזרים 90 יום — לא נכלל (דוח עלות, לא דוח תזרים).", { size: 18, color: "5B6478", before: 120 }),
  );

  return [
    { properties: portrait, children: part1 },
    { properties: landscape, children: part2 },
    { properties: portrait, children: part3 },
  ];
}

function ceoSections(report: ReportModel): { properties: typeof portrait; children: Block[] }[] {
  const c = report.ceo;
  return [
    {
      properties: portrait,
      children: [
        ...headerBlocks(report, true),
        p(c.paragraphHe),
        keyTable(c.keyTable),
        h("השפעות על התחזית לגמר", 2),
        changesTable(c.changes, report.changes.forecastTotal),
        h("נושאים פתוחים ברמת הנהלה", 2),
        issuesTable(c.issues, true),
        ...(c.riskLineHe ? [label("סיכון עיקרי", c.riskLineHe)] : []),
        p(`אותם מספרים, אותם מקורות — מקושר לבקרה 09/2026 (${report.header.controlLabelHe}). אין כאן מספר שלא נמצא בדוח המלא.`, { size: 18, color: "5B6478", before: 160 }),
      ],
    },
  ];
}

export function buildReportDocument(report: ReportModel, tab: "full" | "ceo"): Document {
  const sections = (tab === "ceo" ? ceoSections(report) : fullReportSections(report)).map((s) => ({ ...s, footers: { default: footer() } }));
  return new Document({
    creator: "מערכת הבקרה — הדגמה",
    title: `בקרה תקציבית — ${report.header.projectNameHe} — ${report.header.controlLabelHe}`,
    description: DEMO_FOOTER,
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 } },
        title: { run: { font: "Arial", size: 36, bold: true, color: "16213A" } },
        heading1: { run: { font: "Arial", size: 28, bold: true, color: "16213A" } },
        heading2: { run: { font: "Arial", size: 24, bold: true, color: "16213A" } },
        heading3: { run: { font: "Arial", size: 22, bold: true, color: "5B6478" } },
      },
    },
    sections,
  });
}

/** Builds the .docx and returns it as a Blob (works in the browser and in Node tests). */
export async function exportReportDocx(report: ReportModel, tab: "full" | "ceo"): Promise<Blob> {
  const doc = buildReportDocument(report, tab);
  const buffer = await Packer.toArrayBuffer(doc);
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
