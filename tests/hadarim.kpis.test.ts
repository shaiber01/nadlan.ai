import { describe, expect, it } from "vitest";
import { COST_GROUPS, MATERIAL_INDICES, costGroupOf } from "../src/hadarim/data/bluebook";
import { STANDARD_KPI_POLICY } from "../src/hadarim/data/types";
import { createInvoice, initialState, pkg, setReportConfig } from "../src/hadarim/engine/commands";
import { workingForecast } from "../src/hadarim/engine/forecast";
import { buildKpis, rangeStatus, scaleMoney, sectionCostGroup } from "../src/hadarim/engine/kpis";
import { buildReport } from "../src/hadarim/engine/report";
import { reportToMarkdown } from "../src/hadarim/export/markdown";
import { reportToWorkbook } from "../src/hadarim/export/xlsx";

/**
 * Standard §2א — the cost and quantity indices. Every expectation is derived from the package (gross area,
 * units, the bill of quantities, the invoices) and the working forecast, never from a pre-agreed figure.
 */

const wf = (s: ReturnType<typeof initialState>) => workingForecast(pkg, s.erp, s.control.adjustments, s.control.controlDate);

describe("cost per m² and per unit", () => {
  it("the totals are the working forecast divided by the project's gross area and units, whole shekels", () => {
    const s = initialState();
    const r = buildReport(pkg, s);
    const k = r.kpis!;
    const f = wf(s);
    expect(k.grossSqm).toBe(pkg.project.grossSqm);
    expect(k.units).toBe(pkg.project.units);
    expect(k.total.eacPerSqm).toBe(Math.round(f.totalEac / pkg.project.grossSqm));
    expect(k.total.budgetPerSqm).toBe(Math.round(f.totalBudget / pkg.project.grossSqm));
    expect(k.total.recordedPerSqm).toBe(Math.round(f.totalRecorded / pkg.project.grossSqm));
    expect(k.total.eacPerUnit).toBe(Math.round(f.totalEac / pkg.project.units));
    expect(Number.isInteger(k.total.eacPerSqm)).toBe(true);
    expect(k.denominatorHe).toContain(pkg.project.grossSqm.toLocaleString("he-IL"));
  });

  it("the cost groups partition the sections once each and add up to the sections table", () => {
    const r = buildReport(pkg, initialState());
    const k = r.kpis!;
    const ids = k.groups.flatMap((g) => g.sectionIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(pkg.sections.map((s) => s.id).sort());
    expect(k.groups.reduce((a, g) => a + g.eac, 0)).toBe(r.sections.totals.eac);
    expect(k.groups.reduce((a, g) => a + g.budget, 0)).toBe(r.sections.totals.updatedBudget);
    expect(k.groups.reduce((a, g) => a + g.recorded, 0)).toBe(r.sections.totals.recorded);
    expect(Math.round(k.groups.reduce((a, g) => a + g.sharePct, 0))).toBe(100);
    for (const g of k.groups) {
      expect(g.eacPerSqm).toBe(Math.round(g.eac / pkg.project.grossSqm));
      expect(g.factPct + g.commitmentPct + g.estimatePct).toBeGreaterThanOrEqual(98);
      expect(g.factPct + g.commitmentPct + g.estimatePct).toBeLessThanOrEqual(102);
    }
    // the group order is the reference order; overhead and contingency sections land in their own groups
    const overhead = pkg.sections.find((s) => s.kind === "overhead")!;
    const contingency = pkg.sections.find((s) => s.kind === "contingency")!;
    expect(sectionCostGroup(pkg, overhead.id).id).toBe("overhead");
    expect(sectionCostGroup(pkg, contingency.id).id).toBe("contingency");
    for (const s of pkg.sections.filter((x) => x.kind === "works")) expect(sectionCostGroup(pkg, s.id).id).toBe(costGroupOf(s.chapters?.[0]).id);
    expect(k.groups.map((g) => g.id)).toEqual(COST_GROUPS.map((g) => g.id).filter((id) => k.groups.some((g) => g.id === id)));
  });

  it("every section carries its own ₪/m² and the basis composition of its forecast", () => {
    const r = buildReport(pkg, initialState());
    for (const row of r.sections.rows) {
      const k = r.kpis!.sections.find((x) => x.sectionId === row.sectionId)!;
      expect(k.eacPerSqm).toBe(Math.round(row.eac / pkg.project.grossSqm));
      expect(k.eacPerUnit).toBe(Math.round(row.eac / pkg.project.units));
      if (row.eac > 0) {
        expect(row.factPct).toBe(Math.round((row.recorded / row.eac) * 100));
        expect(row.estimatePct).toBe(Math.round((row.uncovered / row.eac) * 100));
      }
    }
    expect(r.sections.totals.factPct + r.sections.totals.commitmentPct + r.sections.totals.estimatePct).toBeGreaterThanOrEqual(99);
    expect(r.sections.softBasisPct).toBe(pkg.project.materiality.softBasisPct);
  });

  it("scaleMoney restates the money keys of a row and leaves percentages and flags alone", () => {
    const r = buildReport(pkg, initialState());
    const row = r.sections.rows[1];
    const scaled = scaleMoney(row, pkg.project.grossSqm, ["eac", "budget"]);
    expect(scaled.eac).toBe(Math.round(row.eac / pkg.project.grossSqm));
    expect(scaled.budget).toBe(Math.round(row.budget / pkg.project.grossSqm));
    expect(scaled.recorded).toBe(row.recorded);
    expect(scaled.basisPct).toBe(row.basisPct);
    expect(scaled.highlighted).toBe(row.highlighted);
    expect(scaleMoney(row, 0, ["eac"])).toBe(row);
  });

  it("the per-m² trend follows the EAC series and a project without an area yields no ₪/m²", () => {
    const s = setReportConfig(initialState(), { includeTrends: true });
    const r = buildReport(pkg, s);
    expect(r.kpis!.eacPerSqmSeries.map((p) => p.labelHe)).toEqual(r.trends.eacSeries.map((p) => p.labelHe));
    expect(r.kpis!.eacPerSqmSeries.map((p) => p.value)).toEqual(r.trends.eacSeries.map((p) => Math.round(p.value / pkg.project.grossSqm)));
    const noArea = { ...pkg, project: { ...pkg.project, grossSqm: 0 } };
    const k = buildKpis(noArea, s.erp, wf(s), r.trends.eacSeries);
    expect(k.total.eacPerSqm).toBe(0);
    expect(k.total.rangeStatus).toBe("none");
    expect(k.materials.every((m) => m.perSqm == null)).toBe(true);
    expect(k.notesHe[0]).toContain("לא הוגדר");
  });
});

describe("material quantity indices", () => {
  it("reads each index off the bill of quantities by chapter and unit and divides by the gross area", () => {
    const r = buildReport(pkg, initialState());
    const k = r.kpis!;
    for (const def of MATERIAL_INDICES) {
      const lines = pkg.boq.filter((l) => l.chapter === def.chapter && l.unit === def.unit);
      const row = k.materials.find((m) => m.id === def.id);
      if (!lines.length) {
        expect(row).toBeUndefined();
        continue;
      }
      const qty = lines.reduce((a, l) => a + l.qty, 0);
      expect(row!.boqQty).toBe(qty);
      expect(row!.perSqm).toBeCloseTo((qty * def.perSqmFactor) / pkg.project.grossSqm, 6);
      expect(row!.perSqmUnitHe).toBe(def.perSqmUnitHe);
      expect([...row!.sectionIds].sort()).toEqual([...new Set(lines.map((l) => l.sectionId))].sort());
      expect(row!.budgetUnitPrice).toBe(Math.round(lines.reduce((a, l) => a + l.qty * (l.unitPrice ?? 0), 0) / qty));
    }
    // steel per concrete is derived from the two BOQ quantities
    const steel = k.materials.find((m) => m.id === "steel");
    const concrete = k.materials.find((m) => m.id === "concrete");
    const derived = k.derived.find((d) => d.id === "steel_per_concrete");
    if (steel && concrete) expect(derived!.value).toBeCloseTo((steel.boqQty * 1000) / concrete.boqQty, 6);
  });

  it("'delivered' comes only from invoices that carry a quantity, converted into the index unit; otherwise the note says what it rests on", () => {
    const s = initialState();
    const r = buildReport(pkg, s);
    const k = r.kpis!;
    for (const m of k.materials) {
      const invoices = s.erp.invoices.filter((i) => m.sectionIds.includes(i.sectionId) && i.status !== "בבדיקה" && i.dateReceived < s.control.controlDate && i.quantity != null && i.unit);
      const withQty = invoices.filter((i) => i.unit === m.unit || (i.unit === "ק״ג" && m.unit === "טון"));
      if (withQty.length) {
        const expected = withQty.reduce((a, i) => a + (i.unit === m.unit ? i.quantity! : i.quantity! / 1000), 0);
        expect(m.deliveredQty).toBeCloseTo(expected, 1);
        expect(m.deliveredPct).toBe(Math.round((expected / m.boqQty) * 100));
        expect(m.paidUnitPrice).toBe(Math.round(withQty.reduce((a, i) => a + i.amount, 0) / expected));
      } else {
        expect(m.deliveredQty).toBeNull();
        expect(m.deliveredNoteHe).toContain("לפי הוצאת");
      }
    }
  });

  it("an invoice keyed with a quantity moves the delivered figure and the average paid price", () => {
    const seed = initialState();
    const before = buildReport(pkg, seed).kpis!.materials.find((m) => m.deliveredQty != null)!;
    const section = pkg.sections.find((s) => s.id === before.sectionIds[0])!;
    const [created, inv] = createInvoice(seed, { supplierId: pkg.suppliers[0].id, supplierDocNo: "KPI-1", date: "2026-08-20", amount: 50_000, descriptionHe: "אספקה", sectionId: section.id, contractId: section.contractIds[0] ?? null, attachmentId: null, byId: "SARIT" });
    // the ERP carries the delivered quantity on the invoice row
    const s = { ...created, erp: { ...created.erp, invoices: created.erp.invoices.map((i) => (i.id === inv.id ? { ...i, status: "אושר" as const, quantity: 10, unit: before.unit, unitPrice: 5_000 } : i)) } };
    const after = buildReport(pkg, s).kpis!.materials.find((m) => m.id === before.id)!;
    expect(after.deliveredQty! - before.deliveredQty!).toBeCloseTo(10, 6);
    expect(after.paidUnitPrice).toBe(Math.round((before.paidUnitPrice! * before.deliveredQty! + 50_000) / after.deliveredQty!));
  });

  it("the current price is the appendix in force for a framework section, the contract for covered lines, an estimate for uncovered ones", () => {
    const r = buildReport(pkg, initialState());
    const k = r.kpis!;
    for (const m of k.materials) {
      const framework = pkg.contracts.find((c) => m.sectionIds.includes(c.sectionId) && c.priceAppendices?.length);
      const lines = pkg.boq.filter((l) => l.chapter === m.chapter && l.unit === m.unit);
      if (framework) {
        expect(m.currentPriceKind).toBe("appendix");
        expect(m.sensitivityHe).toContain(`${pkg.project.riskPolicy.priceStep.toLocaleString("he-IL")} ₪/${m.unit}`);
      } else if (lines.every((l) => l.coverage === "covered")) {
        expect(m.currentPriceKind).toBe("contract");
        expect(m.currentUnitPrice).toBe(m.budgetUnitPrice);
        expect(m.sensitivityHe).toBeNull();
      } else if (lines.every((l) => l.coverage !== "covered")) {
        expect(m.currentPriceKind).toBe("estimate");
      }
    }
  });

  it("cost per m² is the section's EAC when the material is the whole section, else the BOQ value — and says which", () => {
    const r = buildReport(pkg, initialState());
    for (const m of r.kpis!.materials) {
      const own = pkg.boq.filter((l) => m.sectionIds.includes(l.sectionId));
      const lines = pkg.boq.filter((l) => l.chapter === m.chapter && l.unit === m.unit);
      const eac = r.sections.rows.filter((x) => m.sectionIds.includes(x.sectionId)).reduce((a, x) => a + x.eac, 0);
      if (own.length === lines.length) {
        expect(m.costPerSqm).toBe(Math.round(eac / pkg.project.grossSqm));
        expect(m.costBasisHe).toContain("תחזית לגמר");
      } else {
        expect(m.costPerSqm).toBe(Math.round(m.boqValue! / pkg.project.grossSqm));
        expect(m.costBasisHe).toContain("כתב הכמויות");
      }
    }
  });

  it("the reference ranges are the project's KPI policy: the standard defaults, a project's own, or none", () => {
    expect(rangeStatus(90, { min: 80, max: 130 })).toBe("within");
    expect(rangeStatus(140, { min: 80, max: 130 })).toBe("above");
    expect(rangeStatus(10, { min: 80, max: 130 })).toBe("below");
    expect(rangeStatus(10, null)).toBe("none");
    expect(rangeStatus(null, { min: 1, max: 2 })).toBe("none");
    const s = initialState();
    const standard = buildReport(pkg, s).kpis!;
    const steel = standard.materials.find((m) => m.id === "steel");
    if (steel) {
      expect(steel.range).toEqual(STANDARD_KPI_POLICY.ranges.steel);
      expect(steel.rangeStatus).toBe(rangeStatus(steel.perSqm, STANDARD_KPI_POLICY.ranges.steel));
      const tight = { ...pkg, project: { ...pkg.project, kpiPolicy: { ranges: { steel: { min: 1, max: 2 } } } } };
      const custom = buildReport(tight, s).kpis!;
      expect(custom.materials.find((m) => m.id === "steel")!.rangeStatus).toBe("above");
      expect(custom.materials.find((m) => m.id === "concrete")!.rangeStatus).toBe("none");
      expect(custom.total.range).toBeNull();
      expect(custom.total.rangeStatus).toBe("none");
    }
    expect(standard.total.range).toEqual(STANDARD_KPI_POLICY.ranges.cost_per_sqm);
  });

  it("a material section of the report carries the ids of the indices its BOQ lines feed; the exports render §2א", () => {
    const s = setReportConfig(initialState(), { includeTrends: true });
    const r = buildReport(pkg, s);
    for (const m of r.material) {
      const expected = MATERIAL_INDICES.filter((d) => pkg.boq.some((l) => l.sectionId === m.sectionId && l.chapter === d.chapter && l.unit === d.unit)).map((d) => d.id);
      expect(m.materialIds).toEqual(expected);
    }
    const md = reportToMarkdown(r);
    expect(md).toContain("## 2א. מדדי עלות וכמות");
    expect(md).toContain(r.kpis!.total.eacPerSqm.toLocaleString("he-IL"));
    for (const m of r.kpis!.materials) expect(md).toContain(m.labelHe);
    const ceo = reportToMarkdown(r, "ceo");
    expect(ceo).toContain("עלות למ״ר ברוטו");
    const xlsx = reportToWorkbook(r);
    expect(xlsx.byteLength).toBeGreaterThan(1000);
  });

  it("the structure progress is read from the project's buildings, floors cast over floors planned", () => {
    const r = buildReport(pkg, initialState());
    const b = pkg.project.buildings;
    const cast = b.reduce((a, x) => a + x.floorsCast, 0);
    const planned = b.reduce((a, x) => a + x.floors, 0);
    expect(r.kpis!.structureProgress?.pct).toBe(Math.round((cast / planned) * 100));
    expect(r.kpis!.structureProgress?.labelHe).toContain(`${cast} מתוך ${planned}`);
  });
});
