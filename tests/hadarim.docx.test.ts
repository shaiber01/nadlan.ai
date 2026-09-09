import { describe, expect, it } from "vitest";
import { confirmQuote, decide, initialState, pkg, reviewFindings, revealAllSteps, setPackage, startControl, updateInvoiceSection, setReportConfig } from "../src/hadarim/engine/commands";
import type { V2State } from "../src/hadarim/engine/model";
import { buildReport } from "../src/hadarim/engine/report";
import { exportReportDocx } from "../src/hadarim/export/docx";

// the revised BOQ page (boq_v5_ch57) processed, as the agent would before this control runs
setPackage({ ...pkg, documents: pkg.documents.map((d) => (d.id === "boq_v5_ch57" ? { ...d, facts: { removedLineIds: ["57.03.040"] }, factsSource: { method: "agent" as const, byId: "EYAL" as const } } : d)) });

const findingByKind = (s: V2State, kind: string) => s.control.findings.find((f) => f.kind === kind)!;

/** Scenes 1–6 of the script on the engine alone (same path as tests/hadarim.engine.test.ts). */
function runScript(): V2State {
  let s = revealAllSteps(startControl(updateInvoiceSection(initialState(), 1147, "02", "SARIT"), "תכיני בקרה תקציבית להדרים"));
  s = reviewFindings(s);
  const alloc = findingByKind(s, "allocation");
  s = decide(s, alloc.id, "yes_target");
  const unit = findingByKind(s, "unit");
  s = decide(s, unit.id, "yes_refer");
  const price = findingByKind(s, "price");
  s = decide(s, price.id, "all");
  const cov = findingByKind(s, "coverage");
  s = decide(s, cov.id, null, "צריך להזמין. יש הצעה בתיקייה");
  s = confirmQuote(s, cov.id, true);
  return s;
}

describe("Hadarim v2 — Word export", () => {
  it("produces a real .docx for the full report of the scripted control", async () => {
    let s = runScript();
    s = setReportConfig(s, { includeTrends: true, splitByBuilding: true });
    const report = buildReport(pkg, s);
    expect(report.trends.comparison).not.toBeNull();
    expect(report.sections.byBuilding).not.toBeNull();
    const blob = await exportReportDocx(report, "full");
    expect(blob.type).toContain("wordprocessingml");
    expect(blob.size).toBeGreaterThan(5 * 1024);
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).toEqual([0x50, 0x4b]); // zip signature "PK"
  });

  it("produces the one-page CEO version", async () => {
    const s = setReportConfig(runScript(), { ceoVersion: true });
    const blob = await exportReportDocx(buildReport(pkg, s), "ceo");
    expect(blob.size).toBeGreaterThan(2 * 1024);
  });

  it("does not throw on a state with no control run yet (empty tables)", async () => {
    const report = buildReport(pkg, initialState());
    expect(report.changes.forecast).toHaveLength(0);
    const blob = await exportReportDocx(report, "full");
    expect(blob.size).toBeGreaterThan(5 * 1024);
  });
});

describe("Hadarim v2 — Excel export", () => {
  it("produces a real .xlsx with one sheet per table of the standard", async () => {
    const { unzipSync, strFromU8 } = await import("fflate");
    const { reportToWorkbook } = await import("../src/hadarim/export/xlsx");
    const s = setReportConfig(runScript(), { includeTrends: true, splitByBuilding: true });
    const bytes = reportToWorkbook(buildReport(pkg, s), "full");
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const files = unzipSync(bytes);
    const workbook = strFromU8(files["xl/workbook.xml"]);
    for (const name of ["סיכום", "סעיפים", "לפי בניין", "שינויי תחזית 4א", "תיקוני נתונים 4ב", "סיכונים", "נושאים לטיפול", "יתרה לא מכוסה"]) expect(workbook).toContain(`name="${name}"`);
    const sections = strFromU8(files["xl/worksheets/sheet2.xml"]);
    expect(sections).toContain("<v>48000000</v>"); // the totals row carries the budget as a number
    expect(sections).toContain("<v>48360000</v>"); // and the working EAC
    const ceo = reportToWorkbook(buildReport(pkg, setReportConfig(s, { ceoVersion: true })), "ceo");
    expect(strFromU8(unzipSync(ceo)["xl/workbook.xml"])).toContain('name="שינויים"');
  });
});
