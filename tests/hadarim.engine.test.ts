import { describe, expect, it } from "vitest";
import { allIssues, confirmQuote, createInvoice, decide, initialState, pkg, resetDemo, reviewFindings, revealAllSteps, route, saveConfig, sendReport, setReportConfig, startControl, updateInvoiceBuilding, updateInvoiceSection, updatePurchaseOrder } from "../src/hadarim/engine/commands";
import { handleUserText } from "../src/hadarim/engine/conversation";
import { workingForecast } from "../src/hadarim/engine/forecast";
import type { V2State } from "../src/hadarim/engine/model";
import { buildReport } from "../src/hadarim/engine/report";

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
  expect(lastSystem(s).options?.map((o) => o.labelHe)).toEqual(["עדכן", "העבר להנהלת חשבונות", "רק בתחזית"]);
  s = route(s, alloc.id, "update");
  // 2. unit → yes 12 tons → refer to Roi
  const unit = findingByKind(s, "unit");
  s = decide(s, unit.id, "yes_tons");
  s = route(s, unit.id, "refer_roi");
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

  it("variant B: the seed has no invoice 1147 and the keyed-in invoice gets that number", () => {
    const seed = initialState("B");
    expect(seed.erp.invoices.some((i) => i.id === 1147)).toBe(false);
    expect(seed.erp.changeLog.some((c) => c.recordId === "1147")).toBe(false);
    expect(seed.erp.invoices).toHaveLength(initialState("A").erp.invoices.length - 1);
    const [s, invoice] = createInvoice(seed, { supplierId: "SUP-NTB", supplierDocNo: "2026-087", date: "2026-08-31", amount: 180_000, descriptionHe: "עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳", sectionId: "02", contractId: "07-01", attachmentId: "inv_1147_ntb_partial7", byId: "SARIT" });
    expect(invoice).toMatchObject({ id: 1147, partialNo: 7, cumulativePrev: 2_100_000, cumulativeNow: 2_280_000, retentionAmt: 9_000, sectionId: "02" });
    expect(startControl(s, "בקרה").control.findings.map((f) => f.kind).sort()).toEqual(["allocation", "coverage", "price", "unit"]);
    // variant A keeps numbering sequential for any extra invoice
    expect(createInvoice(initialState("A"), { supplierId: "SUP-NTB", supplierDocNo: "x", date: "2026-08-31", amount: 1, descriptionHe: "x", sectionId: "07", contractId: null, attachmentId: null, byId: "SARIT" })[1].id).toBeGreaterThan(1147);
  });

  it("keeps the PO amount fixed when correcting quantity and unit", () => {
    const s = updatePurchaseOrder(initialState(), 2291, { qty: 12, unit: "טון", unitPrice: 4800 }, "EYAL");
    expect(s.erp.purchaseOrders.find((p) => p.id === 2291)).toMatchObject({ qty: 12, unit: "טון", unitPrice: 4800, amount: 57_600 });
    expect(() => updatePurchaseOrder(initialState(), 2291, { qty: 12, unit: "טון" }, "EYAL")).toThrow(/57,600/);
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

  it("applies the unit fix in the ERP on the [עדכן] route", () => {
    let s = reviewFindings(revealAllSteps(startControl(initialState(), "בקרה")));
    const unit = findingByKind(s, "unit");
    s = decide(s, unit.id, "yes_tons");
    s = route(s, unit.id, "update");
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
    expect(r.trends.uncoveredSeries.map((p) => p.value)).toEqual([9_971_140, 8_277_400]);
    expect(r.trends.uncoveredCommentaryHe).toContain("נחתם חוזה");
    expect(allIssues(final).length).toBe(5);
  });

  it("adds the comparison section, the building split and the CEO page on request", () => {
    const { final } = runScript();
    let s = handleUserText(final, "תוסיפי השוואה לבקרה הקודמת ומגמות");
    expect(s.control.reportConfig.includeTrends).toBe(true);
    let r = buildReport(pkg, s);
    expect(r.trends.comparison![1]).toEqual(["תחזית כוללת", "48.00 מ׳", "48.36 מ׳", "+0.36 מ׳"]);
    expect(r.trends.comparison![2][3]).toBe("+8%");
    expect(r.trends.comparison![3][3]).toContain("180,000");
    s = handleUserText(s, "תציגי את הטבלה לפי בניין");
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
    s = handleUserText(s, "תכיני גרסה לדנה — עמוד אחד");
    expect(s.control.reportConfig.ceoVersion).toBe(true);
    r = buildReport(pkg, s);
    expect(r.ceo.keyTable).toHaveLength(4);
    expect(r.ceo.changes).toHaveLength(2);
    // scene 7: the CEO-version message offers the exports and the hand-off; scene 8: the full save prompt
    const ceoMessage = [...s.control.messages].reverse().find((m) => m.options?.some((o) => o.id === "send_dana"))!;
    expect(ceoMessage.options!.map((o) => o.labelHe)).toEqual(["פתח את הדוח", "ייצוא PDF", "ייצוא Word", "שלח לדנה"]);
    const savePrompt = lastSystem(s);
    expect(savePrompt.textHe).toContain("מה יישמר");
    expect(savePrompt.textHe).toContain("פילוח לפי בניין");
    expect(savePrompt.textHe).toContain("מה לא יישמר: הנתונים והמסקנות");
    expect(savePrompt.options!.map((o) => o.labelHe)).toEqual(["שמור", "לא עכשיו"]);
    s = sendReport(s, "DANA");
    expect(lastSystem(s).kind).toBe("log");
    expect(lastSystem(s).textHe).toContain("נשלח לדנה");
    expect(lastSystem(s).textHe).toContain("הגרסה למנכ״לית");
    s = saveConfig(s, true);
    expect(s.savedConfig?.savedAs).toBe("תצורת בקרה — הדרים");
    expect(resetDemo().savedConfig).toBeNull();
  });

  it("answers the scene-9 questions from the data", () => {
    const { final } = runScript();
    const ask = (s: V2State, q: string) => lastSystem(handleUserText(s, q)).textHe;
    expect(ask(final, "מה השתנה בבקרה האחרונה לעומת הקודמת?")).toContain("360,000");
    expect(ask(final, "אז החריגה בברזל נובעת מזה שקנינו יותר?")).toMatch(/^לא\./);
    expect(ask(final, "אז החריגה בברזל נובעת מזה שקנינו יותר?")).toContain("300 × 4,000");
    expect(ask(final, "אז החריגה בברזל נובעת מזה שקנינו יותר?")).toContain("300 טון בשתי הבקרות");
    expect(ask(final, "אז החריגה בברזל נובעת מזה שקנינו יותר?")).toContain("הפרש: 240,000 ₪");
    expect(ask(final, "אילו נושאים מהבקרה הקודמת כבר נסגרו?")).toContain("נסגרו 2 מתוך 3");
    const estimate = ask(final, "מה עדיין מבוסס על אומדן ולא על הזמנה?");
    expect(estimate).toContain("8,277,400 ₪");
    expect(estimate).toContain("ארבע חבילות שטרם נחתמו");
    expect(estimate).toContain("6,700,000 ₪");
    expect(estimate).toContain("יתרת ברזל 288 טון (1,382,400 ₪ — 12 טון כבר הוזמנו");
    expect(estimate).toContain("קו ניקוז חוץ (120,000 ₪");
    expect(estimate).toContain("הקצאות פנימיות של הנהלה ופיקוח (1,100,000 ₪) אינן רכש");
    expect(ask(final, "למה פיתוח עלה ביותר מ-120 אלף?")).toContain("180,000");
    expect(ask(final, "מה מזג האוויר?")).toContain("בדמו אפשר לשאול");
  });

  it("treats free text during a finding as a decision", () => {
    let s = reviewFindings(revealAllSteps(startControl(updateInvoiceSection(initialState(), 1147, "02", "SARIT"), "בקרה")));
    const first = s.control.messages.filter((m) => m.kind === "finding").at(-1)!.findingId!;
    const kind = s.control.findings.find((f) => f.id === first)!.kind;
    s = handleUserText(s, kind === "allocation" ? "כן, זה לפיתוח" : "צריך להזמין, תחפשי הצעה");
    expect(s.control.decisions[first]).toBeDefined();
    expect(s.control.decisions[first].pending ?? s.control.decisions[first].status).toBeTruthy();
    const cfg = setReportConfig(s, { splitByBuilding: true });
    expect(cfg.control.reportConfig.splitByBuilding).toBe(true);
  });
});
