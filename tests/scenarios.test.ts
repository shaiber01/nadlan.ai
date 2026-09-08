import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createDemoState } from "../src/app/demo";
import { completeS05, completeS06, scenarioById } from "../src/data/scenarios/definitions";
import { askQuestion } from "../src/domain/commands/chat";
import { completeAnalysis, runPendingAnalyses } from "../src/domain/commands/core";
import { recordClientReply, reviewAndReleaseAlert, reviewQuestion, sendQuestionBatch } from "../src/domain/commands/messages";
import { advanceDemoClock, approveReport, generateReport, simulateDeliverReport } from "../src/domain/commands/reports";
import { approveProposal, rejectProposal, retryProposal, simulateWriteFailure } from "../src/domain/commands/review";
import { saveApprovedRule } from "../src/domain/commands/rules";
import { requestDurationChange, setProposalAllocation } from "../src/domain/commands/scenario-actions";
import { setCandidateFuturePrice, steelWhatIf, updateSteelExperiment } from "../src/domain/commands/experiment";
import { ils } from "../src/domain/money";
import { contractRemainingPayment, costLineView, portfolioTotals, projectTotals } from "../src/domain/selectors/financial";
import { changeSinceLastReport, reportById } from "../src/domain/selectors/snapshot";
import { buildReportWorkbook } from "../src/export/xlsx";
import type { DemoState } from "../src/domain/types";

const R = "REVIEWER";

function fixture(id: string): DemoState {
  return scenarioById(id).buildFixture(`test-${id}`);
}

function runEvent(state: DemoState, scenarioId: string, eventId: string): DemoState {
  const event = scenarioById(scenarioId).events.find((e) => e.id === eventId);
  if (!event) throw new Error(`event ${eventId} missing`);
  return event.apply(state);
}

function pending(state: DemoState, kind: string, predicate: (p: DemoState["proposals"][number]) => boolean = () => true) {
  const p = state.proposals.find((x) => x.kind === kind && x.status === "pending_review" && predicate(x));
  if (!p) throw new Error(`no pending ${kind} proposal; proposals: ${state.proposals.map((x) => `${x.kind}:${x.status}`).join(", ")}`);
  return p;
}

function lastAssistant(state: DemoState): string {
  const msgs = state.chat.messages.filter((m) => m.role === "assistant");
  return msgs[msgs.length - 1]?.textHe ?? "";
}

const had = (s: DemoState) => projectTotals(s, "HAD");
const par = (s: DemoState) => projectTotals(s, "PAR");

describe("baseline initialization", () => {
  const s = createDemoState("init");
  it("produces exactly the two baseline findings and the prior report", () => {
    const kinds = s.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(["missing_allocation", "price_risk"]);
    const prior = reportById(s, "RPT-HAD-2026-08-31")!;
    expect(prior.status).toBe("delivered");
    expect(prior.frozen.totals.eac).toBe(ils(6100000));
    expect(prior.frozen.totals.incurred).toBe(ils(1540000));
    expect(prior.frozen.totals.uncommitted).toBe(ils(2730000));
    const h10 = prior.frozen.lines.find((l) => l.costCodeId === "H10")!;
    expect(h10.incurred).toBe(0);
    expect(h10.uncommitted).toBe(ils(1500000));
    expect(h10.workItems.filter((w) => w.status === "uncommitted")).toHaveLength(1);
    expect(h10.workItems[0].quantity).toBe(500);
    expect(prior.frozen.availableDocumentIds).not.toContain("INV-H-STEEL-001");
    expect(prior.frozen.availableDocumentIds).toContain("INV-EQ-001");
  });
  it("keeps the manager-facing alert and question pending provider review", () => {
    expect(s.alerts[0].status).toBe("pending_review");
    expect(s.questions.every((q) => q.status === "pending_review")).toBe(true);
    expect(s.deliveries.filter((d) => d.kind !== "report")).toHaveLength(0);
  });
  it("discards analysis results from another session", () => {
    const st = { ...s, pendingAnalyses: [{ id: "ANL-X", recordId: "TX-H-STEEL", recordVersion: 1, sessionId: "old", scheduledAt: s.clock }] };
    const after = completeAnalysis(st, "ANL-X", "old");
    expect(after.pendingAnalyses).toHaveLength(0);
    expect(after.findings.length).toBe(s.findings.length);
  });
});

describe("S01 weekly report", () => {
  it("generates, approves, delivers by email and WhatsApp, builds a valid workbook, and schedules the next week", () => {
    let s = fixture("S01");
    const [s1, report] = generateReport(s, "HAD", { layout: "management_summary", channel: "email", recipientId: "CEO" });
    s = s1;
    expect(report.status).toBe("pending_review");
    expect(report.frozen.totals.eac).toBe(ils(6106000));
    expect(report.attachmentName).toBe("דוח_בקרה_מגורי_הדרים_2026-09-07.xlsx");
    s = approveReport(s, report.id, R);
    s = simulateDeliverReport(s, report.id, "email", "CEO");
    const again = simulateDeliverReport(s, report.id, "email", "CEO");
    expect(again.deliveries.filter((d) => d.reportId === report.id)).toHaveLength(1);
    const email = s.conversations.find((c) => c.channel === "email" && c.purpose === "report")!;
    const message = email.messages[email.messages.length - 1];
    expect(message.textHe).toContain("6,106,000 ₪");
    expect(message.textHe).toContain("6,100,000 ₪");
    expect(message.attachments[0].filename).toBe(report.attachmentName);
    s = simulateDeliverReport(s, report.id, "whatsapp", "CEO");
    expect(s.conversations.some((c) => c.channel === "whatsapp" && c.purpose === "report")).toBe(true);
    const bytes = buildReportWorkbook(reportById(s, report.id)!);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain("xl/workbook.xml");
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain("rightToLeft");
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain("6106000");
    // current versus last delivered report is now zero
    expect(changeSinceLastReport(s, "HAD").delta).toBe(0);
    expect(changeSinceLastReport(s, "HAD").comparedToReportId).toBe(report.id);
    // advance a week creates exactly one scheduled draft for 14/09
    s = advanceDemoClock(s, 7);
    expect(s.reports.filter((r) => r.scheduledPeriod === "2026-09-14")).toHaveLength(1);
    s = advanceDemoClock(s, 7);
    expect(s.reports.filter((r) => r.scheduledPeriod === "2026-09-14")).toHaveLength(1);
    expect(s.reports.filter((r) => r.scheduledPeriod === "2026-09-21")).toHaveLength(1);
  });
  it("reports with unresolved posted-data errors are blocked; open assumptions are allowed", () => {
    let s = fixture("S09");
    s = runEvent(s, "S09", "S09-RECEIVE");
    const [s1, report] = generateReport(s, "HAD");
    expect(report.status).toBe("blocked");
    expect(() => approveReport(s1, report.id, R)).toThrow();
    const base = fixture("S01");
    const [b1, r2] = generateReport(base, "HAD");
    expect(r2.status).toBe("pending_review");
    expect(r2.frozen.notes.some((n) => n.kind === "conditional_risk")).toBe(true);
    expect(r2.frozen.notes.some((n) => n.kind === "open_question")).toBe(true);
    expect(() => approveReport(b1, r2.id, R)).not.toThrow();
  });
});

