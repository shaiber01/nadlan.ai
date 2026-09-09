import { describe, expect, it } from "vitest";
import { checkAllocation, checkOrderAllocation, checkUnits, isContingency, sectionLabel, sectionShort } from "../src/hadarim/engine/checks";
import { createInvoice, initialState, pkg, setReportConfig, updateInvoiceBuilding, updateInvoiceSection, updatePurchaseOrder, updatePurchaseOrderSection } from "../src/hadarim/engine/commands";
import { recordedBySection, workingForecast } from "../src/hadarim/engine/forecast";
import { addAdjustment } from "../src/hadarim/engine/operations";
import { buildReport } from "../src/hadarim/engine/report";

/**
 * The engine is generic: whatever is keyed into the ERP flows through the forecast, the checks and the
 * report by the data alone. Every expectation here is derived from the record that was written, not from
 * a value of the demo script.
 */

const wf = (s: ReturnType<typeof initialState>) => workingForecast(pkg, s.erp, s.control.adjustments, s.control.controlDate);

describe("generic ERP → forecast", () => {
  it("an arbitrary invoice into a section without a contract raises recorded and the EAC by its amount", () => {
    const seed = initialState();
    const target = pkg.sections.find((s) => s.contractIds.length === 0 && s.kind === "works")!;
    const before = wf(seed).sections.find((x) => x.sectionId === target.id)!;
    const [s, inv] = createInvoice(seed, { supplierId: pkg.suppliers[3].id, supplierDocNo: "GEN-1", date: "2026-08-20", amount: 98_765, descriptionHe: "בדיקה", sectionId: target.id, contractId: null, attachmentId: null, byId: "SARIT" });
    const after = wf(s).sections.find((x) => x.sectionId === target.id)!;
    expect(inv.id).toBe(Math.max(...seed.erp.invoices.map((i) => i.id)) + 1);
    expect(after.recorded - before.recorded).toBe(98_765);
    expect(after.eac - before.eac).toBe(98_765);
    expect(wf(s).totalEac - wf(seed).totalEac).toBe(98_765);
    expect(recordedBySection(pkg.sections, s.erp.invoices, s.control.controlDate)[target.id]).toBe(before.recorded + 98_765);
  });

  it("an invoice against a fixed-price contract moves recorded up and the remaining commitment down; the EAC stays", () => {
    const seed = initialState();
    const contract = pkg.contracts.find((c) => c.amount != null && !c.closed && wf(seed).sections.find((x) => x.sectionId === c.sectionId)!.remainingCommitment > 100_000)!;
    const before = wf(seed).sections.find((x) => x.sectionId === contract.sectionId)!;
    const [s, inv] = createInvoice(seed, { supplierId: contract.supplierId, supplierDocNo: "GEN-2", date: "2026-08-20", amount: 60_000, descriptionHe: "חשבון חלקי", sectionId: contract.sectionId, contractId: contract.id, attachmentId: null, byId: "SARIT" });
    const after = wf(s).sections.find((x) => x.sectionId === contract.sectionId)!;
    expect(inv.retentionPct).toBe(contract.retentionPct);
    expect(inv.cumulativeNow).toBe((inv.cumulativePrev ?? 0) + 60_000);
    expect(after.recorded - before.recorded).toBe(60_000);
    expect(before.remainingCommitment - after.remainingCommitment).toBe(60_000);
    expect(after.eac).toBe(before.eac);
  });

  it("an invoice received after the cutoff is not recorded in this control but is visible as an after-cutoff change", () => {
    const seed = initialState();
    const target = pkg.sections.find((s) => s.contractIds.length === 0 && s.kind === "works")!;
    const [s] = createInvoice(seed, { supplierId: pkg.suppliers[3].id, supplierDocNo: "GEN-3", date: "2026-09-04", amount: 40_000, descriptionHe: "אחרי החתך", sectionId: target.id, contractId: null, attachmentId: null, byId: "SARIT" });
    expect(wf(s).totalRecorded).toBe(wf(seed).totalRecorded);
    expect(buildReport(pkg, s).appendices.afterCutoffHe.join(" ")).toContain("קליטה");
  });
});

