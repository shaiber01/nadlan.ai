import { formatDate } from "../../domain/dates";
import { formatILS, formatNumber, sum } from "../../domain/money";
import { categoryCoverage, contractRemainingPayment } from "../../domain/selectors/financial";
import { recordsForView, viewForScope, type ScopedView } from "../../domain/selectors/scope";
import { changeBetweenReports, changeSinceLastReport, lastDeliveredReport, reportById } from "../../domain/selectors/snapshot";
import type { ChatAnswer, ChatScope, CostCategory, CostLineView, DemoState, EvidenceRef } from "../../domain/types";
import { normalizeText } from "./clarification";

/**
 * Deterministic supported-intent matching with parameterized Hebrew templates (Section 9.3).
 * Every answer is computed from the scoped view (current data or a frozen report) and links evidence.
 */

type Intent = "remaining_payment" | "changed_since_report" | "evidence" | "commitments" | "variance" | "eac" | "paid" | "incurred" | "unsupported" | "site_progress";

const m = (v: number) => formatILS(v);
const UNSUPPORTED_HE = "בדמו אפשר לשאול על הוצאות, תשלומים, התחייבויות, תחזית לסיום, חריגות ושינויים מאז הדוח. למשל: ״כמה צפוי לעלות הברזל בהדרים?״";
const NO_SITE_INFO_HE = "אין במסמכים שבדמו אישור לכמות העבודה שנותרה בשטח. אפשר לפתוח בירור מול מנהלת התפעול.";

export interface ParsedQuestion {
  intent: Intent;
  projectId: string | null;
  portfolio: boolean;
  category: CostCategory | null;
  costCodeId: string | null;
  explicitReportDate: string | null;
  ambiguousProject: boolean;
}

/** Resolve more specific intents first ("נשאר לשלם" before "שילמנו"). */
function detectIntent(norm: string): Intent {
  if (/נשאר לשלם|נותר לשלם|יתרה לתשלום|כמה עוד לשלם|עוד לשלם/.test(norm)) return "remaining_payment";
  if (/מאז הדוח|מה השתנה|השתנה מ|לעומת הדוח/.test(norm)) return "changed_since_report";
  if (/על סמך מה|למה תיקנ|מקור|ראיה|איך ידעת|תיקנתם/.test(norm)) return "evidence";
  if (/התחייבויות|הזמנות פתוחות|התחייבנו|התחייבות/.test(norm)) return "commitments";
  if (/חריגה|חרגנו|מעל התקציב|חריגות|החריגה/.test(norm)) return "variance";
  if (/תחזית|בסוף|לסיום|צפוי לעלות|יעלה/.test(norm)) return "eac";
  if (/שילמנו|שולם|תשלום בפועל|שילמו/.test(norm)) return "paid";
  if (/הוצאנו|עלות שנצברה|הוצאות|נצבר|עלה לנו|הוצאה/.test(norm)) return "incurred";
  if (/נשאר(ה)? (לבצע|בשטח)|עבודה נשארה|בשטח|לבצע|התקדמות|אחוז ביצוע|כמה בוצע|קצב/.test(norm)) return "site_progress";
  return "unsupported";
}

const categoryAliases: [RegExp, CostCategory][] = [
  [/ברזל|ברזלים/, "steel"],
  [/בטון/, "concrete"],
  [/קבלן השלד|שלד/, "frame"],
  [/ציוד|השכרה/, "equipment"],
  [/איטום/, "waterproofing"],
  [/גמר/, "finishing"],
  [/תקורות|תקורה/, "site_overhead"],
];