describe("S02 draft budget assumptions", () => {
  it("compares comparable quotes, excludes the incompatible one, and revises the draft to 390", () => {
    let s = fixture("S02");
    s = runEvent(s, "S02", "S02-INTAKE");
    const finding = s.findings.find((f) => f.kind === "budget_assumption")!;
    expect(finding.amounts.lowGap).toBe(ils(80000));
    expect(finding.amounts.highGap).toBe(ils(100000));
    expect(finding.checkedHe.some((c) => c.includes("QUOTE-NOF-X") && c.includes("לא נכלל בהשוואה"))).toBe(true);
    const p = pending(s, "draft_budget");
    expect(p.payload.kind === "draft_budget" && p.payload.unitPrice).toBe(ils(390));
    s = approveProposal(s, p.id, R);
    const v2 = s.budgetVersions.find((b) => b.projectId === "NOF" && b.version === 2)!;
    expect(v2.lines.find((l) => l.id === "N20")!.amount).toBe(ils(390000));
    expect(v2.lines.reduce((a, l) => a + l.amount, 0)).toBe(ils(5090000));
    expect(s.budgetVersions.find((b) => b.id === "BUD-NOF-DRAFT-V1")!.status).toBe("superseded");
    expect(portfolioTotals(s).eac).toBe(ils(15104000));
  });
  it("a valid contract at 300 lets the reviewer keep the assumption", () => {
    let s = runEvent(fixture("S02"), "S02", "S02-INTAKE");
    s = runEvent(s, "S02", "S02-CONTRACT");
    const p = pending(s, "dismiss_flag");
    s = approveProposal(s, p.id, R);
    expect(s.findings.filter((f) => f.kind === "budget_assumption" && f.status === "dismissed").length).toBeGreaterThan(0);
    expect(s.budgetVersions.some((b) => b.projectId === "NOF" && b.version === 2)).toBe(false);
  });
});

describe("S03 misclassified invoice", () => {
  it("proposes the steel code, survives a failed write, and applies once on retry", () => {
    let s = fixture("S03");
    expect(costLineView(s, "H10").incurred).toBe(0);
    expect(costLineView(s, "H10").eac).toBe(ils(1440000));
    expect(costLineView(s, "H60").incurred).toBe(ils(366000));
    expect(costLineView(s, "H60").eac).toBe(ils(1066000));
    expect(had(s).eac).toBe(ils(6106000));
    expect(s.findings.some((f) => f.kind === "classification")).toBe(false);
    s = runEvent(s, "S03", "S03-RESAVE");
    const finding = s.findings.find((f) => f.kind === "classification")!;
    expect(finding.explanationHe).toContain("נרשמה בסעיף עבודות גמר");
    expect(s.questions.some((q) => q.findingId === finding.id)).toBe(false);
    const p = pending(s, "erp_correction");
    s = simulateWriteFailure(s, true);
    s = approveProposal(s, p.id, R);
    expect(s.proposals.find((x) => x.id === p.id)!.status).toBe("apply_failed");
    expect(s.erpRecords.find((r) => r.id === "TX-H-STEEL")!.allocations[0].costCodeId).toBe("H60");
    s = retryProposal(s, p.id);
    s = runPendingAnalyses(s);
    expect(s.proposals.find((x) => x.id === p.id)!.status).toBe("applied");
    expect(s.erpRecords.find((r) => r.id === "TX-H-STEEL")!.allocations[0].costCodeId).toBe("H10");
    expect(costLineView(s, "H10").incurred).toBe(ils(66000));
    expect(costLineView(s, "H10").eac).toBe(ils(1506000));
    expect(costLineView(s, "H60").incurred).toBe(ils(300000));
    expect(costLineView(s, "H60").eac).toBe(ils(1000000));
    expect(had(s).eac).toBe(ils(6106000));
    expect(had(s).paid).toBe(ils(1250000));
    expect(s.auditEvents.some((e) => e.kind === "applied:erp_correction")).toBe(true);
    expect(s.auditEvents.some((e) => e.kind === "apply_failed")).toBe(true);
    // second retry/approve does nothing
    expect(approveProposal(s, p.id, R).auditEvents.length).toBe(s.auditEvents.length);
    // the price risk now surfaces on the reclassified purchase
    expect(s.findings.some((f) => f.kind === "price_risk")).toBe(true);
  });
  it("rejection leaves the ERP untouched with a reason", () => {
    let s = runEvent(fixture("S03"), "S03", "S03-RESAVE");
    const p = pending(s, "erp_correction");
    s = rejectProposal(s, p.id, "נדרשת בדיקה נוספת", R);
    expect(s.erpRecords.find((r) => r.id === "TX-H-STEEL")!.allocations[0].costCodeId).toBe("H60");
    expect(s.proposals.find((x) => x.id === p.id)!.rejectionReasonHe).toBe("נדרשת בדיקה נוספת");
  });
  it("only an ambiguous source with no order or delivery note asks the client", () => {
    let s = runEvent(fixture("S03"), "S03", "S03-AMBIG");
    const f = s.findings.find((x) => x.kind === "classification" && x.status === "needs_clarification")!;
    expect(f).toBeTruthy();
    expect(s.questions.some((q) => q.findingId === f.id)).toBe(true);
  });
});

