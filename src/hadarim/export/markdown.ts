import { RANGE_STATUS_HE } from "../engine/kpis";
import type { ReportModel } from "../engine/report";

/**
 * Markdown rendering of the control report (full or CEO page) — the form the agent reads, quotes and
 * hands over in chat. Same model as the screen and the Word export; nothing is computed here.
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const signed = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);
const num = (v: number) => v.toLocaleString("he-IL");
const signedNum = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${num(Math.abs(v))}`);
const pct = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);

function table(head: string[], rows: (string | number)[][]): string {
  if (!rows.length) return "_אין נתונים._\n";
  const esc = (c: string | number) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [`| ${head.map(esc).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n") + "\n";
}

export function reportToMarkdown(report: ReportModel, tab: "full" | "ceo" = "full"): string {
  const h = report.header;
  const out: string[] = [];
  const title = tab === "ceo" ? `בקרה תקציבית — ${report.header.projectNameHe} · גרסה למנכ״לית` : `דוח בקרה תקציבית — ${report.header.projectNameHe}`;
  out.push(`# ${title}`, "", `${h.controlLabelHe} · ${h.cutoffHe} · ${h.previousControlHe}`, `${h.budgetVersionHe} · ${h.boqVersionHe}`, `${h.preparedByHe} · ${h.approvedByHe} · ${h.distributionHe}`, h.sourcesHe, "");

  const exec = report.executive;
  out.push(tab === "ceo" ? "## סיכום מנהלים" : "## 1. סיכום מנהלים", "", exec.paragraphHe, "");
  out.push(table(["", "₪", "%"], (tab === "ceo" ? report.ceo.keyTable : exec.keyTable).map((k) => [k.labelHe, k.valueHe, k.pctHe || "—"])));
  if (tab !== "ceo") {
    out.push("**נקודות לתשומת לב ההנהלה**", "", ...exec.bulletsHe.map((b) => `- ${b}`), "");
  }
  if (exec.decisionsHe.length) out.push("**החלטות נדרשות**", "", ...exec.decisionsHe.map((d) => `- ${d}`), "");

  if (tab === "ceo") {
    if (report.kpis && report.kpis.grossSqm > 0) out.push(`**עלות למ״ר ברוטו:** ${num(report.kpis.total.eacPerSqm)} ₪/מ״ר (תקציב ${num(report.kpis.total.budgetPerSqm)})${report.kpis.units > 0 ? ` · ליח״ד ${nis(report.kpis.total.eacPerUnit)}` : ""} · בסיס התחזית ${report.sections.totals.basisPct}%`, "");
    out.push("## השפעות על התחזית לגמר", "", table(["סעיף", "סוג שינוי", "תיאור", "בסיס/מקור", "השפעה ₪"], [...report.ceo.changes.map((c) => [c.sectionHe, c.typeHe, c.descriptionHe, c.basisHe, signed(c.amount)]), ["", "", "סה״כ שינוי מבקרה קודמת", "", signed(report.changes.forecastTotal)]]));
    out.push("## נושאים פתוחים ברמת הנהלה", "", table(["נושא", "אחראי", "יעד", "סטטוס"], report.ceo.issues.map((i) => [i.titleHe, i.ownerHe, i.dueHe, i.statusHe])));
    if (report.ceo.riskLineHe) out.push(`**סיכון עיקרי:** ${report.ceo.riskLineHe}`, "");
    out.push("_אותם מספרים, אותם מקורות — מקושר לבקרה 09/2026. מסמך הדגמה — נתונים בדויים._", "");
    return out.join("\n");
  }

  const s = report.status;
  out.push("## 2. תמונת מצב הפרויקט", "", s.stageHe, "", `ביצוע פיזי ${s.physicalPct != null ? `~${s.physicalPct}%` : "לא נמדד"} · הוצאה ${s.expensePct.toFixed(0)}% · התחייבות ${s.commitmentPct.toFixed(0)}%`, "", s.scheduleHe, "", ...s.eventsHe.map((e) => `- ${e}`), "");

  const t = report.sections.totals;
  const k = report.kpis;
  if (k) {
    const fx = (v: number | null, d: number) => (v == null ? "—" : v.toLocaleString("he-IL", { minimumFractionDigits: d, maximumFractionDigits: d }));
    out.push("## 2א. מדדי עלות וכמות", "", `המכנה: ${k.denominatorHe}.`, "");
    out.push("### א. עלות למ״ר לפי קבוצת עלות", "", table(["קבוצה", "סעיפים", "תקציב ₪/מ״ר", "תחזית ₪/מ״ר", "פער", "נרשם ₪/מ״ר", "% מהתחזית", "בסיס", "תחזית ₪/יח״ד"], [...k.groups.map((g) => [g.labelHe, g.sectionsHe, num(g.budgetPerSqm), num(g.eacPerSqm), g.deltaPerSqm ? signedNum(g.deltaPerSqm) : "—", num(g.recordedPerSqm), `${g.sharePct}%`, `${g.basisPct}% (עובדה ${g.factPct}% · התחייבות ${g.commitmentPct}% · אומדן ${g.estimatePct}%)`, num(g.eacPerUnit)]), ["**סה״כ הפרויקט**", "", num(k.total.budgetPerSqm), num(k.total.eacPerSqm), signedNum(k.total.eacPerSqm - k.total.budgetPerSqm), num(k.total.recordedPerSqm), "100%", `${t.basisPct}%`, num(k.total.eacPerUnit)]]));
    out.push("### ב. מדדי כמות — חומרים עיקריים מול השטח הבנוי", "", table(["מדד", "כמות בכתב הכמויות", "ליחידת שטח", "טווח ייחוס", "בוצע עד החתך", "מחיר יח׳ — תקציב", "מחיר יח׳ — עדכני", "עלות ₪/מ״ר"], [...k.materials.map((m) => [`${m.labelHe} (פרק ${m.chapter}, ${m.unit})`, `${num(m.boqQty)} ${m.unit}`, m.perSqm == null ? "—" : `${fx(m.perSqm, m.digits)} ${m.perSqmUnitHe}`, m.range ? `${fx(m.range.min, m.digits)}–${fx(m.range.max, m.digits)} — ${RANGE_STATUS_HE[m.rangeStatus]}` : "ללא טווח", m.deliveredQty != null ? `${num(Math.round(m.deliveredQty))} ${m.unit}${m.deliveredPct != null ? ` (${m.deliveredPct}%)` : ""}` : m.deliveredNoteHe, m.budgetUnitPrice != null ? `${num(m.budgetUnitPrice)} ₪/${m.unit}` : "—", m.currentUnitPrice != null ? `${num(m.currentUnitPrice)} ₪/${m.unit} (${m.currentPriceBasisHe})` : "—", m.costPerSqm != null ? `${num(m.costPerSqm)} (${m.costBasisHe})` : "—"]), ...k.derived.map((d) => [d.labelHe, "—", d.value == null ? "—" : `${fx(d.value, d.digits)} ${d.unitHe}`, d.range ? `${fx(d.range.min, d.digits)}–${fx(d.range.max, d.digits)} — ${RANGE_STATUS_HE[d.rangeStatus]}` : "ללא טווח", "—", "—", "—", "—"])]), ...k.notesHe.map((n) => `- ${n}`), "");
    out.push("**עלות למ״ר לאורך הבקרות:** " + k.eacPerSqmSeries.map((x) => `${x.labelHe} ${num(x.value)}`).join(" · ") + ` (תקציב ${num(k.total.budgetPerSqm)})`, "");
  }

  out.push("## 3. טבלת הסעיפים", "");
  const rows = report.sections.rows.map((r) => [r.sectionId, r.isContingency ? `${r.nameHe} (שורה נפרדת)` : r.highlighted ? `**${r.nameHe}**` : r.nameHe, nis(r.budget), r.changes ? signed(r.changes) : "—", nis(r.updatedBudget), nis(r.recorded), nis(r.committed), nis(r.remainingCommitment), nis(r.uncovered), nis(r.eac), signed(r.variance), pct(r.variancePct), nis(r.previousEac), signed(r.change), `${r.basisPct}%`]);
  rows.push(["", "**סה״כ**", nis(t.budget), "—", nis(t.updatedBudget), nis(t.recorded), nis(t.committed), nis(t.remainingCommitment), nis(t.uncovered), nis(t.eac), signed(t.variance), pct(t.variancePct), nis(t.previousEac), signed(t.change), `${t.basisPct}%`]);
  out.push(table(["#", "סעיף", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס"], rows), report.sections.materialityHe, "");
  if (report.sections.byChapter) {
    out.push("### פילוח משני — לפי פרקי המפרט הבינמשרדי", "", table(["פרק", "סעיפים", "תקציב מקורי", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "בסיס", "שורות כתב כמויות (לא מכוסות)"], report.sections.byChapter.map((c) => [c.labelHe, c.sectionsHe, nis(c.budget), c.changes ? signed(c.changes) : "—", nis(c.updatedBudget), nis(c.recorded), nis(c.committed), nis(c.uncovered), nis(c.eac), signed(c.variance), pct(c.variancePct), `${c.basisPct}%`, c.boqLines ? `${c.boqLines} (${c.boqUncoveredLines})` : "—"])));
  }
  if (report.sections.byBuilding) {
    out.push("### פילוח משני — לפי בניין", "", table(["בניין", "תקציב", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "בסיס"], report.sections.byBuilding.map((b) => [b.labelHe, nis(b.budget), nis(b.recorded), nis(b.committed), nis(b.remainingCommitment), nis(b.uncovered), nis(b.eac), signed(b.variance), pct(b.variancePct), `${b.basisPct}%`])));
    if (report.sections.byBuildingNoteHe) out.push(`הערה: ${report.sections.byBuildingNoteHe}`, "");
  }

  out.push("## 4. הסבר לשינויים מהבקרה הקודמת", "", "### 4א. שינויים בתחזית לגמר", "", table(["סעיף", "סוג שינוי", "תיאור", "בסיס/מקור", "השפעה ₪"], [...report.changes.forecast.map((c) => [c.sectionHe, c.typeHe, c.descriptionHe, c.basisHe, signed(c.amount)]), ["", "", "סה״כ שינוי מבקרה קודמת", "", signed(report.changes.forecastTotal)]]));
  out.push("### 4ב. תיקוני נתונים ללא השפעה על התחזית הכוללת", "", table(["רשומה", "מה תוקן", "לפני", "אחרי", "מי אישר", "השפעה בין סעיפים", "סטטוס"], report.changes.corrections.map((c) => [c.recordHe, c.whatHe, c.beforeHe, c.afterHe, c.approvedByHe, c.crossSectionHe, c.statusHe])));

  out.push("## 5. ניתוח סעיפים מהותיים", "");
  for (const m of report.material) {
    out.push(`### ${m.titleHe}`, "", `_נכלל כי: ${m.reasonHe}_`, "", ...m.paragraphsHe, "", table(m.table[0], m.table.slice(1)), `**המלצה:** ${m.recommendationHe}`, "", `מקורות: ${m.sources.map((x) => x.labelHe).join(" · ")}`, "");
  }

  const c = report.contingency;
  out.push("## 6. בלתי צפוי, שינויים ותביעות", "", `בלתי צפוי: מקור ${nis(c.original)} · נוצל ${nis(c.used)} · יתרה ${nis(c.remaining)}`, "", `- ${c.pendingChangeOrdersHe}`, `- ${c.claimsHe}`, `- החלטה: ${c.decisionHe}`, "");

  out.push("## 7. סיכונים והזדמנויות (מחוץ לתחזית)", "", table(["נושא", "סעיף", "תיאור", "חשיפה ₪", "סבירות", "מה יקבע", "אחראי"], report.risks.map((r) => [r.topicHe, r.sectionHe, r.descriptionHe, r.exposureHe, r.likelihoodHe, r.triggerHe, r.ownerHe])));

  out.push("## 8. נושאים לטיפול", "", table(["#", "נושא", "סעיף", "אחראי", "יעד", "נפתח בבקרה", "סטטוס", "השפעה אם לא יטופל"], report.issues.open.map((i, idx) => [idx + 1, i.stale ? `${i.titleHe} (פתוח יותר משתי בקרות)` : i.titleHe, i.sectionHe, i.ownerHe, i.dueHe, i.openedHe, i.statusHe, i.impactHe])));
  if (report.openFindings.length || report.openQuestions.length) {
    out.push("### 8א. ממצאים שטרם הוכרעו ושאלות פתוחות", "");
    if (report.openFindings.length) out.push(table(["ממצא", "סעיף", "ההחלטה הנדרשת", "תיקון מומלץ", "מעורבים", "סטטוס"], report.openFindings.map((f) => [f.titleHe, f.sectionHe, f.questionHe, f.fixHe, f.peopleHe, f.statusHe])));
    if (report.openQuestions.length) out.push(table(["שאלה", "נשאל", "ערוץ", "נשלח"], report.openQuestions.map((q) => [q.textHe, q.toHe, q.channelHe, q.askedHe])));
    out.push("הדוח אינו סופי כל עוד יש ממצאים שלא הוכרעו; הסכומים אינם כוללים תיקונים שטרם הוחלטו.", "");
  }
  if (report.issues.closed.length) out.push("נסגרו מאז הבקרה הקודמת:", "", ...report.issues.closed.map((i) => `- ${i.titleHe} — נסגר ${i.closedHe ?? ""} · ${i.ownerHe}`), "");

  out.push("## 9. התאמות מאומתות", "", ...(report.verified.length ? report.verified.map((v) => `- **${v.titleHe}** — ${v.textHe}`) : ["- אין."]), "");

  if (report.trends.comparison) {
    out.push("## 10. השוואה לבקרה הקודמת ומגמות", "", table(report.trends.comparison[0], report.trends.comparison.slice(1)), table(["בקרה", "תחזית לגמר"], report.trends.eacSeries.map((p) => [p.labelHe, nis(p.value)])), table(["בקרה", "יתרה לא מכוסה (אומדנים)"], report.trends.uncoveredSeries.map((p) => [p.labelHe, nis(p.value)])), report.trends.uncoveredCommentaryHe, "", `**מגמה:** ${report.trends.commentaryHe}`, "");
  }

  const a = report.appendices;
  out.push("## 11. נספחים", "", "### א. הגדרות ומתודולוגיה", "", ...a.definitionsHe.map((d) => `- ${d}`), "", "### ב. הנחות התחזית", "", ...a.assumptionsHe.map((d) => `- ${d}`), "", "### ג. מקורות וגרסאות", "", ...a.sourcesHe.map((d) => `- ${d}`), "");
  out.push("### ד. יומן תיקוני נתונים", "", table(["רשומה", "מה תוקן", "לפני", "אחרי", "מי אישר", "השפעה בין סעיפים", "סטטוס"], a.correctionLog.map((x) => [x.recordHe, x.whatHe, x.beforeHe, x.afterHe, x.approvedByHe, x.crossSectionHe, x.statusHe])));
  out.push("### ה. חשבונות בבדיקה במועד החתך", "", `${a.inReview.count} חשבונות בסך ${nis(a.inReview.amount)} — אינם נכללים ב״נרשם״.`, "", "### ו. אירועים לאחר מועד החתך", "", ...(a.afterCutoffHe.length ? a.afterCutoffHe.map((d) => `- ${d}`) : ["- אין."]), "");
  out.push("### ז. פירוט יתרה להשלמה לא מכוסה", "", table(["פריט", "סעיף", "בסיס", "₪"], [...a.uncovered.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, nis(u.amount)]), ["**סה״כ**", "", "", nis(a.uncoveredTotal)]]), "הקצאות פנימיות — לא רכש (מוצגות בנפרד):", "", table(["פריט", "סעיף", "בסיס", "₪"], [...a.allocations.map((u) => [u.descriptionHe, u.sectionHe, u.basisHe, nis(u.amount)]), ["**סה״כ**", "", "", nis(a.allocationTotal)]]));
  out.push("_מסמך הדגמה — נתונים בדויים._", "");
  return out.join("\n");
}
