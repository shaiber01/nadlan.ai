import { buildWorkbook, type WorkbookSheet } from "../../export/xlsx";
import type { ReportModel } from "../engine/report";

/**
 * The control report as a spreadsheet: one sheet per table of the standard (key figures, sections, the
 * per-building split when configured, forecast changes 4א, data corrections 4ב, risks, issues, open
 * findings, uncovered remainder). Numbers are numeric cells; the same model the screen and Word render.
 */

const sheet = (name: string, head: string[], rows: (string | number | null)[][], widths?: number[]): WorkbookSheet => ({ name: name.slice(0, 31), rows: [head, ...rows], headerRows: 1, widths: widths ?? head.map((h, i) => (i === 0 ? 34 : Math.max(14, Math.min(40, h.length + 6)))) });

export function reportToWorkbook(report: ReportModel, tab: "full" | "ceo" = "full"): Uint8Array {
  const sheets: WorkbookSheet[] = [];
  sheets.push(sheet("סיכום", ["מדד", "ערך", "הערה"], [["פרויקט", report.header.projectHe, report.header.companyHe], ["בקרה", report.header.controlLabelHe, report.header.cutoffHe], ...report.executive.keyTable.map((k) => [k.labelHe, k.valueHe, k.pctHe]), ["תקציר", report.executive.paragraphHe, ""], ...report.executive.decisionsHe.map((d) => ["החלטה נדרשת", d, ""])], [28, 60, 40]));
  if (tab === "ceo") {
    sheets.push(sheet("שינויים", ["סעיף", "סוג", "תיאור", "בסיס", "₪"], report.ceo.changes.map((c) => [c.sectionHe, c.typeHe, c.descriptionHe, c.basisHe, c.amount])));
    sheets.push(sheet("נושאים", ["#", "נושא", "סעיף", "אחראי", "יעד", "סטטוס"], report.ceo.issues.map((i) => [i.id, i.titleHe, i.sectionHe, i.ownerHe, i.dueHe, i.statusHe])));
    return buildWorkbook(sheets, { title: `${report.header.projectNameHe} — ${report.header.controlLabelHe} (מנכ״ל)`, creator: "בקרה", created: new Date().toISOString() });
  }
  const rows = [...report.sections.rows, report.sections.totals];
  sheets.push(sheet("סעיפים", ["סעיף", "שם", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס %"], rows.map((r) => [r.nameHe === "סה״כ" ? "" : r.sectionId, r.nameHe, r.budget, r.changes, r.updatedBudget, r.recorded, r.committed, r.remainingCommitment, r.uncovered, r.eac, r.variance, Math.round(r.variancePct * 100) / 100, r.previousEac, r.change, r.basisPct]), [8, 40, 16, 16, 16, 16, 16, 16, 14, 10, 16, 14, 10]));
  if (report.sections.byChapter) sheets.push(sheet("לפי פרקי המפרט", ["פרק", "סעיפים", "תקציב מקורי", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "בסיס %", "שורות כתב כמויות", "מהן לא מכוסות"], report.sections.byChapter.map((c) => [c.labelHe, c.sectionsHe, c.budget, c.changes, c.updatedBudget, c.recorded, c.committed, c.uncovered, c.eac, c.variance, Math.round(c.variancePct * 100) / 100, c.basisPct, c.boqLines, c.boqUncoveredLines]), [30, 30, 14, 12, 14, 14, 14, 14, 14, 12, 10, 8, 10, 10]));
  if (report.sections.byBuilding) sheets.push(sheet("לפי בניין", ["בניין", "תקציב מאושר", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "בסיס %"], report.sections.byBuilding.map((b) => [b.labelHe, b.budget, b.recorded, b.committed, b.remainingCommitment, b.uncovered, b.eac, b.variance, Math.round(b.variancePct * 100) / 100, b.basisPct])));
  sheets.push(sheet("שינויי תחזית 4א", ["סעיף", "סוג שינוי", "תיאור", "בסיס", "₪"], [...report.changes.forecast.map((c) => [c.sectionHe, c.typeHe, c.descriptionHe, c.basisHe, c.amount]), ["", "", "סה״כ", "", report.changes.forecastTotal]], [16, 18, 50, 40, 14]));
  sheets.push(sheet("תיקוני נתונים 4ב", ["רשומה", "מה תוקן", "לפני", "אחרי", "אישר", "בין סעיפים", "סטטוס"], report.changes.corrections.map((c) => [c.recordHe, c.whatHe, c.beforeHe, c.afterHe, c.approvedByHe, c.crossSectionHe, c.statusHe]), [16, 24, 30, 30, 12, 40, 14]));
  sheets.push(sheet("סיכונים", ["נושא", "סעיף", "תיאור", "חשיפה", "סבירות", "מה יקבע", "אחראי"], report.risks.map((r) => [r.topicHe, r.sectionHe, r.descriptionHe, r.exposureHe, r.likelihoodHe, r.triggerHe, r.ownerHe]), [30, 16, 50, 24, 10, 24, 12]));
  sheets.push(sheet("נושאים לטיפול", ["#", "נושא", "סעיף", "אחראי", "יעד", "נפתח בבקרה", "סטטוס", "השפעה אם לא יטופל"], [...report.issues.open, ...report.issues.closed].map((i) => [i.id, i.titleHe, i.sectionHe, i.ownerHe, i.dueHe, i.openedHe, i.statusHe, i.impactHe]), [10, 44, 16, 12, 12, 14, 14, 40]));
  sheets.push(sheet("ממצאים פתוחים", ["ממצא", "סעיף", "ההחלטה הנדרשת", "תיקון מומלץ", "מעורבים", "סטטוס"], report.openFindings.map((f) => [f.titleHe, f.sectionHe, f.questionHe, f.fixHe, f.peopleHe, f.statusHe]), [40, 16, 36, 36, 40, 18]));
  sheets.push(sheet("יתרה לא מכוסה", ["פריט", "סעיף", "בסיס", "₪"], [...report.appendices.uncovered.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, u.amount]), ["סה״כ אומדנים", "", "", report.appendices.uncoveredTotal], ...report.appendices.allocations.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, u.amount]), ["סה״כ הקצאות פנימיות", "", "", report.appendices.allocationTotal]], [50, 16, 22, 14]));
  return buildWorkbook(sheets, { title: `${report.header.projectNameHe} — ${report.header.controlLabelHe}`, creator: "בקרה", created: new Date().toISOString() });
}

export function reportToXlsxBlob(report: ReportModel, tab: "full" | "ceo" = "full"): Blob {
  const bytes = reportToWorkbook(report, tab);
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