describe("generic checks", () => {
  it("any invoice moved to a section its contract does not belong to becomes an allocation finding, and only it", () => {
    const seed = initialState();
    const victim = seed.erp.invoices.find((i) => i.contractId && i.id !== 1147 && pkg.contracts.find((c) => c.id === i.contractId)!.sectionId === i.sectionId)!;
    const wrong = pkg.sections.find((s) => s.id !== victim.sectionId)!.id;
    const moved = updateInvoiceSection(seed, victim.id, wrong, "SARIT");
    const findings = checkAllocation(pkg, moved.erp);
    expect(findings.map((f) => f.record.id)).toEqual([String(victim.id)]);
    expect(findings[0].decision.options[0].labelHe).toBe(`כן, ל${sectionShort(victim.sectionId)}`);
    const back = updateInvoiceSection(moved, victim.id, victim.sectionId, "SARIT");
    expect(checkAllocation(pkg, back.erp)).toHaveLength(0);
  });

  it("the seed's orders are all where their contract, their invoices or their supplier's records put them", () => {
    expect(checkOrderAllocation(pkg, initialState().erp)).toHaveLength(0);
  });

  it("an order moved to a section its contract does not belong to becomes an allocation finding on the order, and only it", () => {
    const seed = initialState();
    const po = seed.erp.purchaseOrders.find((p) => p.contractId && pkg.contracts.find((c) => c.id === p.contractId)!.sectionId === p.sectionId)!;
    const wrong = pkg.sections.find((s) => s.id !== po.sectionId)!.id;
    const moved = updatePurchaseOrderSection(seed, po.id, wrong, "EYAL");
    const findings = checkOrderAllocation(pkg, moved.erp);
    expect(findings.map((f) => f.record)).toEqual([{ type: "po", id: String(po.id) }]);
    expect(findings[0]).toMatchObject({ id: `F-ALLOC-PO-${po.id}`, kind: "allocation", sectionId: wrong, impact: { kind: "none" } });
    expect(findings[0].decision.options[0].labelHe).toBe(`כן, ל${sectionShort(po.sectionId)}`);
    expect(findings[0].sources.map((x) => x.kind)).toEqual(expect.arrayContaining(["po", "contract", "changelog"]));
    // the invoice check is untouched by an order move
    expect(checkAllocation(pkg, moved.erp)).toHaveLength(0);
    expect(checkOrderAllocation(pkg, updatePurchaseOrderSection(moved, po.id, po.sectionId, "EYAL").erp)).toHaveLength(0);
  });

  it("an order without a contract follows the invoices billed against it, else the supplier's other records, else nothing", () => {
    const seed = initialState();
    const other = (id: string) => pkg.sections.find((s) => s.id !== id)!.id;
    // (a) invoices against it: detach the contract from an order that has invoices and move the order alone
    const withInvoices = seed.erp.purchaseOrders.find((p) => seed.erp.invoices.some((i) => i.poId === p.id))!;
    const split = { ...seed, erp: { ...seed.erp, purchaseOrders: seed.erp.purchaseOrders.map((p) => (p.id === withInvoices.id ? { ...p, contractId: null, sectionId: other(p.sectionId) } : p)) } };
    const a = checkOrderAllocation(pkg, split.erp, withInvoices.id);
    expect(a).toHaveLength(1);
    expect(a[0].decision.options[0].labelHe).toBe(`כן, ל${sectionShort(withInvoices.sectionId)}`);
    expect(a[0].sources.some((x) => x.kind === "history" && x.labelHe.includes("כנגד ההזמנה"))).toBe(true);
    // (b) neither contract nor invoices: the supplier's other records, when they all sit on one section
    const lone = seed.erp.purchaseOrders.find((p) => {
      if (p.contractId || seed.erp.invoices.some((i) => i.poId === p.id)) return false;
      const records = [...seed.erp.purchaseOrders.filter((x) => x.supplierId === p.supplierId && x.id !== p.id), ...seed.erp.invoices.filter((i) => i.supplierId === p.supplierId)];
      return records.length >= 2 && new Set(records.map((r) => r.sectionId)).size === 1;
    })!;
    const b = checkOrderAllocation(pkg, updatePurchaseOrderSection(seed, lone.id, other(lone.sectionId), "EYAL").erp, lone.id);
    expect(b).toHaveLength(1);
    expect(b[0].decision.options[0].labelHe).toBe(`כן, ל${sectionShort(lone.sectionId)}`);
    // (c) a supplier with a single other record determines nothing
    const single = { ...seed, erp: { ...seed.erp, purchaseOrders: [...seed.erp.purchaseOrders.filter((p) => p.supplierId !== lone.supplierId), { ...lone, id: 99_001, sectionId: other(lone.sectionId) }, { ...lone, id: 99_002 }], invoices: seed.erp.invoices.filter((i) => i.supplierId !== lone.supplierId) } };
    expect(checkOrderAllocation(pkg, single.erp, 99_001)).toHaveLength(0);
  });

  it("an order re-keyed with kilograms as tons on any framework agreement is caught by the unit check", () => {
    const seed = initialState();
    const framework = pkg.contracts.find((c) => c.priceAppendices?.length)!;
    const po = seed.erp.purchaseOrders.find((p) => p.contractId === framework.id && p.status === "פתוחה" && !p.attachmentId);
    const target = po ?? seed.erp.purchaseOrders.find((p) => p.contractId === framework.id && p.status === "פתוחה")!;
    // key it "in kilograms": a thousand times the quantity at a thousandth of the price; the amount is unchanged
    const broken = updatePurchaseOrder(seed, target.id, { qty: target.qty * 1000, unitPrice: target.unitPrice / 1000 }, "EYAL");
    const findings = checkUnits(pkg, broken.erp, target.id);
    expect(findings).toHaveLength(1);
    expect(findings[0].record.id).toBe(String(target.id));
  });

  it("section names and the contingency section come from the package, not from code", () => {
    expect(sectionLabel(pkg.sections[0].id)).toBe(`${pkg.sections[0].id}-${pkg.sections[0].shortHe}`);
    const contingency = pkg.sections.find((s) => s.kind === "contingency")!;
    expect(isContingency(contingency.id)).toBe(true);
    expect(pkg.sections.filter((s) => s.kind !== "contingency").every((s) => !isContingency(s.id))).toBe(true);
    const r = buildReport(pkg, initialState());
    expect(r.contingency.original).toBe(contingency.budget);
    expect(r.trends.eacSeries.map((p) => p.value)).toEqual([...pkg.forecasts.filter((f) => f.status === "final").map((f) => f.totalEac), r.working.totalEac]);
  });
});

