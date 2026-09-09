import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { HDocument, HInvoice, HPurchaseOrder } from "../data/types";
import { db, deleteInvoice, listProjects, resetProject, updateProject } from "../db/client";
import { DEFAULT_PROJECT_ID } from "../db/config";
import { loadState, nowStamp, saveReportVersion, saveState } from "../db/session";
import { DATA_QUALITY_KINDS, checkAllocation, checkContractOverrun, checkCoverage, checkCumulative, checkDates, checkDuplicates, checkPrices, checkRetention, checkReviewAging, checkUnits, positives, quoteFacts, sectionLabel, sectionShort, withPeople, type HFinding } from "../engine/checks";
import { SCRIPT_INVOICE_ID, confirmQuote, createInvoice, decide, finalizeControl, orderLineHe, pkg, revealAllSteps, reviewFindings, route, saveConfig, setReportConfig, startControl, updateInvoiceBuilding } from "../engine/commands";
import { uncoveredByBasis, workingForecast } from "../engine/forecast";
import { CHANGE_TYPE_HE, type V2State } from "../engine/model";
import { CHANNEL_HE, addAdjustment, addNote, addTask, answerQuestion, askPerson, correctPurchaseOrder, reallocateInvoice, removeAdjustment, removeNote, setTaskStatus } from "../engine/operations";
import { lineValue } from "../engine/units";
import { buildReport } from "../engine/report";
import { exportReportDocx } from "../export/docx";
import { reportToMarkdown } from "../export/markdown";
import { reportToWorkbook } from "../export/xlsx";

/**
 * The budget-control tools: general-purpose operations over any project in the database, exposed to the
 * agent through the MCP server (`mcp/bakara-server.ts`) and to the shell through the CLI. Every number the
 * agent quotes comes from here. Reads never write; writes go through the pure engine commands and are
 * persisted by `saveState` (ERP rows via the attributed writers, so the database triggers log them).
 */

export type ToolKind = "read" | "check" | "decision" | "write" | "destructive";

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  input: S;
  run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}

const defs: ToolDef[] = [];
function define<S extends z.ZodRawShape>(def: ToolDef<S>): void {
  if (defs.some((d) => d.name === def.name)) throw new Error(`duplicate tool ${def.name}`);
  defs.push(def as unknown as ToolDef);
}

// ---------------------------------------------------------------------------
// Shared schema pieces and helpers
// ---------------------------------------------------------------------------

const projectId = z.string().default(DEFAULT_PROJECT_ID).describe("Project id, e.g. HADARIM (see list_projects)");
const controlDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Control date yyyy-mm-dd; default: the project's current control");
const sectionId = z.string().regex(/^\d{2}$/).describe("Budget section id, two digits ('01'–'18')");
const personId = z.string().describe("Person id (see list_people), e.g. EYAL");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CHANGE_TYPES = Object.keys(CHANGE_TYPE_HE) as [keyof typeof CHANGE_TYPE_HE, ...(keyof typeof CHANGE_TYPE_HE)[]];
const BASES = ["contract", "po", "quote", "appendix", "estimate"] as const;
const FINDING_KINDS = ["allocation", "unit", "price", "coverage", "duplicate", "contract_overrun", "cumulative", "retention", "dates", "review_aging"] as const;

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const signed = (v: number) => (v === 0 ? "0 ₪" : `${v > 0 ? "+" : "−"}${nis(Math.abs(v))}`);

function headline(state: V2State) {
  const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
  const variance = wf.totalEac - wf.totalBudget;
  const change = wf.totalEac - wf.previousTotalEac;
  return {
    controlDate: wf.controlDate,
    totalBudget: wf.totalBudget,
    totalEac: wf.totalEac,
    variance,
    previousControlDate: wf.previousControlDate,
    previousTotalEac: wf.previousTotalEac,
    change,
    textHe: `תחזית לגמר ${nis(wf.totalEac)} מול תקציב ${nis(wf.totalBudget)} (${variance === 0 ? "בתוך התקציב" : signed(variance)}) · בקרה קודמת ${nis(wf.previousTotalEac)} (${signed(change)})`,
  };
}

/** The engine's own words for what a command did (system messages added by the command), flattened to text. */
function systemMessages(prev: V2State, next: V2State): string[] {
  const out: string[] = [];
  for (const m of next.control.messages.slice(prev.control.messages.length)) {
    if (m.role !== "system") continue;
    if (m.kind === "finding") {
      out.push(`ממצא ${m.findingId}: ${m.textHe}`);
      continue;
    }
    out.push(m.textHe);
    for (const s of m.steps ?? []) out.push(`  ✔ ${s.textHe}`);
    if (m.options?.length) out.push(`  אפשרויות: ${m.options.map((o) => `[${o.id}] ${o.labelHe}`).join("  ")}`);
  }
  return out;
}

function supplierName(id: string | null | undefined): string | null {
  return id ? (pkg.suppliers.find((s) => s.id === id)?.nameHe ?? id) : null;
}

function personName(id: string | null | undefined): string | null {
  return id ? (pkg.people.find((p) => p.id === id)?.nameHe ?? id) : null;
}

function invoiceView(i: HInvoice) {
  return { ...i, supplierHe: supplierName(i.supplierId), sectionHe: sectionLabel(i.sectionId) };
}

function poView(p: HPurchaseOrder) {
  const value = lineValue(p);
  return {
    ...p,
    supplierHe: supplierName(p.supplierId),
    sectionHe: sectionLabel(p.sectionId),
    remainingAmount: p.amount - p.invoicedAmount,
    lineHe: orderLineHe(p),
    /** The quantity restated in the unit the price is quoted in, and what that makes the line worth. */
    pricedQty: value.pricedQty,
    derivedAmount: value.amount,
    /** True when the recorded amount is not what the quantity and price give once the units are converted. */
    amountDisagrees: value.amount !== p.amount,
  };
}

function findingView(f: HFinding, state: V2State) {
  const d = state.control.decisions[f.id];
  return {
    id: f.id,
    kind: f.kind,
    titleHe: f.titleHe,
    sectionId: f.sectionId,
    sectionHe: sectionLabel(f.sectionId),
    record: f.record,
    problemHe: f.problemHe,
    sources: f.sources.map((s) => ({ kind: s.kind, refId: s.refId, labelHe: s.labelHe, ...(s.documentId ? { documentId: s.documentId, anchor: s.anchor } : {}) })),
    ...(f.checkHe ? { checkHe: f.checkHe } : {}),
    ...(f.detailsTable ? { detailsTable: f.detailsTable } : {}),
    meaningHe: f.meaningHe,
    impact: f.impact,
    ...(f.notesHe?.length ? { notesHe: f.notesHe } : {}),
    ...(f.proposedFix ? { proposedFix: f.proposedFix } : {}),
    people: f.people ?? [],
    decision: f.decision,
    status: d?.status ?? "open",
    ...(d?.choiceId ? { choiceId: d.choiceId } : {}),
    ...(d?.freeTextHe ? { freeTextHe: d.freeTextHe } : {}),
    ...(d?.routeId ? { routeId: d.routeId } : {}),
    ...(d?.ownerId ? { ownerId: d.ownerId, ownerHe: personName(d.ownerId) } : {}),
    ...(d?.auditHe ? { auditHe: d.auditHe } : {}),
    ...(d?.verifiedHe ? { verifiedHe: d.verifiedHe } : {}),
    ...(d?.pending ? { pending: d.pending } : {}),
  };
}

