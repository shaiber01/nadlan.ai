import { describe, expect, it } from "vitest";
import { BLUE_BOOK_CHAPTERS, chapterLabelHe } from "../src/hadarim/data/bluebook";
import type { HBudgetChange, HadarimPackage } from "../src/hadarim/data/types";
import { initialState, pkg, setReportConfig } from "../src/hadarim/engine/commands";
import { budgetChangesBySection, workingForecast } from "../src/hadarim/engine/forecast";
import { buildReport } from "../src/hadarim/engine/report";
import { reportToMarkdown } from "../src/hadarim/export/markdown";
import { reportToWorkbook } from "../src/hadarim/export/xlsx";
import { tools } from "../src/hadarim/tools";

/**
 * The budget is the original budget plus approved changes (transfers, additions, reductions); the report's
 * "שינויים / תקציב מעודכן" columns and the variance follow. Sections carry the chapters of the Interministerial
 * Specification (the Blue Book); the report can group by them.
 */

const works = () => pkg.sections.filter((s) => s.kind === "works");
const change = (partial: Partial<HBudgetChange> & Pick<HBudgetChange, "kind" | "amount">): HBudgetChange => ({ id: "BC-1", date: "2026-08-15", fromSectionId: null, toSectionId: null, reasonHe: "בדיקה", approvedById: pkg.people[0].id, createdById: pkg.people[0].id, ...partial });
const withChanges = (changes: HBudgetChange[]): HadarimPackage => ({ ...pkg, budgetChanges: changes });

describe("budget changes", () => {
  it("net per section: a transfer moves money between sections, an addition raises the total, a reduction lowers it; dated after the cutoff they do not count", () => {
    const [a, b] = works();
    const deltas = budgetChangesBySection([change({ kind: "transfer", fromSectionId: a.id, toSectionId: b.id, amount: 200_000 }), change({ id: "BC-2", kind: "addition", toSectionId: b.id, amount: 50_000 }), change({ id: "BC-3", kind: "reduction", fromSectionId: a.id, amount: 10_000, date: "2026-12-01" })]);
    expect(deltas[a.id]).toBe(-210_000);
    expect(deltas[b.id]).toBe(250_000);
    const upTo = budgetChangesBySection([change({ kind: "reduction", fromSectionId: a.id, amount: 10_000, date: "2026-12-01" })], "2026-09-01");
    expect(upTo[a.id]).toBeUndefined();
  });

  it("the working forecast keeps the original budget, applies the changes and measures the variance against the updated budget", () => {
    const [a, b] = works();
    const state = initialState();
    const base = workingForecast(pkg, state.erp, [], state.control.controlDate);
    const p = withChanges([change({ kind: "transfer", fromSectionId: a.id, toSectionId: b.id, amount: 300_000 }), change({ id: "BC-2", kind: "addition", toSectionId: b.id, amount: 100_000 })]);
    const wf = workingForecast(p, state.erp, [], state.control.controlDate);
    const sa = wf.sections.find((s) => s.sectionId === a.id)!;
    const sb = wf.sections.find((s) => s.sectionId === b.id)!;
    expect(sa.originalBudget).toBe(a.budget);
    expect(sa.budgetChanges).toBe(-300_000);
    expect(sa.budget).toBe(a.budget - 300_000);
    expect(sb.budget).toBe(b.budget + 400_000);
    expect(sa.variance).toBe(sa.eac - sa.budget);
    expect(wf.totalOriginalBudget).toBe(base.totalBudget);
    expect(wf.totalBudgetChanges).toBe(100_000);
    expect(wf.totalBudget).toBe(base.totalBudget + 100_000);
    expect(wf.totalEac).toBe(base.totalEac);
  });

  it("the report shows original, changes and updated budget per section, in the totals and in the key table; without changes nothing is added", () => {
    const [a, b] = works();
    const plain = buildReport(pkg, initialState());
    expect(plain.sections.rows.every((r) => r.changes === 0 && r.updatedBudget === r.budget)).toBe(true);
    expect(plain.executive.keyTable.some((k) => k.labelHe === "תקציב מקורי")).toBe(false);
    const p = withChanges([change({ kind: "transfer", fromSectionId: a.id, toSectionId: b.id, amount: 250_000, reasonHe: "העברה מאושרת" })]);
    const r = buildReport(p, initialState());
    const ra = r.sections.rows.find((x) => x.sectionId === a.id)!;
    const rb = r.sections.rows.find((x) => x.sectionId === b.id)!;
    expect(ra).toMatchObject({ budget: a.budget, changes: -250_000, updatedBudget: a.budget - 250_000 });
    expect(rb).toMatchObject({ budget: b.budget, changes: 250_000, updatedBudget: b.budget + 250_000 });
    expect(r.sections.totals.changes).toBe(0);
    expect(r.sections.totals.updatedBudget).toBe(r.sections.totals.budget);
    expect(r.header.budgetVersionHe).toContain("1 שינויי תקציב");
    const added = buildReport(withChanges([change({ kind: "addition", toSectionId: b.id, amount: 100_000 })]), initialState());
    expect(added.executive.keyTable.map((k) => k.labelHe).slice(0, 3)).toEqual(["תקציב מקורי", "שינויי תקציב מאושרים", "תקציב מעודכן"]);
    expect(added.sections.totals.updatedBudget).toBe(added.sections.totals.budget + 100_000);
    const md = reportToMarkdown(added, "full");
    expect(md).toContain("+100,000");
  });

  it("tools: budget changes are read and recorded through the registry, never by editing the budget", () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_budget_changes.kind).toBe("read");
    expect(byName.add_budget_change.kind).toBe("write");
    expect(Object.keys(byName.add_budget_change.input)).toEqual(expect.arrayContaining(["kind", "fromSectionId", "toSectionId", "amount", "reasonHe", "approvedById"]));
    expect(tools.some((t) => t.name === "set_budget")).toBe(false);
  });
});

