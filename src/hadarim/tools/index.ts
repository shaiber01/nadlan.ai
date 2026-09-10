import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { DOCUMENT_KIND_HE, type DocumentKind, type HDocument, type HInvoice, type HPurchaseOrder } from "../data/types";
import { addBudgetChange, addDocument, db, deleteInvoice, documentFilePath, documentFileUrl, downloadDocumentFile, latestChangeLogId, listHeartbeats, listProjects, nextDocumentId, recordHeartbeat, resetProject, updateDocument, updateDocumentFacts, updateProject, uploadDocumentFile } from "../db/client";
import { DEFAULT_PROJECT_ID } from "../db/config";
import { loadState, nowStamp, saveReportVersion, saveState } from "../db/session";
import { extractText, isImage, mimeTypeFor } from "../documents/extract";
import { changeLogId, heartbeatSummaryHe, heartbeatWork, isUnprocessed, reportBlockers } from "../engine/heartbeat";
import { DATA_QUALITY_KINDS, checkAllocation, checkOrderAllocation, checkContractOverrun, checkCoverage, checkCumulative, checkDates, checkDocuments, checkDuplicates, checkPrices, checkRetention, checkReviewAging, checkUnits, positives, quoteFacts, sectionLabel, sectionShort, withPeople, type HFinding } from "../engine/checks";
import { chapterNameHe } from "../data/bluebook";
import { BUDGET_CHANGE_KIND_HE, type HBoqLine, type HSection, type SectionId } from "../data/types";
import { SCRIPT_INVOICE_ID, confirmQuote, createInvoice, decide, finalizeControl, orderLineHe, pkg, revealAllSteps, reviewFindings, route, saveConfig, setReportConfig, startControl, updateInvoiceBuilding } from "../engine/commands";
import { budgetChangesBySection, uncoveredByBasis, workingForecast } from "../engine/forecast";
import { CHANGE_TYPE_HE, type V2State } from "../engine/model";
import { CHANNEL_HE, addAdjustment, addNote, addTask, answerQuestion, askPerson, correctPurchaseOrder, raiseFinding, reallocateInvoice, recordReviewPass, removeAdjustment, removeNote, setTaskStatus } from "../engine/operations";
import { lineValue } from "../engine/units";
import { buildReport, reportReadiness, type ReadinessContext } from "../engine/report";
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
const FINDING_KINDS = ["allocation", "unit", "price", "coverage", "duplicate", "contract_overrun", "cumulative", "retention", "dates", "review_aging", "document"] as const;

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

const DOCUMENT_KINDS = Object.keys(DOCUMENT_KIND_HE) as [DocumentKind, ...DocumentKind[]];
const documentKind = z.enum(DOCUMENT_KINDS);
const recordType = z.enum(["invoice", "po", "contract"]);

/** The text of a document: the extracted text of a real file, or the seed's simulated page rendered as text. */
function documentText(d: HDocument): string {
  if (d.text) return d.text;
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

function documentView(d: HDocument) {
  return { id: d.id, kind: d.kind, kindHe: DOCUMENT_KIND_HE[d.kind] ?? d.kind, titleHe: d.titleHe, date: d.date, supplierId: d.supplierId, supplierHe: supplierName(d.supplierId), fileName: d.fileName, processed: !isUnprocessed(d), supersededBy: d.supersededBy ?? null, facts: d.facts ?? null, factsSource: d.factsSource ?? null, recordRef: d.recordRef ?? null, summaryHe: d.summaryHe ?? null, hasFile: !!d.filePath, mimeType: d.mimeType ?? null, uploadedById: d.uploadedById ?? null, uploadedByHe: personName(d.uploadedById), uploadedAt: d.uploadedAt ?? null };
}

/** Local cache of a real file, so the agent can Read it (PDFs and images) — one folder per project and document. */
function documentCachePath(projectId: string, d: HDocument): string {
  return join(tmpdir(), "bakara-documents", projectId, d.id, basename(d.filePath ?? d.fileName));
}

/**
 * A real file made readable: downloaded to the local cache and, on first use, its text extracted and stored on the
 * row. Returns null for the seed's simulated pages (their text comes from `blocks`).
 */
async function materializeDocument(projectId: string, d: HDocument): Promise<{ localPath: string; fileUrl: string; text: string | null; readHintHe: string } | null> {
  if (!d.filePath) return null;
  const localPath = documentCachePath(projectId, d);
  let bytes: Uint8Array | null = null;
  if (!existsSync(localPath)) {
    bytes = await downloadDocumentFile(d.filePath);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, bytes);
  }
  let text = d.text ?? null;
  const mime = d.mimeType ?? mimeTypeFor(d.fileName);
  if (!text && !isImage(mime)) {
    const r = await extractText(bytes ?? new Uint8Array(readFileSync(localPath)), mime);
    if (r.text) {
      text = r.text;
      await updateDocument(projectId, d.id, { text });
    }
  }
  const readHintHe = isImage(mime) ? `תמונה — קרא אותה בעצמך עם Read על ${localPath}.` : mime === "application/pdf" ? `PDF — הטקסט החולץ עשוי להיות משובש (עברית); קרא את הקובץ בעצמך עם Read על ${localPath} כשהטקסט אינו ברור או חסר.` : `קובץ מקומי: ${localPath}.`;
  return { localPath, fileUrl: documentFileUrl(d.filePath), text, readHintHe };
}

function findRecord(state: V2State, type: "invoice" | "po" | "contract", id: string): boolean {
  if (type === "invoice") return state.erp.invoices.some((i) => String(i.id) === id);
  if (type === "po") return state.erp.purchaseOrders.some((p) => String(p.id) === id);
  return pkg.contracts.some((k) => k.id === id);
}

function chapterInfo(s: HSection) {
  return (s.chapters ?? []).map((code, i) => ({ code, nameHe: chapterNameHe(code), primary: i === 0 }));
}

/** BOQ lines rolled up by their Blue Book chapter. */
function boqByChapter(lines: HBoqLine[]) {
  const map = new Map<string, HBoqLine[]>();
  for (const l of lines) map.set(l.chapter, [...(map.get(l.chapter) ?? []), l]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([chapter, rows]) => ({ chapter, nameHe: rows[0]?.chapterNameHe ?? chapterNameHe(chapter), lines: rows.length, covered: rows.filter((l) => l.coverage === "covered").length, excluded: rows.filter((l) => l.coverage === "excluded").length, notContracted: rows.filter((l) => l.coverage === "not_contracted").length, sectionIds: [...new Set(rows.map((l) => l.sectionId))] }));
}