describe("S04 wrong quantity", () => {
  it("corrects quantity and unit price from sources without changing money", () => {
    let s = fixture("S04");
    const raw = s.erpRecords.find((r) => r.id === "TX-H-STEEL")!;
    expect(raw.quantity).toBe(200);
    expect(costLineView(s, "H10").quantities?.purchasedVerified).toBeNull();
    s = runEvent(s, "S04", "S04-SAVE");
    const f = s.findings.find((x) => x.kind === "quantity_mismatch")!;
    expect(f.explanationHe).toContain("בזיו נרשמו 200 טון");
    expect(f.explanationHe).toContain("66,000 ₪");
    const p = pending(s, "erp_correction");
    s = approveProposal(s, p.id, R);
    s = runPendingAnalyses(s);
    const rec = s.erpRecords.find((r) => r.id === "TX-H-STEEL")!;
    expect(rec.quantity).toBe(20);
    expect(rec.unitPrice).toBe(ils(3300));
    expect(rec.amount).toBe(ils(66000));
    expect(had(s).eac).toBe(ils(6106000));
    const q = costLineView(s, "H10").quantities!;
    expect(q.purchasedVerified).toBe(20);
    expect(q.remainingToProcure).toBe(480);
    expect(s.findings.some((x) => x.kind === "price_risk")).toBe(true);
    expect(s.auditEvents.find((e) => e.kind === "applied:erp_correction")!.textHe).toContain("תוקנה מ-200 ל-20 טון");
  });
  it("partial delivery asks after checking for another note and keeps purchased quantity", () => {
    let s = runEvent(fixture("S04"), "S04", "S04-SAVE");
    s = approveProposal(s, pending(s, "erp_correction").id, R);
    s = runPendingAnalyses(s);
    s = runEvent(s, "S04", "S04-PARTIAL");
    const f = s.findings.find((x) => x.kind === "partial_delivery")!;
    expect(f.numbers).toMatchObject({ purchased: 20, delivered: 18, outstanding: 2 });
    const q = costLineView(s, "H10").quantities!;
    expect(q.purchasedVerified).toBe(20);
    expect(q.delivered).toBe(18);
    expect(q.outstandingDelivery).toBe(2);
    expect(q.remainingToProcure).toBe(480);
    expect(s.erpRecords.find((r) => r.id === "TX-H-STEEL")!.amount).toBe(ils(66000));
    const question = s.questions.find((x) => x.findingId === f.id)!;
    expect(question.suggestedReplies.map((r) => r.textHe)).toContain("נדרש בירור מול הספק");
  });
});

describe("S05 consolidated WhatsApp clarification", () => {
  it("validates replies and splits cost and payment across projects", () => {
    let s = fixture("S05");
    const q = s.questions.find((x) => x.recordId === "TX-EQ-SHARED")!;
    s = reviewQuestion(s, q.id, R);
    s = sendQuestionBatch(s, [q.id]);
    const conv = s.conversations.find((c) => c.channel === "whatsapp" && c.purpose === "clarification")!;
    expect(conv.messages[0].textHe).toContain("מאיה, ריכזנו שאלה אחת שלא נפתרה מהמסמכים: חשבונית ציוד INV-EQ-001 בסך 60,000 ₪");
    const bad = recordClientReply(s, q.id, "45,000 למגורי הדרים ו-20,000 למתחם הפארק");
    expect(bad.questions.find((x) => x.id === q.id)!.parsedReply?.ok).toBe(false);
    expect(bad.questions.find((x) => x.id === q.id)!.parsedReply?.messageHe).toBe("החלוקה מסתכמת ב-65,000 ₪, אך סכום החשבונית הוא 60,000 ₪. צריך לתקן את החלוקה לפני העדכון.");
    expect(bad.proposals.length).toBe(s.proposals.length);
    const vague = recordClientReply(s, q.id, "בערך חצי חצי אולי");
    expect(vague.questions.find((x) => x.id === q.id)!.parsedReply?.ok).toBe(false);
    const open = recordClientReply(s, q.id, "אין לי עדיין פירוט");
    expect(open.questions.find((x) => x.id === q.id)!.status).toBe("open");
    expect(open.erpRecords.find((r) => r.id === "TX-EQ-SHARED")!.allocations).toHaveLength(1);
    s = recordClientReply(s, q.id, "40,000 ₪ למגורי הדרים ו-20,000 ₪ למתחם הפארק");
    const p = pending(s, "allocation");
    expect(p.sourceReplyMessageId).toMatch(/MSG-S05-REPLY|MSG-REPLY/);
    s = approveProposal(s, p.id, R);
    s = runPendingAnalyses(s);
    expect(costLineView(s, "H40").incurred).toBe(ils(220000));
    expect(costLineView(s, "P40").incurred).toBe(ils(140000));
    expect(had(s).eac).toBe(ils(6086000));
    expect(par(s).eac).toBe(ils(4018000));
    expect(portfolioTotals(s).eac).toBe(ils(15104000));
    expect(had(s).paid).toBe(124333333);
    expect(par(s).paid).toBe(86466667);
    expect(portfolioTotals(s).paid).toBe(ils(3358000));
    const rec = s.erpRecords.find((r) => r.id === "TX-EQ-SHARED")!;
    expect(rec.amount).toBe(ils(60000));
    expect(rec.paid).toBe(ils(20000));
    expect(rec.allocations).toHaveLength(2);
    s = saveApprovedRule(s, { fromProposalId: p.id, validTo: "2026-12-31", confirmFutureMonthly: true });
    const rule = s.approvedRules[0];
    expect(rule.id).toBe("RULE-EQ-01");
    expect(rule.ratio).toEqual([{ projectId: "HAD", numerator: 2, denominator: 3 }, { projectId: "PAR", numerator: 1, denominator: 3 }]);
    expect(rule.applications[0].kind).toBe("origin");
  });
  it("accepts a custom 30,000/30,000 split written with commas and aliases", () => {
    let s = fixture("S05");
    const q = s.questions.find((x) => x.recordId === "TX-EQ-SHARED")!;
    s = sendQuestionBatch(reviewQuestion(s, q.id, R), [q.id]);
    s = recordClientReply(s, q.id, "30000 להדרים, 30000 לפארק");
    const p = pending(s, "allocation");
    s = approveProposal(s, p.id, R);
    expect(costLineView(s, "H40").incurred).toBe(ils(210000));
    expect(costLineView(s, "P40").incurred).toBe(ils(150000));
    expect(portfolioTotals(s).eac).toBe(ils(15104000));
  });
});

