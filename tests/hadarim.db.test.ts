import { describe, expect, it } from "vitest";
import { generateHadarimPackage } from "../src/hadarim/data/generate";
import { loadPackage } from "../src/hadarim/db/client";
import { runChecks } from "../src/hadarim/engine/checks";
import { workingForecast } from "../src/hadarim/engine/forecast";

/**
 * Round trip against the live Supabase project: the seeded database must load back as the same package
 * the generator produces, and the engine must give the same answers on it. Opt-in (needs network and a
 * freshly reset project): RUN_DB_TESTS=1 npx vitest run tests/hadarim.db.test.ts
 */
const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("Hadarim database round trip", () => {
  it("loads the seeded project as the generator's package", async () => {
    const fromDb = await loadPackage("HADARIM");
    const local = generateHadarimPackage();
    expect(fromDb.project).toEqual(local.project);
    expect(fromDb.people).toEqual(local.people);
    expect(fromDb.suppliers.map((s) => s.id).sort()).toEqual(local.suppliers.map((s) => s.id).sort());
    expect(fromDb.sections).toEqual(local.sections);
    expect(fromDb.contracts.map((c) => ({ ...c, exclusions: c.exclusions })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(local.contracts.slice().sort((a, b) => a.id.localeCompare(b.id)));
    expect(fromDb.invoices).toEqual(local.invoices.slice().sort((a, b) => a.id - b.id));
    expect(fromDb.purchaseOrders).toEqual(local.purchaseOrders.slice().sort((a, b) => a.id - b.id));
    expect(fromDb.boq).toEqual(local.boq);
    expect(fromDb.documents.map((d) => d.id).sort()).toEqual(local.documents.map((d) => d.id).sort());
    expect(fromDb.forecasts.map((f) => ({ controlDate: f.controlDate, status: f.status, totalEac: f.totalEac, sections: f.sections?.map((s) => ({ ...s, lines: s.lines })) ?? null }))).toEqual(
      local.forecasts.map((f) => ({ controlDate: f.controlDate, status: f.status, totalEac: f.totalEac, sections: f.sections?.map((s) => ({ ...s, lines: s.lines })) ?? null })),
    );
    const strip = (c: { recordType: string; recordId: string; field: string; before: string; after: string; at: string; byId: string; noteHe: string }) => ({ recordType: c.recordType, recordId: c.recordId, field: c.field, before: c.before, after: c.after, at: c.at, byId: c.byId, noteHe: c.noteHe });
    // the database orders the log chronologically; the generator lists it by id
    const byTime = (a: { at: string; recordId: string }, b: { at: string; recordId: string }) => (a.at === b.at ? a.recordId.localeCompare(b.recordId) : a.at.localeCompare(b.at));
    expect(fromDb.changeLog.map(strip).sort(byTime)).toEqual(local.changeLog.map(strip).sort(byTime));
  });

  it("runs the engine on database data with the same results", async () => {
    const pkg = await loadPackage("HADARIM");
    const draft = pkg.forecasts.find((f) => f.controlDate === "2026-09-01")!;
    const result = runChecks(pkg, { invoices: pkg.invoices, purchaseOrders: pkg.purchaseOrders, changeLog: pkg.changeLog }, draft, "2026-09-01");
    expect(result.findings.map((f) => f.kind).sort()).toEqual(["coverage", "price", "unit"]);
    const wf = workingForecast(pkg, { invoices: pkg.invoices, purchaseOrders: pkg.purchaseOrders, changeLog: pkg.changeLog }, [], "2026-09-01");
    expect(wf.totalEac).toBe(48_000_000);
    expect(wf.totalRecorded).toBe(20_070_000);
  });
});
