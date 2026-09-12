import { buildWorkbook, type WorkbookSheet } from "./workbook";
import { RANGE_STATUS_HE } from "../engine/kpis";
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
  const k = report.kpis;
  const perSqm = (r: (typeof rows)[number]) => (r.nameHe === "סה״כ" ? k?.total : k?.sections.find((x) => x.sectionId === r.sectionId));
  sheets.push(sheet("סעיפים", ["סעיף", "שם", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס %", "עובדה %", "התחייבות %", "אומדן %", "תקציב ₪/מ״ר", "תחזית ₪/מ״ר", "תחזית ₪/יח״ד"], rows.map((r) => [r.nameHe === "סה״כ" ? "" : r.sectionId, r.nameHe, r.budget, r.changes, r.updatedBudget, r.recorded, r.committed, r.remainingCommitment, r.uncovered, r.eac, r.variance, Math.round(r.variancePct * 100) / 100, r.previousEac, r.change, r.basisPct, r.factPct ?? null, r.commitmentPct ?? null, r.estimatePct ?? null, perSqm(r)?.budgetPerSqm ?? null, perSqm(r)?.eacPerSqm ?? null, perSqm(r)?.eacPerUnit ?? null]), [8, 40, 16, 16, 16, 16, 16, 16, 14, 10, 16, 14, 10, 12, 8, 8, 10, 8, 12, 12, 14]));
  if (k) {
    sheets.push(sheet("מדדים 2א", ["קבוצת עלות", "סעיפים", "תקציב ₪", "תחזית ₪", "נרשם ₪", "תקציב ₪/מ״ר", "תחזית ₪/מ״ר", "פער ₪/מ״ר", "נרשם ₪/מ״ר", "תקציב ₪/יח״ד", "תחזית ₪/יח״ד", "% מהתחזית", "בסיס %", "עובדה %", "התחייבות %", "אומדן %"], [...k.groups.map((g) => [g.labelHe, g.sectionsHe, g.budget, g.eac, g.recorded, g.budgetPerSqm, g.eacPerSqm, g.deltaPerSqm, g.recordedPerSqm, g.budgetPerUnit, g.eacPerUnit, g.sharePct, g.basisPct, g.factPct, g.commitmentPct, g.estimatePct]), ["סה״כ הפרויקט", `${k.grossSqm} מ״ר · ${k.units} יח״ד`, report.sections.totals.updatedBudget, report.sections.totals.eac, report.sections.totals.recorded, k.total.budgetPerSqm, k.total.eacPerSqm, k.total.eacPerSqm - k.total.budgetPerSqm, k.total.recordedPerSqm, k.total.budgetPerUnit, k.total.eacPerUnit, 100, report.sections.totals.basisPct, report.sections.totals.factPct, report.sections.totals.commitmentPct, report.sections.totals.estimatePct]], [30, 22, 14, 14, 14, 12, 12, 12, 12, 14, 14, 10, 8, 8, 10, 8]));
    sheets.push(sheet("מדדי כמות 2ב", ["מדד", "פרק", "יחידה", "סעיפים", "כמות בכתב הכמויות", "ליחידת שטח", "יחידת המדד", "טווח — מינימום", "טווח — מקסימום", "מול הטווח", "בוצע (כמות)", "בוצע %", "בוצע — הערה", "מחיר יח׳ תקציב", "מחיר יח׳ שולם", "מחיר יח׳ עדכני", "בסיס המחיר העדכני", "ערך בכתב הכמויות ₪", "עלות ₪/מ״ר", "בסיס העלות", "רגישות"], [...k.materials.map((m) => [m.labelHe, m.chapter, m.unit, m.sectionIds.join(", "), m.boqQty, m.perSqm == null ? null : Math.round(m.perSqm * 100) / 100, m.perSqmUnitHe, m.range?.min ?? null, m.range?.max ?? null, RANGE_STATUS_HE[m.rangeStatus], m.deliveredQty, m.deliveredPct, m.deliveredNoteHe, m.budgetUnitPrice, m.paidUnitPrice, m.currentUnitPrice, m.currentPriceBasisHe, m.boqValue, m.costPerSqm, m.costBasisHe, m.sensitivityHe ?? ""]), ...k.derived.map((d) => [d.labelHe, "", d.unitHe, "", null, d.value == null ? null : Math.round(d.value * 100) / 100, d.unitHe, d.range?.min ?? null, d.range?.max ?? null, RANGE_STATUS_HE[d.rangeStatus], null, null, d.noteHe, null, null, null, "", null, null, "", ""])], [22, 6, 8, 10, 14, 12, 10, 10, 10, 14, 12, 8, 36, 12, 12, 12, 26, 14, 10, 30, 40]));
    sheets.push(sheet("עלות למ״ר — מגמה", ["בקרה", "תחזית ₪/מ״ר", "תקציב ₪/מ״ר"], k.eacPerSqmSeries.map((x) => [x.labelHe, x.value, k.total.budgetPerSqm]), [16, 14, 14]));
  }
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