describe("S06 early alert and conditional price risk", () => {
  it("separates the 6,000 actual premium from the 144,000 conditional exposure and updates only through review", () => {
    let s = fixture("S06");
    const f = s.findings.find((x) => x.kind === "price_risk")!;
    expect(f.amounts.actualPremium).toBe(ils(6000));
    expect(f.amounts.futurePremium).toBe(ils(144000));
    expect(f.amounts.total).toBe(ils(150000));
    expect(f.explanationHe).toBe("נרכשו רק 20 מתוך 500 טון, במחיר גבוה ב-300 ₪ לטון מהתקציב. החריגה ברכישה שכבר בוצעה היא 6,000 ₪. אם גם 480 הטון שנותרו יירכשו ב-3,300 ₪ לטון, תתווסף חריגה של 144,000 ₪. החריגה הכוללת בסעיף תהיה 150,000 ₪.");
    expect(had(s).eac).toBe(ils(6106000));
    const alert = s.alerts.find((a) => a.kind === "early_alert")!;
    s = reviewAndReleaseAlert(s, alert.id, R);
    expect(s.reports.filter((r) => !r.seededHistory)).toHaveLength(0);
    const ceo = s.conversations.find((c) => c.contactId === "CEO" && c.channel === "whatsapp")!;
    expect(ceo.messages[0].actions?.map((a) => a.labelHe)).toEqual(["פתח את החישוב", "בדוק את הנחת המחיר"]);
    const q = s.questions.find((x) => x.id === alert.linkedQuestionId)!;
    expect(q.status).toBe("sent");
    expect(q.textHe).toBe("האם 3,300 ₪ לטון צפוי להיות המחיר גם ליתרת הרכישות, או שמדובר בהזמנה חריגה?");
    const again = reviewAndReleaseAlert(s, alert.id, R);
    expect(again.deliveries.length).toBe(s.deliveries.length);
    s = recordClientReply(s, q.id, "זה המחיר הצפוי גם בהמשך");
    expect(had(s).eac).toBe(ils(6106000));
    const p = pending(s, "forecast");
    s = approveProposal(s, p.id, R);
    expect(costLineView(s, "H10").uncommitted).toBe(ils(1584000));
    expect(costLineView(s, "H10").eac).toBe(ils(1650000));
    expect(costLineView(s, "H10").variance).toBe(ils(150000));
    expect(had(s).eac).toBe(ils(6250000));
    expect(s.findings.find((x) => x.id === f.id)!.status).toBe("resolved");
    expect(reportById(s, "RPT-HAD-2026-08-31")!.frozen.totals.eac).toBe(ils(6100000));
    const cmp = changeSinceLastReport(s, "HAD");
    expect(cmp.delta).toBe(ils(150000));
    expect(cmp.comparedToReportId).toBe("RPT-HAD-2026-08-31");
    const ops = s.conversations.find((c) => c.contactId === "OPS")!;
    expect(ops.messages.some((mm) => mm.kind === "update" && mm.textHe.includes("1,650,000"))).toBe(true);
  });
  it("supports 3,150 and one-off replies", () => {
    let s = fixture("S06");
    const alert = s.alerts.find((a) => a.kind === "early_alert")!;
    s = reviewAndReleaseAlert(s, alert.id, R);
    const q = s.questions.find((x) => x.id === alert.linkedQuestionId)!;
    let s2 = recordClientReply(s, q.id, "יש הערכה חדשה של 3,150 ₪ לטון");
    s2 = approveProposal(s2, pending(s2, "forecast").id, R);
    expect(costLineView(s2, "H10").uncommitted).toBe(ils(1512000));
    expect(had(s2).eac).toBe(ils(6178000));
    const s3 = recordClientReply(s, q.id, "זו רכישה חד-פעמית; היתרה צפויה ב-3,000 ₪");
    expect(had(s3).eac).toBe(ils(6106000));
    expect(s3.findings.find((x) => x.kind === "price_risk")!.status).toBe("resolved");
    const s4 = recordClientReply(s, q.id, "עדיין לא ידוע");
    expect(s4.questions.find((x) => x.id === q.id)!.status).toBe("open");
    expect(s4.findings.find((x) => x.kind === "price_risk")!.status).not.toBe("resolved");
  });
  it("locked fixed-price order removes 200 tons from exposure and updates the finding", () => {
    let s = fixture("S06");
    s = runEvent(s, "S06", "S06-LOCKED");
    const p = pending(s, "commitment");
    s = approveProposal(s, p.id, R);
    s = runPendingAnalyses(s);
    const line = costLineView(s, "H10");
    expect(line.commitments).toBe(ils(600000));
    expect(line.uncommitted).toBe(ils(840000));
    expect(line.eac).toBe(ils(1506000));
    const risks = s.findings.filter((f) => f.kind === "price_risk");
    expect(risks.some((f) => f.status === "superseded")).toBe(true);
    const active = risks.find((f) => !["superseded", "resolved"].includes(f.status))!;
    expect(active.amounts.futurePremium).toBe(ils(84000));
    expect(active.amounts.total).toBe(ils(90000));
    expect(active.numbers.remaining).toBe(280);
    const alert = s.alerts.find((a) => a.findingId === active.id)!;
    s = reviewAndReleaseAlert(s, alert.id, R);
    const q = s.questions.find((x) => x.id === alert.linkedQuestionId)!;
    s = recordClientReply(s, q.id, "זה המחיר הצפוי גם בהמשך");
    s = approveProposal(s, pending(s, "forecast").id, R);
    expect(costLineView(s, "H10").uncommitted).toBe(ils(924000));
    expect(costLineView(s, "H10").eac).toBe(ils(1590000));
    expect(had(s).eac).toBe(ils(6190000));
  });
  it("the what-if panel drives the same calculation and an experiment edit replaces the purchase projection", () => {
    let s = fixture("S06");
    s = setCandidateFuturePrice(s, ils(3300));
    const w = steelWhatIf(s, ils(3300));
    expect(w.actualPriceVariance).toBe(ils(6000));
    expect(w.conditionalFutureVariance).toBe(ils(144000));
    expect(w.candidateSteelEac).toBe(ils(1650000));
    expect(() => setCandidateFuturePrice(s, -5)).toThrow();
    expect(() => updateSteelExperiment(s, { purchasedQuantity: 600, purchaseUnitPrice: ils(3300) })).toThrow();
    s = updateSteelExperiment(s, { purchasedQuantity: 50, purchaseUnitPrice: ils(3200) });
    s = runPendingAnalyses(s);
    const rec = s.erpRecords.find((r) => r.id === "TX-H-STEEL")!;
    expect(rec.amount).toBe(ils(160000));
    expect(s.erpRecords.filter((r) => r.kind === "invoice" && r.allocations[0].costCodeId === "H10")).toHaveLength(1);
    expect(costLineView(s, "H10").uncommitted).toBe(ils(1350000));
    expect(s.documents.filter((d) => d.id === "INV-H-STEEL-001")).toHaveLength(2);
    const risk = s.findings.find((f) => f.kind === "price_risk" && !["superseded"].includes(f.status))!;
    expect(risk.amounts.actualPremium).toBe(ils(10000));
    expect(risk.amounts.futurePremium).toBe(ils(90000));
  });
});