function resolveFinding(state: V2State, ref: string): HFinding {
  const byId = state.control.findings.find((f) => f.id === ref);
  if (byId) return byId;
  const byKind = state.control.findings.filter((f) => f.kind === ref);
  if (byKind.length === 1) return byKind[0];
  if (byKind.length > 1) throw new Error(`יש ${byKind.length} ממצאים מסוג ${ref}: ${byKind.map((f) => f.id).join(", ")} — נא לציין מזהה`);
  throw new Error(`ממצא ${ref} לא נמצא. ממצאים בבקרה: ${state.control.findings.map((f) => `${f.id} (${f.kind})`).join(", ") || "אין — הרץ run_control"}`);
}

function documentText(d: HDocument): string {
  return d.blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return `# ${b.text ?? ""}`;
        case "table":
          return (b.rows ?? []).map((r) => `| ${r.join(" | ")} |`).join("\n");
        case "highlight":
          return `**${b.text ?? ""}**`;
        default:
          return b.text ?? "";
      }
    })
    .join("\n");
}

function controlView(state: V2State) {
  const c = state.control;
  return {
    controlDate: c.controlDate,
    status: c.status,
    finalized: c.finalized,
    operatorId: state.operatorId,
    operatorHe: personName(state.operatorId),
    requestedAt: c.requestedAt,
    findings: c.findings.map((f) => findingView(f, state)),
    openFindings: c.findings.filter((f) => !c.decisions[f.id] || c.decisions[f.id].status === "open" || c.decisions[f.id].pending).map((f) => f.id),
    positives: c.positives.map((p) => ({ id: p.id, titleHe: p.titleHe, textHe: p.textHe, sectionId: p.sectionId })),
    checkedHe: c.checkedHe,
    adjustments: c.adjustments.map((a) => ({ ...a, changeTypeHe: CHANGE_TYPE_HE[a.changeType], sectionHe: sectionLabel(a.sectionId) })),
    corrections: c.corrections,
    tasks: c.tasks.map((t) => ({ ...t, ownerHe: personName(t.ownerId), sectionHe: t.sectionId ? sectionLabel(t.sectionId) : null })),
    notes: c.notes,
    questions: c.questions.map((q) => ({ ...q, toHe: personName(q.toId), channelHe: CHANNEL_HE[q.channel] })),
    reportConfig: c.reportConfig,
    savedConfig: state.savedConfig,
    headline: headline(state),
  };
}

interface WriteOutcome {
  prev: V2State;
  state: V2State;
  erpWrites: string[];
  messagesHe: string[];
}

/** Load → pure command → persist (ERP rows through attributed writers, then re-read). */
async function write(project: string, date: string | undefined, fn: (s: V2State) => V2State): Promise<WriteOutcome> {
  const prev = await loadState(project, date);
  const next = fn(prev);
  const { state, erpWrites } = await saveState(prev, next, project);
  return { prev, state, erpWrites, messagesHe: systemMessages(prev, next) };
}

function outcome(r: WriteOutcome, extra: Record<string, unknown> = {}) {
  const newLog = r.state.erp.changeLog.slice(r.prev.erp.changeLog.length);
  return {
    ok: true,
    messagesHe: r.messagesHe,
    erpWrites: r.erpWrites,
    ...(newLog.length ? { changeLog: newLog.map((c) => ({ ...c, byHe: personName(c.byId) })) } : {}),
    headline: headline(r.state),
    ...extra,
  };
}

function draftOf(state: V2State) {
  const draft = pkg.forecasts.find((f) => f.controlDate === state.control.controlDate && f.sections);
  if (!draft) throw new Error(`אין טיוטת תחזית לבקרה ${state.control.controlDate}`);
  return draft;
}

function outPath(project: string, date: string, tab: string, ext: string, given?: string): string {
  const path = resolve(given ?? `out/bakara-${project}-${date}${tab === "ceo" ? "-ceo" : ""}.${ext}`);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

// ---------------------------------------------------------------------------
// Reading the project
// ---------------------------------------------------------------------------

define({
  name: "list_projects",
  title: "Projects",
  description: "List the projects in the database (id, name, company, stage, control dates). Start here when the project is not obvious.",
  kind: "read",
  input: {},
  run: async () => ({ projects: await listProjects() }),
});

define({
  name: "get_project",
  title: "Project overview",
  description: "Project header, people and roles, budget sections with budgets, record counts, the current control's state and the headline forecast (EAC vs budget vs previous control).",
  kind: "read",
  input: { projectId, controlDate },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const p = pkg.project;
    const c = state.control;
    return {
      project: { id: p.id, nameHe: p.nameHe, companyHe: p.companyHe, statusHe: p.statusHe, units: p.units, buildings: p.buildings, buckets: p.buckets, materiality: p.materiality, riskPolicy: p.riskPolicy, checkPolicy: p.checkPolicy, budgetVersion: p.budgetVersion, boqVersion: p.boqVersion, controlDates: p.controlDates, currentControlDate: p.currentControlDate, physicalProgressPct: p.physicalProgressPct ?? null, schedule: p.schedule ?? {} },
      people: pkg.people,
      sections: pkg.sections.map((s) => ({ id: s.id, nameHe: s.nameHe, shortHe: sectionShort(s.id), budget: s.budget, split: s.split, contractIds: s.contractIds })),
      counts: { invoices: state.erp.invoices.length, invoicesInReview: state.erp.invoices.filter((i) => i.status === "בבדיקה").length, openPurchaseOrders: state.erp.purchaseOrders.filter((x) => x.status === "פתוחה").length, contracts: pkg.contracts.length, boqLines: pkg.boq.length, documents: pkg.documents.length, changeLog: state.erp.changeLog.length },
      forecastVersions: pkg.forecasts.map((f) => ({ controlDate: f.controlDate, status: f.status, totalEac: f.totalEac })),
      control: { controlDate: c.controlDate, status: c.status, finalized: c.finalized, findings: c.findings.length, openFindings: c.findings.filter((f) => !c.decisions[f.id] || c.decisions[f.id].status === "open" || c.decisions[f.id].pending).length, adjustments: c.adjustments.length, corrections: c.corrections.length, openTasks: c.tasks.filter((t) => t.status !== "closed").length },
      headline: headline(state),
      now: nowStamp(),
    };
  },
});

define({
  name: "list_people",
  title: "People",
  description: "The people of the project with roles and write permissions (who may re-allocate invoices).",
  kind: "read",
  input: { projectId },
  run: async (a) => {
    await loadState(a.projectId);
    return { people: pkg.people };
  },
});

define({
  name: "get_control",
  title: "Control session",
  description: "The control session in full: status, every finding with its sources, meaning, decision options and decision state, verified matches, forecast adjustments (4a), data corrections (4b), tasks, controller notes, report configuration and the headline forecast.",
  kind: "read",
  input: { projectId, controlDate },
  run: async (a) => controlView(await loadState(a.projectId, a.controlDate)),
});

