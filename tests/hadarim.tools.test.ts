import { describe, expect, it } from "vitest";
import { z } from "zod";
import { initialState, pkg } from "../src/hadarim/engine/commands";
import { addAdjustment, addNote, addTask, correctPurchaseOrder, reallocateInvoice, removeAdjustment, setTaskStatus } from "../src/hadarim/engine/operations";
import { workingForecast } from "../src/hadarim/engine/forecast";
import { buildReport } from "../src/hadarim/engine/report";
import { tools } from "../src/hadarim/tools";

/**
 * The general-purpose tool layer: the registry the MCP server exposes, and the free-standing operations
 * behind it (offline, on the generator package). The live round trip through the MCP server is opt-in.
 */

describe("tool registry", () => {
  it("has unique snake_case names, descriptions and a project id on every project tool", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(t.description.length).toBeGreaterThan(40);
      expect(["read", "check", "decision", "write", "destructive"]).toContain(t.kind);
      if (t.name !== "list_projects") expect(Object.keys(t.input)).toContain("projectId");
    }
    expect(names).toEqual(expect.arrayContaining(["get_project", "get_forecast", "run_check", "run_control", "decide_finding", "route_finding", "reallocate_invoice", "add_forecast_adjustment", "open_task", "add_control_note", "build_report", "reset_project"]));
  });

  it("read tools accept an empty argument object (defaults fill the project)", () => {
    for (const t of tools.filter((x) => x.kind === "read" && !["get_section", "get_contract", "get_supplier", "get_document"].includes(x.name))) {
      const parsed = z.object(t.input).parse({}) as { projectId?: string };
      if (t.name !== "list_projects") expect(parsed.projectId).toBe("HADARIM");
    }
    expect(() => z.object(tools.find((t) => t.name === "get_section")!.input).parse({})).toThrow();
  });

  it("write tools validate their enumerations", () => {
    const adjust = z.object(tools.find((t) => t.name === "add_forecast_adjustment")!.input);
    expect(() => adjust.parse({ sectionId: "12", changeType: "bogus", descriptionHe: "x", basis: "quote", basisHe: "x", sourceRef: "x", amount: 1 })).toThrow();
    expect(adjust.parse({ sectionId: "12", changeType: "scope", descriptionHe: "x", basis: "quote", basisHe: "x", sourceRef: "x", amount: 1 }).projectId).toBe("HADARIM");
    const building = z.object(tools.find((t) => t.name === "set_invoice_building")!.input);
    expect(() => building.parse({ invoiceId: 1, building: "C", byId: "EYAL" })).toThrow();
    expect(building.parse({ invoiceId: 1, building: null, byId: "EYAL" }).building).toBeNull();
  });
});