function budgetChangeView(c: HBudgetChangeLike) {
  return { ...c, kindHe: BUDGET_CHANGE_KIND_HE[c.kind], fromHe: c.fromSectionId ? sectionLabel(c.fromSectionId) : null, toHe: c.toSectionId ? sectionLabel(c.toSectionId) : null, approvedByHe: personName(c.approvedById), createdByHe: personName(c.createdById) };
}
type HBudgetChangeLike = (typeof pkg.budgetChanges)[number];

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
    reviewPassHe: c.notes.find((n) => n.kind === "review_pass")?.textHe ?? null,
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
      sections: pkg.sections.map((s) => ({ id: s.id, nameHe: s.nameHe, shortHe: sectionShort(s.id), budget: s.budget, kind: s.kind, split: s.split, contractIds: s.contractIds, chapters: chapterInfo(s) })),
      budgetChanges: { count: pkg.budgetChanges.length, net: pkg.budgetChanges.reduce((n, c) => n + (c.kind === "addition" ? c.amount : c.kind === "reduction" ? -c.amount : 0), 0) },
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
      .map((s) => ({ sectionId: s.sectionId, nameHe: pkg.sections.find((x) => x.id === s.sectionId)!.nameHe, budget: s.budget, originalBudget: s.originalBudget, budgetChanges: s.budgetChanges, recorded: s.recorded, committed: s.committed, remainingCommitment: s.remainingCommitment, uncovered: s.uncovered, eac: s.eac, variance: s.variance, previousEac: s.previousEac, change: s.change, basisPct: s.basisPct, ...(s.coverageNoteHe ? { coverageNoteHe: s.coverageNoteHe } : {}), ...(a.includeLines || a.sectionId ? { lines: s.lines } : {}) }));
    const u = uncoveredByBasis(wf);
    return {
      controlDate: wf.controlDate,
      previousControlDate: wf.previousControlDate,
      totals: { budget: wf.totalBudget, originalBudget: wf.totalOriginalBudget, budgetChanges: wf.totalBudgetChanges, recorded: wf.totalRecorded, committed: wf.totalCommitted, remainingCommitment: wf.totalRemainingCommitment, uncovered: wf.totalUncovered, eac: wf.totalEac, variance: wf.totalEac - wf.totalBudget, previousEac: wf.previousTotalEac, change: wf.totalEac - wf.previousTotalEac },
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
      section: { ...section, shortHe: sectionShort(section.id), chapters: chapterInfo(section) },
      budgetChanges: pkg.budgetChanges.filter((c) => c.fromSectionId === section.id || c.toSectionId === section.id).map(budgetChangeView),
      forecast: { budget: ws.budget, originalBudget: ws.originalBudget, budgetChanges: ws.budgetChanges, recorded: ws.recorded, committed: ws.committed, remainingCommitment: ws.remainingCommitment, uncovered: ws.uncovered, eac: ws.eac, variance: ws.variance, previousEac: ws.previousEac, change: ws.change, basisPct: ws.basisPct, lines: ws.lines },
      contracts: pkg.contracts.filter((c) => c.sectionId === section.id).map((c) => ({ ...c, supplierHe: supplierName(c.supplierId) })),
      invoices: { count: invoices.length, recordedBeforeCutoff: approved.reduce((s, i) => s + i.amount, 0), inReview: invoices.filter((i) => i.status === "בבדיקה").length, rows: invoices.map(invoiceView) },
      purchaseOrders: state.erp.purchaseOrders.filter((p) => p.sectionId === section.id).map(poView),
      boq: pkg.boq.filter((l) => l.sectionId === section.id),
      boqByChapter: boqByChapter(pkg.boq.filter((l) => l.sectionId === section.id)),
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
  description: "BOQ lines with coverage (covered / excluded / not_contracted), the covering contract or exclusion clause, quantities and units; filter by section, Blue Book chapter (the Interministerial Specification chapter the line belongs to), coverage or a text fragment. byChapter rolls the lines up per chapter.",
  kind: "read",
  input: { projectId, sectionId: sectionId.optional(), chapter: z.string().optional().describe("Blue Book chapter code, e.g. '57'"), coverage: z.enum(["covered", "excluded", "not_contracted"]).optional(), query: z.string().optional().describe("text fragment of the description") },
  run: async (a) => {
    await loadState(a.projectId);
    const rows = pkg.boq.filter((l) => (!a.sectionId || l.sectionId === a.sectionId) && (!a.chapter || l.chapter === a.chapter) && (!a.coverage || l.coverage === a.coverage) && (!a.query || l.descriptionHe.includes(a.query)));
    return { boqVersion: pkg.project.boqVersion, total: rows.length, byChapter: boqByChapter(rows), lines: rows.map((l) => ({ ...l, sectionHe: sectionLabel(l.sectionId) })) };
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
  input: { projectId, since: z.string().optional().describe("yyyy-mm-dd or yyyy-mm-ddTHH:MM (Israel time)"), recordType: z.enum(["invoice", "po", "contract", "budget"]).optional(), recordId: z.string().optional(), byId: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) },
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
  description: "Search the project folder — the seed's pages and the real files people uploaded (invoices, quotes, price appendices, contract excerpts, BOQ pages, delivery notes, letters) — by text, kind, supplier, BOQ line or the record they belong to. unprocessed=true lists the documents nobody read yet (no facts recorded): those are yours to process (get_document → classify_document → set_document_facts). Returns titles, dates, the record, whether processed and the extracted facts.",
  kind: "read",
  input: { projectId, includeReplaced: z.boolean().default(false).describe("also list documents replaced by a newer upload (supersededBy set); by default only current documents"), query: z.string().optional().describe("text in the title or body"), kind: documentKind.optional(), supplierId: z.string().optional(), boqLineId: z.string().optional(), recordType: recordType.optional(), recordId: z.string().optional().describe("with recordType: the invoice/order number or contract id the document belongs to"), unprocessed: z.boolean().optional().describe("true: only documents not processed yet; false: only processed") },
  run: async (a) => {
    await loadState(a.projectId);
    const rows = pkg.documents.filter((d) => (a.includeReplaced || !d.supersededBy) && (!a.kind || d.kind === a.kind) && (!a.supplierId || d.supplierId === a.supplierId) && (!a.boqLineId || quoteFacts(d)?.boqLineId === a.boqLineId || JSON.stringify(d.blocks).includes(a.boqLineId)) && (!a.recordType || d.recordRef?.type === a.recordType) && (!a.recordId || d.recordRef?.id === a.recordId) && (a.unprocessed === undefined || isUnprocessed(d) === a.unprocessed) && (!a.query || d.titleHe.includes(a.query) || documentText(d).includes(a.query)));
    return { total: rows.length, unprocessed: pkg.documents.filter(isUnprocessed).length, documents: rows.map(documentView) };
  },
});