export function parseQuestion(state: DemoState, text: string, scope: ChatScope, lastContext: { projectId: string | null; costCodeId: string | null }): ParsedQuestion {
  const norm = normalizeText(text).replace(/,(?=\d{3})/g, "");
  const intent = detectIntent(norm);
  let projectId: string | null = null;
  let portfolio = false;
  const mentioned: string[] = [];
  for (const p of state.projects) {
    if (p.aliases.some((a) => norm.includes(a))) mentioned.push(p.id);
  }
  if (/כל החברה|בכל החברה|כלל החברה|כל הפרויקטים|בחברה/.test(norm)) portfolio = true;
  const unique = [...new Set(mentioned)];
  if (unique.length === 1) projectId = unique[0];
  const ambiguousProject = unique.length > 1;
  if (!projectId && !portfolio) projectId = scope.projectId ?? lastContext.projectId;
  let category: CostCategory | null = null;
  for (const [re, cat] of categoryAliases) {
    if (re.test(norm)) {
      category = cat;
      break;
    }
  }
  let costCodeId: string | null = null;
  if (category && projectId) costCodeId = state.costCodes.find((c) => c.projectId === projectId && c.category === category)?.id ?? null;
  else if (!category && lastContext.costCodeId && /^(ו|ומה עם|וכמה|ומה) /.test(norm)) costCodeId = lastContext.costCodeId;
  const dateMatch = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/.exec(norm);
  const explicitReportDate = dateMatch ? `${dateMatch[3] ?? "2026"}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}` : null;
  return { intent, projectId, portfolio, category, costCodeId, explicitReportDate, ambiguousProject };
}

function lineEvidence(_state: DemoState, line: CostLineView, view: ScopedView): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const r of line.records) if (r.sourceDocumentId) refs.push({ documentId: r.sourceDocumentId, anchorId: "line1", labelHe: `${r.descriptionHe}` });
  for (const w of line.workItems) if (w.status === "uncommitted" && w.sourceDocumentId) refs.push({ documentId: w.sourceDocumentId, anchorId: "summary", labelHe: w.titleHe });
  for (const c of line.commitmentViews) if (c.documentId) refs.push({ documentId: c.documentId, anchorId: "value", labelHe: c.titleHe });
  refs.push({ documentId: `BUD-${line.projectId}-V1`, anchorId: line.costCodeId.toLowerCase(), labelHe: "תקציב הפרויקט" });
  const allowed = view.availableDocumentIds;
  const seen = new Set<string>();
  return refs.filter((r) => (!allowed || allowed.has(r.documentId)) && !seen.has(`${r.documentId}#${r.anchorId}`) && seen.add(`${r.documentId}#${r.anchorId}`)).slice(0, 6);
}

function answerIncurred(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  if (view.portfolio && parsed.category) return answerCompanyCategory(state, parsed.category, view);
  const line = parsed.costCodeId ? view.lines.find((l) => l.costCodeId === parsed.costCodeId) : null;
  if (line) {
    const invoices = line.records.filter((r) => r.kind === "invoice");
    const qtyText = line.quantities?.purchasedVerified != null ? `; ${formatNumber(line.quantities.purchasedVerified)} ${line.quantities.unit}${invoices[0]?.unitPrice ? ` במחיר ${m(invoices[0].unitPrice)} ל${line.quantities.unit}` : ""}` : "";
    return {
      headlineHe: `עלות ה${line.nameHe} שנצברה ב${projectLabel(state, view)} היא ${m(line.incurred)}${qtyText}. ״הוצאנו״ כאן פירושו עלות שנצברה (חשבוניות שנקלטו${line.incurredAccrued ? " ועבודה שבוצעה וטרם חויבה" : ""}), לא תשלום בפועל: שולם עד כה ${m(line.paid)}.`,
      breakdownHe: [`חשבוניות שנקלטו: ${m(line.incurredInvoiced)}`, ...(line.incurredAccrued ? [`עבודה שבוצעה וטרם חויבה: ${m(line.incurredAccrued)}`] : []), `שולם בפועל (מוצג בנפרד): ${m(line.paid)}`, ...(line.provisional ? ["חלק מהרשומות טרם הושלמה הבדיקה"] : [])],
      evidence: lineEvidence(state, line, view),
      actions: [{ labelHe: "פתח את סעיף התקציב", route: `#/budget?project=${line.projectId}&code=${line.costCodeId}` }],
      scopeLabelHe: view.labelHe,
    };
  }
  if (parsed.category && !view.portfolio) {
    return { headlineHe: `בפרויקט ${projectLabel(state, view)} אין בדמו סעיף נפרד ל${categoryHe(parsed.category)}; הנתונים המצרפיים אינם מפרטים קטגוריה זו, ולכן הסכום אינו ידוע (לא אפס).`, breakdownHe: ["קיים פירוט רק בחלק מהפרויקטים"], evidence: [], actions: [], scopeLabelHe: view.labelHe, qualificationHe: "קיים פירוט רק בחלק מהפרויקטים" };
  }
  return {
    headlineHe: `העלות שנצברה ב${projectLabel(state, view)} היא ${m(view.totals.incurred)} (לפני מע״מ). זו עלות מוכרת — חשבוניות שנקלטו${view.totals.incurredAccrued ? " ועבודה שבוצעה וטרם חויבה" : ""} — ולא תשלום בפועל (${m(view.totals.paid)}).`,
    breakdownHe: view.lines.map((l) => `${l.nameHe}: ${m(l.incurred)}`),
    evidence: view.lines.flatMap((l) => lineEvidence(state, l, view)).slice(0, 6),
    actions: [{ labelHe: "פתח את טבלת התקציב", route: `#/budget?project=${view.projectId ?? "HAD"}` }],
    scopeLabelHe: view.labelHe,
  };
}

