import { addDays, formatDate, isoDateOf, weekdayOf } from "../dates";
import { formatILS } from "../money";
import { attachmentFilename, buildFrozenReport, lastDeliveredReport, nextReportId, priorWorldState } from "../selectors/snapshot";
import { addActivity, addAudit, bump, byId, contactName, nextId, projectName, replaceById, tick } from "../state-utils";
import type { Channel, DemoState, ReportLayout, ReportPreferences, ReportSnapshot } from "../types";
import { ensureConversation, addMessage } from "./messages";
import { refreshRuleStatuses } from "./rules";

/** Findings that are confirmed posted-data errors and still unresolved block final delivery. */
export function blockingIssues(state: DemoState, projectId: string): string[] {
  return state.findings.filter((f) => f.projectId === projectId && f.blocksReport && !["resolved", "dismissed", "superseded"].includes(f.status) && !(f.proposalIds.length > 0 && f.proposalIds.every((pid) => ["applied", "rejected"].includes(state.proposals.find((p) => p.id === pid)?.status ?? "")))).map((f) => f.id).concat(state.proposals.filter((p) => p.projectId === projectId && p.status === "apply_failed").map((p) => p.id));
}

export interface GenerateOptions {
  layout?: ReportLayout;
  channel?: Channel;
  recipientId?: string;
  reportDate?: string;
  scheduledPeriod?: string | null;
  showPaid?: boolean;
  showQuantities?: boolean;
}

/** Provider review gate 3, step 1: prepare a frozen snapshot for internal review. */
export function generateReport(state: DemoState, projectId: string, options: GenerateOptions = {}): [DemoState, ReportSnapshot] {
  const prefs = state.reportPreferences;
  const reportDate = options.reportDate ?? isoDateOf(state.clock);
  const period = options.scheduledPeriod ?? null;
  const existingScheduled = period ? state.reports.find((r) => r.projectId === projectId && r.scheduledPeriod === period && r.status !== "superseded") : undefined;
  if (existingScheduled) return [state, existingScheduled];
  const { id, version } = nextReportId(state, projectId, reportDate);
  const blocking = blockingIssues(state, projectId);
  const frozen = buildFrozenReport(state, projectId, state.clock);
  const previous = lastDeliveredReport(state, projectId);
  const report: ReportSnapshot = {
    id,
    projectId,
    reportDate,
    version,
    generatedAt: state.clock,
    dataThrough: state.clock,
    sourceRevision: state.revision,
    status: blocking.length > 0 ? "blocked" : "pending_review",
    layout: options.layout ?? prefs.layout,
    channel: options.channel ?? prefs.channel,
    recipientId: options.recipientId ?? prefs.recipientId,
    previousReportId: previous?.id ?? null,
    frozen,
    attachmentName: attachmentFilename(frozen.projectNameHe, reportDate),
    scheduledPeriod: period,
    blockingIssueIds: blocking,
    showPaid: options.showPaid ?? prefs.showPaid,
    showQuantities: options.showQuantities ?? prefs.showQuantities,
    deliveryIds: [],
  };
  let s: DemoState = { ...state, reports: [...state.reports, report] };
  s = addActivity(s, "report", blocking.length > 0 ? `הוכנה טיוטת דוח פנימית ${id}; המסירה חסומה עד לתיקון נתונים שגויים` : `הוכן דוח ${id} לבדיקת צוות הבקרה (תחזית ${formatILS(frozen.totals.eac)})`, [id]);
  return [bump(tick(s, 2)), report];
}

/** Provider review gate 3, step 2. */
export function approveReport(state: DemoState, reportId: string, reviewerId = "REVIEWER"): DemoState {
  const report = byId(state.reports, reportId, "report");
  if (report.status === "approved" || report.status === "delivered") return state;
  if (report.status === "blocked" || blockingIssues(state, report.projectId).length > 0) throw new Error("הדוח כולל נתון שגוי מאומת שטרם תוקן; ניתן להפיק רק טיוטה פנימית");
  let s: DemoState = { ...state, reports: replaceById(state.reports, reportId, (r) => ({ ...r, status: "approved", reviewedBy: reviewerId, reviewedAt: state.clock })) };
  const openNotes = report.frozen.notes.filter((n) => n.kind === "open_question" || n.kind === "conditional_risk").length;
  const [s1] = addAudit(s, { actorId: reviewerId, kind: "report_approved", textHe: `הדוח ${reportId} אושר למסירה${openNotes ? ` עם ${openNotes} הנחות/שאלות פתוחות המוצגות במפורש בדוח` : ""}.`, entityIds: [reportId], projectId: report.projectId });
  s = addActivity(s1, "report", `הדוח ${reportId} אושר על ידי צוות הבקרה`, [reportId]);
  return bump(tick(s, 1));
}