define({
  name: "get_document",
  title: "Document",
  description: "One document of the project folder to read: its text (a real file's extracted text, or the seed page), its recorded facts and their provenance, and for a real file the local path — Read that path yourself for a PDF or an image; the model reading the document is the point, the extracted text is a convenience and Hebrew PDFs often extract poorly.",
  kind: "read",
  input: { projectId, documentId: z.string() },
  run: async (a) => {
    await loadState(a.projectId);
    const d = pkg.documents.find((x) => x.id === a.documentId);
    if (!d) throw new Error(`מסמך ${a.documentId} לא נמצא`);
    const file = await materializeDocument(a.projectId, d);
    return { ...documentView(d), text: file ? file.text : documentText(d), anchors: d.anchors, footerHe: d.footerHe, ...(file ? { localPath: file.localPath, fileUrl: file.fileUrl, readHintHe: file.readHintHe } : {}), ...(isUnprocessed(d) ? { processHintHe: "המסמך טרם עובד: קרא אותו, תאר אותו (classify_document — סוג, כותרת, תאריך, ספק, הרשומה שאליה הוא שייך) ורשום את העובדות שהוא מציין (set_document_facts; אם אין עובדות לבדיקות — {} עם הערה). זה מסמן אותו כמעובד." } : {}) };
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
  description: "Run one check, a group, or all of them on the live data without opening a control. Control checks: allocation (an invoice vs its contract and the supplier's history; an order vs its contract, the invoices billed against it, or the supplier's other records), unit (order quantities/units vs quotes and appendices), price (forecast remainders vs the appendix in force), coverage (BOQ lines vs contracts). Data-quality checks ('data_quality' runs them all): duplicate (same supplier document number), contract_overrun (approved invoices above the contract), cumulative (partial-invoice cumulative chains), retention (retention arithmetic and rate), dates (received before issued, future dates), review_aging (invoices in review longer than the project's policy). Optionally limited to one invoice, order, contract or section. Nothing is recorded.",
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
      ...(want("allocation") ? bySection([...(a.poId == null ? checkAllocation(pkg, state.erp, a.invoiceId) : []), ...(a.invoiceId == null ? checkOrderAllocation(pkg, state.erp, a.poId) : [])]) : []),
      ...(want("unit") ? bySection(checkUnits(pkg, state.erp, a.poId)) : []),
      ...(want("price") ? checkPrices(pkg, state.erp, draft, state.control.controlDate, sec) : []),
      ...(want("coverage") ? checkCoverage(pkg, draft, sec) : []),
      ...(want("duplicate") ? bySection(checkDuplicates(pkg, state.erp, a.invoiceId)) : []),
      ...(want("contract_overrun") ? bySection(checkContractOverrun(pkg, state.erp, a.contractId)) : []),
      ...(want("cumulative") ? bySection(checkCumulative(pkg, state.erp, a.invoiceId)) : []),
      ...(want("retention") ? bySection(checkRetention(pkg, state.erp, a.invoiceId)) : []),
      ...(want("dates") ? bySection(checkDates(pkg, state.erp, today, a.invoiceId)) : []),
      ...(want("review_aging") ? bySection(checkReviewAging(pkg, state.erp, state.control.controlDate, a.invoiceId)) : []),
      ...(want("document") ? bySection(checkDocuments(pkg, state.erp, { invoiceId: a.invoiceId, poId: a.poId })) : []),
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
  input: { projectId, controlDate, findingId: z.string().describe("finding id (F-ALLOC-<invoice>, F-ALLOC-PO-<order>, F-UNIT-<order>, F-PRICE-<line>, F-COV-<boq line>) or the kind when unique"), choiceId: z.string().optional(), freeTextHe: z.string().optional() },
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
  description: "Set the route of an allocation or unit correction on its own, without a card answer: update applies it in the ERP (attributed to the control's operator, permission-checked, re-read from the database as verification), refer_accounting / refer_roi opens a pending task for the owner, forecast_only corrects the forecast and leaves the ERP alone. Not a step of the normal flow — the card's own answers already carry their route, decide_finding with the approving option writes the ERP itself. Use this only for a route the card does not offer (forecast_only) or to change a route already taken. For an order's allocation (F-ALLOC-PO-…) the routes are update and refer_roi.",
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
  description: "Fix quantity / unit / price unit / unit price on a purchase order, and/or move it to another budget section (sectionId). The amount is locked: the quantity converted into priceUnit, times unitPrice, must still equal it — so an order quoted per טון and delivered in ק״ג is recorded as qty in ק״ג with priceUnit טון. A section move is permission-checked like an invoice re-allocation; the invoices booked against the order keep their own section. Attributed to byId, trigger-logged and re-read. asCorrection=true (default) also records it as a data correction for report §4b; false = plain data entry by the ERP user.",
  kind: "write",
  input: { projectId, controlDate, poId: z.number().int(), qty: z.number().optional(), unit: z.string().optional(), priceUnit: z.string().optional(), unitPrice: z.number().optional(), sectionId: sectionId.optional().describe("move the order to this budget section"), byId: personId, noteHe: z.string().optional(), asCorrection: z.boolean().default(true) },
  run: async (a) => {
    if (a.qty == null && !a.unit && !a.priceUnit && a.unitPrice == null && !a.sectionId) throw new Error("נדרש לפחות שדה אחד לתיקון: qty, unit, priceUnit, unitPrice, sectionId");
    const patch = { ...(a.qty != null ? { qty: a.qty } : {}), ...(a.unit ? { unit: a.unit } : {}), ...(a.priceUnit ? { priceUnit: a.priceUnit } : {}), ...(a.unitPrice != null ? { unitPrice: a.unitPrice } : {}), ...(a.sectionId ? { sectionId: a.sectionId } : {}) };
    const r = await write(a.projectId, a.controlDate, (s) => correctPurchaseOrder(s, a.poId, patch, a.byId, a.noteHe, a.asCorrection)[0]);
    const fresh = r.state.erp.purchaseOrders.find((p) => p.id === a.poId)!;
    return outcome(r, { purchaseOrder: poView(fresh), verifiedHe: `הזמנה ${fresh.id} נקראה מחדש ממסד הנתונים — ${sectionLabel(fresh.sectionId)} · ${orderLineHe(fresh)} = ${nis(fresh.amount)}`, correction: a.asCorrection ? r.state.control.corrections[r.state.control.corrections.length - 1] : null });
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
// The agent's review: material to read, findings it raises, the pass it closes, facts it extracts
// ---------------------------------------------------------------------------

const recordRef = z.object({ type: z.enum(["invoice", "po", "contract", "boq_line", "document", "forecast_line"]), id: z.string() });
const sourceRef = z.object({ kind: z.enum(["invoice", "po", "contract", "document", "forecast", "boq", "changelog", "history", "section"]), refId: z.string(), labelHe: z.string(), documentId: z.string().optional(), anchor: z.string().optional() });

define({
  name: "get_review_material",
  title: "Material for the review pass",
  description: "What the deterministic checks cannot judge, gathered for reading: each contract's scope, inclusions and exclusions with the invoices billed against it in the period (descriptions, amounts, sections), invoices without a contract, BOQ lines that are not covered with the quotes that may price them (with their extracted facts), and every document's text next to its recorded facts and their provenance. Read it and raise findings with raise_finding for what does not fit; then record_review_pass.",
  kind: "read",
  input: { projectId, controlDate, since: isoDate.optional().describe("invoices received on/after this date (default: the previous control date)"), sectionId: sectionId.optional() },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const c = state.control.controlDate;
    const previous = pkg.forecasts.filter((f) => f.status === "final" && f.controlDate < c).sort((x, y) => (x.controlDate < y.controlDate ? 1 : -1))[0];
    const since = a.since ?? previous?.controlDate ?? "0000-00-00";
    const sec = a.sectionId as HInvoice["sectionId"] | undefined;
    const period = state.erp.invoices.filter((i) => i.dateReceived >= since && (!sec || i.sectionId === sec));
    const brief = (i: HInvoice) => ({ id: i.id, date: i.date, dateReceived: i.dateReceived, docType: i.docType, partialNo: i.partialNo, descriptionHe: i.descriptionHe, amount: i.amount, sectionId: i.sectionId, sectionHe: sectionLabel(i.sectionId), status: i.status, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, attachmentId: i.attachmentId, enteredBy: i.enteredBy });
    const contracts = pkg.contracts
      .filter((k) => !sec || k.sectionId === sec)
      .map((k) => ({ id: k.id, supplierHe: supplierName(k.supplierId), sectionId: k.sectionId, sectionHe: sectionLabel(k.sectionId), amount: k.amount, scopeHe: k.scopeHe, inclusionsHe: k.inclusionsHe, exclusions: k.exclusions, priceAppendices: k.priceAppendices ?? [], closed: k.closed ?? null, invoices: period.filter((i) => i.contractId === k.id).map(brief) }));
    const keywords = (t: string) => t.split(/[\s,()״"]+/).filter((w) => w.length >= 4);
    const boq = pkg.boq
      .filter((l) => (!sec || l.sectionId === sec) && l.coverage !== "covered")
      .map((l) => ({ ...l, sectionHe: sectionLabel(l.sectionId), candidateQuotes: pkg.documents.filter((d) => d.kind === "quote" && (quoteFacts(d)?.boqLineId === l.id || keywords(l.descriptionHe).some((w) => d.titleHe.includes(w)))).map((d) => ({ id: d.id, titleHe: d.titleHe, date: d.date, supplierHe: supplierName(d.supplierId), facts: d.facts ?? null })) }));
    return {
      period: { from: since, to: c },
      contracts,
      invoicesWithoutContract: period.filter((i) => !i.contractId).map(brief),
      boq,
      documents: pkg.documents.map((d) => ({ id: d.id, kind: d.kind, titleHe: d.titleHe, date: d.date, supplierHe: supplierName(d.supplierId), processed: !isUnprocessed(d), recordRef: d.recordRef ?? null, facts: d.facts ?? null, factsSource: d.factsSource ?? null, text: documentText(d) })),
      reviewPassHe: state.control.notes.find((n) => n.kind === "review_pass")?.textHe ?? null,
    };
  },
});

define({
  name: "raise_finding",
  title: "Raise a finding from reading",
  description: "Record a finding you found by reading — an invoice whose description does not match its contract's scope or lands on an exclusion, a quote that does not price the BOQ line it is attached to, facts that differ from the document — with the record, the sources you read, your reasoning and the decision needed. It joins the control like a check's finding: a card, the same decisions (apply when you give a proposedFix — a section move for an invoice or an order, the invoice's fields as the document states them, the order's line under the amount lock; refer; accept), the report's open-findings table. On approval the fix runs through the same guarded, logged and verified path as a check's fix. Requires a running control.",
  kind: "write",
  input: {
    projectId,
    controlDate,
    titleHe: z.string(),
    problemHe: z.string().describe("one sentence: what does not fit, with the numbers"),
    meaningHe: z.string().describe("what it means for the forecast or the payments"),
    sectionId,
    record: recordRef,
    sources: z.array(sourceRef).optional(),
    reasoningHe: z.string().optional().describe("what you read and why it does not fit"),
    questionHe: z.string().optional(),
    options: z.array(z.object({ id: z.enum(["apply", "refer", "accept"]), labelHe: z.string() })).optional(),
    impact: z.object({ kind: z.enum(["none", "amount", "unknown"]), amount: z.number().optional(), labelHe: z.string().optional() }).optional(),
    proposedFix: z
      .object({
        labelHe: z.string().describe("the fix in words, e.g. שיוך ל-07-פיתוח"),
        patch: z.object({
          sectionId: sectionId.optional().describe("move the invoice or the order to this budget section (the section its contract or description points to)"),
          amount: z.number().optional(),
          supplierDocNo: z.string().optional(),
          retentionPct: z.number().optional(),
          retentionAmt: z.number().optional(),
          netPayable: z.number().optional(),
          cumulativePrev: z.number().nullable().optional(),
          cumulativeNow: z.number().nullable().optional(),
          date: isoDate.optional(),
          dateReceived: isoDate.optional(),
          status: z.enum(["אושר", "בבדיקה", "שולם"]).optional(),
          qty: z.number().optional().describe("order only"),
          unit: z.string().optional().describe("order only"),
          priceUnit: z.string().optional().describe("order only"),
          unitPrice: z.number().optional().describe("order only — the amount stays locked"),
        }),
      })
      .optional()
      .describe("a fix that names stored data — the contract's section, the document's values, the quote's line — offered as 'apply' and written only after the user approves; refused when raised if it is not applicable"),
    referToId: personId.optional().describe("who a 'refer' decision goes to (default: bookkeeping)"),
  },
  run: async (a) => {
    let raised!: HFinding;
    const r = await write(a.projectId, a.controlDate, (s) => {
      const [next, f] = raiseFinding(s, a as never);
      raised = f;
      return next;
    });
    return outcome(r, { finding: findingView(r.state.control.findings.find((f) => f.id === raised.id)!, r.state), openFindings: controlView(r.state).openFindings });
  },
});

define({
  name: "record_review_pass",
  title: "Close the review pass",
  description: "Record that you read the review material for this control and what came of it (how many findings raised, what was checked and found consistent). The report states it in its sources line; without it the report says the review was not done.",
  kind: "write",
  input: { projectId, controlDate, summaryHe: z.string(), byId: personId.optional() },
  run: async (a) => outcome(await write(a.projectId, a.controlDate, (s) => recordReviewPass(s, a.summaryHe, (a.byId as V2State["operatorId"] | undefined) ?? s.operatorId)[0])),
});

define({
  name: "set_document_facts",
  title: "Record facts extracted from a document",
  description: "Write the structured facts you read in a document (get_document gives its text) so the checks run on them: for a quote or order confirmation — qty, unit, unitPrice, amount, validUntil (yyyy-mm-dd), boqLineId, supplierId; for a price appendix — pricePerTon (per unit), validFrom; for an invoice — amount, qty, unit; anything else you read that a check may need. Replaces the document's facts and records the provenance (agent, by whom, when). In the operational system an extraction service would do this from the PDF; the checks and the agent do not change.",
  kind: "write",
  input: { projectId, documentId: z.string(), facts: z.record(z.string(), z.unknown()), noteHe: z.string().optional().describe("what you read it from, e.g. 'שורה 2 בטבלת ההצעה'"), byId: personId.optional() },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const doc = pkg.documents.find((d) => d.id === a.documentId);
    if (!doc) throw new Error(`מסמך ${a.documentId} לא נמצא`);
    await updateDocumentFacts(a.projectId, a.documentId, a.facts, { method: "agent", byId: a.byId ?? state.operatorId, ...(a.noteHe ? { noteHe: a.noteHe } : {}) });
    await loadState(a.projectId);
    const fresh = pkg.documents.find((d) => d.id === a.documentId)!;
    return { ok: true, document: { id: fresh.id, titleHe: fresh.titleHe, facts: fresh.facts ?? null, factsSource: fresh.factsSource ?? null, quoteFacts: quoteFacts(fresh), processed: !isUnprocessed(fresh) }, hintHe: "העובדות נרשמו והמסמך מסומן כמעובד; הבדיקות הדטרמיניסטיות ירוצו עליהן בהרצה הבאה (run_check / run_control / build_report)." };
  },
});

define({
  name: "add_document",
  title: "Add a real document to the folder",
  description: "Put a file the user handed you (a path on this machine: PDF, image, text) into the project folder: uploads it to storage, opens its folder row (unprocessed), extracts what text it has and caches it locally. Give what you already know — kind, title, date, supplier, the invoice/order/contract it belongs to — and process it afterwards (get_document → classify_document → set_document_facts). replacesDocumentId makes it the record's current document instead of that one (the replaced document stays in the folder marked, neither pending nor compared; the record link is inherited when not given). The ERP users upload from the web app's תיקיית מסמכים screen or from a record's card; this is the same operation from the session.",
  kind: "write",
  input: { projectId, path: z.string().describe("local file path"), fileName: z.string().optional().describe("name to keep (default: the file's name)"), kind: documentKind.default("other"), titleHe: z.string().optional(), date: isoDate.optional().describe("the document's date (default: today)"), supplierId: z.string().optional(), recordType: recordType.optional(), recordId: z.string().optional(), replacesDocumentId: z.string().optional().describe("the document this file replaces (same record)"), byId: personId.optional().describe("who adds it (default: the operator)") },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const source = resolve(a.path);
    if (!existsSync(source)) throw new Error(`הקובץ לא נמצא: ${source}`);
    if (a.supplierId && !pkg.suppliers.some((x) => x.id === a.supplierId)) throw new Error(`ספק ${a.supplierId} לא נמצא`);
    if ((a.recordType && !a.recordId) || (!a.recordType && a.recordId)) throw new Error("recordType ו-recordId באים יחד");
    if (a.recordType && a.recordId && !findRecord(state, a.recordType, a.recordId)) throw new Error(`רשומה ${a.recordType} ${a.recordId} לא נמצאה`);
    const replaced = a.replacesDocumentId ? pkg.documents.find((d) => d.id === a.replacesDocumentId) : undefined;
    if (a.replacesDocumentId && !replaced) throw new Error(`המסמך ${a.replacesDocumentId} לא נמצא`);
    if (replaced?.supersededBy) throw new Error(`המסמך ${replaced.id} כבר הוחלף ב-${replaced.supersededBy}`);
    const fileName = a.fileName ?? basename(source);
    const bytes = new Uint8Array(readFileSync(source));
    const mimeType = mimeTypeFor(fileName);
    const id = await nextDocumentId(a.projectId);
    const filePath = await uploadDocumentFile(documentFilePath(a.projectId, id, fileName), bytes, mimeType);
    const extracted = isImage(mimeType) ? { text: null } : await extractText(bytes, mimeType);
    const created = await addDocument(a.projectId, { id, kind: a.kind, titleHe: a.titleHe ?? fileName, date: a.date ?? nowStamp().slice(0, 10), supplierId: a.supplierId ?? null, fileName, filePath, mimeType, sizeBytes: bytes.byteLength, uploadedById: a.byId ?? state.operatorId, recordRef: a.recordType && a.recordId ? { type: a.recordType, id: a.recordId } : (replaced?.recordRef ?? null), replacesDocumentId: a.replacesDocumentId ?? null, text: extracted.text });
    const localPath = documentCachePath(a.projectId, created);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, bytes);
    return { ok: true, document: documentView(created), localPath, fileUrl: documentFileUrl(filePath), text: extracted.text, hintHe: `המסמך ${id} נוסף לתיקייה וטרם עובד: קרא אותו (Read ${localPath} ל-PDF/תמונה), תאר אותו ורשום את עובדותיו.` };
  },
});

define({
  name: "classify_document",
  title: "Describe a document after reading it",
  description: "Record what you determined by reading a document: its kind, a proper Hebrew title, its date, the supplier, the invoice/order/contract it belongs to, and a one-line summary. Metadata only — the facts the checks use go through set_document_facts, which is what marks the document processed.",
  kind: "write",
  input: { projectId, documentId: z.string(), kind: documentKind.optional(), titleHe: z.string().optional(), date: isoDate.optional(), supplierId: z.string().nullable().optional(), recordType: recordType.nullable().optional(), recordId: z.string().nullable().optional(), summaryHe: z.string().optional().describe("one line: what the document is and says") },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const doc = pkg.documents.find((d) => d.id === a.documentId);
    if (!doc) throw new Error(`מסמך ${a.documentId} לא נמצא`);
    if (a.supplierId && !pkg.suppliers.some((x) => x.id === a.supplierId)) throw new Error(`ספק ${a.supplierId} לא נמצא`);
    const patch: Parameters<typeof updateDocument>[2] = {};
    if (a.kind !== undefined) patch.kind = a.kind;
    if (a.titleHe !== undefined) patch.titleHe = a.titleHe;
    if (a.date !== undefined) patch.date = a.date;
    if (a.supplierId !== undefined) patch.supplierId = a.supplierId;
    if (a.summaryHe !== undefined) patch.summaryHe = a.summaryHe;
    if (a.recordType !== undefined || a.recordId !== undefined) {
      if (a.recordType && a.recordId) {
        if (!findRecord(state, a.recordType, a.recordId)) throw new Error(`רשומה ${a.recordType} ${a.recordId} לא נמצאה`);
        patch.recordRef = { type: a.recordType, id: a.recordId };
      } else patch.recordRef = null;
    }
    const updated = await updateDocument(a.projectId, a.documentId, patch);
    return { ok: true, document: documentView(updated), ...(isUnprocessed(updated) ? { hintHe: "המסמך עדיין לא מסומן כמעובד — רשום את עובדותיו עם set_document_facts (גם {} עם הערה כשאין עובדות לבדיקות)." } : {}) };
  },
});

// ---------------------------------------------------------------------------
// Budget changes
// ---------------------------------------------------------------------------

define({
  name: "list_budget_changes",
  title: "Approved budget changes",
  description: "The approved changes to the budget — transfers between sections, additions, reductions — with who approved them and why, and the net effect per section (original budget, changes, updated budget). The report's sections table shows the same in its שינויים / תקציב מעודכן columns.",
  kind: "read",
  input: { projectId, sectionId: sectionId.optional() },
  run: async (a) => {
    await loadState(a.projectId);
    const rows = pkg.budgetChanges.filter((c) => !a.sectionId || c.fromSectionId === a.sectionId || c.toSectionId === a.sectionId);
    const deltas = budgetChangesBySection(pkg.budgetChanges);
    return { total: rows.length, changes: rows.map(budgetChangeView), perSection: pkg.sections.filter((s) => deltas[s.id]).map((s) => ({ sectionId: s.id, sectionHe: sectionLabel(s.id), originalBudget: s.budget, changes: deltas[s.id], updatedBudget: s.budget + deltas[s.id] })), totals: { originalBudget: pkg.sections.reduce((n, s) => n + s.budget, 0), changes: Object.values(deltas).reduce((n, v) => n + v, 0) } };
  },
});

define({
  name: "add_budget_change",
  title: "Record an approved budget change",
  description: "Record a change to the budget on the user's instruction, with who approved it: a transfer between two sections (fromSectionId → toSectionId), an addition to a section (toSectionId only; an owner-approved increase or funding from outside the project) or a reduction (fromSectionId only). The original budget stays; the updated budget is original plus changes, used by the report, the variance and the materiality thresholds. Logged in the change log. A transfer or reduction may not take a section's updated budget below zero. A change counts in a control when its date is on or before that control's date (the result says whether it counts). Never on your own initiative.",
  kind: "write",
  input: { projectId, kind: z.enum(["transfer", "addition", "reduction"]), fromSectionId: sectionId.optional(), toSectionId: sectionId.optional(), amount: z.number().int().positive(), date: isoDate.optional().describe("approval date (default: today)"), reasonHe: z.string().min(3), referenceHe: z.string().optional().describe("the approval: a decision, a change order, a letter"), approvedById: personId, byId: personId.optional().describe("who records it (default: the operator)") },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const from = a.kind === "addition" ? null : a.fromSectionId ?? null;
    const to = a.kind === "reduction" ? null : a.toSectionId ?? null;
    if (a.kind === "transfer" && (!from || !to || from === to)) throw new Error("העברה דורשת fromSectionId ו-toSectionId שונים");
    if (a.kind === "addition" && !to) throw new Error("תוספת דורשת toSectionId");
    if (a.kind === "reduction" && !from) throw new Error("הפחתה דורשת fromSectionId");
    for (const id of [from, to]) if (id && !pkg.sections.some((s) => s.id === id)) throw new Error(`סעיף ${id} לא קיים`);
    if (!pkg.people.some((p) => p.id === a.approvedById)) throw new Error(`${a.approvedById} אינו מוגדר בפרויקט`);
    if (from) {
      const current = pkg.sections.find((s) => s.id === from)!.budget + (budgetChangesBySection(pkg.budgetChanges)[from] ?? 0);
      if (current - a.amount < 0) throw new Error(`התקציב המעודכן של סעיף ${sectionLabel(from as SectionId)} הוא ${current.toLocaleString("he-IL")} ₪ — אי אפשר להוריד ממנו ${a.amount.toLocaleString("he-IL")} ₪`);
    }
    const created = await addBudgetChange(a.projectId, { date: a.date ?? nowStamp().slice(0, 10), kind: a.kind, fromSectionId: from as HBudgetChangeLike["fromSectionId"], toSectionId: to as HBudgetChangeLike["toSectionId"], amount: a.amount, reasonHe: a.reasonHe, referenceHe: a.referenceHe, approvedById: a.approvedById as HBudgetChangeLike["approvedById"], createdById: (a.byId ?? state.operatorId) as HBudgetChangeLike["createdById"] });
    const fresh = await loadState(a.projectId);
    const deltas = budgetChangesBySection(pkg.budgetChanges);
    const after = [from, to].filter((id): id is string => !!id).map((id) => ({ sectionId: id, sectionHe: sectionLabel(id as SectionId), originalBudget: pkg.sections.find((s) => s.id === id)!.budget, changes: deltas[id] ?? 0, updatedBudget: pkg.sections.find((s) => s.id === id)!.budget + (deltas[id] ?? 0) }));
    const logged = fresh.erp.changeLog.find((e) => e.recordType === "budget" && e.recordId === created.id);
    const controlDate = fresh.control.controlDate;
    const countsInControl = created.date <= controlDate;
    return { ok: true, change: budgetChangeView(created), sectionsAfter: after, countsInControl, ...(countsInControl ? {} : { noteHe: `השינוי מתוארך ${created.date.split("-").reverse().join(".")} — אחרי מועד הבקרה ${controlDate.split("-").reverse().join(".")} — ולכן אינו נכלל בתקציב המעודכן של בקרה זו (ייכלל בבקרה הבאה). אם אושר לפני מועד הבקרה, רשום אותו עם date מתאים.` }), verifiedHe: `נקרא מחדש: ${created.id} · ${BUDGET_CHANGE_KIND_HE[created.kind]} · ${created.amount.toLocaleString("he-IL")} ₪ · אישר ${personName(created.approvedById)}${logged ? ` · נרשם ביומן השינויים (${logged.after})` : ""}`, headline: headline(fresh) };
  },
});