function answerCompanyCategory(state: DemoState, category: CostCategory, view: ScopedView): ChatAnswer {
  const cov = categoryCoverage(state, category);
  const parts = cov.detailed.map((d) => `${m(d.incurred)} ב${state.projects.find((p) => p.id === d.projectId)?.shortNameHe}`);
  const aggregate = cov.aggregateOnlyProjectIds.map((id) => state.projects.find((p) => p.id === id)?.nameHe).join(" וב");
  return {
    headlineHe: `בפרויקטים שבהם קיים פירוט ${categoryHe(category)} נצברו ${m(cov.subtotal)}: ${parts.join(" ו-")}. ב${aggregate} יש בדמו נתונים מצרפיים בלבד, ולכן זה אינו סך ה${categoryHe(category)} המלא של החברה.`,
    breakdownHe: [...cov.detailed.map((d) => `${state.projects.find((p) => p.id === d.projectId)?.nameHe}: ${m(d.incurred)} (${d.costCodeId})`), ...cov.aggregateOnlyProjectIds.map((id) => `${state.projects.find((p) => p.id === id)?.nameHe}: פירוט לפי קטגוריה אינו זמין`)],
    evidence: cov.detailed.flatMap((d) => lineEvidence(state, view.lines.find((l) => l.costCodeId === d.costCodeId)!, view).slice(0, 2)),
    actions: [],
    scopeLabelHe: view.labelHe,
    qualificationHe: "קיים פירוט רק בחלק מהפרויקטים",
  };
}

function answerPaid(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  const line = parsed.costCodeId ? view.lines.find((l) => l.costCodeId === parsed.costCodeId) : null;
  if (line) {
    const unpaid = line.incurredInvoiced - line.paid;
    return {
      headlineHe: `על ה${line.nameHe} ב${projectLabel(state, view)} שולם בפועל ${m(line.paid)}. זאת לעומת ${m(line.incurredInvoiced)} בחשבוניות שהוכרו${unpaid > 0 ? `; ${m(unpaid)} הוכרו וטרם שולמו` : ""}. תשלומים אינם עלות פרויקט נוספת.`,
      breakdownHe: line.records.map((r) => `${r.descriptionHe}: הוכר ${m(r.amount)}, שולם ${m(r.paid)}`),
      evidence: lineEvidence(state, line, view),
      actions: [{ labelHe: "תשלומים לפי הרישומים", route: `#/budget?project=${line.projectId}&code=${line.costCodeId}` }],
      scopeLabelHe: view.labelHe,
    };
  }
  return {
    headlineHe: `ב${projectLabel(state, view)} שולם בפועל ${m(view.totals.paid)}, לעומת עלות שנצברה של ${m(view.totals.incurred)}. ההפרש (${m(view.totals.incurred - view.totals.paid)}) הוכר וטרם שולם.`,
    breakdownHe: view.lines.map((l) => `${l.nameHe}: שולם ${m(l.paid)} מתוך ${m(l.incurred)}`),
    evidence: [],
    actions: [],
    scopeLabelHe: view.labelHe,
  };
}

