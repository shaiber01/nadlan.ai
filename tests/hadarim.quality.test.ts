import { describe, expect, it } from "vitest";
import { checkContractOverrun, checkCumulative, checkDates, checkDuplicates, checkRetention, checkReviewAging, runChecks } from "../src/hadarim/engine/checks";
import { createInvoice, decide, initialState, pkg, reviewFindings, revealAllSteps, startControl, updateInvoiceSection } from "../src/hadarim/engine/commands";
import type { V2State } from "../src/hadarim/engine/model";
import { answerQuestion, askPerson } from "../src/hadarim/engine/operations";
import { buildReport } from "../src/hadarim/engine/report";
import { installScenario } from "./fixtures/scenario";

// the seed is clean: the scripted walkthrough below needs its three errors, and the revised BOQ page
// already read, the way the agent would before this control runs
installScenario({ processedBoqRevision: true });

/**
 * Data-quality checks: the record itself is inconsistent. Each case breaks one thing in a copy of the seed
 * and expects exactly that finding; the clean seed produces none. Then the decision flow shared by these
 * cards, questions to people, and the report's "open findings" block.
 */

const withInvoice = (s: V2State, patch: (i: V2State["erp"]["invoices"][number]) => V2State["erp"]["invoices"][number], pick: (i: V2State["erp"]["invoices"][number]) => boolean): V2State => {
  const target = s.erp.invoices.find(pick)!;
  return { ...s, erp: { ...s.erp, invoices: s.erp.invoices.map((i) => (i.id === target.id ? patch(i) : i)) } };
};

describe("data-quality checks", () => {
  it("the clean seed raises none of them", () => {
    const seed = initialState();
    const draft = pkg.forecasts.find((f) => f.controlDate === seed.control.controlDate)!;
    const { findings } = runChecks(pkg, seed.erp, draft, seed.control.controlDate, "2026-09-03");
    expect(findings.map((f) => f.kind).sort()).toEqual(["coverage", "price", "unit"]);
  });

  it("a second invoice with the same supplier document number is a duplicate finding", () => {
    const seed = initialState();
    const original = seed.erp.invoices.find((i) => i.contractId && i.status === "אושר")!;
    const [s, dup] = createInvoice(seed, { supplierId: original.supplierId, supplierDocNo: original.supplierDocNo, date: original.date, amount: original.amount, descriptionHe: original.descriptionHe, sectionId: original.sectionId, contractId: original.contractId, attachmentId: null, byId: "SARIT" });
    const findings = checkDuplicates(pkg, s.erp);
    expect(findings.map((f) => f.id)).toEqual([`F-DUP-${dup.id}`]);
    expect(findings[0].problemHe).toContain(`חשבון ${original.id}`);
    expect(findings[0].impact.amount).toBe(-original.amount);
    expect(findings[0].decision.options.map((o) => o.id)).toEqual(["refer", "accept"]);
  });

  it("approved invoices above a contract's amount are a contract overrun", () => {
    const seed = initialState();
    const contract = pkg.contracts.find((c) => c.amount != null && !c.closed)!;
    const recorded = seed.erp.invoices.filter((i) => i.contractId === contract.id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
    const over = contract.amount! - recorded + 12_345;
    const [s] = createInvoice(seed, { supplierId: contract.supplierId, supplierDocNo: "OVER-1", date: "2026-08-28", amount: over, descriptionHe: "חשבון חלקי", sectionId: contract.sectionId, contractId: contract.id, attachmentId: null, byId: "SARIT" });
    const findings = checkContractOverrun(pkg, s.erp);
    expect(findings.map((f) => f.id)).toEqual([`F-OVER-${contract.id}`]);
    expect(findings[0].impact.amount).toBe(12_345);
    expect(findings[0].decision.options.map((o) => o.id)).toEqual(["change_order", "refer", "accept"]);
  });

  it("a cumulative that does not add up, or does not chain from the previous invoice, is flagged", () => {
    const seed = initialState();
    const broken = withInvoice(seed, (i) => ({ ...i, cumulativeNow: (i.cumulativeNow ?? 0) + 1000 }), (i) => i.cumulativeNow != null && i.cumulativePrev != null);
    const findings = checkCumulative(pkg, broken.erp);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].kind).toBe("cumulative");
    expect(findings[0].problemHe).toContain("מצטבר");
  });

  it("retention arithmetic and a rate different from the contract are flagged", () => {
    const seed = initialState();
    const arithmetic = withInvoice(seed, (i) => ({ ...i, retentionAmt: i.retentionAmt + 7 }), (i) => i.retentionPct > 0);
    expect(checkRetention(pkg, arithmetic.erp).map((f) => f.kind)).toEqual(["retention"]);
    const rate = withInvoice(seed, (i) => ({ ...i, retentionPct: i.retentionPct + 1, retentionAmt: Math.round((i.amount * (i.retentionPct + 1)) / 100), netPayable: i.amount - Math.round((i.amount * (i.retentionPct + 1)) / 100) }), (i) => !!i.contractId && i.docType === "חשבון חלקי");
    const f = checkRetention(pkg, rate.erp);
    expect(f).toHaveLength(1);
    expect(f[0].titleHe).toContain("שיעור עכבון שונה מהחוזה");
  });

  it("dates: received before issued, or in the future", () => {
    const seed = initialState();
    const before = withInvoice(seed, (i) => ({ ...i, dateReceived: "2026-01-01" }), (i) => i.status === "אושר");
    expect(checkDates(pkg, before.erp, "2026-09-03").map((f) => f.titleHe)).toEqual([expect.stringContaining("התקבל לפני תאריך המסמך")]);
    const future = withInvoice(seed, (i) => ({ ...i, date: "2026-12-01", dateReceived: "2026-12-01" }), (i) => i.status === "אושר");
    expect(checkDates(pkg, future.erp, "2026-09-03").map((f) => f.titleHe)).toEqual([expect.stringContaining("תאריך עתידי")]);
  });

  it("an invoice left in review beyond the project's policy is flagged, with the policy's number of days", () => {
    const seed = initialState();
    const old = withInvoice(seed, (i) => ({ ...i, dateReceived: "2026-07-01" }), (i) => i.status === "בבדיקה");
    const findings = checkReviewAging(pkg, old.erp, seed.control.controlDate);
    expect(findings).toHaveLength(1);
    expect(findings[0].problemHe).toContain(`מעל ${pkg.project.checkPolicy.reviewAgingDays} הימים`);
    const lenient = { ...pkg, project: { ...pkg.project, checkPolicy: { reviewAgingDays: 90 } } };
    expect(checkReviewAging(lenient, old.erp, seed.control.controlDate)).toHaveLength(0);
  });
});

