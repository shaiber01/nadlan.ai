import { describe, expect, it } from "vitest";
import { allIssues, confirmQuote, createInvoice, decide, initialState, pkg, resetDemo, reviewFindings, revealAllSteps, saveConfig, sendReport, setReportConfig, startControl, updateInvoiceBuilding, updateInvoiceSection, updatePurchaseOrder, updatePurchaseOrderSection } from "../src/hadarim/engine/commands";
import { savePromptHe } from "../src/hadarim/engine/commands";
import { workingForecast } from "../src/hadarim/engine/forecast";
import type { V2State } from "../src/hadarim/engine/model";
import { buildReport } from "../src/hadarim/engine/report";
import { installScenario } from "./fixtures/scenario";

// the seed is clean: the flow below needs the three errors a control acts on, with the revised BOQ page
// already read, the way the agent would before this control runs
installScenario({ processedBoqRevision: true });

const lastSystem = (s: V2State) => [...s.control.messages].reverse().find((m) => m.role === "system")!;
const findingByKind = (s: V2State, kind: string) => s.control.findings.find((f) => f.kind === kind)!;
const total = (s: V2State) => workingForecast(pkg, s.erp, s.control.adjustments, s.control.controlDate).totalEac;

/** Scene 1 (variant A) through scene 8 of the script, on the engine alone. */
function runScript(): { afterEdit: V2State; afterControl: V2State; final: V2State } {
  const afterEdit = updateInvoiceSection(initialState(), 1147, "02", "SARIT");
  let s = revealAllSteps(startControl(afterEdit, "תכיני בקרה תקציבית להדרים"));
  const afterControl = s;
  s = reviewFindings(s);
  // 1. allocation → yes → update in the ERP
  const alloc = findingByKind(s, "allocation");
  s = decide(s, alloc.id, "yes_target");
  // one question, not two: the answer carried the route, so the ERP is already written
  expect(s.control.decisions[alloc.id]).toMatchObject({ status: "handled", routeId: "update" });
  // 2. unit → yes 12 tons, but Roi keys it
  const unit = findingByKind(s, "unit");
  s = decide(s, unit.id, "yes_refer");
  // 3. price → applies to all remaining
  const price = findingByKind(s, "price");
  s = decide(s, price.id, "all");
  // 4. coverage → free text → quote found → confirm
  const cov = findingByKind(s, "coverage");
  s = decide(s, cov.id, null, "צריך להזמין. יש הצעה בתיקייה");
  s = confirmQuote(s, cov.id, true);
  return { afterEdit, afterControl, final: s };
}