function answerEac(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  const line = parsed.costCodeId ? view.lines.find((l) => l.costCodeId === parsed.costCodeId) : null;
  if (line) {
    const uncommitted = line.workItems.filter((w) => w.status === "uncommitted");
    const qtyText = uncommitted.length === 1 && uncommitted[0].quantity ? ` עבור ${formatNumber(uncommitted[0].quantity)} ${uncommitted[0].unit ?? ""} שנותרו, לפי ${uncommitted[0].basisHe}` : "";
    const varianceText = line.variance > 0 ? `זו חריגה צפויה של ${m(line.variance)} מהתקציב.` : line.variance < 0 ? `זו תחזית נמוכה מהתקציב ב-${m(-line.variance)} (חיסכון צפוי, לא ממומש).` : "התחזית תואמת לתקציב.";
    const conditional = openConditional(state, line.costCodeId, view);
    return {
      headlineHe: `תחזית עלות ה${line.nameHe} ב${projectLabel(state, view)} היא ${m(line.eac)}: ${m(line.incurred)} שכבר נצברו${line.commitments ? `, ${m(line.commitments)} התחייבויות שנותרו` : ""}${line.uncommitted ? ` ועוד ${m(line.uncommitted)}${qtyText}` : ""}. ${varianceText}${conditional ? ` בנוסף קיים סיכון מותנה של ${m(conditional)} שטרם אושר ואינו כלול בתחזית.` : ""}`,
      breakdownHe: [`עלות שנצברה: ${m(line.incurred)}`, `התחייבויות שנותרו: ${m(line.commitments)}`, ...uncommitted.map((w) => `${w.titleHe}: ${m(w.amount)} (${w.basisHe})`), `תקציב מאושר: ${m(line.budget)}`],
      evidence: lineEvidence(state, line, view),
      actions: [{ labelHe: "פתח את סעיף התקציב", route: `#/budget?project=${line.projectId}&code=${line.costCodeId}` }],
      scopeLabelHe: view.labelHe,
    };
  }
  return {
    headlineHe: `תחזית העלות לסיום של ${projectLabel(state, view)} היא ${m(view.totals.eac)} (כולל ${m(view.totals.incurred)} שכבר נצברו), לעומת תקציב ${m(view.totals.budget)}: ${view.totals.variance >= 0 ? `חריגה צפויה של ${m(view.totals.variance)}` : `תחזית נמוכה מהתקציב ב-${m(-view.totals.variance)}`}.`,
    breakdownHe: view.lines.map((l) => `${l.nameHe}: ${m(l.eac)} (${l.variance >= 0 ? "+" : "−"}${m(Math.abs(l.variance))})`),
    evidence: [],
    actions: [{ labelHe: "פתח את טבלת התקציב", route: `#/budget?project=${view.projectId ?? "HAD"}` }],
    scopeLabelHe: view.labelHe,
  };
}

function openConditional(state: DemoState, costCodeId: string, view: ScopedView): number {
  if (view.report) return sum(view.report.frozen.notes.filter((n) => n.kind === "conditional_risk" && n.costCodeId === costCodeId).map((n) => n.amount ?? 0));
  return sum(state.findings.filter((f) => f.kind === "price_risk" && f.costCodeId === costCodeId && ["conditional", "pending_review", "question_sent", "needs_clarification"].includes(f.status)).map((f) => f.amounts.futurePremium ?? 0));
}