describe("deciding on data-quality cards", () => {
  function controlWithDuplicate(): { state: V2State; findingId: string } {
    const seed = initialState();
    const original = seed.erp.invoices.find((i) => i.contractId && i.status === "אושר")!;
    const [s, dup] = createInvoice(seed, { supplierId: original.supplierId, supplierDocNo: original.supplierDocNo, date: original.date, amount: original.amount, descriptionHe: original.descriptionHe, sectionId: original.sectionId, contractId: original.contractId, attachmentId: null, byId: "SARIT" });
    const state = reviewFindings(revealAllSteps(startControl(s, "בקרה")));
    return { state, findingId: `F-DUP-${dup.id}` };
  }

  it("'refer' opens a pending task for bookkeeping and leaves the finding pending execution", () => {
    const { state, findingId } = controlWithDuplicate();
    expect(state.control.findings.some((f) => f.id === findingId)).toBe(true);
    const s = decide(state, findingId, "refer");
    expect(s.control.decisions[findingId]).toMatchObject({ status: "pending_execution", ownerId: "SARIT" });
    const task = s.control.tasks.find((t) => t.findingId === findingId)!;
    expect(task).toMatchObject({ status: "pending_execution", ownerId: "SARIT" });
    expect(task.titleHe).toContain("תיקון במערכת המידע");
  });

  it("'accept' closes the finding as checked and correct, with the reason", () => {
    const { state, findingId } = controlWithDuplicate();
    const s = decide(state, findingId, "accept", "הספק ממספר חשבונות לפי אתר");
    expect(s.control.decisions[findingId]).toMatchObject({ status: "handled" });
    expect(s.control.decisions[findingId].auditHe).toContain("הספק ממספר חשבונות לפי אתר");
    expect(buildReport(pkg, s).openFindings.some((f) => f.id === findingId)).toBe(false);
  });

  it("a contract overrun can be closed by recording a change order, which the report's §6 then shows", () => {
    const seed = initialState();
    const contract = pkg.contracts.find((c) => c.amount != null && !c.closed)!;
    const recorded = seed.erp.invoices.filter((i) => i.contractId === contract.id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
    const [s0] = createInvoice(seed, { supplierId: contract.supplierId, supplierDocNo: "OVER-2", date: "2026-08-28", amount: contract.amount! - recorded + 50_000, descriptionHe: "חשבון חלקי", sectionId: contract.sectionId, contractId: contract.id, attachmentId: null, byId: "SARIT" });
    const state = reviewFindings(revealAllSteps(startControl(s0, "בקרה")));
    const s = decide(state, `F-OVER-${contract.id}`, "change_order", "אושרה על ידי המזמין");
    expect(s.control.notes.some((n) => n.kind === "change_order" && n.textHe.includes("50,000"))).toBe(true);
    expect(buildReport(pkg, s).contingency.pendingChangeOrdersHe).toContain("50,000");
  });
});

describe("questions to people", () => {
  it("a question is addressed to a person with their channel, stays open in the report, and the answer closes it", () => {
    const { state, findingId } = (() => {
      const seed = initialState();
      const original = seed.erp.invoices.find((i) => i.contractId && i.status === "אושר")!;
      const [s, dup] = createInvoice(seed, { supplierId: original.supplierId, supplierDocNo: original.supplierDocNo, date: original.date, amount: original.amount, descriptionHe: original.descriptionHe, sectionId: original.sectionId, contractId: original.contractId, attachmentId: null, byId: "SARIT" });
      return { state: reviewFindings(revealAllSteps(startControl(s, "בקרה"))), findingId: `F-DUP-${dup.id}` };
    })();
    const [asked, q] = askPerson(state, { toId: "SARIT", textHe: "האם החשבון נקלט פעמיים?", findingId });
    expect(q).toMatchObject({ toId: "SARIT", channel: "email", status: "open", findingId });
    const open = buildReport(pkg, asked);
    expect(open.openQuestions).toEqual([expect.objectContaining({ id: q.id, toHe: "שרית", channelHe: "דוא״ל" })]);
    expect(open.openFindings.some((f) => f.id === findingId)).toBe(true);
    const answered = answerQuestion(asked, q.id, "כן — בוטל היום");
    expect(answered.control.questions[0]).toMatchObject({ status: "answered", answerHe: "כן — בוטל היום", answeredById: "SARIT" });
    expect(buildReport(pkg, answered).openQuestions).toHaveLength(0);
    expect(() => askPerson(state, { toId: "NOBODY", textHe: "?" })).toThrow(/NOBODY/);
    expect(() => answerQuestion(asked, "Q-9", "x")).toThrow(/Q-9/);
  });
});

describe("recommended fixes are applied only on approval, and verified", () => {
  const broken = (patch: (i: V2State["erp"]["invoices"][number]) => V2State["erp"]["invoices"][number], pick: (i: V2State["erp"]["invoices"][number]) => boolean) => {
    const seed = initialState();
    const s = withInvoice(seed, patch, pick);
    return { state: reviewFindings(revealAllSteps(startControl(s, "בקרה"))), invoiceId: seed.erp.invoices.find(pick)!.id };
  };

  it("a retention card carries the fix from the contract's rate; 'apply' writes it, logs it and records a correction", () => {
    const { state, invoiceId } = broken((i) => ({ ...i, retentionAmt: i.retentionAmt + 7 }), (i) => i.retentionPct > 0 && !!i.contractId && i.docType === "חשבון חלקי");
    const f = state.control.findings.find((x) => x.id === `F-RET-${invoiceId}`)!;
    expect(f.proposedFix).toBeDefined();
    expect(f.decision.options[0]).toMatchObject({ id: "apply" });
    expect(f.people?.some((p) => p.relationHe.includes("קלט"))).toBe(true);
    const s = decide(state, f.id, "apply");
    const inv = s.erp.invoices.find((i) => i.id === invoiceId)!;
    expect(inv.retentionAmt).toBe(Math.round((inv.amount * inv.retentionPct) / 100));
    expect(inv.netPayable).toBe(inv.amount - inv.retentionAmt);
    expect(s.erp.changeLog.at(-1)).toMatchObject({ recordId: String(invoiceId), field: "עכבון", byId: s.operatorId });
    expect(s.control.corrections.at(-1)).toMatchObject({ recordId: String(invoiceId), findingId: f.id, status: "applied" });
    expect(s.control.decisions[f.id]).toMatchObject({ status: "handled", routeId: "update" });
    expect(s.control.decisions[f.id].verifiedHe).toContain("נקרא מחדש");
    expect(buildReport(pkg, s).openFindings.some((x) => x.id === f.id)).toBe(false);
  });

  it("a cumulative card fixes the chain on approval", () => {
    const { state, invoiceId } = broken((i) => ({ ...i, cumulativeNow: (i.cumulativeNow ?? 0) + 1000 }), (i) => i.cumulativeNow != null && i.cumulativePrev != null);
    const f = state.control.findings.find((x) => x.id === `F-CUM-${invoiceId}`)!;
    const s = decide(state, f.id, "apply");
    const inv = s.erp.invoices.find((i) => i.id === invoiceId)!;
    expect(inv.cumulativeNow).toBe((inv.cumulativePrev ?? 0) + inv.amount);
    expect(s.erp.changeLog.at(-1)).toMatchObject({ field: "מצטבר" });
  });

  it("an invoice in review can be approved from the card; it then counts as recorded", () => {
    const { state, invoiceId } = broken((i) => ({ ...i, dateReceived: "2026-07-01" }), (i) => i.status === "בבדיקה");
    const f = state.control.findings.find((x) => x.id === `F-REVIEW-${invoiceId}`)!;
    const before = buildReport(pkg, state).working.totalRecorded;
    const s = decide(state, f.id, "apply");
    const inv = s.erp.invoices.find((i) => i.id === invoiceId)!;
    expect(inv.status).toBe("אושר");
    expect(inv.approvedBy).toBe(s.operatorId);
    expect(buildReport(pkg, s).working.totalRecorded).toBe(before + inv.amount);
  });

  it("without a decision nothing changes: 'refer' leaves the record as it was", () => {
    const { state, invoiceId } = broken((i) => ({ ...i, retentionAmt: i.retentionAmt + 7 }), (i) => i.retentionPct > 0 && !!i.contractId && i.docType === "חשבון חלקי");
    const s = decide(state, `F-RET-${invoiceId}`, "refer");
    expect(s.erp.invoices.find((i) => i.id === invoiceId)!.retentionAmt).toBe(state.erp.invoices.find((i) => i.id === invoiceId)!.retentionAmt);
    expect(s.control.tasks.at(-1)).toMatchObject({ status: "pending_execution", ownerId: "SARIT" });
  });
});

describe("who to ask, and the report without a control", () => {
  it("a finding names the people who entered, approved and changed the record", () => {
    const seed = initialState();
    const moved = updateInvoiceSection(seed, 1147, "02", "SARIT");
    const state = reviewFindings(revealAllSteps(startControl(moved, "בקרה")));
    const f = state.control.findings.find((x) => x.kind === "allocation")!;
    const names = (f.people ?? []).map((p) => p.id);
    expect(names).toEqual(expect.arrayContaining(["SARIT", "EYAL"]));
    expect(f.people!.find((p) => p.id === "SARIT")!.relationHe).toContain("קלט");
    expect(f.people!.find((p) => p.id === "SARIT")!.relationHe).toContain("סעיף תקציבי");
    expect(f.people!.find((p) => p.id === "EYAL")!.relationHe).toContain("אישר");
  });

  it("the report built before any control lists what the checks find now, with the recommended fix and the people", () => {
    const seed = initialState();
    const moved = updateInvoiceSection(seed, 1147, "02", "SARIT");
    const r = buildReport(pkg, moved);
    expect(r.openFindings.length).toBe(4);
    expect(r.openFindings.every((f) => f.statusHe === "הבקרה טרם רצה")).toBe(true);
    const alloc = r.openFindings.find((f) => f.kind === "allocation")!;
    expect(alloc.fixHe).toContain("כן — לעדכן ל");
    expect(alloc.peopleHe).toContain("שרית");
  });
});
