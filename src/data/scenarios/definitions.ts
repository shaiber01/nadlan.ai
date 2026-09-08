import { createDemoState } from "../../app/demo";
import { receiveDocuments, receiveRecord, runPendingAnalyses, saveErpRecord, scheduleAnalysis } from "../../domain/commands/core";
import { ambiguousInvoiceVariant } from "../../domain/commands/experiment";
import { recordClientReply, reviewAndReleaseAlert, reviewQuestion, sendQuestionBatch } from "../../domain/commands/messages";
import { setDemoClock } from "../../domain/commands/reports";
import { approveProposal, simulateWriteFailure } from "../../domain/commands/review";
import { expireRule, saveApprovedRule } from "../../domain/commands/rules";
import { intakeSampleBudget, runAnalysisForCode } from "../../domain/commands/scenario-actions";
import { ils } from "../../domain/money";
import { costLineView } from "../../domain/selectors/financial";
import { addActivity, replaceById } from "../../domain/state-utils";
import type { DemoState, ErpRecord, SourceDocument } from "../../domain/types";
import { makeScenarioDocument } from "../documents";
import { makeRecord } from "../seed";
import type { ScenarioDefinition } from "./types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const REVIEWER = "REVIEWER";

function withProject(state: DemoState, projectId: string): DemoState {
  return { ...state, activeProjectId: projectId, chat: { ...state.chat, scope: { ...state.chat.scope, projectId, reportId: null, portfolio: false }, lastContext: { projectId, costCodeId: null } } };
}

function dropFindingsForRecord(state: DemoState, recordId: string): DemoState {
  const ids = new Set(state.findings.filter((f) => f.recordIds.includes(recordId)).map((f) => f.id));
  return {
    ...state,
    findings: state.findings.filter((f) => !ids.has(f.id)),
    proposals: state.proposals.filter((p) => !p.findingId || !ids.has(p.findingId)),
    questions: state.questions.filter((q) => !ids.has(q.findingId)),
    alerts: state.alerts.filter((a) => !ids.has(a.findingId)),
    tasks: state.tasks.filter((t) => !ids.has(t.findingId)),
    activity: state.activity.filter((a) => !a.entityIds.some((id) => ids.has(id))),
  };
}

function seededHistory(state: DemoState, lines: string[]): DemoState {
  let s = state;
  for (const line of lines) s = addActivity(s, "scenario", `היסטוריה שנטענה מראש לתרחיש: ${line}`, []);
  return s;
}

/** S05 primary path executed programmatically (used as seeded history for S15). */
export function completeS05(state: DemoState): DemoState {
  const q = state.questions.find((x) => x.parser === "allocation" && x.recordId === "TX-EQ-SHARED");
  if (!q) throw new Error("S05 question missing");
  let s = reviewQuestion(state, q.id, REVIEWER);
  s = sendQuestionBatch(s, [q.id]);
  s = recordClientReply(s, q.id, "40,000 ₪ למגורי הדרים ו-20,000 ₪ למתחם הפארק");
  const p = s.proposals.find((x) => x.kind === "allocation" && x.status === "pending_review" && x.targetIds.includes("TX-EQ-SHARED"));
  if (!p) throw new Error("S05 allocation proposal missing");
  s = approveProposal(s, p.id, REVIEWER);
  s = runPendingAnalyses(s);
  s = saveApprovedRule(s, { fromProposalId: p.id, validTo: "2026-12-31", confirmFutureMonthly: true, reviewerId: REVIEWER });
  return s;
}

/** S06 primary path executed programmatically (used as seeded history for S16). */
export function completeS06(state: DemoState, replyText = "זה המחיר הצפוי גם בהמשך"): DemoState {
  const alert = state.alerts.find((a) => a.kind === "early_alert" && a.status === "pending_review" && a.projectId === "HAD");
  if (!alert) throw new Error("S06 alert missing");
  let s = reviewAndReleaseAlert(state, alert.id, REVIEWER);
  const q = s.questions.find((x) => x.id === alert.linkedQuestionId)!;
  s = recordClientReply(s, q.id, replyText);
  const p = s.proposals.find((x) => x.kind === "forecast" && x.status === "pending_review" && x.costCodeId === "H10");
  if (!p) throw new Error("S06 forecast proposal missing");
  s = approveProposal(s, p.id, REVIEWER);
  return runPendingAnalyses(s);
}

function frameRecordCurrent(state: DemoState, priorRecordId: string | null): ErpRecord {
  return {
    ...makeRecord({ id: "TX-H-FRAME-CURRENT", kind: "certificate", projectId: "HAD", costCodeId: "H30", supplierId: "SUP-FRAME", sourceDocumentId: "CERT-H-FRAME-CURRENT", descriptionHe: "חשבון עבודות שלד — מצטבר 300,000 ₪ (נקלט במלואו)", date: state.clock.slice(0, 10), receivedAt: state.clock, amount: 300000, paid: 0, workItemId: "H-FRAME-WORK", commitmentId: "CT-H-FRAME", cumulativeApproved: 300000, priorCumulative: 220000 }),
    priorRecordId,
    certificateId: "CERT-H-FRAME-CURRENT",
  };
}

function equipmentInvoiceRecord(state: DemoState, sourceDocumentId: string): ErpRecord {
  return makeRecord({ id: "TX-EQ-002", kind: "invoice", projectId: "HAD", costCodeId: "H40", supplierId: "SUP-EQUIPMENT", sourceDocumentId, relatedDocumentIds: ["EQ-FRAMEWORK-01"], descriptionHe: "השכרת ציוד ספטמבר — מסגרת משותפת", date: "2026-09-30", receivedAt: state.clock, amount: 60000, paid: 0, workItemId: "H-EQ-SEP", commitmentId: null, chargeType: "rental" });
}

const variant = (base: SourceDocument, patch: Partial<SourceDocument> & { idSuffix: string; note: string }): SourceDocument => ({
  ...base,
  ...patch,
  id: `${base.id}-${patch.idSuffix}`,
  titleHe: patch.titleHe ?? `${base.titleHe} (${patch.note})`,
  facts: { ...base.facts, ...(patch.facts ?? {}) },
  annotationHe: `גרסה חלופית לתרחיש: ${patch.note}. המסמך המקורי אינו משתנה.`,
  generated: true,
});