function answerVariance(state: DemoState, view: ScopedView): ChatAnswer {
  const ranked = [...view.lines].sort((a, b) => b.variance - a.variance);
  const top = ranked[0];
  const conditional = view.report ? view.report.frozen.notes.filter((n) => n.kind === "conditional_risk") : state.findings.filter((f) => f.kind === "price_risk" && (!view.projectId || f.projectId === view.projectId) && ["conditional", "pending_review", "question_sent", "needs_clarification"].includes(f.status)).map((f) => ({ titleHe: f.titleHe, amount: f.amounts.futurePremium }));
  if (!top || top.variance <= 0) {
    return { headlineHe: `ב${projectLabel(state, view)} אין כרגע סעיף עם חריגה צפויה מאושרת. ${conditional.length ? `קיימים סיכונים מותנים שטרם אושרו: ${conditional.map((c) => `${c.titleHe} (${m(c.amount ?? 0)})`).join("; ")}.` : ""}`, breakdownHe: ranked.slice(0, 3).map((l) => `${l.nameHe}: ${m(l.variance)}`), evidence: [], actions: [], scopeLabelHe: view.labelHe };
  }
  return {
    headlineHe: `החריגה הצפויה הגדולה ביותר ב${projectLabel(state, view)} היא בסעיף ${top.nameHe}: ${m(top.variance)} (תחזית ${m(top.eac)} מול תקציב ${m(top.budget)}).${conditional.length ? ` בנפרד, סיכונים מותנים שטרם אושרו: ${conditional.map((c) => `${m(c.amount ?? 0)}`).join(", ")}.` : ""}`,
    breakdownHe: ranked.slice(0, 5).map((l, i) => `${i + 1}. ${l.nameHe}: ${l.variance >= 0 ? "+" : "−"}${m(Math.abs(l.variance))}`),
    evidence: lineEvidence(state, top, view),
    actions: [{ labelHe: "פתח את סעיף התקציב", route: `#/budget?project=${top.projectId}&code=${top.costCodeId}` }],
    scopeLabelHe: view.labelHe,
  };
}

function answerCommitments(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  const line = parsed.costCodeId ? view.lines.find((l) => l.costCodeId === parsed.costCodeId) : null;
  const lines = line ? [line] : view.lines;
  const total = sum(lines.map((l) => l.commitments));
  return {
    headlineHe: `${line ? `בסעיף ${line.nameHe}` : `ב${projectLabel(state, view)}`} פתוחות התחייבויות נטו של ${m(total)}. הסכום אינו כולל עלות שכבר נצברה (${m(sum(lines.map((l) => l.incurred)))}) ולא יתרת עבודה ללא התחייבות (${m(sum(lines.map((l) => l.uncommitted)))}).`,
    breakdownHe: lines.flatMap((l) => l.commitmentViews.filter((c) => c.remaining > 0).map((c) => `${l.nameHe} · ${c.titleHe}: ${m(c.remaining)} (מתוך ${m(c.value)}, הוכרו ${m(c.recognized)})`)),
    evidence: lines.flatMap((l) => l.commitmentViews.filter((c) => c.documentId).map((c) => ({ documentId: c.documentId!, anchorId: "value", labelHe: c.titleHe }))).slice(0, 6),
    actions: [],
    scopeLabelHe: view.labelHe,
  };
}