/** Simulated delivery: one delivery record per (report, channel, recipient); repeated clicks do nothing. */
export function simulateDeliverReport(state: DemoState, reportId: string, channel?: Channel, recipientId?: string): DemoState {
  const report = byId(state.reports, reportId, "report");
  if (report.status !== "approved" && report.status !== "delivered") throw new Error("יש לאשר את הדוח לפני המסירה");
  const ch = channel ?? report.channel;
  const to = recipientId ?? report.recipientId;
  const key = `report:${reportId}:${ch}:${to}`;
  if (state.deliveries.some((d) => d.idempotencyKey === key)) return state;
  let s = state;
  const name = contactName(s, to).split(" ")[0];
  const f = report.frozen;
  const text = `${name}, דוח הבקרה השבועי של ${f.projectNameHe} מוכן. תחזית העלות לסיום היא ${formatILS(f.totals.eac)}, לעומת תקציב של ${formatILS(f.totals.budget)}. מצורף קובץ Excel בפורמט שבחרת. אפשר לפתוח את הדוח ולשאול עליו שאלות.`;
  const [s1, conversation] = ensureConversation(s, ch, "report", to, report.projectId, ch === "email" ? `דוחות במייל — ${contactName(s, to)}` : `דוחות ב-WhatsApp — ${contactName(s, to)}`);
  s = s1;
  const [s2, message] = addMessage(s, conversation.id, { direction: "outbound", kind: "report", textHe: text, attachments: [{ id: `ATT-${reportId}`, filename: report.attachmentName, kind: "xlsx", reportId }], authorId: "REVIEWER", reportId, actions: [{ labelHe: "פתח את הדוח", action: "open_report", targetId: reportId }] });
  s = s2;
  const [s3, deliveryId] = nextId(s, "DLV");
  s = { ...s3, deliveries: [...s3.deliveries, { id: deliveryId, kind: "report", reportId, channel: ch, recipientId: to, at: s.clock, conversationId: conversation.id, messageId: message.id, idempotencyKey: key }] };
  s = { ...s, reports: replaceById(s.reports, reportId, (r) => ({ ...r, status: "delivered", deliveredAt: r.deliveredAt ?? s.clock, deliveryIds: [...r.deliveryIds, deliveryId], channel: ch, recipientId: to })) };
  const [s4] = addAudit(s, { actorId: "REVIEWER", kind: "report_delivered", textHe: `הדוח ${reportId} נמסר ל${contactName(s, to)} ב${ch === "email" ? "מייל" : "-WhatsApp"} עם הקובץ ${report.attachmentName} (הדמיה).`, entityIds: [reportId, deliveryId], projectId: report.projectId });
  s = addActivity(s4, "report", `הדוח ${reportId} נמסר ל${contactName(s, to)} ב${ch === "email" ? "מייל" : "-WhatsApp"}`, [reportId]);
  return bump(tick(s, 2));
}

export function setReportPreferences(state: DemoState, patch: Partial<ReportPreferences>): DemoState {
  return bump({ ...state, reportPreferences: { ...state.reportPreferences, ...patch } });
}

/** Seed history: the prior delivered report reconstructed from the prior-world ledger (never from the later steel invoice). */
export function seedPriorReport(state: DemoState, projectId: string, cutoff: string, id: string, deliveredAt: string): DemoState {
  if (state.reports.some((r) => r.id === id)) return state;
  const prior = priorWorldState(state, cutoff);
  const frozen = buildFrozenReport(prior, projectId, cutoff, ["דוח קודם ששוחזר מהרישומים שהיו זמינים במועד הדוח."]);
  const report: ReportSnapshot = {
    id,
    projectId,
    reportDate: isoDateOf(cutoff),
    version: 1,
    generatedAt: cutoff,
    dataThrough: cutoff,
    sourceRevision: 0,
    status: "delivered",
    layout: state.reportPreferences.layout,
    channel: state.reportPreferences.channel,
    recipientId: state.reportPreferences.recipientId,
    reviewedBy: "REVIEWER",
    reviewedAt: cutoff,
    deliveredAt,
    previousReportId: null,
    frozen,
    attachmentName: attachmentFilename(frozen.projectNameHe, isoDateOf(cutoff)),
    scheduledPeriod: isoDateOf(cutoff),
    blockingIssueIds: [],
    showPaid: true,
    showQuantities: true,
    deliveryIds: [],
    seededHistory: true,
  };
  let s: DemoState = { ...state, reports: [...state.reports, report] };
  const [s1, conversation] = ensureConversation(s, report.channel, "report", report.recipientId, projectId, `דוחות במייל — ${contactName(s, report.recipientId)}`);
  s = s1;
  const name = contactName(s, report.recipientId).split(" ")[0];
  const [s2, message] = addMessage(s, conversation.id, { direction: "outbound", kind: "report", textHe: `${name}, דוח הבקרה השבועי של ${frozen.projectNameHe} מוכן. תחזית העלות לסיום היא ${formatILS(frozen.totals.eac)}, לעומת תקציב של ${formatILS(frozen.totals.budget)}. מצורף קובץ Excel בפורמט שבחרת. אפשר לפתוח את הדוח ולשאול עליו שאלות.`, attachments: [{ id: `ATT-${id}`, filename: report.attachmentName, kind: "xlsx", reportId: id }], authorId: "REVIEWER", reportId: id, actions: [{ labelHe: "פתח את הדוח", action: "open_report", targetId: id }] });
  s = { ...s2, conversations: replaceById(s2.conversations, conversation.id, (c) => ({ ...c, messages: c.messages.map((mm) => (mm.id === message.id ? { ...mm, at: deliveredAt } : mm)), createdAt: deliveredAt, updatedAt: deliveredAt })) };
  const [s3, deliveryId] = nextId(s, "DLV");
  s = { ...s3, deliveries: [...s3.deliveries, { id: deliveryId, kind: "report", reportId: id, channel: report.channel, recipientId: report.recipientId, at: deliveredAt, conversationId: conversation.id, messageId: message.id, idempotencyKey: `report:${id}:${report.channel}:${report.recipientId}` }], reports: replaceById(s3.reports, id, (r) => ({ ...r, deliveryIds: [deliveryId] })) };
  return s;
}