describe("S07 natural-language questions", () => {
  it("answers the required baseline questions with evidence", () => {
    let s = fixture("S07");
    s = askQuestion(s, "כמה הוצאנו על ברזל בהדרים?");
    expect(lastAssistant(s)).toContain("66,000 ₪");
    expect(lastAssistant(s)).toContain("20 טון");
    s = askQuestion(s, "כמה שילמנו בפועל על הברזל?");
    expect(lastAssistant(s)).toContain("שולם בפועל 0 ₪");
    s = askQuestion(s, "כמה צפוי לעלות הברזל בסוף?");
    expect(lastAssistant(s)).toContain("1,506,000 ₪");
    s = askQuestion(s, "איפה החריגה הכי גדולה בפרויקט?");
    expect(lastAssistant(s)).toContain("ברזל");
    expect(lastAssistant(s)).toContain("6,000 ₪");
    s = askQuestion(s, "מה השתנה מאז הדוח האחרון?");
    expect(lastAssistant(s)).toContain("RPT-HAD-2026-08-31");
    expect(lastAssistant(s)).toContain("עלתה ב-6,000 ₪");
    s = askQuestion(s, "כמה נשאר לשלם לקבלן השלד?");
    expect(lastAssistant(s)).toContain("850,000 ₪");
    expect(lastAssistant(s)).toContain("50,000 ₪");
    expect(lastAssistant(s)).toContain("800,000 ₪");
    s = askQuestion(s, "כמה התחייבויות עוד פתוחות בהדרים?");
    expect(lastAssistant(s)).toContain("1,830,000 ₪");
    s = askQuestion(s, "כמה ברזל הוצאנו בכל החברה?");
    expect(lastAssistant(s)).toBe("בפרויקטים שבהם קיים פירוט ברזל נצברו 124,000 ₪: 66,000 ₪ בהדרים ו-58,000 ₪ בפארק. בגני השקד ובמרכז הים יש בדמו נתונים מצרפיים בלבד, ולכן זה אינו סך הברזל המלא של החברה.");
    s = askQuestion(s, "על סמך מה תיקנתם את הכמות?");
    expect(lastAssistant(s)).toContain("לא בוצע תיקון");
    s = askQuestion(s, "מה מזג האוויר?");
    expect(lastAssistant(s)).toContain("בדמו אפשר לשאול על הוצאות");
    s = askQuestion(s, "כמה עבודה נשארה בשטח?");
    expect(lastAssistant(s)).toContain("אין במסמכים שבדמו אישור");
    s = askQuestion(s, "כמה הוצאנו על ברזל בהדרים ובפארק?");
    expect(lastAssistant(s)).toBe("לאיזה פרויקט התכוונת?");
    const answer = s.chat.messages.filter((m) => m.role === "assistant")[0].answer!;
    expect(answer.evidence.length).toBeGreaterThan(0);
  });
  it("changes with the data and stays frozen for a report scope", () => {
    let s = completeS06(fixture("S06"));
    s = askQuestion(s, "כמה צפוי לעלות הברזל בסוף?");
    expect(lastAssistant(s)).toContain("1,650,000 ₪");
    expect(lastAssistant(s)).toContain("150,000 ₪");
    s = askQuestion(s, "מה השתנה מאז הדוח האחרון?");
    expect(lastAssistant(s)).toContain("150,000 ₪");
    s = askQuestion(s, "כמה צפוי לעלות הברזל?", { reportId: "RPT-HAD-2026-08-31", projectId: "HAD" });
    expect(lastAssistant(s)).toContain("1,500,000 ₪");
    const ans = s.chat.messages[s.chat.messages.length - 1].answer!;
    expect(ans.evidence.some((e) => e.documentId === "INV-H-STEEL-001")).toBe(false);
    expect(ans.actions.some((a) => a.labelHe === "הצג נתונים עדכניים")).toBe(true);
    s = runEvent(runPendingAnalyses(fixture("S04")), "S04", "S04-SAVE");
    s = approveProposal(s, pending(s, "erp_correction").id, R);
    s = askQuestion(s, "על סמך מה תיקנתם את הכמות?");
    expect(lastAssistant(s)).toContain("תוקנה מ-200 ל-20 טון");
  });
});

describe("S08 commitments before invoices", () => {
  it("adds the signed addendum once and flags the overrun", () => {
    let s = runEvent(fixture("S08"), "S08", "S08-INTAKE");
    const f = s.findings.find((x) => x.kind === "commitment_overrun")!;
    expect(f.explanationHe).toBe("עד כה נצברו 200,000 ₪ בלבד, אבל לאחר התוספת החתומה נותרו התחייבויות של 900,000 ₪. העלות הידועה לפי ההסכמים היא כבר 1,100,000 ₪ — לפחות 100,000 ₪ מעל תקציב הסעיף, עוד לפני חשבוניות נוספות.");
    s = approveProposal(s, pending(s, "commitment").id, R);
    const line = costLineView(s, "H30");
    expect(line.commitments).toBe(ils(900000));
    expect(line.eac).toBe(ils(1100000));
    expect(line.incurred).toBe(ils(200000));
    expect(line.paid).toBe(ils(150000));
    expect(line.budget).toBe(ils(1000000));
    expect(had(s).eac).toBe(ils(6206000));
    expect(s.commitments.find((c) => c.id === "CT-H-FRAME")!.value).toBe(ils(1100000));
  });
  it("an unsigned draft stays a conditional risk", () => {
    const s = runEvent(fixture("S08"), "S08", "S08-DRAFT");
    expect(s.findings.some((f) => f.kind === "commitment_conditional" && f.status === "conditional")).toBe(true);
    expect(costLineView(s, "H30").commitments).toBe(ils(800000));
  });
});

describe("S09 cumulative certificate", () => {
  it("corrects the period amount to 80,000 and keeps the contract EAC", () => {
    let s = fixture("S09");
    expect(costLineView(s, "H30").incurred).toBe(ils(220000));
    expect(costLineView(s, "H30").commitments).toBe(ils(780000));
    expect(reportById(s, "RPT-HAD-2026-08-31")!.frozen.lines.find((l) => l.costCodeId === "H30")!.incurred).toBe(ils(220000));
    expect(reportById(s, "RPT-HAD-2026-08-31")!.frozen.lines.find((l) => l.costCodeId === "H30")!.paid).toBe(ils(220000));
    s = runEvent(s, "S09", "S09-RECEIVE");
    expect(costLineView(s, "H30").incurred).toBe(ils(520000));
    expect(costLineView(s, "H30").commitments).toBe(ils(480000));
    expect(costLineView(s, "H30").eac).toBe(ils(1000000));
    expect(costLineView(s, "H30").provisional).toBe(true);
    const f = s.findings.find((x) => x.kind === "cumulative_duplicate")!;
    expect(f.explanationHe).toBe("בחשבון הנוכחי אושר מצטבר של 300,000 ₪, אך 220,000 ₪ כבר הוכרו בחשבון הקודם. התוספת לתקופה היא 80,000 ₪. קליטה של 300,000 ₪ נוספים תחזור על 220,000 ₪ שכבר נרשמו.");
    s = approveProposal(s, pending(s, "erp_correction").id, R);
    const line = costLineView(s, "H30");
    expect(line.incurred).toBe(ils(300000));
    expect(line.commitments).toBe(ils(700000));
    expect(line.eac).toBe(ils(1000000));
    expect(had(s).eac).toBe(ils(6106000));
    const rec = s.erpRecords.find((r) => r.id === "TX-H-FRAME-CURRENT")!;
    expect(rec.amount).toBe(ils(80000));
    expect(rec.paid).toBe(0);
    expect(rec.priorRecordId).toBe("TX-H-FRAME-PREV");
    expect(s.documents.find((d) => d.id === "CERT-H-FRAME-CURRENT")!.facts.cumulativeApproved).toBe(ils(300000));
    const dup = runEvent(s, "S09", "S09-DUPLICATE");
    expect(dup.erpRecords.some((r) => r.id === "TX-H-FRAME-CURRENT-DUP")).toBe(false);
    expect(dup.activity[dup.activity.length - 1].textHe).toContain("כבר נקלט");
  });
  it("finds the prior certificate before asking, and asks only when history is really missing", () => {
    let s = runEvent(fixture("S09"), "S09", "S09-NOLINK");
    const p = pending(s, "erp_correction");
    expect(p.payload.kind === "erp_correction" && p.payload.changes.priorRecordId).toBe("TX-H-FRAME-PREV");
    expect(s.questions.length).toBe(fixture("S09").questions.length);
    s = runEvent(fixture("S09"), "S09", "S09-NOHISTORY");
    expect(s.findings.some((f) => f.kind === "missing_link" && f.status === "needs_clarification")).toBe(true);
    expect(s.questions.some((q) => q.textHe.includes("חשבון קודם"))).toBe(true);
  });
  it("a rejected proposal leaves the raw entry flagged", () => {
    let s = runEvent(fixture("S09"), "S09", "S09-RECEIVE");
    s = rejectProposal(s, pending(s, "erp_correction").id, "לבדיקה", R);
    expect(s.erpRecords.find((r) => r.id === "TX-H-FRAME-CURRENT")!.checkStatus).toBe("flagged");
    expect(costLineView(s, "H30").incurred).toBe(ils(520000));
  });
});

