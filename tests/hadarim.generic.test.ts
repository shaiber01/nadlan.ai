import { describe, expect, it } from "vitest";
import { checkAllocation, checkUnits, isContingency, sectionLabel, sectionShort } from "../src/hadarim/engine/checks";
import { createInvoice, initialState, pkg, updateInvoiceSection, updatePurchaseOrder } from "../src/hadarim/engine/commands";
import { recordedBySection, workingForecast } from "../src/hadarim/engine/forecast";
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