// ---------------------------------------------------------------------------
// The heartbeat — everything new since the last pass
// ---------------------------------------------------------------------------

define({
  name: "get_heartbeat_work",
  title: "What is new since the last heartbeat",
  description: "The deterministic part of a heartbeat: the documents nobody processed yet (with their text and local path, so you can read them), the records inserted or changed in the ERP since the last heartbeat's watermark (grouped per invoice/order, with who changed what), the checks' findings that touch those records or that neither the control session nor an earlier heartbeat knows, and the control's undecided findings for context. Process the documents, read the changed records against their contracts, present or raise findings, then record_heartbeat with the untilChangeLogId returned here.",
  kind: "check",
  input: { projectId, sinceChangeLogId: z.number().int().optional().describe("start after this change-log id (default: the last heartbeat's watermark; 0 = everything)"), sinceDate: isoDate.optional().describe("alternatively: changes on/after this date"), extract: z.boolean().default(true).describe("download pending files and extract their text (false: list only)") },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const history = await listHeartbeats(a.projectId, 200);
    const last = history[0] ?? null;
    let since = a.sinceChangeLogId ?? last?.untilChangeLogId ?? 0;
    if (a.sinceDate) {
      const before = state.erp.changeLog.filter((e) => e.at.slice(0, 10) < a.sinceDate!).reduce((m, e) => Math.max(m, changeLogId(e)), 0);
      since = before;
    }
    const reported = new Set<string>();
    for (const h of history) for (const id of ((h.details.findingIds as string[] | undefined) ?? [])) reported.add(id);
    const work = heartbeatWork(pkg, state, since, reported, nowStamp().slice(0, 10));
    const pending = [];
    for (const d of work.pendingDocuments) {
      const file = a.extract ? await materializeDocument(a.projectId, d) : null;
      pending.push({ ...documentView(d), text: file ? file.text : documentText(d) || null, ...(file ? { localPath: file.localPath, fileUrl: file.fileUrl, readHintHe: file.readHintHe } : {}) });
    }
    const records = work.changedRecords.map((r) => {
      const inv = r.type === "invoice" ? state.erp.invoices.find((i) => String(i.id) === r.id) : undefined;
      const po = r.type === "po" ? state.erp.purchaseOrders.find((p) => String(p.id) === r.id) : undefined;
      const contract = inv?.contractId ? pkg.contracts.find((k) => k.id === inv.contractId) : po?.contractId ? pkg.contracts.find((k) => k.id === po.contractId) : undefined;
      return { type: r.type, id: r.id, isNew: r.isNew, byHe: r.byIds.map((id) => personName(id) ?? id).join(", "), fieldsHe: r.fieldsHe, firstAt: r.firstAt, lastAt: r.lastAt, changes: r.entries.map((e) => ({ id: e.id, at: e.at, fieldHe: e.field, beforeHe: e.before, afterHe: e.after, byHe: personName(e.byId) ?? e.byId, noteHe: e.noteHe || null })), record: inv ? invoiceView(inv) : po ? poView(po) : null, contract: contract ? { id: contract.id, scopeHe: contract.scopeHe, inclusionsHe: contract.inclusionsHe, exclusions: contract.exclusions } : null, documents: pkg.documents.filter((d) => d.recordRef?.type === r.type && d.recordRef.id === r.id).map(documentView) };
    });
    const findings = work.findings.map((f) => findingView(f, state));
    const summaryHe = heartbeatSummaryHe(work);
    const steps = [pending.length ? `עבד ${pending.length} מסמכים: קרא כל אחד (Read על localPath כשיש קובץ), classify_document, set_document_facts, ואם הוא שייך לרשומה — run_check עליה.` : "", records.length ? `קרא ${records.length} רשומות שהשתנו מול החוזה והתיאור שלהן; מה שלא מתאים — ממצא.` : "", findings.length ? `${findings.length} ממצאים מהבדיקות: הצג כל אחד עם התיקון המומלץ ומי מעורב; כשיש בקרה פעילה — raise_finding לממצאי קריאה; החלטות דרך /bakara-control.` : "", `סיים ב-record_heartbeat (untilChangeLogId=${work.untilChangeLogId}, findingIds של מה שהוצג, summaryHe).`].filter(Boolean);
    return { ok: true, sinceChangeLogId: work.sinceChangeLogId, untilChangeLogId: work.untilChangeLogId, previousHeartbeat: last ? { id: last.id, at: last.at, byHe: personName(last.byId) ?? last.byId, summaryHe: last.summaryHe } : null, controlStatus: state.control.status, summaryHe, documents: { pendingCount: pending.length, pending }, changes: { recordCount: records.length, entryCount: work.changedRecords.reduce((n, r) => n + r.entries.length, 0), records }, findings, findingIds: work.findings.map((f) => f.id), sessionOpenFindings: work.sessionOpenFindings.map((f) => ({ id: f.id, titleHe: f.titleHe })), stepsHe: steps, nothingNew: !pending.length && !records.length && !findings.length };
  },
});