describe("S10 unbilled approved work", () => {
  it("recognizes the accrual without changing EAC, then replaces it with the invoice", () => {
    let s = runEvent(fixture("S10"), "S10", "S10-CERT");
    const f = s.findings.find((x) => x.kind === "unbilled_work")!;
    expect(f.explanationHe).toBe("נרשמו עד כה חשבוניות בסך 100,000 ₪, אבל יש גם עבודה מאושרת בסך 80,000 ₪ שטרם חויבה. לכן העלות שנצברה היא 180,000 ₪. העבודה כבר נכללה בהתחייבות החוזית, ולכן תחזית העלות הכוללת אינה גדלה.");
    s = approveProposal(s, pending(s, "accrual").id, R);
    let line = costLineView(s, "H50");
    expect(line.incurredInvoiced).toBe(ils(100000));
    expect(line.incurredAccrued).toBe(ils(80000));
    expect(line.incurred).toBe(ils(180000));
    expect(line.commitments).toBe(ils(170000));
    expect(line.uncommitted).toBe(ils(50000));
    expect(line.eac).toBe(ils(400000));
    expect(line.paid).toBe(ils(80000));
    expect(had(s).eac).toBe(ils(6106000));
    const pay = contractRemainingPayment(s, "CT-H-WATER");
    expect(pay.unpaidRecognized).toBe(ils(20000));
    expect(pay.unbilledRecognized).toBe(ils(80000));
    expect(pay.remainingCommitment).toBe(ils(170000));
    expect(pay.total).toBe(ils(270000));
    expect(line.eac - line.paid).toBe(ils(320000));
    s = runEvent(s, "S10", "S10-INVOICE");
    s = approveProposal(s, pending(s, "invoice_match").id, R);
    line = costLineView(s, "H50");
    expect(line.incurredInvoiced).toBe(ils(180000));
    expect(line.incurredAccrued).toBe(0);
    expect(line.incurred).toBe(ils(180000));
    expect(line.commitments).toBe(ils(170000));
    expect(line.eac).toBe(ils(400000));
  });
  it("unapproved or additional-scope certificates do not consume the contract", () => {
    const s1 = runEvent(fixture("S10"), "S10", "S10-UNAPPROVED");
    expect(s1.proposals.find((p) => p.kind === "accrual")!.status).toBe("needs_clarification");
    expect(costLineView(s1, "H50").incurred).toBe(ils(100000));
    const s2 = runEvent(fixture("S10"), "S10", "S10-SCOPE");
    expect(s2.findings.find((f) => f.kind === "unbilled_work")!.explanationHe).toContain("הוראת שינוי");
    expect(s2.proposals.filter((p) => p.kind === "accrual")).toHaveLength(0);
  });
});

describe("S11 quantity overrun with a correct unit price", () => {
  it("corrects the posting to the single 48,000 invoice after the site reply", () => {
    let s = fixture("S11");
    expect(s.documents.some((d) => d.id === "INV-H-CONC-001")).toBe(false);
    const prior = reportById(s, "RPT-HAD-2026-08-31")!;
    expect(prior.frozen.qualificationsHe.some((q) => q.includes("TX-H-SLAB"))).toBe(true);
    s = runEvent(s, "S11", "S11-RECEIVE");
    expect(reportById(s, "RPT-HAD-2026-08-31")!.frozen.availableDocumentIds).not.toContain("INV-H-SLAB-120");
    const amountFinding = s.findings.find((x) => x.kind === "amount_correction")!;
    expect(amountFinding.blocksReport).toBe(true);
    const varianceFinding = s.findings.find((x) => x.kind === "quantity_variance")!;
    expect(varianceFinding.numbers.variancePercent).toBe(20);
    const q = s.questions.find((x) => x.findingId === varianceFinding.id)!;
    expect(q.textHe).toBe("לתקרה A תוכננו 100 מ״ק וסופקו 120 מ״ק. האם הכמות הנוספת נדרשה לאותה יציקה, הוחזרה לספק, או שייכת לתכולה אחרת?");
    s = sendQuestionBatch(reviewQuestion(s, q.id, R), [q.id]);
    s = recordClientReply(s, q.id, "כל 120 המ״ק שימשו לאותה יציקה. אין החזרה ואין שינוי מאושר בתכולה.");
    s = approveProposal(s, pending(s, "erp_correction").id, R);
    const line = costLineView(s, "H20");
    expect(line.incurred).toBe(ils(408000));
    expect(line.commitments).toBe(ils(200000));
    expect(line.uncommitted).toBe(ils(400000));
    expect(line.eac).toBe(ils(1008000));
    expect(had(s).eac).toBe(ils(6114000));
    expect(s.erpRecords.filter((r) => r.allocations[0].costCodeId === "H20" && r.kind === "invoice")).toHaveLength(1);
    expect(s.documents.find((d) => d.id === "INV-H-SLAB-120")!.facts.amount).toBe(ils(48000));
  });
  it("a returned quantity holds the adjustment pending evidence", () => {
    let s = runEvent(fixture("S11"), "S11", "S11-RECEIVE");
    const q = s.questions.find((x) => x.parser === "quantity_reason")!;
    s = sendQuestionBatch(reviewQuestion(s, q.id, R), [q.id]);
    s = recordClientReply(s, q.id, "20 מ״ק הוחזרו");
    expect(s.proposals.find((p) => p.kind === "erp_correction")!.status).toBe("needs_clarification");
    expect(costLineView(s, "H20").incurred).toBe(ils(400000));
  });
});

