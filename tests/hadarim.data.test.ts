import { describe, expect, it } from "vitest";
import { generateHadarimPackage, recordedBySection, CURRENT_CONTROL } from "../src/hadarim/data/generate";
import { runChecks } from "../src/hadarim/engine/checks";
import { lineAmount } from "../src/hadarim/engine/units";
import type { SectionId } from "../src/hadarim/data/types";
import { scenarioPackage } from "./fixtures/scenario";

const pkg = generateHadarimPackage();

describe("Hadarim v2 data package", () => {
  it("budgets sum to 48,000,000 across 18 sections", () => {
    expect(pkg.sections).toHaveLength(18);
    expect(pkg.sections.reduce((a, s) => a + s.budget, 0)).toBe(48_000_000);
  });

  it("recorded to 1.9 per section matches the data spec (invoice 1147 on 07)", () => {
    const rec = recordedBySection(pkg.invoices, CURRENT_CONTROL);
    const expected: Record<SectionId, number> = { "01": 1_250_000, "02": 8_400_000, "03": 1_800_000, "04": 2_850_000, "05": 320_000, "06": 180_000, "07": 2_280_000, "08": 350_000, "09": 280_000, "10": 0, "11": 0, "12": 0, "13": 0, "14": 260_000, "15": 0, "16": 0, "17": 0, "18": 2_100_000 };
    for (const [id, value] of Object.entries(expected)) expect(rec[id as SectionId], id).toBe(value);
    expect(Object.values(rec).reduce((a, b) => a + b, 0)).toBe(20_070_000);
  });

  it("has 210–220 invoices with sequential ids, five in review excluded from recorded", () => {
    expect(pkg.invoices.length).toBeGreaterThanOrEqual(210);
    expect(pkg.invoices.length).toBeLessThanOrEqual(220);
    const ids = pkg.invoices.map((i) => i.id);
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]).toBe(ids[i - 1] + 1);
    const inReview = pkg.invoices.filter((i) => i.status === "בבדיקה");
    expect(inReview).toHaveLength(5);
    expect(inReview.every((i) => i.dateReceived >= "2026-08-18")).toBe(true);
  });

  it("invoice 1147 is the seventh development partial, entered by bookkeeping on 2.9", () => {
    const inv = pkg.invoices.find((i) => i.id === 1147)!;
    expect(inv).toMatchObject({ supplierId: "SUP-NTB", supplierDocNo: "2026-087", partialNo: 7, sectionId: "07", contractId: "07-01", amount: 180_000, date: "2026-08-31", enteredAt: "2026-09-02", enteredBy: "SARIT", building: null, cumulativePrev: 2_100_000, cumulativeNow: 2_280_000, retentionAmt: 9_000, netPayable: 171_000, attachmentId: "inv_1147_ntb_partial7" });
    expect(inv.descriptionHe).toBe("עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳");
    expect(pkg.changeLog.some((c) => c.recordId === "1147" && c.byId === "SARIT" && c.at.startsWith("2026-09-02"))).toBe(true);
  });

  it("steel: 18 deliveries, 450 t at 4,000, one consistent kg/kg invoice, last delivery 28.8 against PO 2240", () => {
    const steel = pkg.invoices.filter((i) => i.sectionId === "03");
    expect(steel).toHaveLength(18);
    expect(steel.reduce((a, i) => a + i.amount, 0)).toBe(1_800_000);
    const tons = steel.reduce((a, i) => a + (i.unit === "ק״ג" ? (i.quantity ?? 0) / 1000 : i.quantity ?? 0), 0);
    expect(tons).toBe(450);
    expect(steel.filter((i) => i.unit === "ק״ג")).toHaveLength(1);
    const last = [...steel].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    expect(last.date).toBe("2026-08-28");
    expect(last.poId).toBe(2240);
  });

  it("purchase orders: 38 open plus the closed PO 2240; PO 2291 states its quote", () => {
    expect(pkg.purchaseOrders.filter((p) => p.status === "פתוחה")).toHaveLength(38);
    const closed = pkg.purchaseOrders.find((p) => p.id === 2240)!;
    expect(closed).toMatchObject({ status: "סגורה", qty: 60, unit: "טון", priceUnit: "טון", unitPrice: 4000, amount: 240_000, deliveredQty: 60, date: "2026-07-01" });
    const po = pkg.purchaseOrders.find((p) => p.id === 2291)!;
    expect(po).toMatchObject({ qty: 12, unit: "טון", priceUnit: "טון", unitPrice: 4800, amount: 57_600, attachmentId: "quote_pladot_12t", status: "פתוחה", date: "2026-08-22" });
  });

  it("every seeded order adds up once its units are converted", () => {
    for (const p of pkg.purchaseOrders) expect({ id: p.id, amount: lineAmount(p) }).toEqual({ id: p.id, amount: p.amount });
  });

  it("BOQ v4 has ~120 lines, the drainage line covered by 07-01, and elevators covered by 14-01", () => {
    expect(pkg.boq.length).toBeGreaterThanOrEqual(110);
    expect(pkg.boq.length).toBeLessThanOrEqual(125);
    const drainage = pkg.boq.find((l) => l.id === "57.03.040")!;
    expect(drainage).toMatchObject({ coverage: "covered", coveredByContractId: "07-01", qty: 80, unit: "מ׳", sectionId: "07" });
    const steel = pkg.boq.find((l) => l.descriptionHe.includes("מוטות פלדה"))!;
    expect(steel).toMatchObject({ qty: 750, unit: "טון", sectionId: "03", coverage: "covered" });
    expect(pkg.boq.filter((l) => l.chapter === "17").every((l) => l.coverage === "covered" && l.coveredByContractId === "14-01")).toBe(true);
    expect(pkg.boq.filter((l) => l.chapter === "05").every((l) => l.coverage === "covered" && l.coveredByContractId === "05-01")).toBe(true);
    expect(pkg.boq.filter((l) => l.sectionId === "12" || l.sectionId === "13" || l.sectionId === "15" || l.sectionId === "16").every((l) => l.coverage === "not_contracted")).toBe(true);
  });

  it("forecast 1.8 prices the steel remainder by the appendix in force and carries the development coverage note", () => {
    const f = pkg.forecasts.find((x) => x.controlDate === "2026-08-01")!;
    expect(f.status).toBe("final");
    expect(f.totalEac).toBe(48_240_000);
    const expectedEac: Partial<Record<SectionId, number>> = { "01": 1_950_000, "03": 3_240_000, "04": 2_850_000, "07": 3_200_000, "11": 2_000_000, "17": 1_500_000 };
    for (const [id, value] of Object.entries(expectedEac)) expect(f.sections!.find((s) => s.sectionId === id)!.eac, id).toBe(value);
    const steel = f.sections!.find((s) => s.sectionId === "03")!;
    expect(steel.recorded).toBe(1_560_000);
    const remaining = steel.lines.find((l) => l.basis === "appendix")!;
    expect(remaining).toMatchObject({ qty: 300, unitPrice: 4800, amount: 1_440_000 });
    expect(steel.lines.find((l) => l.basis === "po")?.amount).toBe(240_000);
    const dev = f.sections!.find((s) => s.sectionId === "07")!;
    expect(dev.recorded).toBe(2_100_000);
    expect(dev.coverageNoteHe).toContain("מכוסה בחוזה 07-01");
    expect(dev.uncovered).toBe(0);
    expect(f.sections!.find((s) => s.sectionId === "11")!.lines[0].basis).toBe("estimate");
    expect(f.openIssues.filter((o) => o.status === "closed")).toHaveLength(2);
    expect(f.openIssues.filter((o) => o.status === "open")).toHaveLength(1);
    expect(pkg.forecasts.filter((x) => x.sections === null).map((x) => x.totalEac)).toEqual([47_900_000, 47_950_000, 48_000_000]);
  });

  it("the 1.9 draft rolls the previous assumptions forward and nets to 48,240,000", () => {
    const d = pkg.forecasts.find((x) => x.controlDate === CURRENT_CONTROL)!;
    expect(d.status).toBe("draft");
    expect(d.totalEac).toBe(48_240_000);
    const steel = d.sections!.find((s) => s.sectionId === "03")!;
    expect(steel.recorded).toBe(1_800_000);
    expect(steel.lines.find((l) => l.basis === "appendix")).toMatchObject({ qty: 300, unitPrice: 4800, amount: 1_440_000 });
    expect(d.sections!.find((s) => s.sectionId === "11")!.lines[0].basis).toBe("contract");
    expect(d.sections!.find((s) => s.sectionId === "07")!.recorded).toBe(2_280_000);
    const site = d.sections!.find((s) => s.sectionId === "01")!;
    expect(site.eac).toBe(1_950_000);
    expect(site.lines.find((l) => l.basis === "estimate")!.amount).toBeGreaterThan(0);
  });

  it("documents: seven PDF-like pages with anchors and the demo footer, all read", () => {
    expect(pkg.documents).toHaveLength(7);
    expect(pkg.documents.filter((d) => !d.factsSource)).toEqual([]);
    for (const d of pkg.documents) expect(d.footerHe).toBe("מסמך הדגמה — נתונים בדויים");
    expect(pkg.documents.find((d) => d.id === "contract_07_01_excerpt")!.anchors.exclusion).toBeGreaterThan(0);
    expect(pkg.documents.find((d) => d.id === "quote_pladot_12t")!.blocks.some((b) => b.text?.includes("12,000 ק״ג (12 טון) × 4,800"))).toBe(true);
  });
});