define({
  name: "get_forecast",
  title: "Working forecast",
  description: "The working forecast per section (budget, recorded, committed, remaining commitment, uncovered, EAC, variance, change vs previous control, basis %). Lines are included when a section is given or includeLines is true. Also the uncovered remainder by basis (estimate / quote / appendix) and internal allocations.",
  kind: "read",
  input: { projectId, controlDate, sectionId: sectionId.optional(), includeLines: z.boolean().default(false) },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
    const sections = wf.sections
      .filter((s) => !a.sectionId || s.sectionId === a.sectionId)
      .map((s) => ({ sectionId: s.sectionId, nameHe: pkg.sections.find((x) => x.id === s.sectionId)!.nameHe, budget: s.budget, recorded: s.recorded, committed: s.committed, remainingCommitment: s.remainingCommitment, uncovered: s.uncovered, eac: s.eac, variance: s.variance, previousEac: s.previousEac, change: s.change, basisPct: s.basisPct, ...(s.coverageNoteHe ? { coverageNoteHe: s.coverageNoteHe } : {}), ...(a.includeLines || a.sectionId ? { lines: s.lines } : {}) }));
    const u = uncoveredByBasis(wf);
    return {
      controlDate: wf.controlDate,
      previousControlDate: wf.previousControlDate,
      totals: { budget: wf.totalBudget, recorded: wf.totalRecorded, committed: wf.totalCommitted, remainingCommitment: wf.totalRemainingCommitment, uncovered: wf.totalUncovered, eac: wf.totalEac, variance: wf.totalEac - wf.totalBudget, previousEac: wf.previousTotalEac, change: wf.totalEac - wf.previousTotalEac },
      invoicesInReview: wf.invoicesInReview,
      uncoveredByBasis: { total: u.total, estimate: u.estimate, quote: u.quote, appendix: u.appendix, lines: u.lines, allocationTotal: u.allocationTotal, allocations: u.allocations },
      sections,
    };
  },
});

define({
  name: "get_section",
  title: "Section detail",
  description: "Everything about one budget section: budget, contracts (scope, exclusions, price appendices), invoices summary and list, open purchase orders, BOQ lines with coverage, the working forecast lines, adjustments and tasks of the control.",
  kind: "read",
  input: { projectId, controlDate, sectionId },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const section = pkg.sections.find((s) => s.id === a.sectionId);
    if (!section) throw new Error(`סעיף ${a.sectionId} לא קיים`);
    const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
    const ws = wf.sections.find((s) => s.sectionId === section.id)!;
    const invoices = state.erp.invoices.filter((i) => i.sectionId === section.id);
    const approved = invoices.filter((i) => i.status !== "בבדיקה" && i.dateReceived < state.control.controlDate);
    return {
      section: { ...section, shortHe: sectionShort(section.id) },
      forecast: { budget: ws.budget, recorded: ws.recorded, committed: ws.committed, remainingCommitment: ws.remainingCommitment, uncovered: ws.uncovered, eac: ws.eac, variance: ws.variance, previousEac: ws.previousEac, change: ws.change, basisPct: ws.basisPct, lines: ws.lines },
      contracts: pkg.contracts.filter((c) => c.sectionId === section.id).map((c) => ({ ...c, supplierHe: supplierName(c.supplierId) })),
      invoices: { count: invoices.length, recordedBeforeCutoff: approved.reduce((s, i) => s + i.amount, 0), inReview: invoices.filter((i) => i.status === "בבדיקה").length, rows: invoices.map(invoiceView) },
      purchaseOrders: state.erp.purchaseOrders.filter((p) => p.sectionId === section.id).map(poView),
      boq: pkg.boq.filter((l) => l.sectionId === section.id),
      adjustments: state.control.adjustments.filter((x) => x.sectionId === section.id),
      corrections: state.control.corrections.filter((x) => x.crossSectionHe.includes(`${section.id}-`) || x.afterHe.startsWith(section.id) || x.beforeHe.startsWith(section.id)),
      tasks: state.control.tasks.filter((t) => t.sectionId === section.id),
    };
  },
});

define({
  name: "query_invoices",
  title: "Invoices",
  description: "Search supplier invoices by section, supplier, contract, order, status, date range, ids, or those changed since a date (per the change log). Returns up to `limit` rows plus the total.",
  kind: "read",
  input: {
    projectId,
    sectionId: sectionId.optional(),
    supplierId: z.string().optional(),
    contractId: z.string().optional(),
    poId: z.number().int().optional(),
    status: z.enum(["אושר", "בבדיקה", "שולם"]).optional(),
    dateFrom: isoDate.optional().describe("date received ≥"),
    dateTo: isoDate.optional().describe("date received <"),
    changedSince: isoDate.optional().describe("only invoices with change-log rows at or after this date"),
    ids: z.array(z.number().int()).optional(),
    limit: z.number().int().min(1).max(500).default(50),
  },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const changed = a.changedSince ? new Set(state.erp.changeLog.filter((c) => c.recordType === "invoice" && c.at >= a.changedSince!).map((c) => Number(c.recordId))) : null;
    const rows = state.erp.invoices.filter((i) => (!a.sectionId || i.sectionId === a.sectionId) && (!a.supplierId || i.supplierId === a.supplierId) && (!a.contractId || i.contractId === a.contractId) && (a.poId == null || i.poId === a.poId) && (!a.status || i.status === a.status) && (!a.dateFrom || i.dateReceived >= a.dateFrom) && (!a.dateTo || i.dateReceived < a.dateTo) && (!changed || changed.has(i.id)) && (!a.ids || a.ids.includes(i.id)));
    return { total: rows.length, totalAmount: rows.reduce((s, i) => s + i.amount, 0), returned: Math.min(rows.length, a.limit), invoices: rows.slice(0, a.limit).map(invoiceView) };
  },
});

define({
  name: "query_purchase_orders",
  title: "Purchase orders",
  description: "Search purchase orders by section, supplier, contract, status or ids; each row includes the attached quote id and remaining amount.",
  kind: "read",
  input: { projectId, sectionId: sectionId.optional(), supplierId: z.string().optional(), contractId: z.string().optional(), status: z.enum(["פתוחה", "סגורה"]).optional(), ids: z.array(z.number().int()).optional() },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const rows = state.erp.purchaseOrders.filter((p) => (!a.sectionId || p.sectionId === a.sectionId) && (!a.supplierId || p.supplierId === a.supplierId) && (!a.contractId || p.contractId === a.contractId) && (!a.status || p.status === a.status) && (!a.ids || a.ids.includes(p.id)));
    return { total: rows.length, totalAmount: rows.reduce((s, p) => s + p.amount, 0), purchaseOrders: rows.map(poView) };
  },
});

define({
  name: "list_contracts",
  title: "Contracts",
  description: "Subcontractor and framework contracts with scope, inclusions, exclusions (clause and text), retention, price appendices and closing data; filter by section or supplier.",
  kind: "read",
  input: { projectId, sectionId: sectionId.optional(), supplierId: z.string().optional() },
  run: async (a) => {
    await loadState(a.projectId);
    const rows = pkg.contracts.filter((c) => (!a.sectionId || c.sectionId === a.sectionId) && (!a.supplierId || c.supplierId === a.supplierId));
    return { contracts: rows.map((c) => ({ ...c, supplierHe: supplierName(c.supplierId), sectionHe: sectionLabel(c.sectionId) })) };
  },
});

define({
  name: "get_contract",
  title: "Contract detail",
  description: "One contract with its invoices (recorded so far, cumulative), open orders, BOQ lines it covers or excludes, and the price appendix in force at the control date.",
  kind: "read",
  input: { projectId, controlDate, contractId: z.string() },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const c = pkg.contracts.find((x) => x.id === a.contractId);
    if (!c) throw new Error(`חוזה ${a.contractId} לא נמצא (${pkg.contracts.map((x) => x.id).join(", ")})`);
    const invoices = state.erp.invoices.filter((i) => i.contractId === c.id);
    const approved = invoices.filter((i) => i.status !== "בבדיקה" && i.dateReceived < state.control.controlDate);
    const recorded = approved.reduce((s, i) => s + i.amount, 0);
    const current = c.priceAppendices?.length ? [...c.priceAppendices].filter((x) => x.validFrom <= state.control.controlDate).sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0] ?? null : null;
    return {
      contract: { ...c, supplierHe: supplierName(c.supplierId), sectionHe: sectionLabel(c.sectionId) },
      recorded,
      remaining: c.amount != null ? c.amount - recorded : null,
      invoices: invoices.map(invoiceView),
      purchaseOrders: state.erp.purchaseOrders.filter((p) => p.contractId === c.id).map(poView),
      boq: pkg.boq.filter((l) => l.sectionId === c.sectionId).map((l) => ({ ...l, coveredByThis: l.coveredByContractId === c.id })),
      appendixInForce: current,
    };
  },
});