const hasApplied = (state: DemoState, kind: string, predicate: (p: DemoState["proposals"][number]) => boolean = () => true) => state.proposals.some((p) => p.kind === kind && p.status === "applied" && predicate(p));

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const scenarios: ScenarioDefinition[] = [
  {
    id: "S01",
    number: 1,
    titleHe: "דוח בקרה שבועי בפורמט שהחברה רוצה",
    purposeHe: "להראות את התוצר הקונקרטי: דוח בקרה שבועי שימושי בפורמט שהלקוח בוחר, בערוץ שהוא בוחר.",
    summaryHe: "בחירת פריסה וערוץ, הפקה, בדיקת צוות הבקרה, מסירה מדומה עם קובץ Excel תקין, והתקדמות שבוע שמייצרת את הדוח הבא.",
    fixtureHe: "מצב פתיחה קנוני; דוח קודם RPT-HAD-2026-08-31; תחזית הדרים 6,106,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    canContinueFrom: () => true,
    events: [],
    steps: [
      { id: "1", textHe: "פתחו את מסך הדוחות ובחרו את מגורי הדרים.", route: "#/reports?project=HAD", anchor: "reports-project" },
      { id: "2", textHe: "בחרו Excel ואחת מהפריסות: סיכום להנהלה או פירוט לפי סעיפי תקציב. התצוגה המקדימה משתנה בהתאם.", route: "#/reports?project=HAD", anchor: "reports-layout" },
      { id: "3", textHe: "בחרו ערוץ מסירה (מייל או WhatsApp), נמען איתן ברק ותדירות בכל יום שני.", route: "#/reports?project=HAD", anchor: "reports-channel" },
      { id: "4", textHe: "לחצו ״הפק דוח עכשיו״. הדוח מוכן לבדיקה; עברו לתצוגת צוות הבקרה ולחצו ״אשר והעבר ללקוח״.", route: "#/reports?project=HAD", anchor: "reports-generate", doneWhen: (s) => s.reports.some((r) => r.projectId === "HAD" && r.status === "delivered" && !r.seededHistory) },
      { id: "5", textHe: "פתחו את ההודעה שנמסרה במרכז ההודעות (מייל או WhatsApp).", route: "#/questions?tab=messages", anchor: "messages-latest", role: "manager" },
      { id: "6", textHe: "פתחו או הורידו את קובץ ה-Excel המצורף, ופתחו את הדוח המקביל בארכיון.", route: "#/reports?project=HAD", anchor: "report-archive" },
      { id: "7", textHe: "לחצו ״התקדם שבוע״ בסרגל ההצגה. הדוח הבא נוצר אוטומטית לבדיקה ולמסירה, בלי לבנות אותו מחדש.", route: "#/reports?project=HAD", anchor: "advance-week", doneWhen: (s) => s.reports.some((r) => r.scheduledPeriod === "2026-09-14") },
    ],
    isComplete: (s) => s.reports.some((r) => r.projectId === "HAD" && r.status === "delivered" && !r.seededHistory),
    expectationsHe: ["שני ערוצי המסירה עובדים בתוך האפליקציה", "הקובץ המצורף הוא Excel תקין שנבנה מהצילום הקפוא", "התקדמות שבוע יוצרת דוח מאוחר יותר; הדוח הקודם אינו משתנה"],
  },
  {
    id: "S02",
    number: 2,
    titleHe: "בדיקת הנחות התקציב לפני תחילת העבודה",
    purposeHe: "להדגים ערך לפני שההוצאות מתחילות: זיהוי הנחת מחיר לא סבירה והשפעתה על טיוטת התקציב.",
    summaryHe: "קליטת טיוטה לדוגמה, השוואה לשלוש הצעות מחיר תואמות, החרגת הצעה במפרט שונה, ועדכון גרסת טיוטה חדשה.",
    fixtureHe: "טיוטת נוף הגבעה: בטון 1,000 מ״ק × 300 ₪; סך טיוטה 5,000,000 ₪; שלוש הצעות ב-380–400 ₪ והצעה לא מקבילה ב-310 ₪.",
    activeProjectId: "NOF",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "NOF"),
    canContinueFrom: (s) => s.budgetVersions.some((b) => b.id === "BUD-NOF-DRAFT-V1" && b.status === "current"),
    events: [
      { id: "S02-INTAKE", labelHe: "קלוט טיוטה בזיו — הדגמה", descriptionHe: "קליטת טיוטה לדוגמה (שתי שורות) לתוך גרסת הטיוטה הקיימת; הבדיקה מתחילה אוטומטית.", kind: "primary", route: "#/projects", apply: (s) => runPendingAnalyses(intakeSampleBudget(s, "NOF")), doneWhen: (s) => s.findings.some((f) => f.kind === "budget_assumption") },
      { id: "S02-CONTRACT", labelHe: "יש הסכם תקף במחיר 300 ₪", descriptionHe: "מציג הסכם CT-NOF-CONC-300; אם המפרט והתנאים תואמים, אפשר להשאיר את ההנחה המקורית עם הסבר.", kind: "branch", route: "#/projects", apply: (s) => runPendingAnalyses(scheduleAnalysis(receiveDocuments(s, [makeScenarioDocument("CT-NOF-CONC-300", s.clock)]), { documentId: "BUD-NOF-DRAFT-V1" })), availableWhen: (s) => s.findings.some((f) => f.kind === "budget_assumption") && !s.documents.some((d) => d.id === "CT-NOF-CONC-300") },
    ],
    steps: [
      { id: "1", textHe: "פתחו את פרויקטים ובחרו את טיוטת נוף הגבעה. לחצו ״טען תקציב לדוגמה״ ואז ״קלוט טיוטה בזיו — הדגמה״.", route: "#/projects?project=NOF", anchor: "draft-intake", doneWhen: (s) => s.findings.some((f) => f.kind === "budget_assumption") },
      { id: "2", textHe: "לחצו ״הצג בדיקת הנחות״: שורת הבטון מסומנת, והמגירה משווה מפרט, מיקום, תוקף, כמות, הובלה, שאיבה ותנאי תשלום.", route: "#/projects?project=NOF", anchor: "draft-check" },
      { id: "3", textHe: "שימו לב ש-QUOTE-NOF-X מוצגת כ״לא נכלל בהשוואה — מפרט ותנאים שונים״.", route: "#/projects?project=NOF", anchor: "draft-check" },
      { id: "4", textHe: "בחרו מחיר מעודכן לטיוטה (ברירת מחדל 390 ₪) וראו את הסכום המחושב מחדש.", route: "#/projects?project=NOF", anchor: "draft-price" },
      { id: "5", textHe: "לחצו ״עדכן טיוטה״ בתצוגת צוות הבקרה. גרסה 1 נשמרת להשוואה; התקציבים הפעילים אינם משתנים.", route: "#/projects?project=NOF", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => s.budgetVersions.some((b) => b.projectId === "NOF" && b.version === 2) },
    ],
    isComplete: (s) => s.budgetVersions.some((b) => b.projectId === "NOF" && b.version === 2) || s.findings.some((f) => f.kind === "budget_assumption" && f.status === "dismissed"),
    expectationsHe: ["פער אפשרי 80,000–100,000 ₪", "ב-390 ₪: בטון 390,000 ₪, סך טיוטה 5,090,000 ₪", "טיוטה 1 נשמרת; סך הפרויקטים הפעילים ללא שינוי"],
  },
  {
    id: "S03",
    number: 3,
    titleHe: "חשבונית שנרשמה בסעיף הלא נכון",
    purposeHe: "להראות סיווג מבוסס ראיות ותיקון שנכתב בפועל חזרה ל-ERP המדומה.",
    summaryHe: "חשבונית הברזל רשומה בעבודות גמר; שמירה מחדש מפעילה בדיקה, המערכת מציעה סעיף ברזל, צוות הבקרה מאשר והסעיפים מתעדכנים.",
    fixtureHe: "TX-H-STEEL משויכת ל-H60; H10 ללא עלות (תחזית 1,440,000 ₪), H60 366,000 ₪ (תחזית 1,066,000 ₪); הדרים 6,106,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) =>
      withProject(
        createDemoState(sessionId, {
          overlayAfter: (s) => {
            let next = dropFindingsForRecord(s, "TX-H-STEEL");
            next = { ...next, erpRecords: replaceById(next.erpRecords, "TX-H-STEEL", (r) => ({ ...r, allocations: [{ ...r.allocations[0], costCodeId: "H60" }], checkStatus: "verified" })) };
            return next;
          },
        }),
        "HAD",
      ),
    events: [
      { id: "S03-RESAVE", labelHe: "שמור / קלוט מחדש את הרשומה", descriptionHe: "שמירת הרשומה בזיו כפי שהיא; הבדיקה האוטומטית מזהה את הסיווג השגוי.", kind: "primary", route: "#/records?tab=erp&record=TX-H-STEEL", apply: (s) => runPendingAnalyses(saveErpRecord(s, "TX-H-STEEL", {})), doneWhen: (s) => s.findings.some((f) => f.kind === "classification") },
      { id: "S03-FAIL", labelHe: "הדמה כשל בעדכון", descriptionHe: "העדכון הבא בזיו ייכשל באופן דטרמיניסטי; ההצעה המאושרת נשמרת ו״נסה שוב״ מיישם אותה פעם אחת.", kind: "branch", route: "#/records", role: "reviewer", apply: (s) => simulateWriteFailure(s, true), availableWhen: (s) => !s.flags.failNextErpWrite && !hasApplied(s, "erp_correction") },
      {
        id: "S03-AMBIG",
        labelHe: "הדגם מקרה לא חד-משמעי",
        descriptionHe: "גרסה חלופית: חשבונית ללא תיאור חומר וללא הזמנה או תעודת משלוח. רק אז נוצרת שאלה ללקוח.",
        kind: "branch",
        route: "#/records",
        apply: (s) => {
          const base = s.documents.find((d) => d.id === "INV-H-STEEL-001")!;
          let next = receiveDocuments(s, [ambiguousInvoiceVariant(base, s.clock)], { analyze: false });
          next = { ...next, erpRecords: replaceById(next.erpRecords, "TX-H-STEEL", (r) => ({ ...r, sourceDocumentId: "INV-H-STEEL-001-AMBIG", relatedDocumentIds: [], descriptionHe: "אספקת חומרים לאתר", erpDescriptionVague: true })) };
          return runPendingAnalyses(saveErpRecord(next, "TX-H-STEEL", {}));
        },
        availableWhen: (s) => !s.documents.some((d) => d.id === "INV-H-STEEL-001-AMBIG") && !hasApplied(s, "erp_correction"),
      },
    ],
    steps: [
      { id: "1", textHe: "פתחו את זיו — סביבת הדגמה ואת החשבונית הרשומה תחת עבודות גמר.", route: "#/records?tab=erp&record=TX-H-STEEL", anchor: "erp-record" },
      { id: "2", textHe: "לחצו ״שמור / קלוט מחדש את הרשומה״. הבדיקה מתחילה אוטומטית; ״הצג בדיקה״ פותח את הממצא.", route: "#/records?tab=erp&record=TX-H-STEEL", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "classification") },
      { id: "3", textHe: "הממצא מציע את הסעיף ברזל, עם שורת החשבונית והסעיף בתקציב המאושר. לחצו על קישורי המקור.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "4", textHe: "עברו לתצוגת צוות הבקרה ולחצו ״אשר תיקון״. אפשר קודם ״הדמה כשל בעדכון״ כדי לראות כשל ו״נסה שוב״.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "erp_correction") },
      { id: "5", textHe: "חזרו לזיו ולטבלת התקציב: הרשומה מסווגת לברזל, שני הסעיפים מתעדכנים מאותה תנועה, ואין מדד ״66,000 ₪ נחסכו״.", route: "#/budget?project=HAD&code=H10", anchor: "budget-line" },
    ],
    isComplete: (s) => hasApplied(s, "erp_correction", (p) => p.targetIds.includes("TX-H-STEEL")) && s.erpRecords.find((r) => r.id === "TX-H-STEEL")?.allocations[0].costCodeId === "H10",
    expectationsHe: ["H10 חוזר ל-66,000 ₪ (תחזית 1,506,000 ₪); H60 חוזר ל-300,000 ₪", "סך הפרויקט, התשלומים וטקסט החשבונית ללא שינוי", "רשומת ביקורת עם סעיף לפני/אחרי וראיות"],
  },
  {
    id: "S04",
    number: 4,
    titleHe: "כמות או יחידת מידה שגויה בקליטה",
    purposeHe: "להראות התאמה רציפה של רשומה חדשה מול המסמכים שלה.",
    summaryHe: "רשומת זיו אומרת 200 טון ב-330 ₪; החשבונית ותעודת המשלוח אומרות 20 טון ב-3,300 ₪. שמירה מפעילה בדיקה ותיקון מבוסס מקורות.",
    fixtureHe: "רשומת TX-H-STEEL: 200 טון × 330 ₪ = 66,000 ₪; החשבונית, ההזמנה ותעודת המשלוח: 20 טון × 3,300 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) =>
      withProject(
        createDemoState(sessionId, {
          overlayAfter: (s) => {
            let next = dropFindingsForRecord(s, "TX-H-STEEL");
            next = { ...next, erpRecords: replaceById(next.erpRecords, "TX-H-STEEL", (r) => ({ ...r, quantity: 200, unitPrice: ils(330), verifiedQuantity: null, checkStatus: "verified" })), steelExperiment: { ...next.steelExperiment, rawErpQuantity: 200 } };
            return next;
          },
        }),
        "HAD",
      ),
    events: [
      { id: "S04-SAVE", labelHe: "שמור תנועה", descriptionHe: "שמירת הרשומה השגויה בזיו; הבדיקה מתחילה אוטומטית ומשווה זיו, חשבונית ותעודת משלוח.", kind: "primary", route: "#/records?tab=erp&record=TX-H-STEEL", apply: (s) => runPendingAnalyses(saveErpRecord(s, "TX-H-STEEL", { quantity: s.erpRecords.find((r) => r.id === "TX-H-STEEL")?.quantity ?? 200 })), doneWhen: (s) => s.findings.some((f) => f.kind === "quantity_mismatch") },
      { id: "S04-PARTIAL", labelHe: "הדגם אספקה חלקית", descriptionHe: "תעודת משלוח DN-H-STEEL-018: התקבלו 18 מתוך 20 טון. לא הוכחה לחשבונית שגויה; נבדקת תעודה נוספת לפני שאלה.", kind: "branch", route: "#/records", apply: (s) => runPendingAnalyses(scheduleAnalysis(receiveDocuments(s, [makeScenarioDocument("DN-H-STEEL-018", s.clock)], { analyze: false }), { recordId: "TX-H-STEEL" })), availableWhen: (s) => hasApplied(s, "erp_correction", (p) => p.targetIds.includes("TX-H-STEEL")) && !s.documents.some((d) => d.id === "DN-H-STEEL-018") },
    ],
    steps: [
      { id: "1", textHe: "פתחו את טופס הרשומה בזיו: הכמות הרשומה היא 200 טון במחיר 330 ₪.", route: "#/records?tab=erp&record=TX-H-STEEL", anchor: "erp-record" },
      { id: "2", textHe: "לחצו ״שמור תנועה״. הבדיקה מתחילה אוטומטית.", route: "#/records?tab=erp&record=TX-H-STEEL", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "quantity_mismatch") },
      { id: "3", textHe: "הממצא מציג שלוש שורות מקור זו לצד זו: זיו, חשבונית, תעודת משלוח. מוצע 200 ← 20 טון ו-330 ← 3,300 ₪; הסכום נשאר 66,000 ₪.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "4", textHe: "בתצוגת צוות הבקרה לחצו ״אשר תיקון״. הרשומה בזיו מתוקנת; 20 טון מאומתים מתוך 500 (4%).", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "erp_correction", (p) => p.targetIds.includes("TX-H-STEEL")) },
      { id: "5", textHe: "אופציונלי: ״הדגם אספקה חלקית״ מציג 18 מתוך 20 טון ושאלה עם תשובות מוצעות; הכמות שנרכשה נשארת 20.", route: "#/records?tab=findings", anchor: "scenario-events" },
    ],
    isComplete: (s) => hasApplied(s, "erp_correction", (p) => p.targetIds.includes("TX-H-STEEL")) && s.erpRecords.find((r) => r.id === "TX-H-STEEL")?.quantity === 20,
    expectationsHe: ["200 → 20 טון, 330 → 3,300 ₪; 66,000 ₪ ללא שינוי", "20 טון מאומתים מתוך 500; תחזית הדרים נשארת 6,106,000 ₪", "ענף אספקה חלקית: נרכשו 20, סופקו 18, חסרים 2, יתרת רכש 480"],
  },
  {
    id: "S05",
    number: 5,
    titleHe: "בירור מרוכז ב-WhatsApp ועדכון השיוך בזיו",
    purposeHe: "להראות שאלה שבאמת דורשת הקשר מהלקוח, עם לולאה שלמה: זיהוי, בדיקה פנימית, שליחה, תשובה, בדיקה ועדכון בזיו.",
    summaryHe: "חשבונית ציוד משותפת של 60,000 ₪ רשומה כולה להדרים. המסגרת כוללת גם את הפארק; הפיצול אינו במסמכים. שאלה מרוכזת למאיה, תשובה, ועדכון שורות השיוך.",
    fixtureHe: "INV-EQ-001 בסך 60,000 ₪ משויכת כולה ל-HAD/H40, שולמו 20,000 ₪. EQ-FRAMEWORK-01 מאפשר שימוש בשני האתרים.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    canContinueFrom: (s) => s.erpRecords.find((r) => r.id === "TX-EQ-SHARED")?.allocations.length === 1 && s.questions.some((q) => q.recordId === "TX-EQ-SHARED"),
    events: [],
    steps: [
      { id: "1", textHe: "בתנועות ובדיקות מופיע ממצא: חסר פירוט שיוך בין אתרים. ״מה כבר נבדק״ מציג את החשבונית והמסגרת שנבדקו.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "2", textHe: "בתצוגת צוות הבקרה, בשאלות ותשובות, בדקו את השאלה והוסיפו אותה ל״שאלות מרוכזות למאיה״.", route: "#/questions", anchor: "question-review", role: "reviewer", doneWhen: (s) => s.questions.some((q) => q.recordId === "TX-EQ-SHARED" && ["ready", "sent", "answered", "resolved"].includes(q.status)) },
      { id: "3", textHe: "לחצו ״שלח בירור מרוכז״. נוצרת שיחת WhatsApp בתוך האפליקציה (ההודעה מוצגת בהדגמה בלבד).", route: "#/questions", anchor: "batch-send", role: "reviewer", doneWhen: (s) => s.questions.some((q) => q.recordId === "TX-EQ-SHARED" && ["sent", "answered", "resolved"].includes(q.status)) },
      { id: "4", textHe: "ענו כמאיה: בחרו תשובה מוצעת או כתבו חלוקה משלכם. נסו גם 45,000/20,000 כדי לראות אימות.", route: "#/questions?tab=messages", anchor: "reply-box", role: "manager", doneWhen: (s) => s.questions.some((q) => q.recordId === "TX-EQ-SHARED" && ["answered", "resolved"].includes(q.status)) },
      { id: "5", textHe: "ההצעה מפרשת את התשובה לשורות שיוך; התשובה מוצגת כראיה תומכת.", route: "#/records?tab=proposals", anchor: "proposal-list" },
      { id: "6", textHe: "בתצוגת צוות הבקרה אשרו את התיקון. שני הפרויקטים מתעדכנים; סך החברה ללא שינוי; התשלום מתחלק יחסית.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => (s.erpRecords.find((r) => r.id === "TX-EQ-SHARED")?.allocations.length ?? 0) > 1 },
      { id: "7", textHe: "אופציונלי: ״שמור כלל לשימוש חוזר״ — היקף, תוקף ואישור מפורש שהחלוקה מיועדת לחיובים חודשיים דומים. הכלל משמש בתרחיש 15.", route: "#/knowledge", anchor: "rule-save", role: "reviewer" },
    ],
    isComplete: (s) => (s.erpRecords.find((r) => r.id === "TX-EQ-SHARED")?.allocations.length ?? 0) > 1,
    expectationsHe: ["הדרים ציוד 220,000 ₪; הפארק ציוד 140,000 ₪", "תחזית הדרים 6,086,000 ₪; הפארק 4,018,000 ₪; סך החברה 15,104,000 ₪", "תשלום 20,000 ₪ מתחלק 13,333.33 / 6,666.67; סך תשלומי החברה 3,358,000 ₪"],
  },
  {
    id: "S06",
    number: 6,
    titleHe: "התרעה מוקדמת: רכישה קטנה חושפת סיכון גדול",
    purposeHe: "הרגע הצופה פני עתיד: רכישה קטנה חושפת חריגה עתידית מהותית לפני שרוב הכסף הוצא.",
    summaryHe: "20 טון ב-3,300 ₪ במקום 3,000 ₪. חריגה בפועל 6,000 ₪; אם 480 הטון הנותרים יירכשו באותו מחיר — עוד 144,000 ₪. התרעה מוקדמת ב-WhatsApp, בירור, ועדכון תחזית מאושר.",
    fixtureHe: "מצב פתיחה קנוני לאחר אימות הכמות: תקציב 500 × 3,000 ₪; נרכשו 20 × 3,300 ₪; יתרה 480 טון ללא התחייבות ב-3,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    canContinueFrom: (s) => s.findings.some((f) => f.kind === "price_risk" && f.costCodeId === "H10" && !["resolved", "dismissed", "superseded"].includes(f.status)),
    events: [
      { id: "S06-LOCKED", labelHe: "חלק מהכמות כבר מוזמן במחיר קבוע", descriptionHe: "הזמנה חתומה PO-H-STEEL-LOCKED-200: 200 טון ב-3,000 ₪ עוברים להתחייבויות; רק 280 טון נותרים חשופים.", kind: "branch", route: "#/budget?project=HAD&code=H10", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("PO-H-STEEL-LOCKED-200", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id === "PO-H-STEEL-LOCKED-200") },
    ],
    steps: [
      { id: "1", textHe: "בתמונת המצב מופיע כרטיס סיכון מותנה לברזל. לחצו ״הצג השפעה על יתרת הפרויקט״ לפתיחת החישוב.", route: "#/overview", anchor: "conditional-panel" },
      { id: "2", textHe: "הרחיבו: תוספת בפועל 6,000 ₪, יתרת כמות 480 טון, ותוספת עתידית מותנית 144,000 ₪. 6,250,000 ₪ מוצג רק כתרחיש מותנה לצד 6,106,000 ₪ המאושרים.", route: "#/overview", anchor: "conditional-panel" },
      { id: "3", textHe: "בתצוגת צוות הבקרה בדקו את ההתרעה המוקדמת ושחררו אותה ל-WhatsApp — לפני שהופק דוח חדש.", route: "#/questions?tab=alerts", anchor: "alert-release", role: "reviewer", doneWhen: (s) => s.alerts.some((a) => a.kind === "early_alert" && ["delivered", "acknowledged", "resolved"].includes(a.status)) },
      { id: "4", textHe: "פתחו את ההתרעה שנמסרה ואת הבירור המקושר: האם 3,300 ₪ לטון צפוי גם ליתרה? ענו כמנהלת התפעול או הזינו מחיר משלכם.", route: "#/questions?tab=messages", anchor: "reply-box", role: "manager", doneWhen: (s) => s.questions.some((q) => q.parser === "future_price" && ["answered", "resolved", "open"].includes(q.status)) },
      { id: "5", textHe: "בדקו את ״הצעה לעדכון תחזית״ ואשרו אותה בתצוגת צוות הבקרה. תחזית הדרים מתעדכנת רק דרך ההחלטה הזו.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "forecast", (p) => p.costCodeId === "H10") },
      { id: "6", textHe: "אופציונלי: פאנל ״נסה נתונים אחרים״ מאפשר מחיר עתידי אחר (2,800–3,600 ₪) עם אותו חישוב, וענף ״חלק מהכמות כבר מוזמן במחיר קבוע״.", route: "#/budget?project=HAD&code=H10", anchor: "experiment-panel" },
    ],
    isComplete: (s) => hasApplied(s, "forecast", (p) => p.costCodeId === "H10") || s.findings.some((f) => f.kind === "price_risk" && f.status === "resolved"),
    expectationsHe: ["3,300 ₪: יתרה 1,584,000 ₪, ברזל 1,650,000 ₪, הדרים 6,250,000 ₪", "3,150 ₪: הדרים 6,178,000 ₪", "ענף הזמנה קבועה: C 600,000 ₪, R 924,000 ₪, הדרים 6,190,000 ₪, חשיפה נוספת 84,000 ₪"],
  },
  {
    id: "S07",
    number: 7,
    titleHe: "שאלות בשפה טבעית עם תשובות ומקורות",
    purposeHe: "לאפשר למנהל לשאול שאלות שימושיות בלי לחפש ולפרש טבלת דוח.",
    summaryHe: "שאלות מוצעות או טקסט חופשי; כל תשובה כוללת תשובה ישירה, פירוט קצר וקישורי מקורות, לפי נתונים עדכניים או דוח שנבחר.",
    fixtureHe: "מצב פתיחה קנוני, או מצב הסיור המודרך הנוכחי.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    canContinueFrom: () => true,
    events: [],
    steps: [
      { id: "1", textHe: "פתחו ״שאל את הבקרה״. בחרו היקף: נתונים עדכניים או דוח בשם.", route: "#/chat", anchor: "chat-scope" },
      { id: "2", textHe: "לחצו על שאלה מוצעת או הקלידו ניסוח משלכם, למשל ״כמה צפוי לעלות הברזל בסוף?״.", route: "#/chat", anchor: "chat-input", doneWhen: (s) => s.chat.messages.filter((m) => m.role === "assistant").length >= 1 },
      { id: "3", textHe: "התשובה כוללת תשובה ישירה, פירוט ומקורות לחיצים. שאלת המשך שומרת את הפרויקט והסעיף.", route: "#/chat", anchor: "chat-answer" },
      { id: "4", textHe: "שאלו ״מה השתנה מאז הדוח האחרון?״ — התשובה נוקבת בדוח ההשוואה ובהפרש המדויק.", route: "#/chat", anchor: "chat-input", doneWhen: (s) => s.chat.messages.filter((m) => m.role === "assistant").length >= 2 },
      { id: "5", textHe: "נסו שאלה שאינה נתמכת או התקדמות בשטח: מתקבל הסבר על מה שאין בדמו, לא תשובה מומצאת.", route: "#/chat", anchor: "chat-input" },
    ],
    isComplete: (s) => s.chat.messages.filter((m) => m.role === "assistant").length >= 2,
    expectationsHe: ["ברזל בהדרים: 66,000 ₪ נצברו; 0 ₪ שולמו; תחזית 1,506,000 ₪ (1,650,000 ₪ אחרי S06)", "מה השתנה: +6,000 ₪ מול 31/08 במצב הבסיס; +150,000 ₪ אחרי אישור 3,300 ₪", "קבלן השלד: נשאר לשלם 850,000 ₪"],
  },
  {
    id: "S08",
    number: 8,
    titleHe: "התחייבויות חושפות חריגה לפני הגעת החשבוניות",
    purposeHe: "להראות למה הסתכלות רק על חשבוניות שנקלטו מפספסת בעיית עלות.",
    summaryHe: "תוספת חתומה של 100,000 ₪ לחוזה השלד, שטרם חויבה. ההתחייבות עולה ל-900,000 ₪ והעלות הידועה כבר 1,100,000 ₪ — מעל התקציב.",
    fixtureHe: "H30: תקציב 1,000,000 ₪, נצבר 200,000 ₪, התחייבות שנותרה 800,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    events: [
      { id: "S08-INTAKE", labelHe: "קלוט תוספת להסכם", descriptionHe: "קליטת ADD-H-FRAME-100 החתומה; מוצע לעדכן את ההתחייבות.", kind: "primary", route: "#/budget?project=HAD&code=H30", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("ADD-H-FRAME-100", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id === "ADD-H-FRAME-100"), doneWhen: (s) => s.findings.some((f) => f.kind === "commitment_overrun") },
      {
        id: "S08-DRAFT",
        labelHe: "טיוטה שטרם נחתמה",
        descriptionHe: "גרסה חלופית: אותה תוספת ללא חתימה יוצרת סיכון מותנה; ההתחייבות המאושרת נשארת 800,000 ₪.",
        kind: "branch",
        route: "#/budget?project=HAD&code=H30",
        apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("ADD-H-FRAME-100", s.clock), { idSuffix: "DRAFT", note: "טיוטה שטרם נחתמה", facts: { signed: false } })])),
        availableWhen: (s) => !s.documents.some((d) => d.id === "ADD-H-FRAME-100-DRAFT") && !s.documents.some((d) => d.id === "ADD-H-FRAME-100"),
      },
    ],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את קבלן השלד ולחצו ״קלוט תוספת להסכם״.", route: "#/budget?project=HAD&code=H30", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "commitment_overrun") },
      { id: "2", textHe: "פתחו את התוספת החתומה ואת החוזה הנוכחי מתוך הממצא.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "ההצעה מציגה סך חוזה 1,100,000 ₪ והתחייבות נטו 900,000 ₪ מחושבת מחדש.", route: "#/records?tab=proposals", anchor: "proposal-list" },
      { id: "4", textHe: "בתצוגת צוות הבקרה לחצו ״עדכן התחייבות״.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "commitment", (p) => p.costCodeId === "H30") },
      { id: "5", textHe: "בדקו את תחזית הפרויקט (6,206,000 ₪) ואת החשבוניות והתשלומים שלא השתנו. התקציב נשאר 1,000,000 ₪.", route: "#/budget?project=HAD&code=H30", anchor: "budget-line" },
    ],
    isComplete: (s) => hasApplied(s, "commitment", (p) => p.costCodeId === "H30"),
    expectationsHe: ["סך חוזה 1,100,000 ₪; C = 900,000 ₪; תחזית H30 1,100,000 ₪", "תחזית הדרים 6,206,000 ₪; נצבר ושולם ללא שינוי", "ענף טיוטה: סיכון מותנה, C נשאר 800,000 ₪"],
  },
  {
    id: "S09",
    number: 9,
    titleHe: "חשבון מצטבר שנקלט שוב במלואו",
    purposeHe: "התאמת חשבון מצטבר של קבלן משנה ומניעת חיוב כפול לתקופה.",
    summaryHe: "חשבון קודם 220,000 ₪ הוכר ושולם. חשבון נוכחי: מצטבר 300,000 ₪, ובזיו נקלטו 300,000 ₪ נוספים. התוספת לתקופה היא 80,000 ₪ בלבד.",
    fixtureHe: "H30 עצמאי: TX-H-FRAME הוחלף בחשבון קודם 220,000 ₪ (שולם במלואו), יתרת חוזה 780,000 ₪; גם הדוח הקודם משקף זאת.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) =>
      withProject(
        createDemoState(sessionId, {
          overlayBefore: (s) => {
            const prev = { ...makeRecord({ id: "TX-H-FRAME-PREV", kind: "certificate", projectId: "HAD", costCodeId: "H30", supplierId: "SUP-FRAME", sourceDocumentId: "CERT-H-FRAME-PREV", descriptionHe: "חשבון קודם עבודות שלד — מצטבר 220,000 ₪", date: "2026-08-25", receivedAt: "2026-08-25T10:00:00+03:00", amount: 220000, paid: 220000, workItemId: "H-FRAME-WORK", commitmentId: "CT-H-FRAME", cumulativeApproved: 220000, priorCumulative: 0 }), certificateId: "CERT-H-FRAME-PREV" };
            return { ...s, erpRecords: [...s.erpRecords.filter((r) => r.id !== "TX-H-FRAME"), prev], documents: [...s.documents.filter((d) => d.id !== "INV-H-FRAME-001"), makeScenarioDocument("CERT-H-FRAME-PREV", "2026-08-25T10:00:00+03:00")], processedCertificateIds: ["CERT-H-FRAME-PREV"] };
          },
        }),
        "HAD",
      ),
    events: [
      { id: "S09-RECEIVE", labelHe: "חשבון קבלן חדש לבדיקה", descriptionHe: "קליטת CERT-H-FRAME-CURRENT כשהרשומה בזיו מתייחסת ל-300,000 ₪ כולם כעלות התקופה.", kind: "primary", route: "#/budget?project=HAD&code=H30", apply: (s) => runPendingAnalyses(receiveRecord(s, frameRecordCurrent(s, "TX-H-FRAME-PREV"), [makeScenarioDocument("CERT-H-FRAME-CURRENT", s.clock)])), availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-H-FRAME-CURRENT"), doneWhen: (s) => s.findings.some((f) => f.kind === "cumulative_duplicate") },
      { id: "S09-NOLINK", labelHe: "אין חשבון קודם מקושר", descriptionHe: "הרשומה נקלטת ללא קישור לחשבון הקודם; המערכת מחפשת קודם את החשבון הקודם ברישומים ומציעה את הקישור.", kind: "branch", route: "#/budget?project=HAD&code=H30", apply: (s) => runPendingAnalyses(receiveRecord(s, frameRecordCurrent(s, null), [makeScenarioDocument("CERT-H-FRAME-CURRENT", s.clock)])), availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-H-FRAME-CURRENT") },
      {
        id: "S09-NOHISTORY",
        labelHe: "ללא ראיה היסטורית (שאלה ללקוח)",
        descriptionHe: "ענף שמסיר את תעודת החשבון הקודם מהמצב הפעיל; רק אז נשאל אדם.",
        kind: "branch",
        route: "#/budget?project=HAD&code=H30",
        apply: (s) => {
          const stripped: DemoState = { ...s, documents: s.documents.filter((d) => d.id !== "CERT-H-FRAME-PREV"), erpRecords: replaceById(s.erpRecords, "TX-H-FRAME-PREV", (r) => ({ ...r, sourceDocumentId: null, sourceMissing: true, cumulativeApproved: undefined, priorCumulative: undefined, descriptionHe: "חשבון קודם עבודות שלד — ללא תעודה מצורפת" })) };
          return runPendingAnalyses(receiveRecord(stripped, frameRecordCurrent(stripped, null), [makeScenarioDocument("CERT-H-FRAME-CURRENT", stripped.clock)]));
        },
        availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-H-FRAME-CURRENT"),
      },
      { id: "S09-DUPLICATE", labelHe: "קלוט את אותו חשבון שוב", descriptionHe: "מספר חשבון שכבר עובד מייצר ״החשבון כבר נקלט״ ולא תנועה נוספת.", kind: "optional", route: "#/budget?project=HAD&code=H30", apply: (s) => receiveRecord(s, { ...frameRecordCurrent(s, "TX-H-FRAME-PREV"), id: "TX-H-FRAME-CURRENT-DUP" }, []), availableWhen: (s) => s.erpRecords.some((r) => r.id === "TX-H-FRAME-CURRENT") },
    ],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את קבלן השלד ולחצו ״חשבון קבלן חדש לבדיקה״.", route: "#/budget?project=HAD&code=H30", anchor: "scenario-events", doneWhen: (s) => s.erpRecords.some((r) => r.id === "TX-H-FRAME-CURRENT") },
      { id: "2", textHe: "השוו את החשבון הקודם, החשבון המצטבר הנוכחי ורשומת זיו. הממצא מציג ״מצטבר״ מול ״לתקופה״ במפורש.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "לפני התיקון: נצבר 520,000 ₪, יתרת התחייבות 480,000 ₪; תחזית החוזה נשארת 1,000,000 ₪ (חוזה קבוע).", route: "#/budget?project=HAD&code=H30", anchor: "budget-line" },
      { id: "4", textHe: "בתצוגת צוות הבקרה אשרו את הסכום לתקופה 80,000 ₪. הרשומה נשארת מסומנת אם דוחים.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => s.erpRecords.find((r) => r.id === "TX-H-FRAME-CURRENT")?.amount === ils(80000) },
      { id: "5", textHe: "אחרי התיקון: נצבר 300,000 ₪, יתרה 700,000 ₪, 80,000 ₪ לתשלום לתקופה. התעודה המקורית עדיין מציגה 300,000 ₪ מצטבר.", route: "#/budget?project=HAD&code=H30", anchor: "budget-line" },
    ],
    isComplete: (s) => s.erpRecords.find((r) => r.id === "TX-H-FRAME-CURRENT")?.amount === ils(80000),
    expectationsHe: ["לפני: 220,000 / 780,000; קליטה שגויה: 520,000 / 480,000; מתוקן: 300,000 / 700,000", "תחזית החוזה 1,000,000 ₪ לאורך כל הדרך; הדרים 6,106,000 ₪", "אין ״חיסכון״ של 220,000 ₪; לא בוצע תשלום"],
  },
  {
    id: "S10",
    number: 10,
    titleHe: "חיסכון מדומה: עבודה בוצעה והחשבונית עוד לא הגיעה",
    purposeHe: "להראות שחשבוניות חסרות מקטינות מלאכותית את העלות שנצברה, ושהכרה בעבודה אינה סופרת התחייבות פעמיים.",
    summaryHe: "אישור ביצוע של 80,000 ₪ בתוך חוזה האיטום, ללא חשבונית. ההכרה מעבירה 80,000 ₪ מהתחייבות לעלות שנצברה; התחזית לא משתנה. החשבונית שמגיעה אחר כך מחליפה את הרישום הזמני.",
    fixtureHe: "H50: תקציב 400,000 ₪, נצבר 100,000 ₪, התחייבות 250,000 ₪, יתרה 50,000 ₪, תחזית 400,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    events: [
      { id: "S10-CERT", labelHe: "קלוט אישור ביצוע ללא חשבונית", descriptionHe: "CERT-H-WATER-080: עבודה מאושרת בתכולת החוזה, טרם חויבה.", kind: "primary", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("CERT-H-WATER-080", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id === "CERT-H-WATER-080"), doneWhen: (s) => s.findings.some((f) => f.kind === "unbilled_work") },
      { id: "S10-INVOICE", labelHe: "הדמה הגעת החשבונית", descriptionHe: "INV-H-WATER-080 מגיעה; החשבונית מחליפה את רכיב העבודה שטרם חויבה בלי הכרה כפולה.", kind: "optional", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("INV-H-WATER-080", s.clock)])), availableWhen: (s) => hasApplied(s, "accrual") && !s.documents.some((d) => d.id === "INV-H-WATER-080") },
      { id: "S10-UNAPPROVED", labelHe: "אישור ביצוע שטרם אושר", descriptionHe: "גרסה חלופית: הדיווח ללא אישור — ״נדרש אישור ביצוע״ וההצעה ממתינה.", kind: "branch", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("CERT-H-WATER-080", s.clock), { idSuffix: "UNAPPROVED", note: "טרם אושר", facts: { approved: false } })])), availableWhen: (s) => !s.documents.some((d) => d.id === "CERT-H-WATER-080-UNAPPROVED") && !s.documents.some((d) => d.id === "CERT-H-WATER-080") },
      { id: "S10-SCOPE", labelHe: "אישור לתכולה נוספת", descriptionHe: "גרסה חלופית: העבודה מחוץ לחוזה — המערכת מפנה לזרימת הוראת שינוי במקום לצרוך את יתרת החוזה.", kind: "branch", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("CERT-H-WATER-080", s.clock), { idSuffix: "SCOPE", note: "תכולה נוספת", facts: { isAdditionalScope: true } })])), availableWhen: (s) => !s.documents.some((d) => d.id === "CERT-H-WATER-080-SCOPE") && !s.documents.some((d) => d.id === "CERT-H-WATER-080") },
    ],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את האיטום ולחצו ״קלוט אישור ביצוע ללא חשבונית״.", route: "#/budget?project=HAD&code=H50", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "unbilled_work") },
      { id: "2", textHe: "הממצא מציג את האישור ואת ההתאמה לחוזה CT-H-WATER, ומציע הכרה כ״עבודה שבוצעה וטרם חויבה״.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "בתצוגת צוות הבקרה אשרו את ההכרה. נצבר 180,000 ₪ (100,000 חשבוניות + 80,000 עבודה), התחייבות 170,000 ₪, תחזית ללא שינוי.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "accrual") },
      { id: "4", textHe: "אופציונלי: ״הדמה הגעת החשבונית״ ואשרו את ההתאמה — נצבר נשאר 180,000 ₪, בלי הכרה נוספת.", route: "#/budget?project=HAD&code=H50", anchor: "scenario-events" },
      { id: "5", textHe: "שאלו בצ׳אט ״כמה נשאר לשלם לקבלן האיטום?״: 20,000 + 80,000 + 170,000 = 270,000 ₪ לחוזה; 320,000 ₪ לסעיף כולו.", route: "#/chat", anchor: "chat-input" },
    ],
    isComplete: (s) => hasApplied(s, "accrual"),
    expectationsHe: ["חשבוניות 100,000 ₪; עבודה שטרם חויבה 80,000 ₪; נצבר 180,000 ₪; C 170,000 ₪; R 50,000 ₪; תחזית 400,000 ₪", "החשבונית המאוחרת מחליפה את הרישום הזמני; אין עלות נוספת", "נשאר לשלם: 270,000 ₪ לחוזה; 320,000 ₪ לסעיף"],
  },
  {
    id: "S11",
    number: 11,
    titleHe: "חריגת כמות גם כשהמחיר ליחידה תקין",
    purposeHe: "להראות שמחירים תקינים יכולים להסתיר כמויות עודפות.",
    summaryHe: "תוכננו 100 מ״ק לתקרה A; החשבונית היחידה מציגה 120 מ״ק × 400 ₪ = 48,000 ₪, אך זיו שמר 100 מ״ק / 40,000 ₪. תיקון נתמך במסמכים ושאלה תפעולית נפרדת.",
    fixtureHe: "עולם חלופי: TX-H-SLAB בסך 40,000 ₪ ללא חשבונית מקור; INV-H-CONC-001 אינה פעילה; PLAN-SLAB-A מתכנן 100 מ״ק.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) =>
      withProject(
        createDemoState(sessionId, {
          overlayBefore: (s) => ({ ...s, documents: s.documents.filter((d) => d.id !== "INV-H-CONC-001"), erpRecords: replaceById(s.erpRecords, "TX-H-SLAB", (r) => ({ ...r, sourceDocumentId: null, sourceMissing: true, descriptionHe: "בטון C30 — יציקת תקרה A (רשומת זיו קודמת; חשבונית המקור טרם התקבלה)" })) }),
        }),
        "HAD",
      ),
    events: [
      {
        id: "S11-RECEIVE",
        labelHe: "קלוט אספקת בטון לתקרה A",
        descriptionHe: "מגיעות החשבונית INV-H-SLAB-120 ותעודת המשלוח DN-H-SLAB-120 ומקושרות לרשומה הקיימת בזיו.",
        kind: "primary",
        route: "#/budget?project=HAD&code=H20",
        apply: (s) => {
          let next = receiveDocuments(s, [makeScenarioDocument("INV-H-SLAB-120", s.clock), makeScenarioDocument("DN-H-SLAB-120", s.clock)], { analyze: false });
          next = { ...next, erpRecords: replaceById(next.erpRecords, "TX-H-SLAB", (r) => ({ ...r, sourceDocumentId: "INV-H-SLAB-120", sourceMissing: false, relatedDocumentIds: [...new Set([...r.relatedDocumentIds, "DN-H-SLAB-120", "PLAN-SLAB-A"])] })) };
          return runPendingAnalyses(saveErpRecord(next, "TX-H-SLAB", {}));
        },
        availableWhen: (s) => !s.documents.some((d) => d.id === "INV-H-SLAB-120"),
        doneWhen: (s) => s.findings.some((f) => f.kind === "amount_correction"),
      },
    ],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את הבטון ולחצו ״קלוט אספקת בטון לתקרה A״.", route: "#/budget?project=HAD&code=H20", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "amount_correction") },
      { id: "2", textHe: "נוצרים שני ממצאים: תיקון סכום וכמות נתמך במסמכים (40,000 → 48,000 ₪), ושאלה מדוע סופקו 120 מ״ק במקום 100.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "בתצוגת צוות הבקרה בדקו ושלחו את השאלה למאיה; ענו כמנהלת התפעול (למשל: כל 120 המ״ק שימשו לאותה יציקה).", route: "#/questions", anchor: "question-review", role: "reviewer", doneWhen: (s) => s.questions.some((q) => q.parser === "quantity_reason" && ["answered", "resolved", "open"].includes(q.status)) },
      { id: "4", textHe: "אשרו את תיקון הרשומה: נצבר בבטון 408,000 ₪, תחזית 1,008,000 ₪, הדרים 6,114,000 ₪. החשבונית עצמה אינה משתנה.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => s.erpRecords.find((r) => r.id === "TX-H-SLAB")?.amount === ils(48000) },
      { id: "5", textHe: "שימו לב: סטיית כמות מקומית של 20% ביציקה זו, לא הקשה של 20% על כל הפרויקט.", route: "#/budget?project=HAD&code=H20", anchor: "budget-line" },
    ],
    isComplete: (s) => s.erpRecords.find((r) => r.id === "TX-H-SLAB")?.amount === ils(48000),
    expectationsHe: ["עלות נוספת 20 × 400 = 8,000 ₪; H20 נצבר 408,000 ₪; תחזית 1,008,000 ₪; הדרים 6,114,000 ₪", "החזרה: נדרש מסמך החזרה/זיכוי לפני הקטנה; תוספת תכנון: בדיקת סיווג; בבדיקה: נושא פתוח", "רק חשבונית אחת תורמת עלות; הדוח הקודם משמר את ההסתייגות"],
  },
  {
    id: "S12",
    number: 12,
    titleHe: "חיוב שאינו תואם את תנאי החוזה",
    purposeHe: "להראות איך קריאת החוזה בפועל מונעת שאלה מיותרת להנהלה ומזהה חיוב שנוי במחלוקת.",
    summaryHe: "חיוב הובלה נפרד של 2,000 ₪; החוזה קובע שההובלה כלולה. החיוב מסומן לבירור מול הספק, ובקבלת זיכוי נרשמת התאמה מקושרת.",
    fixtureHe: "מצב פתיחה + INV-H-FREIGHT-002 בסך 2,000 ₪ ב-H20 (לא שולם): H20 402,000 ₪; הדרים 6,108,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) =>
      withProject(
        createDemoState(sessionId, {
          overlayBefore: (s) => {
            const docFreight = makeScenarioDocument("INV-H-FREIGHT-002", "2026-09-07T08:50:00+03:00");
            const record = { ...makeRecord({ id: "TX-H-FREIGHT-002", kind: "invoice", projectId: "HAD", costCodeId: "H20", supplierId: "SUP-CONCRETE", sourceDocumentId: "INV-H-FREIGHT-002", relatedDocumentIds: ["CT-H-CONC"], descriptionHe: "הובלת בטון — חיוב נוסף", date: "2026-09-07", receivedAt: "2026-09-07T08:50:00+03:00", amount: 2000, paid: 0, workItemId: null, commitmentId: null, chargeType: "freight" }), checkStatus: "pending" as const };
            record.allocations[0].additionalScope = true;
            return { ...s, documents: [...s.documents, docFreight], erpRecords: [...s.erpRecords, record] };
          },
        }),
        "HAD",
      ),
    events: [
      { id: "S12-CREDIT", labelHe: "הדמה קבלת זיכוי", descriptionHe: "CREDIT-H-FREIGHT-002 מתקבל; מוצע לרשום התאמת עלות מקושרת של −2,000 ₪.", kind: "primary", route: "#/budget?project=HAD&code=H20", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("CREDIT-H-FREIGHT-002", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id === "CREDIT-H-FREIGHT-002") && !s.documents.some((d) => d.id === "ADD-H-FREIGHT-VALID"), doneWhen: (s) => s.proposals.some((p) => p.kind === "credit") },
      { id: "S12-ADDENDUM", labelHe: "קיימת תוספת מאושרת לאספקה מיוחדת", descriptionHe: "ADD-H-FREIGHT-VALID: אם היקפה תואם לאספקה זו, הדגל נסגר והעלות נשארת 2,000 ₪.", kind: "branch", route: "#/budget?project=HAD&code=H20", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("ADD-H-FREIGHT-VALID", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id === "ADD-H-FREIGHT-VALID") && !s.documents.some((d) => d.id === "CREDIT-H-FREIGHT-002") },
    ],
    steps: [
      { id: "1", textHe: "חיוב ההובלה יצר ממצא אוטומטית. לחצו ״הצג בדיקת חיוב הובלה״ בתנועות ובדיקות.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "2", textHe: "שורת החשבונית מוצגת ליד סעיף ההובלה המדויק בחוזה. הסימון אינו מוחק את החשבונית או את החוב.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "החיוב מסומן ״חיוב לבירור מול הספק״ ונוצרת משימת בקשת זיכוי בתצוגת המשימות.", route: "#/questions?tab=tasks", anchor: "task-list" },
      { id: "4", textHe: "לחצו ״הדמה קבלת זיכוי״.", route: "#/budget?project=HAD&code=H20", anchor: "scenario-events", doneWhen: (s) => s.proposals.some((p) => p.kind === "credit") },
      { id: "5", textHe: "בתצוגת צוות הבקרה אשרו את הזיכוי: ״זיכוי שאושר: 2,000 ₪״; H20 חוזר ל-400,000 ₪ והדרים ל-6,106,000 ₪.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "credit") },
    ],
    isComplete: (s) => hasApplied(s, "credit") || s.findings.some((f) => f.kind === "contract_charge" && f.status === "dismissed"),
    expectationsHe: ["לפני: H20 402,000 ₪, הדרים 6,108,000 ₪; אחרי זיכוי מאושר: 400,000 ₪ / 6,106,000 ₪", "החשבונית המקורית והזיכוי שניהם ניתנים לעיון", "ללא תשובת ספק: ההזדמנות ממתינה והתחזית 6,108,000 ₪"],
  },
  {
    id: "S13",
    number: 13,
    titleHe: "הוראת שינוי שלא נכנסה לתחזית",
    purposeHe: "להראות תוספת עלות מאושרת שנכנסת לתחזית לפני הדוח, תוך הפרדת החזר מלקוח מעלות הבנייה.",
    summaryHe: "הוראת שינוי חתומה לאיטום ב-80,000 ₪ שטרם בוצעה, ודרישת החזר מלקוח הקצה שטרם אושרה. ההתחייבות עולה ל-330,000 ₪; ההחזר מוצג בנפרד.",
    fixtureHe: "H50 תחזית 400,000 ₪; CO-H-WATER-080 מגיעה בתרחיש.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    events: [
      { id: "S13-CO", labelHe: "קלוט הוראת שינוי", descriptionHe: "CO-H-WATER-080 חתומה על ידי החברה והקבלן; דרישת החזר מלקוח הקצה ממתינה.", kind: "primary", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("CO-H-WATER-080", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id.startsWith("CO-H-WATER-080")), doneWhen: (s) => s.findings.some((f) => f.kind === "scope_change") },
      { id: "S13-INTERNAL", labelHe: "אושר פנימית, ללא התחייבות לספק", descriptionHe: "גרסה חלופית: אומדן מאושר פנימית נכנס ליתרת העבודה ללא התחייבות (C 250,000 ₪, R 130,000 ₪; אותה תחזית 480,000 ₪).", kind: "branch", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("CO-H-WATER-080", s.clock), { idSuffix: "INTERNAL", note: "אישור פנימי ללא חתימת קבלן", facts: { signed: false, approved: true } })])), availableWhen: (s) => !s.documents.some((d) => d.id.startsWith("CO-H-WATER-080")) },
      { id: "S13-PROPOSED", labelHe: "עבודה מוצעת שטרם אושרה", descriptionHe: "גרסה חלופית: התוספת רק מוצעת — נשארת מותנית ואינה נכנסת לתחזית המאושרת.", kind: "branch", route: "#/budget?project=HAD&code=H50", apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("CO-H-WATER-080", s.clock), { idSuffix: "PROPOSED", note: "הצעה שטרם אושרה", facts: { signed: false, approved: false } })])), availableWhen: (s) => !s.documents.some((d) => d.id.startsWith("CO-H-WATER-080")) },
    ],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את האיטום ולחצו ״קלוט הוראת שינוי״.", route: "#/budget?project=HAD&code=H50", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "scope_change") },
      { id: "2", textHe: "הממצא מציג את תכולת החוזה המקורי, התוספת, אישורה ודרישת ההחזר הממתינה — בנפרד מהעלות.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "ההצעה מוסיפה התחייבות של 80,000 ₪ ומעדכנת את התחזית ל-480,000 ₪. התקציב נשאר 400,000 ₪.", route: "#/records?tab=proposals", anchor: "proposal-list" },
      { id: "4", textHe: "בתצוגת צוות הבקרה אשרו ויישמו. רשומת החזר נפרדת מציגה 80,000 ₪ ״ממתין לאישור״.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "commitment", (p) => p.costCodeId === "H50") || hasApplied(s, "forecast", (p) => p.costCodeId === "H50") },
      { id: "5", textHe: "בטבלת התקציב: C 330,000 ₪, תחזית 480,000 ₪, הדרים 6,186,000 ₪; ההחזר אינו מקטין את התחזית.", route: "#/budget?project=HAD&code=H50", anchor: "budget-line" },
    ],
    isComplete: (s) => hasApplied(s, "commitment", (p) => p.costCodeId === "H50") || hasApplied(s, "forecast", (p) => p.costCodeId === "H50"),
    expectationsHe: ["C 250,000 → 330,000 ₪; A 100,000 ₪; R 50,000 ₪; תחזית 480,000 ₪; הדרים 6,186,000 ₪", "ענף פנימי: C 250,000 ₪, R 130,000 ₪, תחזית 480,000 ₪", "החזר 80,000 ₪ ממתין לאישור — נפרד מהעלות"],
  },
  {
    id: "S14",
    number: 14,
    titleHe: "עיכוב בלוח הזמנים מגדיל את עלויות האתר",
    purposeHe: "להדגים את השפעת העלות של תקופת בנייה ארוכה יותר, מעבר לבדיקות ברמת החשבונית.",
    summaryHe: "12 חודשים × 50,000 ₪. הזנת 14 חודשים מפעילה שאלה האם האתר כולו מתארך ואילו עלויות נמשכות; אישור מוסיף 100,000 ₪ ליתרת העבודה ומזיז את הסיום ל-30/04/2027.",
    fixtureHe: "H70: 6 חודשים הוכרו 300,000 ₪, C 100,000 ₪, R 200,000 ₪; PLAN-H-SITE מפרט את העלות החודשית.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => withProject(createDemoState(sessionId), "HAD"),
    events: [],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את תקורות האתר ולחצו ״עדכן משך פרויקט״; הזינו 14 חודשים ובחרו אילו רכיבים נמשכים.", route: "#/budget?project=HAD&code=H70", anchor: "duration-form", doneWhen: (s) => s.questions.some((q) => q.parser === "duration") },
      { id: "2", textHe: "המערכת שואלת האם העיכוב מאריך את פעילות האתר כולו ואילו עלויות חודשיות נמשכות. בתצוגת צוות הבקרה שלחו את השאלה.", route: "#/questions", anchor: "question-review", role: "reviewer", doneWhen: (s) => s.questions.some((q) => q.parser === "duration" && ["sent", "answered", "resolved", "open"].includes(q.status)) },
      { id: "3", textHe: "ענו כמנהלת התפעול בתשובה המוצעת (״כן. האתר יפעל עד 30/04/2027…״). נוצר SCHEDULE-H-14 והצעה מפורטת.", route: "#/questions?tab=messages", anchor: "reply-box", role: "manager", doneWhen: (s) => s.proposals.some((p) => p.kind === "duration") },
      { id: "4", textHe: "בדקו את השפעת התחזית המפורטת (2 × 50,000 ₪) ואשרו. R של תקורות 300,000 ₪, תחזית 700,000 ₪, הדרים 6,206,000 ₪; סיום מאושר 30/04/2027.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => s.projects.find((p) => p.id === "HAD")?.acceptedMonths === 14 },
    ],
    isComplete: (s) => s.projects.find((p) => p.id === "HAD")?.acceptedMonths != null,
    expectationsHe: ["עלות חודשית 20,000 + 15,000 + 10,000 + 5,000 = 50,000 ₪; חודשיים = 100,000 ₪", "H70 R 300,000 ₪; תחזית 700,000 ₪; הדרים 6,206,000 ₪; סיום 28/02/2027 → 30/04/2027", "אבן דרך בלבד: ללא תוספת; לא ודאי: טווח מותנה"],
  },
  {
    id: "S15",
    number: 15,
    titleHe: "שימוש בידע שאושר כדי לצמצם בירורים חוזרים",
    purposeHe: "להראות מנגנון אמין להפחתת שאלות חוזרות לאורך זמן.",
    summaryHe: "אחרי חלוקת 40,000/20,000 שאושרה ונשמרה כהנחיה, חשבונית ספטמבר מתחלקת לפי הכלל בלי שאלה נוספת — וצורכת את פריטי התחזית של ספטמבר.",
    fixtureHe: "תרחיש 5 הושלם (כולל הנחיה RULE-EQ-01 בתוקף עד 31/12/2026); השעון 01/10/2026 09:00. הדרים ציוד A 220,000 / R 180,000; הפארק A 140,000 / R 160,000.",
    activeProjectId: "HAD",
    clock: "2026-10-01T09:00:00+03:00",
    buildFixture: (sessionId) => {
      let s = withProject(createDemoState(sessionId), "HAD");
      s = completeS05(s);
      s = seededHistory(s, ["תרחיש 5 הושלם: חלוקת INV-EQ-001 40,000/20,000 לפי תשובת מאיה ואישור צוות הבקרה", "נשמרה הנחיה RULE-EQ-01 לחיובים חודשיים במסגרת EQ-FRAMEWORK-01, בתוקף עד 31/12/2026"]);
      s = setDemoClock(s, "2026-10-01T09:00:00+03:00", "השעון עבר לתקופת החיוב הבאה: 01/10/2026");
      return { ...s, activity: s.activity.slice(-25) };
    },
    canContinueFrom: (s) => s.approvedRules.some((r) => r.status === "active" && r.frameworkDocumentId === "EQ-FRAMEWORK-01") && (s.erpRecords.find((r) => r.id === "TX-EQ-SHARED")?.allocations.length ?? 0) > 1,
    seededHistoryHe: ["חלוקת INV-EQ-001 לפי תשובת הלקוח (תרחיש 5)", "הנחיה מאושרת RULE-EQ-01"],
    events: [
      { id: "S15-INVOICE", labelHe: "קלוט חשבונית החודש הבא", descriptionHe: "INV-EQ-002 (30/09, התקבלה 01/10): 60,000 ₪, אותה מסגרת, אותם אתרים; טרם שולמה.", kind: "primary", route: "#/budget?project=HAD&code=H40", apply: (s) => runPendingAnalyses(receiveRecord(s, equipmentInvoiceRecord(s, "INV-EQ-002"), [makeScenarioDocument("INV-EQ-002", s.clock)])), availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-EQ-002"), doneWhen: (s) => s.findings.some((f) => f.kind === "rule_reuse") },
      {
        id: "S15-OTHER",
        labelHe: "מסגרת אחרת",
        descriptionHe: "החשבונית מתייחסת למסגרת EQ-FRAMEWORK-02; הכלל אינו חל ונוצרת שאלה חדשה.",
        kind: "branch",
        route: "#/budget?project=HAD&code=H40",
        apply: (s) => {
          const fw = s.documents.find((d) => d.id === "EQ-FRAMEWORK-01")!;
          const fw2 = variant(fw, { idSuffix: "", note: "מסגרת אחרת", titleHe: "מסגרת השכרת ציוד נוספת — EQ-FRAMEWORK-02" });
          const framework2: SourceDocument = { ...fw2, id: "EQ-FRAMEWORK-02", receivedAt: s.clock, date: s.clock.slice(0, 10) };
          const inv = variant(makeScenarioDocument("INV-EQ-002", s.clock), { idSuffix: "FW2", note: "מסגרת אחרת", facts: { contractId: "EQ-FRAMEWORK-02" } });
          const next = receiveDocuments(s, [framework2], { analyze: false });
          return runPendingAnalyses(receiveRecord(next, { ...equipmentInvoiceRecord(next, inv.id), id: "TX-EQ-002-FW2", relatedDocumentIds: ["EQ-FRAMEWORK-02"] }, [inv]));
        },
        availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-EQ-002-FW2"),
      },
      {
        id: "S15-EXTRA-SITE",
        labelHe: "אתר נוסף",
        descriptionHe: "המסגרת עודכנה לשלושה אתרים; קבוצת האתרים שונה מזו שבכלל ולכן אין שימוש אוטומטי.",
        kind: "branch",
        route: "#/budget?project=HAD&code=H40",
        apply: (s) => {
          const fw = s.documents.find((d) => d.id === "EQ-FRAMEWORK-01")!;
          const fw3: SourceDocument = { ...variant(fw, { idSuffix: "EXT", note: "אתר נוסף (גני השקד)", facts: { frameworkProjectIds: ["HAD", "PAR", "GAN"] } }), receivedAt: s.clock, date: s.clock.slice(0, 10), projectIds: ["HAD", "PAR", "GAN"], anchors: [{ id: "scope", labelHe: "תכולה", text: "מסגרת השכרת ציוד לאתרים מגורי הדרים, מתחם הפארק וגני השקד." }, ...fw.anchors.slice(1)] };
          const inv = variant(makeScenarioDocument("INV-EQ-002", s.clock), { idSuffix: "EXT", note: "אתר נוסף", facts: { contractId: fw3.id } });
          const next = receiveDocuments(s, [fw3], { analyze: false });
          return runPendingAnalyses(receiveRecord(next, { ...equipmentInvoiceRecord(next, inv.id), id: "TX-EQ-002-EXT", relatedDocumentIds: [fw3.id] }, [inv]));
        },
        availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-EQ-002-EXT"),
      },
      {
        id: "S15-EXPIRED",
        labelHe: "כלל שפג תוקפו",
        descriptionHe: "תוקף ההנחיה מסתיים לפני תקופת החיוב (31/08/2026); החשבונית מקבלת בדיקה ושאלה חדשה.",
        kind: "branch",
        route: "#/knowledge",
        apply: (s) => {
          const rule = s.approvedRules.find((r) => r.frameworkDocumentId === "EQ-FRAMEWORK-01" && r.status === "active");
          let next = rule ? expireRule(s, rule.id, "2026-08-31") : s;
          next = receiveRecord(next, { ...equipmentInvoiceRecord(next, "INV-EQ-002"), id: "TX-EQ-002-EXPIRED" }, [makeScenarioDocument("INV-EQ-002", next.clock)]);
          return runPendingAnalyses(next);
        },
        availableWhen: (s) => !s.erpRecords.some((r) => r.id === "TX-EQ-002-EXPIRED") && !s.erpRecords.some((r) => r.id === "TX-EQ-002"),
      },
    ],
    steps: [
      { id: "1", textHe: "השעון עבר ל-01/10/2026. בטבלת התקציב פתחו את הציוד ולחצו ״קלוט חשבונית החודש הבא״.", route: "#/budget?project=HAD&code=H40", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "rule_reuse") },
      { id: "2", textHe: "הממצא מציג התאמה להנחיה המאושרת ולראיה המקורית שלה: שני שלישים להדרים, שליש לפארק.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "ההצעה מציגה 40,000/20,000 בלי שאלה חדשה ללקוח. אפשר להזין חלוקה בפועל אחרת (סה״כ 60,000 ₪).", route: "#/records?tab=proposals", anchor: "proposal-list" },
      { id: "4", textHe: "בתצוגת צוות הבקרה אשרו: ״בחשבונית זו נעשה שימוש בהנחיה קודמת; לא נשלחה שאלה נוספת״. R של ספטמבר נצרך בשני הפרויקטים.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => (s.erpRecords.find((r) => r.id === "TX-EQ-002")?.allocations.length ?? 0) > 1 },
      { id: "5", textHe: "בידע מאושר פתחו את RULE-EQ-01: ההחלטה המקורית והשימוש החוזר הראשון מוצגים בנפרד.", route: "#/knowledge", anchor: "rule-history" },
    ],
    isComplete: (s) => (s.erpRecords.find((r) => r.id === "TX-EQ-002")?.allocations.length ?? 0) > 1,
    expectationsHe: ["הדרים ציוד: A 220,000 → 260,000 ₪; R 180,000 → 140,000 ₪", "הפארק ציוד: A 140,000 → 160,000 ₪; R 160,000 → 140,000 ₪; שתי התחזיות ללא שינוי", "חלוקה בפועל 30,000/30,000: הדרים 6,076,000 ₪, הפארק 4,028,000 ₪"],
  },
  {
    id: "S16",
    number: 16,
    titleHe: "הזדמנות רכש מתוך השוואה בין פרויקטים",
    purposeHe: "להראות תובנה חוצת-פרויקטים שימושית בלי להציג מחיר רכישה ישן כהצעה זמינה מובטחת.",
    summaryHe: "אחרי אישור 3,300 ₪ ליתרת הברזל בהדרים, הפארק רכש את אותו מפרט ב-2,900 ₪. ההשוואה מעלה הזדמנות של 192,000 ₪; הצעה חדשה ב-3,100 ₪ מאפשרת שיפור תחזית מאושר של 96,000 ₪.",
    fixtureHe: "תרחיש 6 הושלם עם הנחת 3,300 ₪: ברזל הדרים A 66,000 ₪, R 1,584,000 ₪, תחזית 1,650,000 ₪; הדרים 6,250,000 ₪.",
    activeProjectId: "HAD",
    buildFixture: (sessionId) => {
      let s = withProject(createDemoState(sessionId), "HAD");
      s = completeS06(s);
      s = seededHistory(s, ["תרחיש 6 הושלם: התרעה מוקדמת נמסרה, מאיה אישרה שהמחיר 3,300 ₪ צפוי גם בהמשך, וצוות הבקרה אישר את הנחת המחיר"]);
      return { ...s, activity: s.activity.slice(-25) };
    },
    canContinueFrom: (s) => hasApplied(s, "forecast", (p) => p.costCodeId === "H10"),
    seededHistoryHe: ["הנחת מחיר 3,300 ₪ ליתרת הברזל אושרה (תרחיש 6)"],
    events: [
      { id: "S16-COMPARE", labelHe: "השווה רכישות בפרויקטים", descriptionHe: "השוואת מפרט, תאריך, כמות, הובלה, מיקום ותנאי תשלום מול רכישת הברזל בפארק.", kind: "primary", route: "#/budget?project=HAD&code=H10", apply: (s) => runAnalysisForCode(s, "H10"), doneWhen: (s) => s.findings.some((f) => f.kind === "cross_project_opportunity" && f.recordIds.includes("TX-P-STEEL")) },
      { id: "S16-QUOTE", labelHe: "הדמה קבלת הצעה חדשה", descriptionHe: "QUOTE-H-STEEL-3100: 480 טון ב-3,100 ₪ כולל הובלה, בתוקף עד 30/09/2026; הצעה בלבד.", kind: "primary", route: "#/budget?project=HAD&code=H10", apply: (s) => runPendingAnalyses(receiveDocuments(s, [makeScenarioDocument("QUOTE-H-STEEL-3100", s.clock)])), availableWhen: (s) => !s.documents.some((d) => d.id === "QUOTE-H-STEEL-3100"), doneWhen: (s) => s.proposals.some((p) => p.kind === "forecast" && p.evidence.some((e) => e.documentId === "QUOTE-H-STEEL-3100")) },
      { id: "S16-NOFREIGHT", labelHe: "הצעה ללא הובלה", descriptionHe: "גרסה חלופית: הצעה שאינה כוללת הובלה ורכיב ההובלה אינו ידוע — מסומנת כלא ניתנת להשוואה.", kind: "branch", route: "#/budget?project=HAD&code=H10", apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("QUOTE-H-STEEL-3100", s.clock), { idSuffix: "NOFREIGHT", note: "ללא הובלה", facts: { freightIncluded: false, unitPrice: ils(3050) } })])), availableWhen: (s) => !s.documents.some((d) => d.id === "QUOTE-H-STEEL-3100-NOFREIGHT") },
      { id: "S16-EXPIRED", labelHe: "הצעה שפג תוקפה", descriptionHe: "גרסה חלופית: הצעה שתוקפה חלף אינה יכולה להפוך לבסיס תחזית ללא ראיה מחודשת.", kind: "branch", route: "#/budget?project=HAD&code=H10", apply: (s) => runPendingAnalyses(receiveDocuments(s, [variant(makeScenarioDocument("QUOTE-H-STEEL-3100", s.clock), { idSuffix: "EXPIRED", note: "פג תוקף", facts: { validUntil: "2026-08-31" } })])), availableWhen: (s) => !s.documents.some((d) => d.id === "QUOTE-H-STEEL-3100-EXPIRED") },
    ],
    steps: [
      { id: "1", textHe: "בטבלת התקציב פתחו את הברזל ולחצו ״השווה רכישות בפרויקטים״.", route: "#/budget?project=HAD&code=H10", anchor: "scenario-events", doneWhen: (s) => s.findings.some((f) => f.kind === "cross_project_opportunity") },
      { id: "2", textHe: "הממצא משווה מפרט, תאריך, כמות, הובלה, מיקום ותנאי תשלום. המחיר הישן בפארק הוא סיבה לבקש הצעה חדשה — לא הצעה זמינה.", route: "#/records?tab=findings", anchor: "finding-list" },
      { id: "3", textHe: "לחצו ״הדמה קבלת הצעה חדשה״ (3,100 ₪, בתוקף עד 30/09).", route: "#/budget?project=HAD&code=H10", anchor: "scenario-events", doneWhen: (s) => s.documents.some((d) => d.id === "QUOTE-H-STEEL-3100") },
      { id: "4", textHe: "בדקו את ההצעה ולחצו ״עדכן את התחזית לפי ההצעה״ בתצוגת צוות הבקרה. הסכום נשאר ביתרת העבודה ללא התחייבות — לא הזמנה.", route: "#/records?tab=proposals", anchor: "approve-proposal", role: "reviewer", doneWhen: (s) => hasApplied(s, "forecast", (p) => p.evidence.some((e) => e.documentId === "QUOTE-H-STEEL-3100")) },
      { id: "5", textHe: "שיפור בתחזית 96,000 ₪ (הדרים 6,154,000 ₪); הברזל עדיין 54,000 ₪ מעל התקציב המקורי.", route: "#/budget?project=HAD&code=H10", anchor: "budget-line" },
    ],
    isComplete: (s) => hasApplied(s, "forecast", (p) => p.evidence.some((e) => e.documentId === "QUOTE-H-STEEL-3100")),
    expectationsHe: ["הזדמנות אינדיקטיבית: (3,300 − 2,900) × 480 = 192,000 ₪; לא משנה את התחזית", "הצעה 3,100 ₪: יתרה 1,488,000 ₪, ברזל 1,554,000 ₪, הדרים 6,154,000 ₪; שיפור 96,000 ₪", "הברזל עדיין 54,000 ₪ מעל התקציב"],
  },
];

export function scenarioById(id: string): ScenarioDefinition {
  const def = scenarios.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown scenario ${id}`);
  return def;
}

export function lineEac(state: DemoState, costCodeId: string): number {
  return costLineView(state, costCodeId).eac;
}