define({
  name: "record_heartbeat",
  title: "Record a heartbeat",
  description: "Close a heartbeat pass: store its watermark (the untilChangeLogId from get_heartbeat_work, so nothing that happened meanwhile is skipped next time), the counts, the finding ids you presented (the next heartbeat will not repeat them unless their record changes again) and a Hebrew summary of what was processed, what was found and what awaits the user.",
  kind: "write",
  input: { projectId, untilChangeLogId: z.number().int().optional().describe("from get_heartbeat_work (default: the latest change-log id)"), sinceChangeLogId: z.number().int().optional(), summaryHe: z.string().describe("what was processed, what was found, what needs the user"), documentsProcessed: z.number().int().default(0), documentsPending: z.number().int().default(0), recordsChanged: z.number().int().default(0), findingIds: z.array(z.string()).default([]).describe("finding ids presented in this pass"), documentIds: z.array(z.string()).default([]).describe("documents processed in this pass"), byId: personId.optional() },
  run: async (a) => {
    const state = await loadState(a.projectId);
    const history = await listHeartbeats(a.projectId, 1);
    const until = a.untilChangeLogId ?? (await latestChangeLogId(a.projectId));
    const since = a.sinceChangeLogId ?? history[0]?.untilChangeLogId ?? 0;
    const row = await recordHeartbeat(a.projectId, { byId: a.byId ?? state.operatorId, sinceChangeLogId: since, untilChangeLogId: until, documentsPending: a.documentsPending, documentsProcessed: a.documentsProcessed, recordsChanged: a.recordsChanged, findings: a.findingIds.length, summaryHe: a.summaryHe, details: { findingIds: a.findingIds, documentIds: a.documentIds } });
    return { ok: true, heartbeat: { ...row, byHe: personName(row.byId) ?? row.byId }, messageHe: `פעימת לב #${row.id} נרשמה (יומן שינויים ${since}→${until}): ${a.summaryHe}` };
  },
});