function answerRemainingPayment(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  const line = parsed.costCodeId ? view.lines.find((l) => l.costCodeId === parsed.costCodeId) : null;
  if (!line) {
    const remaining = view.totals.eac - view.totals.paid;
    return { headlineHe: `ב${projectLabel(state, view)} התשלום הצפוי שנותר הוא ${m(remaining)}: תחזית עלות לסיום ${m(view.totals.eac)} פחות ${m(view.totals.paid)} ששולמו. הסכום כולל גם יתרת עבודה ללא התחייבות.`, breakdownHe: [], evidence: [], actions: [], scopeLabelHe: view.labelHe };
  }
  const contracts = line.commitmentViews.filter((c) => c.kind === "contract");
  if (contracts.length === 1 && !view.report) {
    const c = contracts[0];
    const pay = contractRemainingPayment(state, c.commitmentId);
    const lineRemaining = line.eac - line.paid;
    return {
      headlineHe: `לפי החוזה המפושט של ${line.nameHe} נשאר לשלם ${m(pay.total)}: ${m(pay.unpaidRecognized)} חשבוניות שהוכרו וטרם שולמו${pay.unbilledRecognized ? `, ${m(pay.unbilledRecognized)} עבודה שבוצעה וטרם חויבה` : ""} ועוד ${m(pay.remainingCommitment)} עבודה חוזית עתידית. הדמו ללא מע״מ, עכבון ומימון.${lineRemaining !== pay.total ? ` הסעיף כולו כולל גם ${m(lineRemaining - pay.total)} מחוץ לחוזה זה, כך שהתשלום הצפוי לכל הסעיף הוא ${m(lineRemaining)}.` : ""}`,
      breakdownHe: [`הוכר בחוזה: ${m(c.recognized)}`, `שולם: ${m(line.paid)}`, `יתרת החוזה: ${m(pay.remainingCommitment)}`, `סך החוזה: ${m(c.value)} (תחזית עלות החוזה אינה משתנה מתשלומים)`],
      evidence: lineEvidence(state, line, view),
      actions: [{ labelHe: "תשלומים לפי הרישומים", route: `#/budget?project=${line.projectId}&code=${line.costCodeId}` }],
      scopeLabelHe: view.labelHe,
    };
  }
  const remaining = line.eac - line.paid;
  return { headlineHe: `בסעיף ${line.nameHe} התשלום הצפוי שנותר הוא ${m(remaining)}: תחזית ${m(line.eac)} פחות ${m(line.paid)} ששולמו (כולל יתרת עבודה ללא התחייבות).`, breakdownHe: [`הוכר וטרם שולם: ${m(line.incurred - line.paid)}`, `התחייבויות שנותרו: ${m(line.commitments)}`, `יתרת עבודה ללא התחייבות: ${m(line.uncommitted)}`], evidence: lineEvidence(state, line, view), actions: [], scopeLabelHe: view.labelHe };
}

function answerChanged(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  const projectId = view.projectId ?? parsed.projectId ?? "HAD";
  const explicit = parsed.explicitReportDate ? state.reports.find((r) => r.projectId === projectId && r.reportDate === parsed.explicitReportDate && r.status === "delivered") ?? null : null;
  const comparison = view.report ? changeBetweenReports(state, view.report, explicit?.id) : changeSinceLastReport(state, projectId, explicit?.id);
  if (!comparison.comparedToReportId) {
    return { headlineHe: `אין דוח קודם שנמסר ל${projectLabel(state, view)}, ולכן אין בסיס להשוואה.`, breakdownHe: [], evidence: [], actions: [], scopeLabelHe: view.labelHe };
  }
  const compared = reportById(state, comparison.comparedToReportId)!;
  const subject = view.report ? `הדוח מתאריך ${formatDate(view.report.reportDate)}` : "הנתונים העדכניים";
  const evidence: EvidenceRef[] = [];
  for (const l of comparison.changedLines) {
    const line = view.lines.find((x) => x.costCodeId === l.costCodeId);
    if (line) evidence.push(...lineEvidence(state, line, view).slice(0, 2));
  }
  const auditNotes = view.report ? [] : state.auditEvents.filter((e) => e.reportRelevant && e.at > compared.generatedAt && (!e.projectId || e.projectId === projectId)).map((e) => `${formatDate(e.at)} · ${e.textHe}`).slice(0, 5);
  return {
    headlineHe: `${subject} לעומת הדוח מתאריך ${formatDate(compared.reportDate)} (${compared.id}): תחזית העלות לסיום ${comparison.delta === 0 ? "לא השתנתה" : comparison.delta > 0 ? `עלתה ב-${m(comparison.delta)}` : `ירדה ב-${m(-comparison.delta)}`} — ${m(comparison.before?.eac ?? 0)} ← ${m(comparison.after.eac)}.${comparison.changedLines.length ? ` השינויים: ${comparison.changedLines.map((l) => `${l.nameHe} ${l.delta > 0 ? "+" : "−"}${m(Math.abs(l.delta))}`).join(", ")}.` : ""}`,
    breakdownHe: [...comparison.changedLines.map((l) => `${l.nameHe}: ${m(l.before)} ← ${m(l.after)}`), ...auditNotes],
    evidence: [...evidence, { documentId: compared.id, labelHe: `הדוח ${compared.id}` }].slice(0, 6),
    actions: [{ labelHe: "פתח את ארכיון הדוחות", route: `#/reports?project=${projectId}` }],
    scopeLabelHe: view.labelHe,
    calculationRows: [{ labelHe: `תחזית לפי ${compared.id}`, value: m(comparison.before?.eac ?? 0) }, { labelHe: view.report ? `תחזית לפי ${view.report.id}` : "תחזית עדכנית", value: m(comparison.after.eac) }, { labelHe: "הפרש", value: m(comparison.delta) }],
  };
}