describe("Blue Book chapters", () => {
  it("every works section of the seed maps to known chapters, the primary first; BOQ lines carry their chapter", () => {
    for (const s of works()) {
      expect(s.chapters?.length, s.id).toBeGreaterThan(0);
      for (const c of s.chapters!) expect(BLUE_BOOK_CHAPTERS[c], `${s.id} → ${c}`).toBeTruthy();
    }
    expect(pkg.sections.find((s) => s.kind === "contingency")!.chapters).toEqual([]);
    expect(chapterLabelHe("57")).toBe("57 — קווי מים, ביוב ותיעול");
    expect(chapterLabelHe("99")).toBe("99 — פרק 99");
    for (const l of pkg.boq) expect(l.chapter).toMatch(/^\d{2}$/);
  });

  it("the report groups the sections by primary chapter when asked, with the BOQ lines per chapter, in the viewer model, Markdown and Excel", () => {
    const off = buildReport(pkg, initialState());
    expect(off.sections.byChapter).toBeNull();
    const state = setReportConfig(initialState(), { byChapter: true });
    const r = buildReport(pkg, state);
    expect(r.sections.byChapter).not.toBeNull();
    const rows = r.sections.byChapter!;
    const sumUpdated = rows.reduce((n, c) => n + c.updatedBudget, 0);
    expect(sumUpdated).toBe(r.sections.totals.updatedBudget);
    expect(rows.reduce((n, c) => n + c.eac, 0)).toBe(r.sections.totals.eac);
    // a chapter carried only by BOQ lines or as a secondary chapter still has a row: no money, its BOQ lines
    const ch57 = rows.find((c) => c.chapter === "57")!;
    expect(ch57.labelHe).toContain("קווי מים");
    expect(ch57.boqLines).toBeGreaterThan(0);
    expect(ch57.updatedBudget).toBe(0);
    expect(ch57.sectionsHe).toContain("משני");
    const primary = rows.find((c) => c.chapter === pkg.sections.find((s) => s.id === "07")!.chapters![0])!;
    expect(primary.sectionsHe).toContain("פיתוח");
    expect(primary.updatedBudget).toBeGreaterThan(0);
    expect(rows.at(-1)!.chapter).toBe("—");
    expect(reportToMarkdown(r, "full")).toContain("לפי פרקי המפרט הבינמשרדי");
    expect(reportToWorkbook(r, "full").byteLength).toBeGreaterThan(1000);
    for (const c of new Set(pkg.boq.map((l) => l.chapter))) expect(rows.some((x) => x.chapter === c), c).toBe(true);
  });
});
