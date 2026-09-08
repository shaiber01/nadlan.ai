import { formatDate, finishDateForDuration } from "../dates";
import { formatILS, formatNumber } from "../money";
import { addActivity, bump, byId, nextId, replaceById, tick } from "../state-utils";
import type { ClientQuestion, DemoState, Finding } from "../types";
import { scheduleAnalysis, runPendingAnalyses } from "./core";

/**
 * Commands that back specific scenario interactions (S02 sample intake, S14 duration input,
 * S15 custom allocation, S16 "no quote"). They still go through findings/proposals/review.
 */

/** S02: preset sample-budget import. Updates the existing draft version in place (no duplicate rows), then analysis runs. */
export function intakeSampleBudget(state: DemoState, projectId: string): DemoState {
  const draft = state.budgetVersions.find((b) => b.projectId === projectId && b.kind === "draft" && b.status === "current");
  if (!draft) throw new Error("אין טיוטת תקציב לפרויקט זה");
  let s = addActivity(state, "received", `נקלטה טיוטת תקציב לדוגמה בזיו — הדגמה: ${draft.lines.length} שורות (${draft.id})`, [draft.id]);
  s = scheduleAnalysis(s, { documentId: draft.documentId });
  return bump(tick(s, 1));
}

/** S14: the user proposes a new duration; the demo asks OPS whether the whole site extends before any forecast change. */
export function requestDurationChange(state: DemoState, projectId: string, months: number, componentIds?: string[]): DemoState {
  if (!Number.isInteger(months) || months <= 0) throw new Error("משך הפרויקט חייב להיות מספר חודשים שלם וחיובי");
  const project = byId(state.projects, projectId, "project");
  const plan = state.documents.find((d) => d.kind === "plan" && d.projectIds.includes(projectId) && d.facts.monthlyComponents);
  if (!plan?.facts.monthlyComponents) throw new Error("לא נמצא תכנון תקורות לפרויקט");
  const baseMonths = project.acceptedMonths ?? project.plannedMonths ?? 12;
  const code = state.costCodes.find((c) => c.projectId === projectId && c.category === "site_overhead")!;
  if (months <= baseMonths) throw new Error(`המשך המבוקש (${months}) אינו ארוך מהמשך המאושר (${baseMonths} חודשים)`);
  const selected = componentIds?.length ? componentIds : plan.facts.monthlyComponents.map((c) => c.id);
  const components = plan.facts.monthlyComponents.filter((c) => selected.includes(c.id));
  const monthly = components.reduce((a, c) => a + c.amount, 0);
  const extraMonths = months - baseMonths;
  const finish = finishDateForDuration(project.start ?? "2026-03-01", months);
  const dedupeKey = `duration_request:${projectId}:${months}:${selected.join(",")}`;
  if (state.findings.some((f) => f.dedupeKey === dedupeKey && f.status !== "superseded")) return state;
  const [s1, findingId] = nextId(state, "FND");
  const [s2, questionId] = nextId(s1, "Q");
  const componentsHe = components.map((c) => c.nameHe).join(", ");
  const finding: Finding = {
    id: findingId,
    kind: "duration_impact",
    projectId,
    costCodeId: code.id,
    recordIds: [],
    documentIds: [plan.id],
    titleHe: `עיכוב אפשרי: משך האתר ${months} חודשים במקום ${baseMonths}`,
    explanationHe: `הוזן משך של ${months} חודשים (סיום ${formatDate(finish)}). אם האתר כולו מתארך ב-${extraMonths} חודשים, הרכיבים הממשיכים (${componentsHe}, ${formatILS(monthly)} לחודש) יוסיפו ${formatILS(monthly * extraMonths)} לתחזית. לפני עדכון התחזית נדרש אישור שהעיכוב מאריך את פעילות האתר כולו ואילו עלויות נמשכות.`,
    status: "needs_clarification",
    severity: "risk",
    checkedHe: [`נבדק תכנון האתר ${plan.id}: ${plan.facts.months} חודשים, ${formatILS(plan.facts.monthlyComponents.reduce((a, c) => a + c.amount, 0))} לחודש`, "לא נמצא במסמכים אישור להארכת האתר; נדרש מידע מהלקוח"],
    evidence: [{ documentId: plan.id, anchorId: "monthly" }, { documentId: plan.id, anchorId: "duration" }],
    proposalIds: [],
    questionIds: [questionId],
    alertIds: [],
    taskIds: [],
    amounts: { extra: monthly * extraMonths, monthly },
    numbers: { months, extraMonths, componentCount: components.length },
    blocksReport: false,
    createdAt: state.clock,
    createdAtRevision: state.revision,
    sessionId: state.sessionId,
    dedupeKey,
  };
  const question: ClientQuestion = {
    id: questionId,
    findingId,
    projectId,
    contactId: "OPS",
    textHe: extraMonths === 2 && components.length === plan.facts.monthlyComponents.length ? `האם העיכוב מאריך את פעילות האתר בשני חודשים מלאים, והאם צוות האתר, השכירות, האבטחה והשירותים יידרשו לכל התקופה הנוספת?` : `האם העיכוב מאריך את פעילות האתר ב-${formatNumber(extraMonths)} חודשים מלאים (עד ${formatDate(finish)}), והאם ${componentsHe} יידרשו לכל התקופה הנוספת?`,
    suggestedReplies: [
      { id: "yes", textHe: `כן. האתר יפעל עד ${formatDate(finish)}, וכל העלויות האלה יימשכו ב${extraMonths === 2 ? "שני החודשים הנוספים" : `${formatNumber(extraMonths)} החודשים הנוספים`}.`, effect: { type: "duration", confirm: true, months, componentIds: selected } },
      { id: "milestone", textHe: "לא, רק אבן דרך זזה; משך האתר הכולל נשאר", effect: { type: "duration", confirm: false, milestoneOnly: true } },
      { id: "unsure", textHe: "עדיין לא ידוע אם האתר יתארך", effect: { type: "open" } },
    ],
    parser: "duration",
    status: "pending_review",
    checkedHe: ["תכנון תקורות האתר", "לוח הזמנים המאושר"],
    createdAt: state.clock,
  };
  let s: DemoState = { ...s2, findings: [...s2.findings, finding], questions: [...s2.questions, question] };
  s = addActivity(s, "question", `נוצרה שאלה ללקוח על הארכת האתר ל-${months} חודשים`, [findingId, questionId]);
  return bump(tick(s, 1));
}