define({
  name: "list_heartbeats",
  title: "Heartbeat history",
  description: "The recorded heartbeats of the project, newest first: when, by whom, the change-log range covered, counts and the summary — and how many changes happened since the last one.",
  kind: "read",
  input: { projectId, limit: z.number().int().min(1).max(200).default(20) },
  run: async (a) => {
    const [rows, latest] = await Promise.all([listHeartbeats(a.projectId, a.limit), latestChangeLogId(a.projectId)]);
    await loadState(a.projectId);
    const last = rows[0] ?? null;
    return { total: rows.length, latestChangeLogId: latest, changesSinceLast: last ? Math.max(0, latest - last.untilChangeLogId) : null, pendingDocuments: pkg.documents.filter(isUnprocessed).length, heartbeats: rows.map((r) => ({ ...r, byHe: personName(r.byId) ?? r.byId })) };
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
  input: { projectId, controlDate, includeTrends: z.boolean().optional(), splitByBuilding: z.boolean().optional(), byChapter: z.boolean().optional().describe("secondary view of the sections table by the chapters of the Interministerial Specification (הספר הכחול)"), ceoVersion: z.boolean().optional(), execSummaryMaxLines: z.number().int().min(3).max(10).optional(), save: z.boolean().default(false) },
  run: async (a) => {
    const r = await write(a.projectId, a.controlDate, (s) => {
      const patch = { ...(a.includeTrends !== undefined ? { includeTrends: a.includeTrends } : {}), ...(a.splitByBuilding !== undefined ? { splitByBuilding: a.splitByBuilding } : {}), ...(a.byChapter !== undefined ? { byChapter: a.byChapter } : {}), ...(a.ceoVersion !== undefined ? { ceoVersion: a.ceoVersion } : {}), ...(a.execSummaryMaxLines !== undefined ? { execSummaryMaxLines: a.execSummaryMaxLines } : {}) };
      let next = Object.keys(patch).length ? setReportConfig(s, patch) : s;
      if (a.save) next = saveConfig(next, true);
      return next;
    });
    return outcome(r, { reportConfig: r.state.control.reportConfig, savedConfig: r.state.savedConfig });
  },
});

/** The last heartbeat, the change log's top id and the findings earlier heartbeats presented — what readiness and the blockers are measured against. */
async function heartbeatContext(projectId: string): Promise<ReadinessContext> {
  const [history, latest] = await Promise.all([listHeartbeats(projectId, 200), latestChangeLogId(projectId)]);
  const reported = new Set<string>();
  for (const h of history) for (const id of ((h.details.findingIds as string[] | undefined) ?? [])) reported.add(id);
  return { lastHeartbeat: history[0] ?? null, latestChangeLogId: latest, previouslyReported: reported, today: nowStamp().slice(0, 10) };
}

/** A saved version or a final control must rest on data that was read: refuse while documents are pending or a heartbeat is due with findings. */
function refuseUnlessRead(ctx: ReadinessContext, state: V2State, prefixHe: string): void {
  const blockers = reportBlockers(pkg, state, ctx.lastHeartbeat, ctx.latestChangeLogId, ctx.previouslyReported ?? [], ctx.today);
  if (blockers.length) throw new Error(`${prefixHe}: ${blockers.map((b) => b.textHe).join(" ")}`);
}

define({
  name: "report_readiness",
  title: "Can the report go out?",
  description: "What stands between the current data and a deliverable report, without rendering it: pending documents, changes since the last heartbeat, findings nobody decided on (the session's open ones, what the checks raise beyond the session, and findings an earlier heartbeat presented that nobody decided), and whether the review pass was done — the same attentionHe build_report returns, at a fraction of the size, with each open finding's recommended fix and people. Call it after the heartbeat and before build_report; build the report once, when ready is true.",
  kind: "check",
  input: { projectId, controlDate },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    return { ok: true, ...reportReadiness(pkg, state, await heartbeatContext(a.projectId)), headline: headline(state) };
  },
});

