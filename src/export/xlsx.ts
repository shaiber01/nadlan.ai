import { zipSync, strToU8 } from "fflate";
import { toIls } from "../domain/money";
import type { ReportSnapshot } from "../domain/types";
import { formatDate } from "../domain/dates";

/**
 * Minimal but valid Office Open XML workbook writer (no external spreadsheet library).
 * Produces a real .xlsx (zip of SpreadsheetML parts) populated from the frozen report snapshot.
 * RTL sheet view, inline strings, numeric cells with a thousands-separator number format.
 */

type Cell = string | number | null;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colName(index: number): string {
  let s = "";
  let i = index;
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

function cellXml(ref: string, value: Cell, style: number): string {
  if (value === null || value === "") return "";
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(rows: Cell[][], headerRows: number, widths: number[]): string {
  const rowsXml = rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(`${colName(c)}${r + 1}`, v, r < headerRows ? 1 : typeof v === "number" ? 2 : 0)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><cols>${cols}</cols><sheetData>${rowsXml}</sheetData></worksheet>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export interface WorkbookSheet {
  name: string;
  rows: Cell[][];
  headerRows: number;
  widths: number[];
}

export function buildWorkbook(sheets: WorkbookSheet[], meta: { title: string; creator: string; created: string }): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(stylesXml);
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows, s.headerRows, s.widths));
  });
  files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${meta.created}</dcterms:created></cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Bakara Demo</Application></Properties>`);
  return zipSync(files, { level: 6 });
}

/** Build the weekly report workbook from a frozen snapshot only (never from mutable current state). */
export function buildReportWorkbook(report: ReportSnapshot): Uint8Array {
  const f = report.frozen;
  const money = (v: number) => toIls(v);
  const summary: Cell[][] = [
    [`דוח בקרה שבועי — ${f.projectNameHe}`, null, null],
    [`תאריך דוח: ${formatDate(report.reportDate)} · גרסה ${report.version} · נתונים עד ${formatDate(report.dataThrough)}`, null, null],
    ["כל הסכומים בש״ח לפני מע״מ. נתוני הדגמה סינתטיים.", null, null],
    [],
    ["מדד", "סכום (₪)", null],
    ["תקציב מאושר", money(f.totals.budget), null],
    ["עלות שנצברה", money(f.totals.incurred), null],
    ["מתוכה: חשבוניות שנקלטו", money(f.totals.incurredInvoiced), null],
    ["מתוכה: עבודה שבוצעה וטרם חויבה", money(f.totals.incurredAccrued), null],
    ["התחייבויות שנותרו", money(f.totals.commitments), null],
    ["יתרת עבודה ללא התחייבות", money(f.totals.uncommitted), null],
    ["תחזית עלות לסיום", money(f.totals.eac), null],
    ["חריגה צפויה מהתקציב", money(f.totals.variance), null],
    ...(report.showPaid ? [["שולם בפועל (מוצג בנפרד)", money(f.totals.paid), null] as Cell[]] : []),
    [],
    ["נושאים פתוחים והנחות", "סכום (₪)", "פירוט"],
    ...f.notes.filter((n) => n.kind !== "assumption").map((n) => [n.titleHe, n.amount != null ? money(n.amount) : null, n.textHe] as Cell[]),
    ...f.qualificationsHe.map((q) => ["הסתייגות", null, q] as Cell[]),
  ];
  const header: Cell[] = ["סעיף", "תקציב מאושר", "עלות שנצברה", "התחייבויות שנותרו", "יתרת עבודה ללא התחייבות", "תחזית עלות לסיום", "חריגה צפויה", ...(report.showPaid ? ["שולם בפועל"] : []), ...(report.showQuantities ? ["כמות מתוכננת", "כמות שנרכשה", "יחידה"] : [])];
  const detail: Cell[][] = [
    [`פירוט לפי סעיפי תקציב — ${f.projectNameHe} — ${formatDate(report.reportDate)}`],
    header,
    ...f.lines.map((l) => [
      `${l.nameHe} (${l.costCodeId})`,
      money(l.budget),
      money(l.incurred),
      money(l.commitments),
      money(l.uncommitted),
      money(l.eac),
      money(l.variance),
      ...(report.showPaid ? [money(l.paid)] : []),
      ...(report.showQuantities ? [l.quantities?.planned ?? null, l.quantities?.purchasedVerified ?? null, l.quantities?.unit ?? null] : []),
    ] as Cell[]),
    ["סה״כ", money(f.totals.budget), money(f.totals.incurred), money(f.totals.commitments), money(f.totals.uncommitted), money(f.totals.eac), money(f.totals.variance), ...(report.showPaid ? [money(f.totals.paid)] : []), ...(report.showQuantities ? [null, null, null] : [])],
  ];
  const sheets: WorkbookSheet[] = report.layout === "management_summary"
    ? [
        { name: "סיכום להנהלה", rows: summary, headerRows: 1, widths: [44, 18, 70] },
        { name: "פירוט סעיפים", rows: detail, headerRows: 2, widths: [30, 16, 16, 18, 22, 18, 16, 14, 14, 14, 10] },
      ]
    : [
        { name: "פירוט סעיפים", rows: detail, headerRows: 2, widths: [30, 16, 16, 18, 22, 18, 16, 14, 14, 14, 10] },
        { name: "סיכום להנהלה", rows: summary, headerRows: 1, widths: [44, 18, 70] },
      ];
  return buildWorkbook(sheets, { title: `דוח בקרה ${f.projectNameHe} ${report.reportDate}`, creator: "בקרה — סביבת הדגמה", created: report.generatedAt.replace(/\+.*$/, "Z") });
}