function answerEvidence(state: DemoState, parsed: ParsedQuestion, view: ScopedView): ChatAnswer {
  const projectId = view.projectId ?? parsed.projectId;
  const applied = state.auditEvents.filter((e) => e.kind.startsWith("applied:") && (!projectId || e.projectId === projectId) && (!view.report || e.at <= view.report.dataThrough)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const relevant = parsed.costCodeId ? applied.filter((e) => e.costCodeId === parsed.costCodeId) : applied;
  const target = relevant[0] ?? applied[0];
  if (!target) {
    return { headlineHe: `במצב הנוכחי לא בוצע תיקון${parsed.costCodeId ? ` בסעיף ${state.costCodes.find((c) => c.id === parsed.costCodeId)?.nameHe}` : ""} ב${projectLabel(state, view)}. כשיאושר תיקון, אפשר יהיה לראות כאן את הערכים המקוריים, המתוקנים והמסמכים התומכים.`, breakdownHe: [], evidence: [], actions: [{ labelHe: "פתח את תנועות ובדיקות", route: "#/records" }], scopeLabelHe: view.labelHe };
  }
  const proposal = state.proposals.find((p) => p.id === target.proposalId);
  return {
    headlineHe: `${formatDate(target.at)} · ${target.actorNameHe}, ${target.actorRoleHe} · ${target.textHe}`,
    breakdownHe: [...(proposal?.before.map((r, i) => `${r.labelHe}: ${r.value} ← ${proposal.after[i]?.value ?? ""}`) ?? []), ...(proposal?.reasonHe ? [`סיבה: ${proposal.reasonHe}`] : [])],
    evidence: target.evidence.length ? target.evidence : (proposal?.evidence ?? []),
    actions: [{ labelHe: "פתח את ההצעה ואת ההיסטוריה", route: `#/records?proposal=${proposal?.id ?? ""}` }],
    scopeLabelHe: view.labelHe,
  };
}

function projectLabel(state: DemoState, view: ScopedView): string {
  if (view.portfolio) return "כל הפרויקטים הפעילים";
  return state.projects.find((p) => p.id === view.projectId)?.nameHe ?? "";
}

function categoryHe(c: CostCategory): string {
  return { steel: "ברזל", concrete: "בטון", frame: "שלד", equipment: "ציוד", waterproofing: "איטום", finishing: "עבודות גמר", site_overhead: "תקורות אתר", general: "עבודות" }[c];
}

export function answerQuestion(state: DemoState, text: string, scope: ChatScope, lastContext: { projectId: string | null; costCodeId: string | null }): { answer: ChatAnswer; parsed: ParsedQuestion } {
  const parsed = parseQuestion(state, text, scope, lastContext);
  const effectiveScope: ChatScope = { ...scope, projectId: parsed.portfolio ? null : (parsed.projectId ?? scope.projectId), portfolio: parsed.portfolio, reportId: parsed.portfolio ? null : scope.reportId };
  if (parsed.ambiguousProject) {
    return { parsed, answer: { headlineHe: "לאיזה פרויקט התכוונת?", breakdownHe: state.projects.filter((p) => p.status === "active").map((p) => p.nameHe), evidence: [], actions: [], scopeLabelHe: "", needsProjectChoice: true } };
  }
  if (parsed.intent === "unsupported") {
    return { parsed, answer: { headlineHe: UNSUPPORTED_HE, breakdownHe: [], evidence: [], actions: [], scopeLabelHe: "" } };
  }
  if (parsed.intent === "site_progress") {
    return { parsed, answer: { headlineHe: NO_SITE_INFO_HE, breakdownHe: ["הדמו אינו כולל מודל ערך מזוכה או דיווח התקדמות בשטח; השוואת עלות שנצברה לתקציב אינה מדד התקדמות."], evidence: [], actions: [{ labelHe: "פתח בירור מול מנהלת התפעול", route: "#/questions?draft=site" }], scopeLabelHe: "" } };
  }
  if (!effectiveScope.projectId && !effectiveScope.portfolio) {
    return { parsed, answer: { headlineHe: "לאיזה פרויקט התכוונת?", breakdownHe: state.projects.filter((p) => p.status === "active").map((p) => p.nameHe), evidence: [], actions: [], scopeLabelHe: "", needsProjectChoice: true } };
  }
  const view = viewForScope(state, effectiveScope);
  let answer: ChatAnswer;
  switch (parsed.intent) {
    case "incurred":
      answer = answerIncurred(state, parsed, view);
      break;
    case "paid":
      answer = answerPaid(state, parsed, view);
      break;
    case "eac":
      answer = answerEac(state, parsed, view);
      break;
    case "variance":
      answer = answerVariance(state, view);
      break;
    case "commitments":
      answer = answerCommitments(state, parsed, view);
      break;
    case "remaining_payment":
      answer = answerRemainingPayment(state, parsed, view);
      break;
    case "changed_since_report":
      answer = answerChanged(state, parsed, view);
      break;
    case "evidence":
      answer = answerEvidence(state, parsed, view);
      break;
    default:
      answer = { headlineHe: UNSUPPORTED_HE, breakdownHe: [], evidence: [], actions: [], scopeLabelHe: "" };
  }
  if (view.report) {
    const newer = lastDeliveredReport(state, view.report.projectId);
    const hasNewer = state.auditEvents.some((e) => e.reportRelevant && e.at > view.report!.generatedAt && e.projectId === view.report!.projectId);
    if (hasNewer || (newer && newer.id !== view.report.id)) answer = { ...answer, actions: [...answer.actions, { labelHe: "הצג נתונים עדכניים", route: "#/chat?scope=current" }], qualificationHe: answer.qualificationHe ?? "התשובה לפי הדוח שנבחר; קיימים עדכונים מאז הדוח" };
  }
  void recordsForView;
  return { parsed, answer };
}

export const suggestedQuestionsHe = [
  "כמה הוצאנו על ברזל בהדרים?",
  "כמה שילמנו בפועל על הברזל?",
  "כמה צפוי לעלות הברזל בסוף?",
  "איפה החריגה הכי גדולה בפרויקט?",
  "מה השתנה מאז הדוח האחרון?",
  "כמה נשאר לשלם לקבלן השלד?",
  "כמה התחייבויות עוד פתוחות בהדרים?",
  "כמה ברזל הוצאנו בכל החברה?",
  "על סמך מה תיקנתם את הכמות?",
];