define({
  name: "query_boq",
  title: "Bill of quantities",
  description: "BOQ lines with coverage (covered / excluded / not_contracted), the covering contract or exclusion clause, quantities and units; filter by section, coverage or a text fragment.",
  kind: "read",
  input: { projectId, sectionId: sectionId.optional(), coverage: z.enum(["covered", "excluded", "not_contracted"]).optional(), query: z.string().optional().describe("text fragment of the description") },
  run: async (a) => {
    await loadState(a.projectId);
    const rows = pkg.boq.filter((l) => (!a.sectionId || l.sectionId === a.sectionId) && (!a.coverage || l.coverage === a.coverage) && (!a.query || l.descriptionHe.includes(a.query)));
    return { boqVersion: pkg.project.boqVersion, total: rows.length, lines: rows.map((l) => ({ ...l, sectionHe: sectionLabel(l.sectionId) })) };
  },
});

define({
  name: "list_suppliers",
  title: "Suppliers",
  description: "Suppliers and subcontractors of the project with kind, contract count and invoice count.",
  kind: "read",
  input: { projectId },
  run: async (a) => {
    const state = await loadState(a.projectId);
    return { suppliers: pkg.suppliers.map((s) => ({ ...s, contracts: pkg.contracts.filter((c) => c.supplierId === s.id).map((c) => c.id), invoices: state.erp.invoices.filter((i) => i.supplierId === s.id).length, openPurchaseOrders: state.erp.purchaseOrders.filter((p) => p.supplierId === s.id && p.status === "פתוחה").length })) };
  },
});

define({
  name: "get_supplier",
  title: "Supplier history",
  description: "A supplier's history: contracts, every invoice (with the sections they were allocated to), purchase orders and documents — the basis for allocation questions.",
  kind: "read",
  input: { projectId, supplierId: z.string() },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const s = pkg.suppliers.find((x) => x.id === a.supplierId);
    if (!s) throw new Error(`ספק ${a.supplierId} לא נמצא (${pkg.suppliers.map((x) => x.id).join(", ")})`);
    const invoices = state.erp.invoices.filter((i) => i.supplierId === s.id);
    const bySection = Object.entries(invoices.reduce<Record<string, { count: number; amount: number }>>((acc, i) => ({ ...acc, [i.sectionId]: { count: (acc[i.sectionId]?.count ?? 0) + 1, amount: (acc[i.sectionId]?.amount ?? 0) + i.amount } }), {})).map(([id, v]) => ({ sectionId: id, sectionHe: sectionLabel(id as HInvoice["sectionId"]), ...v }));
    return {
      supplier: s,
      contracts: pkg.contracts.filter((c) => c.supplierId === s.id).map((c) => ({ ...c, sectionHe: sectionLabel(c.sectionId) })),
      invoicesBySection: bySection,
      invoices: invoices.map(invoiceView),
      purchaseOrders: state.erp.purchaseOrders.filter((p) => p.supplierId === s.id).map(poView),
      documents: pkg.documents.filter((d) => d.supplierId === s.id).map((d) => ({ id: d.id, kind: d.kind, titleHe: d.titleHe, date: d.date })),
    };
  },
});

define({
  name: "query_change_log",
  title: "Change log",
  description: "Who changed what in the ERP and when (written by database triggers): filter by date, record type, record id or person. Use it to see what changed since the last control or today.",
  kind: "read",
  input: { projectId, since: z.string().optional().describe("yyyy-mm-dd or yyyy-mm-ddTHH:MM (Israel time)"), recordType: z.enum(["invoice", "po", "contract"]).optional(), recordId: z.string().optional(), byId: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const rows = state.erp.changeLog.filter((c) => (!a.since || c.at >= a.since) && (!a.recordType || c.recordType === a.recordType) && (!a.recordId || c.recordId === a.recordId) && (!a.byId || c.byId === a.byId));
    return { total: rows.length, entries: rows.slice(-a.limit).map((c) => ({ ...c, byHe: personName(c.byId) })) };
  },
});

define({
  name: "list_issues",
  title: "Issues and tasks",
  description: "Open issues carried from earlier controls and tasks opened in this one, with owner, due date, status and the impact if ignored.",
  kind: "read",
  input: { projectId, controlDate, status: z.enum(["open", "closed", "pending_execution"]).optional() },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const rows = state.control.tasks.filter((t) => !a.status || t.status === a.status);
    return { issues: rows.map((t) => ({ ...t, ownerHe: personName(t.ownerId), sectionHe: t.sectionId ? sectionLabel(t.sectionId) : null })) };
  },
});

define({
  name: "search_documents",
  title: "Project folder",
  description: "Search the project folder (invoices, quotes, price appendices, contract excerpts, BOQ pages) by text, kind, supplier or BOQ line; returns titles, dates and the extracted facts (quantity, unit, unit price, amount, validity).",
  kind: "read",
  input: { projectId, query: z.string().optional().describe("text in the title or body"), kind: z.enum(["invoice", "quote", "appendix", "contract_excerpt", "boq_page"]).optional(), supplierId: z.string().optional(), boqLineId: z.string().optional() },
  run: async (a) => {
    await loadState(a.projectId);
    const rows = pkg.documents.filter((d) => (!a.kind || d.kind === a.kind) && (!a.supplierId || d.supplierId === a.supplierId) && (!a.boqLineId || quoteFacts(d)?.boqLineId === a.boqLineId || JSON.stringify(d.blocks).includes(a.boqLineId)) && (!a.query || d.titleHe.includes(a.query) || documentText(d).includes(a.query)));
    return { total: rows.length, documents: rows.map((d) => ({ id: d.id, kind: d.kind, titleHe: d.titleHe, date: d.date, supplierId: d.supplierId, supplierHe: supplierName(d.supplierId), fileName: d.fileName, facts: d.facts ?? null })) };
  },
});

define({
  name: "get_document",
  title: "Document",
  description: "The text of one document from the project folder (as an extraction step would read it), its anchors and extracted facts.",
  kind: "read",
  input: { projectId, documentId: z.string() },
  run: async (a) => {
    await loadState(a.projectId);
    const d = pkg.documents.find((x) => x.id === a.documentId);
    if (!d) throw new Error(`מסמך ${a.documentId} לא נמצא`);
    return { id: d.id, kind: d.kind, titleHe: d.titleHe, date: d.date, supplierId: d.supplierId, supplierHe: supplierName(d.supplierId), fileName: d.fileName, text: documentText(d), anchors: d.anchors, facts: d.facts ?? null, footerHe: d.footerHe };
  },
});

define({
  name: "get_audit",
  title: "Audit trail",
  description: "The control's audit trail (decisions, forecast changes, ERP corrections) in order.",
  kind: "read",
  input: { projectId, limit: z.number().int().min(1).max(500).default(100) },
  run: async (a) => {
    const state = await loadState(a.projectId);
    return { total: state.audit.length, entries: state.audit.slice(-a.limit).map((e) => ({ ...e, byHe: personName(e.byId) })) };
  },
});