describe("Hadarim v2 engine — ERP edits", () => {
  it("moves invoice 1147 to שלד with a change-log row and refuses unauthorised writers", () => {
    const s = updateInvoiceSection(initialState(), 1147, "02", "SARIT");
    expect(s.erp.invoices.find((i) => i.id === 1147)!.sectionId).toBe("02");
    const entry = s.erp.changeLog.at(-1)!;
    expect(entry).toMatchObject({ recordId: "1147", before: "07-פיתוח", after: "02-שלד", byId: "SARIT" });
    expect(() => updateInvoiceSection(initialState(), 1147, "02", "DANA")).toThrow(/אינו מורשה/);
  });

  it("variant B: the seed has no invoice 1147; the keyed-in invoice gets the next sequential number and the same finding", () => {
    const seed = initialState("B");
    expect(seed.erp.invoices.some((i) => i.id === 1147)).toBe(false);
    expect(seed.erp.changeLog.some((c) => c.recordId === "1147")).toBe(false);
    expect(seed.erp.invoices).toHaveLength(initialState("A").erp.invoices.length - 1);
    const nextNumber = Math.max(...seed.erp.invoices.map((i) => i.id)) + 1;
    const [s, invoice] = createInvoice(seed, { supplierId: "SUP-NTB", supplierDocNo: "2026-087", date: "2026-08-31", amount: 180_000, descriptionHe: "עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳", sectionId: "02", contractId: "07-01", attachmentId: "inv_1147_ntb_partial7", byId: "SARIT" });
    expect(invoice).toMatchObject({ id: nextNumber, partialNo: 7, cumulativePrev: 2_100_000, cumulativeNow: 2_280_000, retentionAmt: 9_000, sectionId: "02" });
    expect(startControl(s, "בקרה").control.findings.map((f) => f.kind).sort()).toEqual(["allocation", "coverage", "price", "unit"]);
    // numbering is sequential in variant A too
    expect(createInvoice(initialState("A"), { supplierId: "SUP-NTB", supplierDocNo: "x", date: "2026-08-31", amount: 1, descriptionHe: "x", sectionId: "07", contractId: null, attachmentId: null, byId: "SARIT" })[1].id).toBe(Math.max(...initialState("A").erp.invoices.map((i) => i.id)) + 1);
  });

  it("recomputes the PO amount from quantity, unit and price", () => {
    const s = updatePurchaseOrder(initialState(), 2291, { qty: 12, unit: "טון", unitPrice: 4800 }, "EYAL");
    expect(s.erp.purchaseOrders.find((p) => p.id === 2291)).toMatchObject({ qty: 12, unit: "טון", unitPrice: 4800, amount: 57_600 });
  });

  it("saves the recomputed amount even when it no longer matches the original order — the amount is derived, not its own field", () => {
    const s = updatePurchaseOrder(initialState(), 2291, { qty: 12, unit: "טון" }, "EYAL");
    const po = s.erp.purchaseOrders.find((p) => p.id === 2291)!;
    expect(po).toMatchObject({ qty: 12, unit: "טון", unitPrice: 4.8, amount: 58 });
  });

  it("still rejects units that do not convert into one another", () => {
    expect(() => updatePurchaseOrder(initialState(), 2291, { unit: "מ׳", priceUnit: "טון" }, "EYAL")).toThrow(/אינן ניתנות להמרה/);
  });

  it("the ERP can move an order to another budget section; the invoices against it keep theirs, and the change is logged", () => {
    const base = initialState();
    const po = base.erp.purchaseOrders.find((p) => base.erp.invoices.some((i) => i.poId === p.id)) ?? base.erp.purchaseOrders[0];
    const other = pkg.sections.find((s) => s.id !== po.sectionId)!.id;
    const s = updatePurchaseOrderSection(base, po.id, other, "EYAL");
    expect(s.erp.purchaseOrders.find((p) => p.id === po.id)!.sectionId).toBe(other);
    const sectionsOf = (st: typeof base) => st.erp.invoices.filter((i) => i.poId === po.id).map((i) => i.sectionId);
    expect(sectionsOf(s)).toEqual(sectionsOf(base));
    expect(s.erp.changeLog.at(-1)).toMatchObject({ recordType: "po", recordId: String(po.id), field: "סעיף תקציבי", byId: "EYAL" });
    expect(updatePurchaseOrderSection(base, po.id, po.sectionId, "EYAL")).toBe(base);
    expect(() => updatePurchaseOrderSection(base, po.id, other, "DANA")).toThrow(/אינו מורשה/);
    expect(() => updatePurchaseOrderSection(base, po.id, "99" as never, "EYAL")).toThrow(/לא קיים/);
  });

  it("an order on the wrong section: the control raises the card; yes → update writes it back, verified and logged; refer opens a task; no closes it", () => {
    const seed = initialState();
    const po = seed.erp.purchaseOrders.find((p) => p.contractId && pkg.contracts.find((c) => c.id === p.contractId)!.sectionId === p.sectionId)!;
    const wrong = pkg.sections.find((s) => s.id !== po.sectionId)!.id;
    const open = () => revealAllSteps(startControl(updatePurchaseOrderSection(seed, po.id, wrong, "EYAL"), "בקרה"));
    let s = open();
    const f = s.control.findings.find((x) => x.kind === "allocation" && x.record.type === "po")!;
    expect(f.id).toBe(`F-ALLOC-PO-${po.id}`);
    expect(f.people?.some((p) => p.id === "EYAL")).toBe(true);
    s = decide(s, f.id, "yes_target");
    expect(s.control.decisions[f.id].pending).toBeUndefined();
    expect(s.erp.purchaseOrders.find((p) => p.id === po.id)!.sectionId).toBe(po.sectionId);
    expect(s.control.decisions[f.id]).toMatchObject({ status: "handled", routeId: "update" });
    expect(s.control.decisions[f.id].verifiedHe).toContain(`הזמנה ${po.id}`);
    expect(s.control.corrections.at(-1)).toMatchObject({ recordType: "po", recordId: String(po.id), fieldHe: "סעיף תקציבי", findingId: f.id, status: "applied" });
    expect(s.erp.changeLog.at(-1)).toMatchObject({ recordType: "po", recordId: String(po.id), field: "סעיף תקציבי", byId: s.operatorId });
    expect(s.audit.at(-1)!.textHe).toContain(`הזמנה ${po.id}`);
    // the invoices billed against the order were never touched
    expect(s.erp.invoices.filter((i) => i.poId === po.id).map((i) => i.sectionId)).toEqual(seed.erp.invoices.filter((i) => i.poId === po.id).map((i) => i.sectionId));

    const referred = decide(open(), f.id, "yes_refer");
    expect(referred.erp.purchaseOrders.find((p) => p.id === po.id)!.sectionId).toBe(wrong);
    expect(referred.control.tasks.at(-1)).toMatchObject({ findingId: f.id, status: "pending_execution", sectionId: po.sectionId });
    expect(referred.control.decisions[f.id].status).toBe("pending_execution");

    const stays = decide(open(), f.id, "no_stay");
    expect(stays.erp.purchaseOrders.find((p) => p.id === po.id)!.sectionId).toBe(wrong);
    expect(stays.control.decisions[f.id].status).toBe("handled");
    expect(decide(open(), f.id, "unsure").control.decisions[f.id].status).toBe("referred");
  });
});