describe("free-standing operations", () => {
  it("adds a typed forecast adjustment that moves the section and the total, and removes it again", () => {
    const seed = initialState();
    const before = workingForecast(pkg, seed.erp, seed.control.adjustments, seed.control.controlDate);
    const [s, adj] = addAdjustment(seed, { sectionId: "12", changeType: "scope", descriptionHe: "ריצוף לובי — שינוי תכנון", basis: "estimate", basisHe: "אומדן אדריכל 8/2026", sourceRef: "מייל אדריכל 28.8", amount: 90_000 });
    expect(adj.id).toBe("ADJ-1");
    const after = workingForecast(pkg, s.erp, s.control.adjustments, s.control.controlDate);
    expect(after.totalEac - before.totalEac).toBe(90_000);
    expect(after.sections.find((x) => x.sectionId === "12")!.eac - before.sections.find((x) => x.sectionId === "12")!.eac).toBe(90_000);
    expect(s.audit.at(-1)!.textHe).toContain("+90,000 ₪");
    const removed = removeAdjustment(s, adj.id);
    expect(workingForecast(pkg, removed.erp, removed.control.adjustments, removed.control.controlDate).totalEac).toBe(before.totalEac);
    expect(() => addAdjustment(seed, { sectionId: "99", changeType: "scope", descriptionHe: "x", basis: "estimate", basisHe: "x", sourceRef: "x", amount: 1 })).toThrow(/סעיף 99/);
    expect(() => addAdjustment(seed, { sectionId: "12", changeType: "scope", descriptionHe: "x", basis: "estimate", basisHe: "x", sourceRef: "x", amount: 0 })).toThrow();
  });

  it("opens, closes and validates tasks; carried issues are part of the task list", () => {
    const seed = initialState();
    expect(seed.control.tasks.map((t) => t.id)).toEqual(["OI-1", "OI-2", "OI-3"]);
    const [s, task] = addTask(seed, { titleHe: "בדיקת הצמדה", ownerId: "ROI", sectionId: "02", dueDate: "2026-09-30", impactIfIgnoredHe: "חשיפה" });
    expect(task).toMatchObject({ id: "TASK-1", status: "open", openedInControl: seed.control.controlDate, ownerId: "ROI" });
    const closed = setTaskStatus(s, "OI-3", "closed");
    expect(closed.control.tasks.find((t) => t.id === "OI-3")).toMatchObject({ status: "closed", closedAt: seed.clock.slice(0, 10) });
    expect(() => addTask(seed, { titleHe: "x", ownerId: "NOBODY" })).toThrow(/NOBODY/);
    expect(() => setTaskStatus(seed, "TASK-9", "closed")).toThrow(/TASK-9/);
  });

  it("controller notes flow into the report: risk, event, decision, assumption, bullet", () => {
    let s = initialState();
    s = addNote(s, { kind: "risk", textHe: "מכרז ריצוף עשוי להיסגר מעל האומדן", sectionId: "12", exposureHe: "עד 150,000 ₪", likelihoodHe: "בינונית", triggerHe: "פתיחת מכרז", ownerId: "EYAL" })[0];
    s = addNote(s, { kind: "event", textHe: "הוגשה בקשה להיתר שינויים" })[0];
    s = addNote(s, { kind: "decision", textHe: "האם להקדים את מכרז הריצוף" })[0];
    s = addNote(s, { kind: "assumption", textHe: "ללא הצמדה בחוזים החדשים" })[0];
    s = addNote(s, { kind: "note", textHe: "הערה לסיכום" })[0];
    const r = buildReport(pkg, s);
    expect(r.risks[0]).toMatchObject({ sectionHe: "12-ריצוף", exposureHe: "עד 150,000 ₪", ownerHe: "אייל" });
    expect(r.status.eventsHe).toContain("הוגשה בקשה להיתר שינויים");
    expect(r.executive.decisionsHe).toContain("האם להקדים את מכרז הריצוף");
    expect(r.appendices.assumptionsHe).toContain("ללא הצמדה בחוזים החדשים");
    expect(r.executive.bulletsHe).toContain("הערה לסיכום");
  });

  it("instructed ERP corrections are permission-checked, logged and recorded as data corrections", () => {
    const seed = initialState();
    const [s, correction] = reallocateInvoice(seed, 1147, "02", "SARIT", "תיקון שיוך");
    expect(s.erp.invoices.find((i) => i.id === 1147)!.sectionId).toBe("02");
    expect(s.erp.changeLog.at(-1)).toMatchObject({ recordType: "invoice", recordId: "1147", byId: "SARIT", field: "סעיף תקציבי" });
    expect(correction).toMatchObject({ recordType: "invoice", recordId: "1147", beforeHe: "07-פיתוח", afterHe: "02-שלד", approvedById: "SARIT", status: "applied" });
    expect(correction!.findingId).toBeUndefined();
    // plain data entry by the ERP user: change log only, no correction row for the report
    const [plain, none] = reallocateInvoice(seed, 1147, "02", "SARIT", "הזנה", false);
    expect(none).toBeNull();
    expect(plain.control.corrections).toHaveLength(0);
    expect(plain.erp.changeLog.length).toBe(seed.erp.changeLog.length + 1);
    const notAllowed = pkg.people.find((p) => !p.canWriteAllocation)!;
    expect(() => reallocateInvoice(seed, 1147, "02", notAllowed.id)).toThrow(/אינו מורשה/);
    expect(() => reallocateInvoice(seed, 1147, "07", "SARIT")).toThrow(/כבר משויך/);
    const [s2, c2] = correctPurchaseOrder(seed, 2291, { qty: 12, unit: "טון", unitPrice: 4800 }, "EYAL");
    expect(s2.erp.purchaseOrders.find((p) => p.id === 2291)).toMatchObject({ qty: 12, unit: "טון", unitPrice: 4800, amount: 57_600 });
    expect(c2!.afterHe).toBe("12 טון × 4,800");
    expect(() => correctPurchaseOrder(seed, 2291, { qty: 10 }, "EYAL")).toThrow(/הסכום חייב להישאר/);
  });
});

describe.skipIf(!process.env.RUN_DB_TESTS)("MCP server over stdio (live database)", () => {
  it("lists the tools and answers get_project", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new StdioClientTransport({ command: "npx", args: ["vite-node", "mcp/bakara-server.ts"], cwd: process.cwd(), stderr: "ignore" });
    const client = new Client({ name: "vitest", version: "0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
      const result = (await client.callTool({ name: "get_project", arguments: {} })) as { content: { type: string; text: string }[] };
      const body = JSON.parse(result.content[0].text) as { project: { id: string }; headline: { totalBudget: number } };
      expect(body.project.id).toBe("HADARIM");
      expect(body.headline.totalBudget).toBe(48_000_000);
    } finally {
      await client.close();
    }
  }, 60_000);
});