define({
  name: "list_report_versions",
  title: "Saved reports",
  description: "Report versions saved in the database for the project (id, control date, created at/by, label, file path).",
  kind: "read",
  input: { projectId, controlDate },
  run: async (a) => {
    let q = db().from("report_versions").select("id, control_date, created_at, created_by, label, docx_path").eq("project_id", a.projectId).order("created_at", { ascending: false });
    if (a.controlDate) q = q.eq("control_date", a.controlDate);
    const { data, error } = await q;
    if (error) throw new Error(`report_versions: ${error.message}`);
    return { versions: data ?? [] };
  },
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

define({
  name: "run_check",
  title: "Run a check (no save)",
  description: "Run one check, a group, or all of them on the live data without opening a control. Control checks: allocation (invoices vs contracts and supplier history), unit (order quantities/units vs quotes and appendices), price (forecast remainders vs the appendix in force), coverage (BOQ lines vs contracts). Data-quality checks ('data_quality' runs them all): duplicate (same supplier document number), contract_overrun (approved invoices above the contract), cumulative (partial-invoice cumulative chains), retention (retention arithmetic and rate), dates (received before issued, future dates), review_aging (invoices in review longer than the project's policy). Optionally limited to one invoice, order, contract or section. Nothing is recorded.",
  kind: "check",
  input: { projectId, controlDate, kind: z.enum([...FINDING_KINDS, "data_quality", "all"]).default("all"), invoiceId: z.number().int().optional(), poId: z.number().int().optional(), contractId: z.string().optional(), sectionId: sectionId.optional() },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const draft = draftOf(state);
    const sec = a.sectionId as HFinding["sectionId"] | undefined;
    const want = (k: (typeof FINDING_KINDS)[number]) => a.kind === "all" || a.kind === k || (a.kind === "data_quality" && DATA_QUALITY_KINDS.includes(k));
    const today = state.clock.slice(0, 10);
    const bySection = (list: HFinding[]) => list.filter((f) => !sec || f.sectionId === sec);
    const findings: HFinding[] = [
      ...(want("allocation") ? bySection(checkAllocation(pkg, state.erp, a.invoiceId)) : []),
      ...(want("unit") ? bySection(checkUnits(pkg, state.erp, a.poId)) : []),
      ...(want("price") ? checkPrices(pkg, state.erp, draft, state.control.controlDate, sec) : []),
      ...(want("coverage") ? checkCoverage(pkg, draft, sec) : []),
      ...(want("duplicate") ? bySection(checkDuplicates(pkg, state.erp, a.invoiceId)) : []),
      ...(want("contract_overrun") ? bySection(checkContractOverrun(pkg, state.erp, a.contractId)) : []),
      ...(want("cumulative") ? bySection(checkCumulative(pkg, state.erp, a.invoiceId)) : []),
      ...(want("retention") ? bySection(checkRetention(pkg, state.erp, a.invoiceId)) : []),
      ...(want("dates") ? bySection(checkDates(pkg, state.erp, today, a.invoiceId)) : []),
      ...(want("review_aging") ? bySection(checkReviewAging(pkg, state.erp, state.control.controlDate, a.invoiceId)) : []),
    ];
    return { controlDate: state.control.controlDate, findings: withPeople(pkg, state.erp, findings).map((f) => findingView(f, state)), positives: a.kind === "all" ? positives(pkg, draft).map((p) => ({ id: p.id, titleHe: p.titleHe, textHe: p.textHe, sectionId: p.sectionId })) : [] };
  },
});

define({
  name: "run_control",
  title: "Run the control",
  description: "Open the control for the project: run all checks on the live data, record findings and verified matches in the session, and return the data-gathering steps, the summary and the findings. Refuses when the control already ran unless force=true (which discards its decisions — confirm with the user first).",
  kind: "write",
  input: { projectId, controlDate, force: z.boolean().default(false), operatorId: personId.optional().describe("who asked for the control (defaults to the project's operator)"), requestTextHe: z.string().default("תכיני בקרה תקציבית") },
  run: async (a) => {
    let state = await loadState(a.projectId, a.controlDate);
    if (state.control.status !== "idle" && !a.force) return { ok: false, reason: "already_running", status: state.control.status, hint: "הבקרה כבר רצה; השתמש ב-get_control להמשך או force=true להרצה מחדש (מוחק את ההחלטות)", headline: headline(state) };
    if (a.force) {
      const supabase = db();
      const del = await supabase.from("controls").delete().eq("project_id", a.projectId).eq("control_date", state.control.controlDate);
      if (del.error) throw new Error(del.error.message);
      const tasks = await supabase.from("open_issues").delete().eq("project_id", a.projectId).not("finding_id", "is", null);
      if (tasks.error) throw new Error(tasks.error.message);
      state = await loadState(a.projectId, a.controlDate);
    }
    if (a.operatorId) {
      if (!pkg.people.some((p) => p.id === a.operatorId)) throw new Error(`${a.operatorId} אינו מוגדר בפרויקט`);
      state = { ...state, operatorId: a.operatorId as V2State["operatorId"] };
    }
    const prev = state;
    const next = reviewFindings(revealAllSteps(startControl(state, a.requestTextHe)));
    const { state: saved, erpWrites } = await saveState(prev, next, a.projectId);
    const steps = next.control.messages.find((m) => m.kind === "steps")?.steps?.map((s) => s.textHe) ?? [];
    const summary = next.control.messages.find((m) => m.kind === "text" && m.role === "system")?.textHe ?? "";
    return { ok: true, stepsHe: steps, summaryHe: summary, findings: saved.control.findings.map((f) => findingView(f, saved)), positives: saved.control.positives.map((p) => ({ id: p.id, titleHe: p.titleHe, textHe: p.textHe })), erpWrites, headline: headline(saved) };
  },
});

// ---------------------------------------------------------------------------
// Deciding on findings
// ---------------------------------------------------------------------------

define({
  name: "decide_finding",
  title: "Decide on a finding",
  description: "Record the user's decision on a finding: one of the finding's option ids, or free text where the finding allows it. The engine replies with what follows (a route question, a quote to confirm, a forecast change) — relay its messages verbatim. Finding may be given by id or, when unique, by kind.",
  kind: "decision",
  input: { projectId, controlDate, findingId: z.string().describe("finding id (F-ALLOC-<invoice>, F-UNIT-<order>, F-PRICE-<line>, F-COV-<boq line>) or the kind when unique"), choiceId: z.string().optional(), freeTextHe: z.string().optional() },
  run: async (a) => {
    if (!a.choiceId && !a.freeTextHe) throw new Error("נדרש choiceId או freeTextHe");
    let f!: HFinding;
    const r = await write(a.projectId, a.controlDate, (s) => {
      f = resolveFinding(s, a.findingId);
      if (a.choiceId && !f.decision.options.some((o) => o.id === a.choiceId)) throw new Error(`אפשרות ${a.choiceId} לא קיימת בממצא ${f.id}: ${f.decision.options.map((o) => o.id).join(", ")}`);
      return decide(s, f.id, a.choiceId ?? null, a.freeTextHe);
    });
    return outcome(r, { finding: findingView(r.state.control.findings.find((x) => x.id === f.id)!, r.state), nextOpenFinding: controlView(r.state).openFindings[0] ?? null, controlStatus: r.state.control.status });
  },
});

define({
  name: "route_finding",
  title: "Route a correction",
  description: "After a 'yes' on an allocation or unit finding: apply the correction in the ERP (update — attributed to the control's operator, permission-checked, re-read from the database as verification), or refer it (refer_accounting / refer_roi opens a pending task for the owner), or keep it in the forecast only (forecast_only).",
  kind: "write",
  input: { projectId, controlDate, findingId: z.string(), routeId: z.enum(["update", "refer_accounting", "forecast_only", "refer_roi"]) },
  run: async (a) => {
    let f!: HFinding;
    const r = await write(a.projectId, a.controlDate, (s) => {
      f = resolveFinding(s, a.findingId);
      return route(s, f.id, a.routeId);
    });
    const d = r.state.control.decisions[f.id];
    return outcome(r, { finding: findingView(f, r.state), verifiedHe: d?.verifiedHe ?? null, nextOpenFinding: controlView(r.state).openFindings[0] ?? null, controlStatus: r.state.control.status });
  },
});

define({
  name: "confirm_quote",
  title: "Confirm a found quote",
  description: "After a coverage finding found a quote in the project folder: accept it into the forecast as an estimate (opens a task to place the order before the quote expires) or reject it as not matching the scope.",
  kind: "write",
  input: { projectId, controlDate, findingId: z.string(), accept: z.boolean() },
  run: async (a) => {
    let f!: HFinding;
    const r = await write(a.projectId, a.controlDate, (s) => {
      f = resolveFinding(s, a.findingId);
      return confirmQuote(s, f.id, a.accept);
    });
    return outcome(r, { finding: findingView(f, r.state), adjustments: r.state.control.adjustments, tasks: r.state.control.tasks.filter((t) => t.findingId === f.id), nextOpenFinding: controlView(r.state).openFindings[0] ?? null, controlStatus: r.state.control.status });
  },
});

// ---------------------------------------------------------------------------
// ERP corrections instructed by the user
// ---------------------------------------------------------------------------

define({
  name: "reallocate_invoice",
  title: "Re-allocate an invoice",
  description: "Move an invoice to another budget section in the ERP on the user's instruction (outside a finding). Permission-checked (only people who may write allocations), attributed to byId, logged by the database trigger and re-read from the database. asCorrection=true (default) also records it as the controller's data correction for report §4b; use false when the user is simply keying a change in the ERP as its user.",
  kind: "write",
  input: { projectId, controlDate, invoiceId: z.number().int(), sectionId, byId: personId, noteHe: z.string().optional(), asCorrection: z.boolean().default(true) },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => reallocateInvoice(s, a.invoiceId, a.sectionId, a.byId, a.noteHe, a.asCorrection)[0]);
    const fresh = r.state.erp.invoices.find((i) => i.id === a.invoiceId)!;
    return outcome(r, { invoice: invoiceView(fresh), verifiedHe: `חשבון ${fresh.id} נקרא מחדש ממסד הנתונים — סעיף = ${sectionLabel(fresh.sectionId)}`, correction: a.asCorrection ? r.state.control.corrections[r.state.control.corrections.length - 1] : null });
  },
});