describe("generic building split", () => {
  it("splits by the project's own buildings, whatever their number and names, and sums back to the section totals", () => {
    const seed = initialState();
    const state = setReportConfig(seed, { splitByBuilding: true });
    const three = { ...pkg, project: { ...pkg.project, buildings: [...pkg.project.buildings, { id: "C", floors: 6, floorsCast: 2, unitsPerFloor: 4 }] } };
    const r = buildReport(three, state);
    const rows = r.sections.byBuilding!;
    expect(rows.map((x) => x.building)).toEqual(["A", "B", "C", "חניון", "משותף"]);
    expect(rows.map((x) => x.labelHe)).toEqual(["בניין A", "בניין B", "בניין C", "חניון", "משותף"]);
    expect(r.sections.byBuildingOptions.map((o) => o.id)).toEqual(["A", "B", "C", "משותף"]);
    for (const key of ["budget", "recorded", "committed", "remainingCommitment", "uncovered", "eac"] as const) {
      expect(rows.reduce((a, x) => a + x[key], 0)).toBe(r.sections.totals[key]);
    }
    // a section split by floors cast follows the buildings' floors: 7 : 5 : 2 of its budget
    const byFloors = pkg.sections.find((s) => s.split === "by_floors")!;
    const shareOf = (id: string) => three.project.buildings.find((b) => b.id === id)!.floorsCast / 14;
    const two = buildReport(pkg, state).sections.byBuilding!;
    const budgetDelta = (id: string) => two.find((x) => x.building === id)!.budget - rows.find((x) => x.building === id)!.budget;
    expect(budgetDelta("A")).toBeGreaterThan(0); // A's share shrinks when a third building joins
    expect(Math.abs(rows.find((x) => x.building === "C")!.budget - pkg.sections.filter((s) => s.split === "by_floors").reduce((a, s) => a + s.budget, 0) * shareOf("C") - pkg.sections.filter((s) => s.split === "by_units").reduce((a, s) => a + s.budget, 0) * (24 / 72) - pkg.sections.filter((s) => s.split === "per_building").reduce((a, s) => a + s.budget, 0) / 3)).toBeLessThan(5);
    expect(byFloors.split).toBe("by_floors");
  });

  it("an invoice can only be tagged with a building of the project or 'משותף'", () => {
    const seed = initialState();
    const inv = seed.erp.invoices[0];
    expect(() => updateInvoiceBuilding(seed, inv.id, "Z", "EYAL")).toThrow(/בניין Z/);
    const tagged = updateInvoiceBuilding(seed, inv.id, pkg.project.buildings[0].id, "EYAL");
    expect(tagged.erp.invoices.find((i) => i.id === inv.id)!.building).toBe(pkg.project.buildings[0].id);
    expect(updateInvoiceBuilding(seed, inv.id, "משותף", "EYAL").erp.invoices.find((i) => i.id === inv.id)!.building).toBe("משותף");
  });
});