/** S15 custom actual split before approval: totals must match; fulfilled forecast items stay as planned. */
export function setProposalAllocation(state: DemoState, proposalId: string, split: Record<string, number>): DemoState {
  const p = byId(state.proposals, proposalId, "proposal");
  if (p.payload.kind !== "allocation") throw new Error("לא הצעת חלוקה");
  const record = byId(state.erpRecords, p.payload.recordId, "record");
  const total = Object.values(split).reduce((a, b) => a + b, 0);
  if (total !== record.amount) throw new Error(`סכום החלוקה חייב להתאים לסכום החשבונית (${formatILS(record.amount)})`);
  if (Object.values(split).some((v) => v < 0)) throw new Error("סכומי החלוקה חייבים להיות חיוביים");
  const allocations = p.payload.allocations.map((a) => ({ ...a, amount: split[a.projectId] ?? a.amount }));
  return bump({
    ...state,
    proposals: replaceById(state.proposals, proposalId, (x) => ({
      ...x,
      payload: { ...p.payload, allocations },
      after: allocations.map((a) => ({ labelHe: state.projects.find((pr) => pr.id === a.projectId)?.nameHe ?? a.projectId, value: formatILS(a.amount) })),
      reasonHe: `${p.reasonHe} חלוקה בפועל שהוזנה ידנית: ${allocations.map((a) => formatILS(a.amount)).join(" / ")}; פריטי התחזית שמומשו נשארים לפי התכנון.`,
    })),
  });
}

/** S16: "לא נמצאה הצעה מתאימה" closes the opportunity without changing the forecast. */
export function closeOpportunity(state: DemoState, findingId: string, noteHe: string): DemoState {
  const f = byId(state.findings, findingId, "finding");
  let s: DemoState = { ...state, findings: replaceById(state.findings, findingId, (x) => ({ ...x, status: "dismissed", resolutionHe: noteHe })) };
  s = addActivity(s, "forecast", `ההזדמנות נסגרה ללא שינוי בתחזית: ${f.titleHe}`, [findingId]);
  return bump(tick(s, 1));
}

/** S13 branch: end-customer approves the recovery claim; cost EAC is unaffected. */
export function approveRecovery(state: DemoState, recoveryId: string): DemoState {
  const r = byId(state.recoveries, recoveryId, "recovery");
  if (r.status === "approved") return state;
  let s: DemoState = { ...state, recoveries: replaceById(state.recoveries, recoveryId, (x) => ({ ...x, status: "approved" })) };
  s = addActivity(s, "applied", `דרישת ההחזר ${r.id} אושרה על ידי לקוח הקצה (${formatILS(r.amount)}); תחזית העלות אינה משתנה`, [recoveryId]);
  return bump(tick(s, 1));
}

export function runAnalysisForCode(state: DemoState, costCodeId: string): DemoState {
  return bump(runPendingAnalyses(scheduleAnalysis(state, { costCodeId })));
}