define({
  name: "correct_purchase_order",
  title: "Correct a purchase order",
  description: "Fix quantity / unit / price unit / unit price on a purchase order. The amount is locked: the quantity converted into priceUnit, times unitPrice, must still equal it — so an order quoted per טון and delivered in ק״ג is recorded as qty in ק״ג with priceUnit טון. Attributed to byId, trigger-logged and re-read. asCorrection=true (default) also records it as a data correction for report §4b; false = plain data entry by the ERP user.",
  kind: "write",
  input: { projectId, controlDate, poId: z.number().int(), qty: z.number().optional(), unit: z.string().optional(), priceUnit: z.string().optional(), unitPrice: z.number().optional(), byId: personId, noteHe: z.string().optional(), asCorrection: z.boolean().default(true) },
  run: async (a) => {
    if (a.qty == null && !a.unit && !a.priceUnit && a.unitPrice == null) throw new Error("נדרש לפחות שדה אחד לתיקון: qty, unit, priceUnit, unitPrice");
    const patch = { ...(a.qty != null ? { qty: a.qty } : {}), ...(a.unit ? { unit: a.unit } : {}), ...(a.priceUnit ? { priceUnit: a.priceUnit } : {}), ...(a.unitPrice != null ? { unitPrice: a.unitPrice } : {}) };
    const r = await write(a.projectId, a.controlDate, (s) => correctPurchaseOrder(s, a.poId, patch, a.byId, a.noteHe, a.asCorrection)[0]);
    const fresh = r.state.erp.purchaseOrders.find((p) => p.id === a.poId)!;
    return outcome(r, { purchaseOrder: poView(fresh), verifiedHe: `הזמנה ${fresh.id} נקראה מחדש ממסד הנתונים — ${orderLineHe(fresh)} = ${nis(fresh.amount)}`, correction: a.asCorrection ? r.state.control.corrections[r.state.control.corrections.length - 1] : null });
  },
});

define({
  name: "set_invoice_building",
  title: "Tag an invoice with a building",
  description: "Set (or clear with null) the building tag of an invoice for the per-building split of the report: a building id of the project (get_project → project.buildings) or the project's shared bucket id (project.buckets.shared.id) for shared costs. Attributed and trigger-logged.",
  kind: "write",
  input: { projectId, controlDate, invoiceId: z.number().int(), building: z.string().nullable().describe("a building id of the project, the shared bucket id, or null to clear"), byId: personId },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => updateInvoiceBuilding(s, a.invoiceId, a.building, a.byId as V2State["operatorId"]));
    return outcome(r, { invoice: invoiceView(r.state.erp.invoices.find((i) => i.id === a.invoiceId)!) });
  },
});

define({
  name: "create_invoice",
  title: "Key in an invoice",
  description: "Enter a new supplier invoice into the ERP (approved status, retention per the contract, cumulative computed). Attributed to byId and trigger-logged. Returns the assigned invoice number.",
  kind: "write",
  input: { projectId, controlDate, supplierId: z.string(), supplierDocNo: z.string(), date: isoDate, amount: z.number().positive(), descriptionHe: z.string(), sectionId, contractId: z.string().nullable().default(null), attachmentId: z.string().nullable().default(null).describe("document id of the scanned invoice, if in the folder"), byId: personId },
  run: async (a) => {
    let created!: HInvoice;
    const r = await write(a.projectId, a.controlDate, (s) => {
      if (!pkg.suppliers.some((x) => x.id === a.supplierId)) throw new Error(`ספק ${a.supplierId} לא קיים`);
      if (a.contractId && !pkg.contracts.some((c) => c.id === a.contractId)) throw new Error(`חוזה ${a.contractId} לא קיים`);
      const [next, inv] = createInvoice(s, { supplierId: a.supplierId, supplierDocNo: a.supplierDocNo, date: a.date, amount: a.amount, descriptionHe: a.descriptionHe, sectionId: a.sectionId as HInvoice["sectionId"], contractId: a.contractId, attachmentId: a.attachmentId, byId: a.byId as V2State["operatorId"] });
      created = inv;
      return next;
    });
    return outcome(r, { invoice: invoiceView(r.state.erp.invoices.find((i) => i.id === created.id) ?? created) });
  },
});

// ---------------------------------------------------------------------------
// Forecast, issues, notes, project status
// ---------------------------------------------------------------------------

define({
  name: "add_forecast_adjustment",
  title: "Change the forecast",
  description: "Add a typed, sourced change to the working forecast (report §4a): change type from the standard's closed list, basis (contract / po / quote / appendix / estimate), a Hebrew basis description and source reference, the amount (positive = increase), optional qty × unit price, document id, and replacesLineId to re-price an existing draft line instead of adding one.",
  kind: "write",
  input: {
    projectId,
    controlDate,
    sectionId,
    changeType: z.enum(CHANGE_TYPES).describe(Object.entries(CHANGE_TYPE_HE).map(([k, v]) => `${k} = ${v}`).join(", ")),
    descriptionHe: z.string(),
    basis: z.enum(BASES),
    basisHe: z.string().describe("the basis in words, e.g. 'הצעת מחיר X מ-20.8.2026, בתוקף עד 19.9.2026'"),
    sourceRef: z.string().describe("document / record reference, e.g. 'הצעת י. כהן 2026-311 · 57.03.040'"),
    amount: z.number().describe("effect on the forecast in whole shekels; positive = increase"),
    qty: z.number().optional(),
    unit: z.string().optional(),
    unitPrice: z.number().optional(),
    documentId: z.string().optional(),
    replacesLineId: z.string().optional(),
    findingId: z.string().optional(),
  },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => addAdjustment(s, a)[0]);
    const added = r.state.control.adjustments[r.state.control.adjustments.length - 1];
    return outcome(r, { adjustment: added, sectionForecast: workingForecast(pkg, r.state.erp, r.state.control.adjustments, r.state.control.controlDate).sections.find((x) => x.sectionId === a.sectionId) });
  },
});

