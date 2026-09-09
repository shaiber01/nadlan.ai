import type { ReportModel } from "../engine/report";

/**
 * Markdown rendering of the control report (full or CEO page) — the form the agent reads, quotes and
 * hands over in chat. Same model as the screen and the Word export; nothing is computed here.
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const signed = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);
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
    out.push("## השפעות על התחזית לגמר", "", table(["סעיף", "סוג שינוי", "תיאור", "בסיס/מקור", "השפעה ₪"], [...report.ceo.changes.map((c) => [c.sectionHe, c.typeHe, c.descriptionHe, c.basisHe, signed(c.amount)]), ["", "", "סה״כ שינוי מבקרה קודמת", "", signed(report.changes.forecastTotal)]]));
    out.push("## נושאים פתוחים ברמת הנהלה", "", table(["נושא", "אחראי", "יעד", "סטטוס"], report.ceo.issues.map((i) => [i.titleHe, i.ownerHe, i.dueHe, i.statusHe])));
    if (report.ceo.riskLineHe) out.push(`**סיכון עיקרי:** ${report.ceo.riskLineHe}`, "");
    out.push("_אותם מספרים, אותם מקורות — מקושר לבקרה 09/2026. מסמך הדגמה — נתונים בדויים._", "");
    return out.join("\n");
  }

  const s = report.status;
  out.push("## 2. תמונת מצב הפרויקט", "", s.stageHe, "", `ביצוע פיזי ${s.physicalPct != null ? `~${s.physicalPct}%` : "לא נמדד"} · הוצאה ${s.expensePct.toFixed(0)}% · התחייבות ${s.commitmentPct.toFixed(0)}%`, "", s.scheduleHe, "", ...s.eventsHe.map((e) => `- ${e}`), "");

  out.push("## 3. טבלת הסעיפים", "");
  const rows = report.sections.rows.map((r) => [r.sectionId, r.isContingency ? `${r.nameHe} (שורה נפרדת)` : r.highlighted ? `**${r.nameHe}**` : r.nameHe, nis(r.budget), r.changes ? signed(r.changes) : "—", nis(r.updatedBudget), nis(r.recorded), nis(r.committed), nis(r.remainingCommitment), nis(r.uncovered), nis(r.eac), signed(r.variance), pct(r.variancePct), nis(r.previousEac), signed(r.change), `${r.basisPct}%`]);
  const t = report.sections.totals;
  rows.push(["", "**סה״כ**", nis(t.budget), "—", nis(t.updatedBudget), nis(t.recorded), nis(t.committed), nis(t.remainingCommitment), nis(t.uncovered), nis(t.eac), signed(t.variance), pct(t.variancePct), nis(t.previousEac), signed(t.change), `${t.basisPct}%`]);
  out.push(table(["#", "סעיף", "תקציב מאושר", "שינויים", "תקציב מעודכן", "נרשם", "התחייבויות", "יתרת התחייבות", "יתרה לא מכוסה", "תחזית לגמר", "סטייה ₪", "סטייה %", "תחזית קודמת", "שינוי", "בסיס"], rows), report.sections.materialityHe, "");
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