describe("Hadarim v2 checks", () => {
  // the seed is clean; the scripted errors are a test fixture, put back here so the checks stay under test
  const brokenPkg = scenarioPackage();
  const processedPkg = scenarioPackage({ processedBoqRevision: true });
  const draft = brokenPkg.forecasts.find((x) => x.controlDate === CURRENT_CONTROL)!;
  const erp = { invoices: brokenPkg.invoices, purchaseOrders: brokenPkg.purchaseOrders, changeLog: brokenPkg.changeLog };

  it("a first control on the seed raises nothing and leaves nothing unread", () => {
    const cleanDraft = pkg.forecasts.find((x) => x.controlDate === CURRENT_CONTROL)!;
    const cleanErp = { invoices: pkg.invoices, purchaseOrders: pkg.purchaseOrders, changeLog: pkg.changeLog };
    expect(runChecks(pkg, cleanErp, cleanDraft, CURRENT_CONTROL).findings).toEqual([]);
    expect(pkg.documents.filter((d) => !d.factsSource)).toEqual([]);
  });

  it("with the scenario injected, only the price and unit findings fire — the revised BOQ page is still unprocessed", () => {
    const result = runChecks(brokenPkg, erp, draft, CURRENT_CONTROL);
    expect(result.findings.map((f) => f.kind).sort()).toEqual(["price", "unit"]);
  });

  it("once the revised BOQ page is processed, the coverage finding joins the other two", () => {
    const result = runChecks(processedPkg, erp, draft, CURRENT_CONTROL);
    expect(result.findings.map((f) => f.kind).sort()).toEqual(["coverage", "price", "unit"]);
  });

  it("moving invoice 1147 to 02 in the ERP adds the allocation finding with no effect on totals", () => {
    const edited = { ...erp, invoices: erp.invoices.map((i) => (i.id === 1147 ? { ...i, sectionId: "02" as const } : i)), changeLog: [...erp.changeLog, { id: "CL-LIVE", recordType: "invoice" as const, recordId: "1147", field: "סעיף תקציבי", before: "07-פיתוח", after: "02-שלד", at: "2026-09-03T09:03", byId: "EYAL" as const, noteHe: "שינוי ידני" }] };
    const result = runChecks(processedPkg, edited, draft, CURRENT_CONTROL);
    expect(result.findings).toHaveLength(4);
    const alloc = result.findings.find((f) => f.kind === "allocation")!;
    expect(alloc.problemHe).toContain("חשבון 1147 של נ.ת.ב. תשתיות ופיתוח בע״מ, 180,000 ₪, שויך לסעיף 02-שלד");
    expect(alloc.impact.labelHe).toBe("ללא שינוי בסה״כ");
    expect(alloc.sources.some((s) => s.kind === "history" && s.labelHe.includes("6 חשבונות קודמים"))).toBe(true);
    expect(alloc.sources.some((s) => s.kind === "changelog" && s.labelHe.includes("02-שלד"))).toBe(true);
    expect(alloc.sources.some((s) => s.kind === "contract" && s.labelHe.includes("אינו קבלן משנה מאושר"))).toBe(true);
    // one question, not two: approving the fix is the answer that writes it to the ERP
    expect(alloc.decision.options.map((o) => o.labelHe)).toEqual(["כן — לעדכן לפיתוח במערכת המידע", "כן — להעביר לשרית לתיקון", "לא, נשאר בשלד", "לא בטוח"]);
    expect(recordedBySection(edited.invoices, CURRENT_CONTROL)["02"]).toBe(8_580_000);
    expect(recordedBySection(edited.invoices, CURRENT_CONTROL)["07"]).toBe(2_100_000);
  });

  it("unit finding reads the quote and appendix; price finding is +240,000; coverage finding is not yet estimated", () => {
    const { findings, positives } = runChecks(processedPkg, erp, draft, CURRENT_CONTROL);
    const unit = findings.find((f) => f.kind === "unit")!;
    expect(unit.record.id).toBe("2291");
    expect(unit.checkHe).toContain("57,600 ₪ נכון");
    expect(unit.sources.some((s) => s.documentId === "quote_pladot_12t")).toBe(true);
    expect(unit.decision.options[0].labelHe).toBe("כן — לתקן ל-12 טון במערכת המידע");
    const price = findings.find((f) => f.kind === "price")!;
    expect(price.impact).toMatchObject({ kind: "amount", amount: 240_000 });
    expect(price.meaningHe).toContain("3,240,000 ₪");
    expect(price.meaningHe).toContain("8%");
    expect(price.notesHe?.some((n) => n.includes("2240"))).toBe(true);
    expect(price.sources.some((s) => s.refId === "2291")).toBe(true);
    const coverage = findings.find((f) => f.kind === "coverage")!;
    expect(coverage.impact.kind).toBe("unknown");
    expect(coverage.record.id).toBe("57.03.040");
    expect(coverage.sources.some((s) => s.anchor === "removed")).toBe(true);
    expect(coverage.decision.freeText).toBe(true);
    expect(positives.map((p) => p.sectionId)).toEqual(["05"]);
  });

  it("the five traps do not fire", () => {
    const { findings } = runChecks(brokenPkg, erp, draft, CURRENT_CONTROL);
    const crane = pkg.invoices.find((i) => i.descriptionHe === "מנוף צריח — שלד בניין A")!;
    expect(crane.sectionId).toBe("01");
    expect(findings.some((f) => f.record.id === String(crane.id))).toBe(false);
    expect(findings.some((f) => f.record.id === "2240")).toBe(false);
    const kg = pkg.invoices.find((i) => i.unit === "ק״ג")!;
    expect(findings.some((f) => f.record.id === String(kg.id))).toBe(false);
    expect(findings.some((f) => f.record.type === "boq_line" && f.record.id.startsWith("17."))).toBe(false);
    expect(findings.some((f) => f.sectionId === "04")).toBe(false);
  });
});