define({
  name: "remove_forecast_adjustment",
  title: "Remove a forecast change",
  description: "Remove a forecast adjustment of the control by id (audited).",
  kind: "write",
  input: { projectId, controlDate, adjustmentId: z.string() },
  run: async (a) => outcome(await write(a.projectId, a.controlDate, (s) => removeAdjustment(s, a.adjustmentId))),
});

define({
  name: "open_task",
  title: "Open an issue",
  description: "Open an issue / task for the report's responsibility table (§8): title, owner, optional section, due date and the impact if ignored.",
  kind: "write",
  input: { projectId, controlDate, titleHe: z.string(), ownerId: personId, sectionId: sectionId.nullable().default(null), dueDate: isoDate.nullable().default(null), impactIfIgnoredHe: z.string().optional(), findingId: z.string().optional() },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => addTask(s, a)[0]);
    return outcome(r, { task: r.state.control.tasks[r.state.control.tasks.length - 1] });
  },
});

define({
  name: "set_task_status",
  title: "Close or reopen an issue",
  description: "Set an issue's status: closed (with an optional closing date, default today), open, or pending_execution.",
  kind: "write",
  input: { projectId, controlDate, taskId: z.string(), status: z.enum(["open", "closed", "pending_execution"]), closedAt: isoDate.optional() },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => setTaskStatus(s, a.taskId, a.status, a.closedAt));
    return outcome(r, { task: r.state.control.tasks.find((t) => t.id === a.taskId) });
  },
});

define({
  name: "add_control_note",
  title: "Add a controller note",
  description: "Record a note that feeds the report: kind 'risk' (§7 — with exposure, likelihood, trigger, owner), 'event' (§2 material events of the period), 'decision' (a decision management must take, §1), 'assumption' (§11), 'note' (executive-summary bullet), 'change_order' (a change order awaiting approval, §6) or 'claim' (a contractor claim or demand, §6). The ERP holds no change orders or claims, so §6 shows what was recorded here.",
  kind: "write",
  input: { projectId, controlDate, kind: z.enum(["risk", "event", "decision", "assumption", "note", "change_order", "claim"]), textHe: z.string(), sectionId: sectionId.optional(), exposureHe: z.string().optional(), likelihoodHe: z.string().optional(), triggerHe: z.string().optional(), ownerId: personId.optional(), byId: personId.optional() },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => addNote(s, a, (a.byId as V2State["operatorId"] | undefined) ?? s.operatorId)[0]);
    return outcome(r, { note: r.state.control.notes[r.state.control.notes.length - 1] });
  },
});

define({
  name: "remove_control_note",
  title: "Remove a controller note",
  description: "Remove a controller note (risk / event / decision / assumption / note / change_order / claim) by id when the user withdraws it.",
  kind: "write",
  input: { projectId, controlDate, noteId: z.string() },
  run: async (a) => outcome(await write(a.projectId, a.controlDate, (s) => removeNote(s, a.noteId))),
});

define({
  name: "set_project_status",
  title: "Update project settings",
  description: "Update the project's stage text, measured physical progress (percent, from the site report — never derived from spend), schedule (contract end / expected end as yyyy-mm, note) and materiality thresholds (report standard §5: materialityAbsolute ₪ AND materialityPctOfSection %, or materialityAbsoluteAlways ₪; a section is analysed anyway above materialityBudgetSharePct % of the budget or below materialitySoftBasisPct % basis). These feed report §2, §5 and the executive key table. Only on the user's instruction.",
  kind: "write",
  input: {
    projectId,
    statusHe: z.string().optional(),
    physicalProgressPct: z.number().min(0).max(100).nullable().optional(),
    scheduleContractEnd: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    scheduleExpectedEnd: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    scheduleNoteHe: z.string().optional(),
    materialityAbsolute: z.number().nonnegative().optional(),
    materialityPctOfSection: z.number().min(0).max(100).optional(),
    materialityAbsoluteAlways: z.number().nonnegative().optional(),
    materialityBudgetSharePct: z.number().min(0).max(100).optional(),
    materialitySoftBasisPct: z.number().min(0).max(100).optional(),
    riskQuoteExpiryExposurePct: z.number().min(0).max(100).optional().describe("§7 assumption: exposure of an estimate resting on a quote that may expire, as % of the estimate"),
    riskPriceStep: z.number().positive().optional().describe("§7: the price step (₪ per unit) used to express appendix-price exposure"),
  },
  run: async (a) => {
    const schedule = { ...(a.scheduleContractEnd ? { contractEnd: a.scheduleContractEnd } : {}), ...(a.scheduleExpectedEnd ? { expectedEnd: a.scheduleExpectedEnd } : {}), ...(a.scheduleNoteHe !== undefined ? { noteHe: a.scheduleNoteHe } : {}) };
    const materiality = { ...(a.materialityAbsolute !== undefined ? { absolute: a.materialityAbsolute } : {}), ...(a.materialityPctOfSection !== undefined ? { pctOfSection: a.materialityPctOfSection } : {}), ...(a.materialityAbsoluteAlways !== undefined ? { absoluteAlways: a.materialityAbsoluteAlways } : {}), ...(a.materialityBudgetSharePct !== undefined ? { budgetSharePct: a.materialityBudgetSharePct } : {}), ...(a.materialitySoftBasisPct !== undefined ? { softBasisPct: a.materialitySoftBasisPct } : {}) };
    const riskPolicy = { ...(a.riskQuoteExpiryExposurePct !== undefined ? { quoteExpiryExposurePct: a.riskQuoteExpiryExposurePct } : {}), ...(a.riskPriceStep !== undefined ? { priceStep: a.riskPriceStep } : {}) };
    await updateProject(a.projectId, { ...(a.statusHe !== undefined ? { statusHe: a.statusHe } : {}), ...(a.physicalProgressPct !== undefined ? { physicalProgressPct: a.physicalProgressPct } : {}), ...(Object.keys(schedule).length ? { schedule } : {}), ...(Object.keys(materiality).length ? { materiality } : {}), ...(Object.keys(riskPolicy).length ? { riskPolicy } : {}) });
    await loadState(a.projectId);
    return { ok: true, project: { statusHe: pkg.project.statusHe, physicalProgressPct: pkg.project.physicalProgressPct ?? null, schedule: pkg.project.schedule ?? {}, materiality: pkg.project.materiality, riskPolicy: pkg.project.riskPolicy } };
  },
});

// ---------------------------------------------------------------------------
// Questions to people
// ---------------------------------------------------------------------------