/** Simulated clock: creating due weekly drafts (keyed by project + period) and expiring quotes/rules. */
export function advanceDemoClock(state: DemoState, days: number): DemoState {
  if (!Number.isInteger(days) || days <= 0) throw new Error("ניתן להתקדם בימים שלמים בלבד");
  const target = addDays(state.clock, days);
  let s: DemoState = { ...state, clock: target };
  const prefs = s.reportPreferences;
  // every scheduled weekday between old clock and new clock (inclusive of target when at/after the hour)
  let cursor = addDays(state.clock, 1);
  const due: string[] = [];
  while (cursor <= target) {
    const date = isoDateOf(cursor);
    if (weekdayOf(date) === prefs.weekday) due.push(date);
    cursor = addDays(cursor, 1);
  }
  for (const date of due) {
    for (const projectId of prefs.projectIds) {
      const period = date;
      if (s.reports.some((r) => r.projectId === projectId && r.scheduledPeriod === period)) continue;
      const clockAt = `${date}T${String(prefs.hour).padStart(2, "0")}:00:00+03:00`;
      const [s1, report] = generateReport({ ...s, clock: clockAt }, projectId, { reportDate: date, scheduledPeriod: period });
      s = { ...s1, clock: target };
      s = addActivity(s, "clock", `דוח שבועי מתוזמן ${report.id} הוכן לבדיקה (${formatDate(date)} ${String(prefs.hour).padStart(2, "0")}:00)`, [report.id]);
    }
  }
  s = expireForecastBases(s);
  s = refreshRuleStatuses(s);
  s = addActivity(s, "clock", `שעון ההדגמה התקדם ב-${days} ימים ל-${formatDate(target)}`, []);
  return bump(s);
}

export function setDemoClock(state: DemoState, iso: string, noteHe?: string): DemoState {
  if (iso <= state.clock) return state;
  let s: DemoState = { ...state, clock: iso };
  s = expireForecastBases(s);
  s = refreshRuleStatuses(s);
  s = addActivity(s, "clock", noteHe ?? `שעון ההדגמה הועבר ל-${formatDate(iso)}`, []);
  return bump(s);
}

/** A forecast basis (quote) that expired marks the accepted estimate as needing revalidation; it does not revert the forecast. */
function expireForecastBases(state: DemoState): DemoState {
  const today = isoDateOf(state.clock);
  const affected = state.forecasts.filter((f) => f.status === "accepted" && f.validUntil && f.validUntil < today);
  if (affected.length === 0) return state;
  let s: DemoState = { ...state, forecasts: state.forecasts.map((f) => (affected.includes(f) ? { ...f, status: "needs_revalidation" as const } : f)) };
  for (const f of affected) {
    const item = s.workItems.find((w) => w.id === f.workItemId);
    s = addActivity(s, "forecast", `בסיס התחזית של ${item?.titleHe ?? f.workItemId} (${f.basisHe}) פג תוקף ב-${formatDate(f.validUntil)}; ההערכה מסומנת לאימות מחדש ואינה מוחזרת אוטומטית`, [f.workItemId]);
  }
  return s;
}

export function describeReport(state: DemoState, report: ReportSnapshot): string {
  return `${projectName(state, report.projectId)} · ${formatDate(report.reportDate)} · גרסה ${report.version}`;
}