describe("S12 charge outside contract terms", () => {
  it("flags, requests a credit, and removes the cost only after the approved credit", () => {
    let s = fixture("S12");
    expect(costLineView(s, "H20").incurred).toBe(ils(402000));
    expect(had(s).eac).toBe(ils(6108000));
    const f = s.findings.find((x) => x.kind === "contract_charge")!;
    expect(f.explanationHe).toBe("חויבו 2,000 ₪ בנפרד עבור הובלה. לפי סעיף ההובלה בחוזה, הובלה רגילה לאתר כלולה במחיר. לא נמצאה תוספת מאושרת לחיוב הזה. מוצע לברר את החיוב ולבקש זיכוי.");
    expect(s.tasks.some((t) => t.kind === "credit_request")).toBe(true);
    expect(s.questions.some((q) => q.findingId === f.id)).toBe(false);
    s = runEvent(s, "S12", "S12-CREDIT");
    s = approveProposal(s, pending(s, "credit").id, R);
    expect(costLineView(s, "H20").incurred).toBe(ils(400000));
    expect(had(s).eac).toBe(ils(6106000));
    expect(s.erpRecords.some((r) => r.id === "TX-H-FREIGHT-002")).toBe(true);
    expect(s.erpRecords.some((r) => r.kind === "credit")).toBe(true);
    expect(s.tasks.find((t) => t.kind === "credit_request")!.status).toBe("done");
  });
  it("a valid addendum closes the flag while keeping the cost", () => {
    let s = runEvent(fixture("S12"), "S12", "S12-ADDENDUM");
    s = approveProposal(s, pending(s, "dismiss_flag").id, R);
    expect(costLineView(s, "H20").incurred).toBe(ils(402000));
    expect(s.findings.filter((f) => f.kind === "contract_charge").every((f) => ["dismissed", "superseded"].includes(f.status))).toBe(true);
  });
});

describe("S13 change order", () => {
  it("adds the commitment once and keeps recovery separate", () => {
    let s = runEvent(fixture("S13"), "S13", "S13-CO");
    expect(s.findings.find((x) => x.kind === "scope_change")!.explanationHe).toBe("אושרה תוספת עבודה בעלות 80,000 ₪ שטרם נכללה בתחזית. צריך להוסיף אותה לעלות הצפויה. דרישת ההחזר מהלקוח עדיין ממתינה לאישור, ולכן מוצגת בנפרד ואינה מקטינה את תחזית העלות.");
    s = approveProposal(s, pending(s, "commitment").id, R);
    const line = costLineView(s, "H50");
    expect(line.commitments).toBe(ils(330000));
    expect(line.incurred).toBe(ils(100000));
    expect(line.uncommitted).toBe(ils(50000));
    expect(line.eac).toBe(ils(480000));
    expect(line.budget).toBe(ils(400000));
    expect(had(s).eac).toBe(ils(6186000));
    expect(s.recoveries[0]).toMatchObject({ amount: ils(80000), status: "pending_customer_approval" });
  });
  it("internally approved scope goes to R; proposed scope stays conditional", () => {
    let s = runEvent(fixture("S13"), "S13", "S13-INTERNAL");
    s = approveProposal(s, pending(s, "forecast").id, R);
    expect(costLineView(s, "H50").commitments).toBe(ils(250000));
    expect(costLineView(s, "H50").uncommitted).toBe(ils(130000));
    expect(costLineView(s, "H50").eac).toBe(ils(480000));
    const s2 = runEvent(fixture("S13"), "S13", "S13-PROPOSED");
    expect(costLineView(s2, "H50").eac).toBe(ils(400000));
    expect(s2.findings.some((f) => f.status === "conditional")).toBe(true);
  });
});

describe("S14 schedule delay", () => {
  it("extends the site by two months after confirmation", () => {
    let s = requestDurationChange(fixture("S14"), "HAD", 14);
    const q = s.questions.find((x) => x.parser === "duration")!;
    expect(q.textHe).toBe("האם העיכוב מאריך את פעילות האתר בשני חודשים מלאים, והאם צוות האתר, השכירות, האבטחה והשירותים יידרשו לכל התקופה הנוספת?");
    s = sendQuestionBatch(reviewQuestion(s, q.id, R), [q.id]);
    s = recordClientReply(s, q.id, "כן. האתר יפעל עד 30/04/2027, וכל העלויות האלה יימשכו בשני החודשים הנוספים.");
    expect(s.documents.some((d) => d.id === "SCHEDULE-H-14")).toBe(true);
    const p = pending(s, "duration");
    expect(p.payload.kind === "duration" && p.payload.extraAmount).toBe(ils(100000));
    s = approveProposal(s, p.id, R);
    const line = costLineView(s, "H70");
    expect(line.uncommitted).toBe(ils(300000));
    expect(line.eac).toBe(ils(700000));
    expect(line.budget).toBe(ils(600000));
    expect(had(s).eac).toBe(ils(6206000));
    const project = s.projects.find((x) => x.id === "HAD")!;
    expect(project.acceptedFinish).toBe("2027-04-30");
    expect(project.plannedFinish).toBe("2027-02-28");
    expect(s.erpRecords.length).toBe(fixture("S14").erpRecords.length);
  });
  it("custom durations and components compute from the chosen values; milestone-only adds nothing", () => {
    let s = requestDurationChange(fixture("S14"), "HAD", 13, ["team", "rent"]);
    const q = s.questions.find((x) => x.parser === "duration")!;
    s = sendQuestionBatch(reviewQuestion(s, q.id, R), [q.id]);
    s = recordClientReply(s, q.id, q.suggestedReplies[0].textHe);
    expect(s.documents.some((d) => d.id === "SCHEDULE-HAD-13-CUSTOM")).toBe(true);
    const p = pending(s, "duration");
    expect(p.payload.kind === "duration" && p.payload.extraAmount).toBe(ils(35000));
    s = approveProposal(s, p.id, R);
    expect(s.projects.find((x) => x.id === "HAD")!.acceptedFinish).toBe("2027-03-31");
    let s2 = requestDurationChange(fixture("S14"), "HAD", 14);
    const q2 = s2.questions.find((x) => x.parser === "duration")!;
    s2 = sendQuestionBatch(reviewQuestion(s2, q2.id, R), [q2.id]);
    s2 = recordClientReply(s2, q2.id, "לא, רק אבן דרך זזה; משך האתר הכולל נשאר");
    expect(costLineView(s2, "H70").eac).toBe(ils(600000));
    expect(s2.proposals.filter((p) => p.kind === "duration")).toHaveLength(0);
  });
});