define({
  name: "ask_person",
  title: "Ask a person",
  description: "Put a question to the person who has the knowledge a decision needs (by person id; roles are in get_project). The full system sends it over that person's channel (WhatsApp, email, phone) and records the reply; in this prototype the question is recorded, the answer is given in the Claude session on that person's behalf and recorded with answer_question. The finding it belongs to (findingId) stays open meanwhile, and the question is listed in the report until answered.",
  kind: "write",
  input: { projectId, controlDate, toId: personId, textHe: z.string().describe("the question, in Hebrew, self-contained: the record, the numbers, what is asked"), findingId: z.string().optional(), byId: personId.optional().describe("who is asking (default: the control's operator)") },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => askPerson(s, a, (a.byId as V2State["operatorId"] | undefined) ?? s.operatorId)[0]);
    const q = r.state.control.questions[r.state.control.questions.length - 1];
    const to = pkg.people.find((p) => p.id === q.toId)!;
    return outcome(r, { question: { ...q, toHe: to.nameHe, roleHe: to.roleHe, channelHe: CHANNEL_HE[q.channel] }, sayHe: `שאלה ${q.id} ל${to.nameHe} (${to.roleHe}). במערכת המלאה תישלח ב-${CHANNEL_HE[q.channel]}; כאן ${to.nameHe} עונה בסשן זה, והתשובה נרשמת ב-answer_question.` });
  },
});

define({
  name: "answer_question",
  title: "Record an answer",
  description: "Record the answer a person gave to a question (in this prototype: typed in the session on that person's behalf; in the full system: the reply that came back over the channel). byId defaults to the person asked.",
  kind: "write",
  input: { projectId, controlDate, questionId: z.string(), answerHe: z.string(), byId: personId.optional() },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => answerQuestion(s, a.questionId, a.answerHe, a.byId));
    return outcome(r, { question: r.state.control.questions.find((q) => q.id === a.questionId) });
  },
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

define({
  name: "set_report_config",
  title: "Report structure",
  description: "Change the report's structure: comparison to the previous control and trends (§10), per-building split of the sections table (§3), the one-page CEO version, the executive-summary length; save=true keeps the structure (never the data) for the project's next controls.",
  kind: "write",
  input: { projectId, controlDate, includeTrends: z.boolean().optional(), splitByBuilding: z.boolean().optional(), ceoVersion: z.boolean().optional(), execSummaryMaxLines: z.number().int().min(3).max(10).optional(), save: z.boolean().default(false) },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => {
      const patch = { ...(a.includeTrends !== undefined ? { includeTrends: a.includeTrends } : {}), ...(a.splitByBuilding !== undefined ? { splitByBuilding: a.splitByBuilding } : {}), ...(a.ceoVersion !== undefined ? { ceoVersion: a.ceoVersion } : {}), ...(a.execSummaryMaxLines !== undefined ? { execSummaryMaxLines: a.execSummaryMaxLines } : {}) };
      let next = Object.keys(patch).length ? setReportConfig(s, patch) : s;
      if (a.save) next = saveConfig(next, true);
      return next;
    });
    return outcome(r, { reportConfig: r.state.control.reportConfig, savedConfig: r.state.savedConfig });
  },
});

define({
  name: "build_report",
  title: "Build the report",
  description: "Build the control report from the current state per the report standard (sections 0–11, 4a/4b kept apart, CEO page). format: 'summary' (header, executive summary, key table, decisions, material sections, issues — compact), 'markdown' (full text), 'json' (the whole model), 'docx' (Word file written to path), 'xlsx' (Excel workbook, one sheet per table, written to path). saveVersion=true (or a label) stores the version in the database.",
  kind: "write",
  input: { projectId, controlDate, tab: z.enum(["full", "ceo"]).default("full"), format: z.enum(["summary", "markdown", "json", "docx", "xlsx"]).default("summary"), path: z.string().optional().describe("output file path for docx/xlsx/markdown (default out/…)"), label: z.string().optional(), saveVersion: z.boolean().default(false) },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const report = buildReport(pkg, state);
    const date = state.control.controlDate;
    let path: string | null = null;
    let text: string | null = null;
    if (a.format === "docx") {
      path = outPath(a.projectId, date, a.tab, "docx", a.path);
      const blob = await exportReportDocx(report, a.tab);
      writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
    } else if (a.format === "xlsx") {
      path = outPath(a.projectId, date, a.tab, "xlsx", a.path);
      writeFileSync(path, Buffer.from(reportToWorkbook(report, a.tab)));
    } else if (a.format === "markdown") {
      text = reportToMarkdown(report, a.tab);
      if (a.path) {
        path = outPath(a.projectId, date, a.tab, "md", a.path);
        writeFileSync(path, text, "utf8");
      }
    }
    const versionId = a.saveVersion || a.label ? await saveReportVersion(a.projectId, date, report, state.operatorId, a.label ?? null, path) : null;
    const summary = {
      header: report.header,
      executive: report.executive,
      status: report.status,
      materialSections: report.material.map((m) => ({ sectionId: m.sectionId, titleHe: m.titleHe, reasonHe: m.reasonHe, recommendationHe: m.recommendationHe })),
      forecastChanges: report.changes.forecast,
      forecastChangesTotal: report.changes.forecastTotal,
      corrections: report.changes.corrections,
      contingency: report.contingency,
      risks: report.risks,
      openIssues: report.issues.open,
      closedIssues: report.issues.closed,
      openFindings: report.openFindings,
      openQuestions: report.openQuestions,
      trends: { uncoveredCommentaryHe: report.trends.uncoveredCommentaryHe, commentaryHe: report.trends.commentaryHe, comparison: report.trends.comparison },
      assumptionsHe: report.appendices.assumptionsHe,
      uncoveredTotal: report.appendices.uncoveredTotal,
      finalized: report.finalized,
    };
    const unreviewed = report.openFindings.filter((f) => f.statusHe !== "טרם הוכרע" && f.statusHe !== "בהחלטה").length;
    const attentionHe = report.openFindings.length ? `${report.openFindings.length} ממצאים דורשים החלטה לפני שהדוח סופי${unreviewed ? ` (${unreviewed} מהם טרם נבדקו — הבקרה לא רצה על הנתונים הנוכחיים; הרץ run_control)` : ""}: הצג כל אחד עם התיקון המומלץ, ומי מעורב ברשומה אם המשתמש אינו יודע, וקבל אישור.` : null;
    return { ok: true, tab: a.tab, format: a.format, path, versionId, ...(attentionHe ? { attentionHe } : {}), ...(a.format === "json" ? { report } : a.format === "markdown" ? { markdown: text } : {}), summary };
  },
});

define({
  name: "finalize_control",
  title: "Finalize the control",
  description: "Close the control as the final version (the report header changes from טיוטה to גרסה סופית). Only when the user says the control is closed.",
  kind: "write",
  input: { projectId, controlDate },
  run: async (a) => outcome(await write(a.projectId, a.controlDate, finalizeControl), { finalized: true }),
});

define({
  name: "reset_project",
  title: "Reset to seed",
  description: "DESTRUCTIVE: restore the project's ERP data and change log to the seed snapshot and clear the control session, audit and saved report versions. variant B also removes the seed's script invoice (the one the demo re-allocates) so it can be keyed in live. Confirm with the user first.",
  kind: "destructive",
  input: { projectId, variant: z.enum(["A", "B"]).default("A") },
  run: async (a) => {
    await resetProject(a.projectId);
    if (a.variant === "B") await deleteInvoice(SCRIPT_INVOICE_ID, a.projectId);
    const state = await loadState(a.projectId);
    return { ok: true, variant: a.variant, invoices: state.erp.invoices.length, controlStatus: state.control.status, headline: headline(state) };
  },
});

export const tools: readonly ToolDef[] = defs;

/** Validate arguments against the tool's schema and run it (used by the CLI and tests). */
export async function callTool(name: string, args: unknown): Promise<unknown> {
  const def = tools.find((t) => t.name === name);
  if (!def) throw new Error(`unknown tool ${name}; tools: ${tools.map((t) => t.name).join(", ")}`);
  const parsed = z.object(def.input).parse(args ?? {});
  return def.run(parsed);
}