describe("generic bucket names", () => {
  it("the shared and parking buckets are the project's own ids and labels", () => {
    const state = setReportConfig(initialState(), { splitByBuilding: true });
    const renamed = { ...pkg, project: { ...pkg.project, buckets: { shared: { id: "כללי", labelHe: "עלויות כלליות" }, parking: { id: "מרתף", labelHe: "מרתף חניה" } } } };
    // invoices keep the seed's shared tag, which is no longer this project's shared id: they count as shared and are noted
    const r = buildReport(renamed, state);
    const rows = r.sections.byBuilding!;
    expect(rows.map((x) => x.building)).toEqual(["A", "B", "מרתף", "כללי"]);
    expect(rows.map((x) => x.labelHe)).toEqual(["בניין A", "בניין B", "מרתף חניה", "עלויות כלליות"]);
    expect(r.sections.byBuildingOptions.at(-1)).toEqual({ id: "כללי", labelHe: "עלויות כלליות", kind: "shared" });
    expect(r.sections.byBuildingNoteHe).toContain("עלויות כלליות");
    expect(rows.reduce((a, x) => a + x.eac, 0)).toBe(r.sections.totals.eac);
    // with the seed's own buckets the seed's tags are recognised: nothing is reported as an unknown tag
    expect(buildReport(pkg, state).sections.byBuildingNoteHe).not.toContain("שאינו בפרויקט");
  });
});

describe("report statements are backed by data or by the controller", () => {
  it("the contingency section reports change orders and claims only when the controller recorded them", async () => {
    const { addNote } = await import("../src/hadarim/engine/operations");
    const seed = initialState();
    const bare = buildReport(pkg, seed);
    expect(bare.contingency.pendingChangeOrdersHe).toContain("לא נרשמו");
    expect(bare.contingency.claimsHe).toContain("לא נרשמו");
    let s = addNote(seed, { kind: "change_order", textHe: "פקודת שינוי 7 — תוספת מעקות, 85,000 ₪, ממתינה לאישור" })[0];
    s = addNote(s, { kind: "claim", textHe: "דרישת קבלן השלד להתייקרות בטון" })[0];
    const r = buildReport(pkg, s);
    expect(r.contingency.pendingChangeOrdersHe).toBe("פקודת שינוי 7 — תוספת מעקות, 85,000 ₪, ממתינה לאישור");
    expect(r.contingency.claimsHe).toBe("דרישת קבלן השלד להתייקרות בטון");
  });
});

describe("materiality is a project setting", () => {
  it("tighter thresholds on the project row make more sections material and change the report's stated threshold", () => {
    const state = initialState();
    const standard = buildReport(pkg, state);
    const strict = { ...pkg, project: { ...pkg.project, materiality: { absolute: 1, pctOfSection: 0, absoluteAlways: 1, budgetSharePct: 100, softBasisPct: 0 } } };
    const r = buildReport(strict, state);
    expect(r.sections.materialityHe).toContain("1 ₪");
    expect(standard.sections.materialityHe).toContain("100,000 ₪");
    // with a 1 ₪ threshold every section with any variance is highlighted; with the standard's, only the material ones
    const varied = r.sections.rows.filter((x) => x.variance !== 0 && !x.isContingency).length;
    expect(r.sections.rows.filter((x) => x.highlighted).length).toBeGreaterThanOrEqual(varied);
    expect(standard.sections.rows.filter((x) => x.highlighted).length).toBeLessThanOrEqual(r.sections.rows.filter((x) => x.highlighted).length);
    expect(r.appendices.definitionsHe.join(" ")).toContain("100% מהתקציב");
  });
});

describe("risk assumptions are a project setting", () => {
  it("the quote-expiry exposure and the price step come from the project row and are stated in the risk rows", () => {
    const seed = initialState();
    const quote = pkg.documents.find((d) => d.kind === "quote" && d.facts?.validUntil)!;
    const withQuote = addAdjustment(seed, { sectionId: pkg.boq[0].sectionId, changeType: "coverage_gap", descriptionHe: "אומדן לפי הצעה", basis: "quote", basisHe: "הצעה", sourceRef: "בדיקה", amount: 200_000, documentId: quote.id })[0];
    const custom = { ...pkg, project: { ...pkg.project, riskPolicy: { quoteExpiryExposurePct: 50, priceStep: 250 } } };
    const r = buildReport(custom, withQuote);
    const quoteRisk = r.risks.find((x) => x.topicHe.startsWith("תוקף הצעת המחיר"))!;
    expect(quoteRisk.exposureHe).toContain("100,000 ₪");
    expect(quoteRisk.exposureHe).toContain("50%");
    const appendixRisk = r.risks.find((x) => x.topicHe.startsWith("עדכון נוסף במחיר"))!;
    expect(appendixRisk.exposureHe).toContain("לכל 250 ₪");
    const standard = buildReport(pkg, withQuote);
    expect(standard.risks.find((x) => x.topicHe.startsWith("תוקף הצעת המחיר"))!.exposureHe).toContain("25%");
    expect(standard.risks.find((x) => x.topicHe.startsWith("עדכון נוסף במחיר"))!.exposureHe).toContain("לכל 100 ₪");
  });
});