define({
  name: "build_report",
  title: "Build the report",
  description: "Build the control report from the current state per the report standard (sections 0–11, 4a/4b kept apart, CEO page). format: 'summary' (header, executive summary, key table, decisions, material sections, issues — compact), 'markdown' (full text), 'json' (the whole model), 'docx' (Word file written to path), 'xlsx' (Excel workbook, one sheet per table, written to path). saveVersion=true (or a label) stores the version in the database — refused, with the reason, while documents are pending, no heartbeat was ever recorded, or the checks raise findings on records changed since the last heartbeat that nobody presented (run /bakara-heartbeat first; building without saving always works).",
  kind: "write",
  input: { projectId, controlDate, tab: z.enum(["full", "ceo"]).default("full"), format: z.enum(["summary", "markdown", "json", "docx", "xlsx"]).default("summary"), path: z.string().optional().describe("output file path for docx/xlsx/markdown (default out/…)"), label: z.string().optional(), saveVersion: z.boolean().default(false) },
  run: async (a) => {
    const state = await loadState(a.projectId, a.controlDate);
    const ctx = await heartbeatContext(a.projectId);
    if (a.saveVersion || a.label) refuseUnlessRead(ctx, state, "הדוח לא נשמר כגרסה");
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
    // the same readiness report_readiness gives, on the findings this build already computed (the checks run once)
    const { attentionHe } = reportReadiness(pkg, state, ctx, report.openFindings);
    return { ok: true, tab: a.tab, format: a.format, path, versionId, ...(attentionHe ? { attentionHe } : {}), ...(a.format === "json" ? { report } : a.format === "markdown" ? { markdown: text } : {}), summary };
  },
});

define({
  name: "finalize_control",
  title: "Finalize the control",
  description: "Close the control as the final version (the report header changes from טיוטה to גרסה סופית). Only when the user says the control is closed. Refused, with the reason, while documents are pending or findings on records changed since the last heartbeat were never presented (run /bakara-heartbeat first).",
  kind: "write",
  input: { projectId, controlDate },
  run: async (a) => {
    refuseUnlessRead(await heartbeatContext(a.projectId), await loadState(a.projectId, a.controlDate), "הבקרה לא נסגרה");
    return outcome(await write(a.projectId, a.controlDate, finalizeControl), { finalized: true });
  },
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