describe("Hadarim v2 engine — the scripted control", () => {
  it("finds 4 findings after the live edit and flags the record changed today", () => {
    const { afterControl } = runScript();
    expect(afterControl.control.findings.map((f) => f.kind).sort()).toEqual(["allocation", "coverage", "price", "unit"]);
    const summary = afterControl.control.messages.find((m) => m.kind === "text" && m.role === "system")!;
    expect(summary.textHe).toContain("נמצאו 4 ממצאים");
    expect(summary.textHe).toContain("אחד מהם ברשומה ששונתה היום");
    expect(afterControl.control.status).toBe("reviewing");
    expect(afterControl.control.messages.find((m) => m.kind === "steps")!.steps!.every((st) => st.done)).toBe(true);
  });

  it("finds 3 findings without the edit (the allocation trap does not fire on clean data)", () => {
    const s = startControl(initialState(), "תכיני בקרה");
    expect(s.control.findings.map((f) => f.kind).sort()).toEqual(["coverage", "price", "unit"]);
    expect(s.control.messages.find((m) => m.kind === "text" && m.role === "system")!.textHe).not.toContain("ששונתה היום");
  });

  it("writes the allocation fix back with permission check, verification and audit", () => {
    const { final } = runScript();
    const alloc = findingByKind(final, "allocation");
    const decision = final.control.decisions[alloc.id];
    expect(decision.status).toBe("handled");
    expect(decision.verifiedHe).toContain("נקרא מחדש");
    expect(final.erp.invoices.find((i) => i.id === 1147)!.sectionId).toBe("07");
    expect(final.erp.changeLog.filter((c) => c.recordId === "1147")).toHaveLength(3); // seed keying, live edit, correction
    expect(final.control.corrections.filter((c) => c.status === "applied")).toHaveLength(1);
    expect(final.audit.some((a) => a.recordRef?.id === "1147" && a.textHe.includes("02-שלד → 07-פיתוח"))).toBe(true);
  });

  it("refers the unit fix to Roi without touching the ERP", () => {
    const { final } = runScript();
    const unit = findingByKind(final, "unit");
    expect(final.control.decisions[unit.id]).toMatchObject({ status: "pending_execution", ownerId: "ROI" });
    expect(final.erp.purchaseOrders.find((p) => p.id === 2291)).toMatchObject({ qty: 12_000, unit: "טון", unitPrice: 4.8 });
    expect(final.control.tasks.some((t) => t.titleHe.includes("2291") && t.status === "pending_execution")).toBe(true);
  });

  it("moves the headline forecast 48.00 → 48.24 → 48.36", () => {
    const { afterControl, final } = runScript();
    expect(total(afterControl)).toBe(48_000_000);
    const price = final.control.adjustments.find((a) => a.changeType === "price")!;
    expect(price.amount).toBe(240_000);
    const drainage = final.control.adjustments.find((a) => a.changeType === "coverage_gap")!;
    expect(drainage).toMatchObject({ amount: 120_000, basis: "quote", sectionId: "07" });
    expect(total(final)).toBe(48_360_000);
    expect(final.control.status).toBe("report");
    expect(lastSystem(final).kind).toBe("report");
    const task = final.control.tasks.find((t) => t.titleHe.includes("ניקוז"))!;
    expect(task).toMatchObject({ ownerId: "EYAL", dueDate: "2026-09-19", status: "open" });
  });

  it("applies the unit fix in the ERP on the approving answer, with no second question", () => {
    let s = reviewFindings(revealAllSteps(startControl(initialState(), "בקרה")));
    const unit = findingByKind(s, "unit");
    s = decide(s, unit.id, "yes_tons");
    expect(s.erp.purchaseOrders.find((p) => p.id === 2291)).toMatchObject({ qty: 12, unit: "טון", unitPrice: 4800, amount: 57_600 });
    expect(s.control.decisions[unit.id].verifiedHe).toContain("2291");
  });

  it("keeps 1147 in שלד with a report note on [לא, נשאר בשלד]", () => {
    let s = reviewFindings(revealAllSteps(startControl(updateInvoiceSection(initialState(), 1147, "02", "SARIT"), "בקרה")));
    const alloc = findingByKind(s, "allocation");
    s = decide(s, alloc.id, "no_stay");
    expect(s.control.decisions[alloc.id].status).toBe("handled");
    expect(s.erp.invoices.find((i) => i.id === 1147)!.sectionId).toBe("02");
    expect(lastSystem(s).kind).toBe("finding"); // moves on to the next card
  });
});