describe("S15 approved-rule reuse", () => {
  it("splits the next month's invoice by the rule and consumes the September forecast items", () => {
    let s = fixture("S15");
    expect(s.clock.startsWith("2026-10-01")).toBe(true);
    expect(costLineView(s, "H40").incurred).toBe(ils(220000));
    expect(costLineView(s, "H40").uncommitted).toBe(ils(180000));
    expect(costLineView(s, "P40").incurred).toBe(ils(140000));
    expect(costLineView(s, "P40").uncommitted).toBe(ils(160000));
    const questionsBefore = s.questions.length;
    s = runEvent(s, "S15", "S15-INVOICE");
    const f = s.findings.find((x) => x.kind === "rule_reuse")!;
    expect(f.explanationHe).toBe("נמצאה הנחיה מאושרת לאותה מסגרת ולאותם אתרים: שני שלישים למגורי הדרים ושליש למתחם הפארק. החשבונית החדשה תואמת לתנאי הכלל. מוצע להשתמש בחלוקה המאושרת, ללא בירור נוסף עם מאיה לוי.");
    expect(s.questions.length).toBe(questionsBefore);
    const p = pending(s, "allocation");
    s = approveProposal(s, p.id, R);
    expect(costLineView(s, "H40").incurred).toBe(ils(260000));
    expect(costLineView(s, "H40").uncommitted).toBe(ils(140000));
    expect(costLineView(s, "P40").incurred).toBe(ils(160000));
    expect(costLineView(s, "P40").uncommitted).toBe(ils(140000));
    expect(costLineView(s, "H40").commitments).toBe(ils(180000));
    expect(costLineView(s, "H40").paid).toBe(19333333);
    expect(had(s).eac).toBe(ils(6086000));
    expect(par(s).eac).toBe(ils(4018000));
    const rule = s.approvedRules[0];
    expect(rule.applications.map((a) => a.kind)).toEqual(["origin", "reuse"]);
    expect(rule.applications[1].noteHe).toContain("לא נשלחה שאלה נוספת");
  });
  it("a custom 30,000/30,000 actual split keeps the fulfilled forecast items", () => {
    let s = runEvent(fixture("S15"), "S15", "S15-INVOICE");
    const p = pending(s, "allocation");
    expect(() => setProposalAllocation(s, p.id, { HAD: ils(45000), PAR: ils(20000) })).toThrow();
    s = setProposalAllocation(s, p.id, { HAD: ils(30000), PAR: ils(30000) });
    s = approveProposal(s, p.id, R);
    expect(had(s).eac).toBe(ils(6076000));
    expect(par(s).eac).toBe(ils(4028000));
    expect(portfolioTotals(s).eac).toBe(ils(15104000));
  });
  it("another framework, an extra site, or an expired rule prevents reuse", () => {
    const other = runEvent(fixture("S15"), "S15", "S15-OTHER");
    expect(other.findings.some((f) => f.kind === "missing_allocation" && f.recordIds.includes("TX-EQ-002-FW2"))).toBe(true);
    expect(other.findings.some((f) => f.kind === "rule_reuse" && f.recordIds.includes("TX-EQ-002-FW2"))).toBe(false);
    const extra = runEvent(fixture("S15"), "S15", "S15-EXTRA-SITE");
    expect(extra.findings.some((f) => f.kind === "missing_allocation" && f.recordIds.includes("TX-EQ-002-EXT"))).toBe(true);
    const expired = runEvent(fixture("S15"), "S15", "S15-EXPIRED");
    expect(expired.findings.some((f) => f.kind === "missing_allocation" && f.recordIds.includes("TX-EQ-002-EXPIRED"))).toBe(true);
    expect(expired.findings.find((f) => f.kind === "missing_allocation" && f.recordIds.includes("TX-EQ-002-EXPIRED"))!.checkedHe.some((c) => c.includes("לא נעשה בו שימוש"))).toBe(true);
  });
});

describe("S16 cross-project opportunity", () => {
  it("shows the historical opportunity, then accepts a valid new quote", () => {
    let s = fixture("S16");
    expect(had(s).eac).toBe(ils(6250000));
    s = runEvent(s, "S16", "S16-COMPARE");
    const f = s.findings.find((x) => x.kind === "cross_project_opportunity")!;
    expect(f.amounts.opportunity).toBe(ils(192000));
    expect(f.explanationHe).toBe("במתחם הפארק נרכש ברזל מאותו מפרט ב-2,900 ₪ לטון. זו רכישה קודמת, ולכן המחיר והזמינות ליתרת הדרים דורשים בדיקה. מול הנחת התחזית של 3,300 ₪, פער של 400 ₪ על 480 טון משקף הזדמנות אפשרית של 192,000 ₪.");
    expect(had(s).eac).toBe(ils(6250000));
    s = runEvent(s, "S16", "S16-QUOTE");
    const p = pending(s, "forecast");
    s = approveProposal(s, p.id, R);
    const line = costLineView(s, "H10");
    expect(line.uncommitted).toBe(ils(1488000));
    expect(line.eac).toBe(ils(1554000));
    expect(line.variance).toBe(ils(54000));
    expect(line.commitments).toBe(0);
    expect(had(s).eac).toBe(ils(6154000));
    // expiring the quote later flags revalidation without reverting
    s = advanceDemoClock(s, 30);
    expect(costLineView(s, "H10").uncommitted).toBe(ils(1488000));
    expect(costLineView(s, "H10").needsRevalidation).toBe(true);
  });
  it("incomparable or expired quotes cannot become a forecast basis", () => {
    const nf = runEvent(fixture("S16"), "S16", "S16-NOFREIGHT");
    expect(nf.proposals.filter((p) => p.kind === "forecast" && p.status === "pending_review")).toHaveLength(0);
    expect(nf.findings.some((f) => f.titleHe.includes("ללא רכיב הובלה"))).toBe(true);
    const ex = runEvent(fixture("S16"), "S16", "S16-EXPIRED");
    expect(ex.proposals.filter((p) => p.kind === "forecast" && p.status === "pending_review")).toHaveLength(0);
    expect(had(ex).eac).toBe(ils(6250000));
  });
});

describe("fixture isolation and history", () => {
  it("independent fixtures do not leak scenario documents", () => {
    const s4 = fixture("S04");
    for (const id of ["CREDIT-H-FREIGHT-002", "QUOTE-H-STEEL-3100", "DN-H-STEEL-018", "CO-H-WATER-080", "SCHEDULE-H-14"]) expect(s4.documents.some((d) => d.id === id)).toBe(false);
    expect(s4.questions.every((q) => !q.replyMessageId)).toBe(true);
    const s15 = fixture("S15");
    expect(s15.activity.some((a) => a.textHe.includes("היסטוריה שנטענה מראש"))).toBe(true);
    expect(fixture("S06").approvedRules).toHaveLength(0);
    expect(completeS05(fixture("S05")).approvedRules).toHaveLength(1);
  });
});