describe("Hadarim v2 engine — the report", () => {
  it("renders the standard's numbers from the final state", () => {
    const { final } = runScript();
    const r = buildReport(pkg, final);
    expect(r.header.controlLabelHe).toContain("טיוטה");
    expect(r.executive.keyTable.map((k) => k.valueHe)).toEqual(expect.arrayContaining(["48,000,000 ₪", "48,360,000 ₪", "+360,000 ₪"]));
    expect(r.executive.keyTable.find((k) => k.labelHe === "סטייה מתקציב")!.pctHe).toBe("0.75%");
    expect(r.executive.paragraphHe).toContain("48.36");
    expect(r.executive.decisionsHe[0]).toContain("360,000");
    const steel = r.sections.rows.find((x) => x.sectionId === "03")!;
    // after the price decision the 12 t on PO 2291 are a commitment; 288 t stay uncovered at the appendix price
    expect(steel).toMatchObject({ recorded: 1_800_000, committed: 57_600, remainingCommitment: 57_600, uncovered: 1_382_400, eac: 3_240_000, variance: 240_000, previousEac: 3_000_000, highlighted: true });
    const dev = r.sections.rows.find((x) => x.sectionId === "07")!;
    expect(dev).toMatchObject({ recorded: 2_280_000, remainingCommitment: 920_000, uncovered: 120_000, eac: 3_320_000, variance: 120_000 });
    expect(r.sections.rows.find((x) => x.sectionId === "02")!.recorded).toBe(8_400_000);
    expect(r.sections.totals.eac).toBe(48_360_000);
    expect(r.sections.rows.find((x) => x.isContingency)!.eac).toBe(1_500_000);
    expect(r.changes.forecast).toHaveLength(2);
    expect(r.changes.forecastTotal).toBe(360_000);
    expect(r.changes.corrections.map((c) => c.statusHe)).toEqual(["בוצע במקור", "ממתין לביצוע"]);
    // standard §5: changed sections, sections above 10 % of budget, and sections whose basis is below 70 %
    expect(r.material.map((m) => m.sectionId)).toEqual(["02", "03", "07", "12", "13", "15", "16", "18"]);
    expect(r.material.find((m) => m.sectionId === "02")!.reasonHe).toContain("10%");
    expect(r.material.find((m) => m.sectionId === "12")!.reasonHe).toContain("בסיס 0%");
    expect(r.material.find((m) => m.sectionId === "03")!.sources.some((s) => s.documentId === "appendix_A2_steel_price_2026_07_15")).toBe(true);
    // the coverage-gap section links the excluded BOQ line to the ERP's bill of quantities, addressed by line
    expect(r.material.find((m) => m.sectionId === "07")!.sources.some((s) => s.erp?.screen === "boq" && s.erp.boqLineId === "57.03.040" && s.erp.sectionId === "07")).toBe(true);
    expect(r.material.every((m) => m.sources.length > 0 && m.table.length > 5 && m.paragraphsHe.length >= 3)).toBe(true);
    expect(r.verified[0].titleHe).toContain("איטום");
    expect(r.issues.open.map((i) => i.titleHe)).toEqual(expect.arrayContaining([expect.stringContaining("ביוב"), expect.stringContaining("ניקוז"), expect.stringContaining("2291")]));
    expect(r.issues.closed).toHaveLength(2);
    expect(r.issues.open.find((i) => i.titleHe.includes("ביוב"))!.stale).toBe(true); // opened 1.7, still open at 1.8 and 1.9
    expect(r.issues.open.find((i) => i.titleHe.includes("ניקוז"))!.stale).toBe(false);
    expect(r.material.find((m) => m.sectionId === "03")!.paragraphsHe[0]).toContain("03-F");
    expect(r.trends.eacSeries.map((p) => p.value)).toEqual([47_900_000, 47_950_000, 48_000_000, 48_000_000, 48_360_000]);
    expect(r.trends.commentaryHe).toContain("בקרה ראשונה");
    expect(r.trends.commentaryHe).toContain("ממחיר, לא מכמות");
    expect(r.trends.comparison).toBeNull();
    expect(r.appendices.inReview.count).toBe(5);
    expect(r.appendices.afterCutoffHe.length).toBeGreaterThanOrEqual(2);
    // data spec §7: four packages 6.7M + steel 288 t 1,382,400 + drainage 120,000 (+ the site-organisation extension estimate)
    expect(r.appendices.uncoveredTotal).toBe(6_700_000 + 1_382_400 + 120_000 + 75_000);
    expect(r.appendices.allocationTotal).toBe(1_100_000);
    expect(r.appendices.uncoveredTotal + r.appendices.allocationTotal + 1_500_000).toBe(r.working.totalUncovered);
    expect(r.appendices.uncovered.every((u) => u.source)).toBe(true);
    expect(r.executive.keyTable.find((k) => k.labelHe.startsWith("יתרה להשלמה"))!.valueHe).toBe("8,277,400 ₪");
    // 1.8: packages 6.7M + aluminium estimate (contract not yet signed) + steel 300 t × 4,000 + site-organisation extension
    expect(r.trends.uncoveredSeries.map((p) => p.value)).toEqual([9_976_030, 8_277_400]);
    expect(r.trends.uncoveredCommentaryHe).toContain("נחתם חוזה");
    expect(allIssues(final).length).toBe(5);
  });

  it("adds the comparison section, the building split and the CEO page on request", () => {
    const { final } = runScript();
    let s = setReportConfig(final, { includeTrends: true });
    expect(s.control.reportConfig.includeTrends).toBe(true);
    let r = buildReport(pkg, s);
    expect(r.trends.comparison![1]).toEqual(["תחזית כוללת", "48.00 מ׳", "48.36 מ׳", "+0.36 מ׳"]);
    // rows are derived from whatever changed: section forecasts that moved, then recorded amounts that moved by a transfer
    const row = (prefix: string) => r.trends.comparison!.find((x) => x[0].startsWith(prefix))!;
    expect(row("ברזל — תחזית סעיף")[3]).toBe("+8%");
    expect(row("פיתוח — תחזית סעיף")[3]).toBe("+4%");
    expect(row("פיתוח — נרשם")[3]).toContain("180,000");
    s = setReportConfig(s, { splitByBuilding: true });
    r = buildReport(pkg, s);
    const rows = r.sections.byBuilding!;
    expect(rows.map((x) => x.building)).toEqual(["A", "B", "חניון", "משותף"]);
    expect(rows.reduce((a, x) => a + x.budget, 0)).toBe(48_000_000);
    expect(rows.reduce((a, x) => a + x.eac, 0)).toBe(48_360_000);
    expect(rows.reduce((a, x) => a + x.recorded, 0)).toBe(r.working.totalRecorded);
    expect(rows.reduce((a, x) => a + x.committed, 0)).toBe(r.working.totalCommitted);
    expect(rows.reduce((a, x) => a + x.uncovered, 0)).toBe(r.working.totalUncovered);
    expect(rows.every((x) => x.eac === x.recorded + x.remainingCommitment + x.uncovered)).toBe(true);
    expect(r.sections.byBuildingNoteHe).toContain("1147");
    expect(r.sections.byBuildingChangeable).toEqual([{ invoiceId: 1147, labelHe: "חשבון 1147", building: null }]);
    // the "[שנה]" affordance: tagging 1147 with building A moves its 180,000 out of "משותף"
    const taggedState = updateInvoiceBuilding(s, 1147, "A", "EYAL");
    const tagged = buildReport(pkg, taggedState);
    const before = rows.find((x) => x.building === "משותף")!.recorded;
    expect(tagged.sections.byBuilding!.find((x) => x.building === "משותף")!.recorded).toBe(before - 180_000);
    expect(tagged.sections.byBuilding!.find((x) => x.building === "A")!.recorded).toBe(rows.find((x) => x.building === "A")!.recorded + 180_000);
    expect(tagged.sections.byBuildingNoteHe).toContain("שויך לבניין A");
    expect(taggedState.erp.changeLog.at(-1)).toMatchObject({ recordId: "1147", field: "בניין", after: "A" });
    s = setReportConfig(s, { ceoVersion: true });
    expect(s.control.reportConfig.ceoVersion).toBe(true);
    r = buildReport(pkg, s);
    expect(r.ceo.keyTable).toHaveLength(4);
    expect(r.ceo.changes).toHaveLength(2);
    // scene 8: the save prompt says what a saved configuration keeps and what it never keeps
    const savePrompt = savePromptHe(s.control.reportConfig);
    expect(savePrompt).toContain("מה יישמר");
    expect(savePrompt).toContain("פילוח לפי בניין");
    expect(savePrompt).toContain("גרסה נפרדת למנכ״לית");
    expect(savePrompt).toContain("מה לא יישמר: הנתונים והמסקנות");
    s = sendReport(s, "DANA");
    expect(lastSystem(s).kind).toBe("log");
    expect(lastSystem(s).textHe).toContain("נשלח לדנה");
    expect(lastSystem(s).textHe).toContain("הגרסה למנכ״לית");
    s = saveConfig(s, true);
    expect(s.savedConfig?.savedAs).toBe("תצורת בקרה — הדרים");
    expect(resetDemo().savedConfig).toBeNull();
  });

  it("the data behind the scene-9 questions is in the report model (the agent answers from it)", () => {
    const { final } = runScript();
    const r = buildReport(pkg, setReportConfig(final, { includeTrends: true }));
    // what changed and why: 4a carries the typed changes, 4b the corrections
    expect(r.changes.forecastTotal).toBe(360_000);
    expect(r.changes.forecast.map((c) => c.typeHe)).toEqual(["שינוי מחיר", "פער כיסוי חוזי"]);
    expect(r.changes.corrections.map((c) => c.recordHe)).toEqual(expect.arrayContaining(["חשבון 1147", "הזמנה 2291"]));
    // price, not quantity: the steel remainder keeps its 300 t and moves from 4,000 to 4,800 per ton
    const steel = r.working.sections.find((s) => s.sectionId === "03")!;
    const remainder = steel.lines.filter((l) => l.kind === "uncovered" || l.basis === "po");
    expect(remainder.reduce((a, l) => a + (l.qty ?? 0), 0)).toBe(300);
    expect(remainder.every((l) => l.unitPrice === 4_800)).toBe(true);
    // issues closed since the previous control, and what is still an estimate
    expect(r.issues.closed).toHaveLength(2);
    expect(r.appendices.uncoveredTotal).toBe(8_277_400);
    expect(r.appendices.allocationTotal).toBe(1_100_000);
    expect(r.trends.comparison!.find((row) => row[0].startsWith("פיתוח — נרשם"))![3]).toContain("180,000");
  });

  it("free text on a finding card is a decision", () => {
    let s = reviewFindings(revealAllSteps(startControl(updateInvoiceSection(initialState(), 1147, "02", "SARIT"), "בקרה")));
    const first = s.control.messages.filter((m) => m.kind === "finding").at(-1)!.findingId!;
    const kind = s.control.findings.find((f) => f.id === first)!.kind;
    s = decide(s, first, null, kind === "allocation" ? "כן, זה לפיתוח" : "צריך להזמין, תחפשי הצעה");
    expect(s.control.decisions[first]).toBeDefined();
    expect(s.control.decisions[first].pending ?? s.control.decisions[first].status).toBeTruthy();
    const cfg = setReportConfig(s, { splitByBuilding: true });
    expect(cfg.control.reportConfig.splitByBuilding).toBe(true);
  });
});
