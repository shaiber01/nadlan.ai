import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BuildingTag, ForecastBasis, HBoqLine, HChangeLogEntry, HContract, HDocument, HForecastVersion, HInvoice, HOpenIssue, HPerson, HProject, HPurchaseOrder, HSection, HSupplier, HadarimPackage, PersonId, SectionId } from "../data/types";
import type { ErpState } from "../engine/model";
import { DEFAULT_PROJECT_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Database, Json, Tables, TablesInsert } from "./types";

/**
 * Supabase access for the Hadarim prototype: loads a project as the engine's `HadarimPackage`,
 * loads/persists the live ERP state, resets to seed, and follows changes through Realtime.
 * Every function here maps between the database rows (snake_case) and the engine types (camelCase).
 */

export type Db = SupabaseClient<Database>;

let client: Db | null = null;
export function db(): Db {
  if (!client) client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  return client;
}

const TZ = "Asia/Jerusalem";
const stampFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** timestamptz → "yyyy-mm-ddTHH:MM" in Israel time, the shape the engine and the screens use. */
export function toStamp(iso: string): string {
  return stampFormat.format(new Date(iso)).replace(" ", "T");
}
/** "yyyy-mm-ddTHH:MM" (Israel time) → ISO with offset for a timestamptz column. */
export function fromStamp(stamp: string): string {
  const [d, t = "09:00"] = stamp.split("T");
  const probe = new Date(`${d}T${t}:00Z`);
  const local = stampFormat.format(probe).replace(" ", "T");
  const offsetMin = (new Date(`${local}:00Z`).getTime() - probe.getTime()) / 60000;
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${d}T${t}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

async function all<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Row → engine type
// ---------------------------------------------------------------------------

type Row<T extends keyof Database["public"]["Tables"]> = Tables<T>;

export function rowToInvoice(r: Row<"invoices">): HInvoice {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    supplierDocNo: r.supplier_doc_no,
    docType: r.doc_type as HInvoice["docType"],
    partialNo: r.partial_no,
    period: r.period,
    date: r.date,
    dateReceived: r.date_received,
    enteredAt: r.entered_at,
    enteredBy: r.entered_by as PersonId,
    sectionId: r.section_id as SectionId,
    contractId: r.contract_id,
    poId: r.po_id,
    descriptionHe: r.description_he,
    amount: Number(r.amount),
    cumulativePrev: r.cumulative_prev == null ? null : Number(r.cumulative_prev),
    cumulativeNow: r.cumulative_now == null ? null : Number(r.cumulative_now),
    retentionPct: Number(r.retention_pct),
    retentionAmt: Number(r.retention_amt),
    netPayable: Number(r.net_payable),
    building: (r.building as BuildingTag | null) ?? null,
    status: r.status as HInvoice["status"],
    approvedBy: (r.approved_by as PersonId | null) ?? null,
    attachmentId: r.attachment_id,
    quantity: r.quantity == null ? null : Number(r.quantity),
    unit: r.unit,
    unitPrice: r.unit_price == null ? null : Number(r.unit_price),
  };
}

export function rowToPurchaseOrder(r: Row<"purchase_orders">): HPurchaseOrder {
  return {
    id: r.id,
    date: r.date,
    supplierId: r.supplier_id,
    sectionId: r.section_id as SectionId,
    contractId: r.contract_id,
    descriptionHe: r.description_he,
    qty: Number(r.qty),
    unit: r.unit,
    unitPrice: Number(r.unit_price),
    amount: Number(r.amount),
    deliveredQty: Number(r.delivered_qty),
    invoicedAmount: Number(r.invoiced_amount),
    status: r.status as HPurchaseOrder["status"],
    attachmentId: r.attachment_id,
    kind: r.kind as HPurchaseOrder["kind"],
  };
}

export function rowToChangeLog(r: Row<"change_log">): HChangeLogEntry {
  return { id: String(r.id), recordType: r.record_type as HChangeLogEntry["recordType"], recordId: r.record_id, field: r.field, before: r.before, after: r.after, at: toStamp(r.at), byId: r.by_id as PersonId, noteHe: r.note_he ?? "" };
}

function rowToOpenIssue(r: Row<"open_issues">): HOpenIssue {
  return { id: r.id, titleHe: r.title_he, sectionId: (r.section_id as SectionId | null) ?? null, ownerId: r.owner_id as PersonId, dueDate: r.due_date, openedInControl: r.opened_in_control, status: (r.status === "pending_execution" ? "open" : r.status) as HOpenIssue["status"], closedAt: r.closed_at, impactIfIgnoredHe: r.impact_if_ignored_he ?? undefined };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadErp(projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<ErpState> {
  const [invoices, purchaseOrders, changeLog] = await Promise.all([
    all(supabase.from("invoices").select("*").eq("project_id", projectId).order("id"), "invoices"),
    all(supabase.from("purchase_orders").select("*").eq("project_id", projectId).order("id"), "purchase_orders"),
    all(supabase.from("change_log").select("*").eq("project_id", projectId).order("at").order("id"), "change_log"),
  ]);
  return { invoices: invoices.map(rowToInvoice), purchaseOrders: purchaseOrders.map(rowToPurchaseOrder), changeLog: changeLog.map(rowToChangeLog) };
}

/** The whole project as the engine's package: reference data, ERP records, forecasts, issues, documents. */
export async function loadPackage(projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<HadarimPackage> {
  const [projects, people, suppliers, sections, documents, contracts, boq, versions, fSections, fLines, issues, erp] = await Promise.all([
    all(supabase.from("projects").select("*").eq("id", projectId), "projects"),
    all(supabase.from("people").select("*").eq("project_id", projectId), "people"),
    all(supabase.from("suppliers").select("*").eq("project_id", projectId).order("id"), "suppliers"),
    all(supabase.from("sections").select("*").eq("project_id", projectId).order("position"), "sections"),
    all(supabase.from("documents").select("*").eq("project_id", projectId).order("date"), "documents"),
    all(supabase.from("contracts").select("*").eq("project_id", projectId).order("signed_at"), "contracts"),
    all(supabase.from("boq_lines").select("*").eq("project_id", projectId).order("position"), "boq_lines"),
    all(supabase.from("forecast_versions").select("*").eq("project_id", projectId).order("control_date"), "forecast_versions"),
    all(supabase.from("forecast_sections").select("*").eq("project_id", projectId), "forecast_sections"),
    all(supabase.from("forecast_lines").select("*").eq("project_id", projectId).order("position"), "forecast_lines"),
    all(supabase.from("open_issues").select("*").eq("project_id", projectId).order("opened_in_control"), "open_issues"),
    loadErp(projectId, supabase),
  ]);
  const p = projects[0];
  if (!p) throw new Error(`project ${projectId} not found`);
  const budgetVersion = p.budget_version as { number: number; approved_at: string; amount: number };
  const boqVersion = p.boq_version as { number: number; date: string };
  const buildings = (p.buildings as { id: "A" | "B"; floors: number; floors_cast: number; units_per_floor: number }[]).map((b) => ({ id: b.id, floors: b.floors, floorsCast: b.floors_cast, unitsPerFloor: b.units_per_floor }));
  const project: HProject = {
    id: "HADARIM",
    nameHe: p.name_he,
    companyHe: p.company_he,
    buildings,
    units: p.units ?? 0,
    grossSqm: p.gross_sqm ?? 0,
    startDate: p.start_date ?? "",
    budgetVersion: { number: budgetVersion.number, approvedAt: budgetVersion.approved_at, amount: Number(budgetVersion.amount) },
    boqVersion: { number: boqVersion.number, date: boqVersion.date },
    controlDates: p.control_dates,
    currentControlDate: p.current_control_date ?? p.control_dates[p.control_dates.length - 1],
    statusHe: p.status_he ?? "",
    physicalProgressPct: p.physical_progress_pct == null ? null : Number(p.physical_progress_pct),
    schedule: (() => {
      const s = (p.schedule ?? {}) as { contract_end?: string; expected_end?: string; note_he?: string };
      return { ...(s.contract_end ? { contractEnd: s.contract_end } : {}), ...(s.expected_end ? { expectedEnd: s.expected_end } : {}), ...(s.note_he ? { noteHe: s.note_he } : {}) };
    })(),
  };
  const contractsOut: HContract[] = contracts.map((c) => ({
    id: c.id,
    sectionId: c.section_id as SectionId,
    supplierId: c.supplier_id,
    amount: c.amount == null ? null : Number(c.amount),
    signedAt: c.signed_at,
    scopeHe: c.scope_he,
    inclusionsHe: c.inclusions_he,
    exclusions: (c.exclusions as { clause: string; text_he: string; covered_by_contract_id: string | null }[]).map((e) => ({ clause: e.clause, textHe: e.text_he, ...(e.covered_by_contract_id ? { coveredByContractId: e.covered_by_contract_id } : {}) })),
    retentionPct: Number(c.retention_pct),
    ...(c.closed ? { closed: { at: (c.closed as { at: string }).at, finalAccount: Number((c.closed as { final_account: number }).final_account) } } : {}),
    ...(c.steel_supplied_by_client ? { steelSuppliedByClient: true } : {}),
    ...(c.price_appendices
      ? { priceAppendices: (c.price_appendices as { id: string; title_he?: string; price_per_ton: number; valid_from: string; document_id: string }[]).map((a) => ({ id: a.id, titleHe: a.title_he ?? `נספח ${a.id}`, validFrom: a.valid_from, pricePerTon: Number(a.price_per_ton), documentId: a.document_id })) }
      : {}),
    ...(c.document_id ? { documentId: c.document_id } : {}),
    ...(c.note_he ? { noteHe: c.note_he } : {}),
    ...(c.boq_match_verified ? { boqMatchVerified: true } : {}),
  }));
  const sectionsOut: HSection[] = sections.map((s) => ({ id: s.id as SectionId, nameHe: s.name_he, budget: Number(s.budget), split: s.split as HSection["split"], contractIds: contractsOut.filter((c) => c.sectionId === s.id).map((c) => c.id) }));
  const peopleOut: HPerson[] = people.map((x) => ({ id: x.id as PersonId, nameHe: x.name_he, roleHe: x.role_he, canWriteAllocation: x.can_write_allocation }));
  const suppliersOut: HSupplier[] = suppliers.map((s) => ({ id: s.id, nameHe: s.name_he, kind: s.kind as HSupplier["kind"] }));
  const documentsOut: HDocument[] = documents.map((d) => ({ id: d.id, kind: d.kind as HDocument["kind"], titleHe: d.title_he, date: d.date, supplierId: d.supplier_id, fileName: d.file_name, blocks: d.blocks as unknown as HDocument["blocks"], footerHe: d.footer_he, anchors: d.anchors as Record<string, number>, ...(d.facts && Object.keys(d.facts as object).length ? { facts: d.facts as Record<string, unknown> } : {}) }));
  const boqOut: HBoqLine[] = boq.map((l) => ({ id: l.id, chapter: l.chapter, chapterNameHe: l.chapter_name_he, descriptionHe: l.description_he, qty: Number(l.qty), unit: l.unit, sectionId: l.section_id as SectionId, coverage: l.coverage as HBoqLine["coverage"], coverageRef: l.coverage_ref, coveredByContractId: l.covered_by_contract_id, ...(l.note_he ? { noteHe: l.note_he } : {}) }));
  const issuesOut = issues.map(rowToOpenIssue);
  const forecasts: HForecastVersion[] = versions.map((v) => ({
    controlDate: v.control_date,
    status: v.status as HForecastVersion["status"],
    totalEac: Number(v.total_eac),
    sections: v.has_sections
      ? fSections
          .filter((s) => s.control_date === v.control_date)
          .sort((a, b) => a.section_id.localeCompare(b.section_id))
          .map((s) => ({
            sectionId: s.section_id as SectionId,
            budget: Number(s.budget),
            recorded: Number(s.recorded),
            committed: Number(s.committed),
            remainingCommitment: Number(s.remaining_commitment),
            uncovered: Number(s.uncovered),
            eac: Number(s.eac),
            lines: fLines
              .filter((l) => l.control_date === v.control_date && l.section_id === s.section_id)
              .map((l) => ({ id: l.id, sectionId: l.section_id as SectionId, descriptionHe: l.description_he, qty: l.qty == null ? null : Number(l.qty), unit: l.unit, unitPrice: l.unit_price == null ? null : Number(l.unit_price), amount: Number(l.amount), basis: l.basis as ForecastBasis, sourceRef: l.source_ref, kind: l.kind as "remaining_commitment" | "uncovered" })),
            ...(s.coverage_note_he ? { coverageNoteHe: s.coverage_note_he } : {}),
          }))
      : null,
    openIssues: v.has_sections ? issuesOut.filter((i) => i.openedInControl <= v.control_date) : [],
    qualificationsHe: v.qualifications_he,
  }));
  return { project, people: peopleOut, suppliers: suppliersOut, sections: sectionsOut, contracts: contractsOut, invoices: erp.invoices, purchaseOrders: erp.purchaseOrders, boq: boqOut, forecasts, changeLog: erp.changeLog, documents: documentsOut };
}

// ---------------------------------------------------------------------------
// Writing (the triggers write the change log; `updated_by` / `update_note_he` attribute the edit)
// ---------------------------------------------------------------------------

function invoiceColumns(i: HInvoice, projectId: string): TablesInsert<"invoices"> {
  return {
    project_id: projectId,
    id: i.id,
    supplier_id: i.supplierId,
    supplier_doc_no: i.supplierDocNo,
    doc_type: i.docType,
    partial_no: i.partialNo,
    period: i.period,
    date: i.date,
    date_received: i.dateReceived,
    entered_at: i.enteredAt,
    entered_by: i.enteredBy,
    section_id: i.sectionId,
    contract_id: i.contractId,
    po_id: i.poId,
    description_he: i.descriptionHe,
    amount: i.amount,
    cumulative_prev: i.cumulativePrev,
    cumulative_now: i.cumulativeNow,
    retention_pct: i.retentionPct,
    retention_amt: i.retentionAmt,
    net_payable: i.netPayable,
    building: i.building,
    status: i.status,
    approved_by: i.approvedBy,
    attachment_id: i.attachmentId,
    quantity: i.quantity,
    unit: i.unit,
    unit_price: i.unitPrice,
  };
}

export interface WriteMeta {
  byId: PersonId;
  noteHe?: string;
}

export async function saveInvoice(invoice: HInvoice, meta: WriteMeta, isNew: boolean, projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<HInvoice> {
  const columns = { ...invoiceColumns(invoice, projectId), updated_by: meta.byId, update_note_he: meta.noteHe ?? null };
  const query = isNew ? supabase.from("invoices").insert(columns).select().single() : supabase.from("invoices").update(columns).eq("project_id", projectId).eq("id", invoice.id).select().single();
  const { data, error } = await query;
  if (error) throw new Error(`invoice ${invoice.id}: ${error.message}`);
  return rowToInvoice(data);
}

export async function savePurchaseOrder(po: HPurchaseOrder, meta: WriteMeta, projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<HPurchaseOrder> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ qty: po.qty, unit: po.unit, unit_price: po.unitPrice, amount: po.amount, status: po.status, section_id: po.sectionId, description_he: po.descriptionHe, delivered_qty: po.deliveredQty, invoiced_amount: po.invoicedAmount, updated_by: meta.byId, update_note_he: meta.noteHe ?? null })
    .eq("project_id", projectId)
    .eq("id", po.id)
    .select()
    .single();
  if (error) throw new Error(`purchase order ${po.id}: ${error.message}`);
  return rowToPurchaseOrder(data);
}

/** Re-reads one invoice after a write — the verification step the control flow reports. */
export async function readInvoice(id: number, projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<HInvoice | null> {
  const { data, error } = await supabase.from("invoices").select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw new Error(`invoice ${id}: ${error.message}`);
  return data ? rowToInvoice(data) : null;
}

/** Scene-1 variant B in database mode: the script's invoice is removed so it can be keyed in live. */
export async function deleteInvoice(id: number, projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<void> {
  const log = await supabase.from("change_log").delete().eq("project_id", projectId).eq("record_type", "invoice").eq("record_id", String(id));
  if (log.error) throw new Error(`change_log ${id}: ${log.error.message}`);
  const { error } = await supabase.from("invoices").delete().eq("project_id", projectId).eq("id", id);
  if (error) throw new Error(`invoice ${id}: ${error.message}`);
}

export async function resetProject(projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<void> {
  const { error } = await supabase.rpc("reset_project", { p_project_id: projectId });
  if (error) throw new Error(`reset_project: ${error.message}`);
}

export interface ProjectSummary {
  id: string;
  nameHe: string;
  companyHe: string;
  statusHe: string;
  controlDates: string[];
  currentControlDate: string | null;
}

/** Every project in the database (the prototype is multi-project by `project_id`). */
export async function listProjects(supabase: Db = db()): Promise<ProjectSummary[]> {
  const rows = await all(supabase.from("projects").select("id, name_he, company_he, status_he, control_dates, current_control_date").order("id"), "projects");
  return rows.map((r) => ({ id: r.id, nameHe: r.name_he, companyHe: r.company_he, statusHe: r.status_he ?? "", controlDates: r.control_dates, currentControlDate: r.current_control_date }));
}

export interface ProjectStatusPatch {
  statusHe?: string;
  /** Measured physical progress in percent; null = not measured. */
  physicalProgressPct?: number | null;
  schedule?: { contractEnd?: string; expectedEnd?: string; noteHe?: string };
}

/** Updates the project's status fields (stage text, measured physical progress, schedule); the schedule is merged. */
export async function updateProject(projectId: string, patch: ProjectStatusPatch, supabase: Db = db()): Promise<void> {
  const row: Partial<TablesInsert<"projects">> = {};
  if (patch.statusHe !== undefined) row.status_he = patch.statusHe;
  if (patch.physicalProgressPct !== undefined) row.physical_progress_pct = patch.physicalProgressPct;
  if (patch.schedule) {
    const { data, error } = await supabase.from("projects").select("schedule").eq("id", projectId).single();
    if (error) throw new Error(`projects: ${error.message}`);
    const current = ((data?.schedule as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const s = patch.schedule;
    row.schedule = { ...current, ...(s.contractEnd !== undefined ? { contract_end: s.contractEnd } : {}), ...(s.expectedEnd !== undefined ? { expected_end: s.expectedEnd } : {}), ...(s.noteHe !== undefined ? { note_he: s.noteHe } : {}) } as Json;
  }
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from("projects").update(row).eq("id", projectId);
  if (error) throw new Error(`projects: ${error.message}`);
}

/** Tables whose changes the web app follows: the ERP, the control session the agent writes, saved reports, the project row. */
const LIVE_TABLES = ["invoices", "purchase_orders", "change_log", "controls", "decisions", "forecast_adjustments", "data_corrections", "open_issues", "audit", "report_versions"] as const;

/** Calls `onChange` (debounced) whenever the project's ERP data, control session or saved reports change. Returns an unsubscribe. */
export function subscribeProject(projectId: string, onChange: () => void, supabase: Db = db()): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 400);
  };
  const channel = supabase.channel(`project-${projectId}`);
  for (const table of LIVE_TABLES) channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` }, bump);
  channel.on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, bump);
  channel.subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}

export interface ReportVersionSummary {
  id: number;
  controlDate: string;
  createdAt: string;
  createdBy: string;
  label: string | null;
}

/** Saved report versions of a project, newest first. */
export async function listReportVersions(projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<ReportVersionSummary[]> {
  const rows = await all(supabase.from("report_versions").select("id, control_date, created_at, created_by, label").eq("project_id", projectId).order("created_at", { ascending: false }), "report_versions");
  return rows.map((r) => ({ id: r.id, controlDate: r.control_date, createdAt: r.created_at, createdBy: r.created_by, label: r.label }));
}

/** One saved report version with its stored model (the ReportModel JSON the agent built). */
export async function getReportVersion(id: number, projectId = DEFAULT_PROJECT_ID, supabase: Db = db()): Promise<(ReportVersionSummary & { model: unknown }) | null> {
  const { data, error } = await supabase.from("report_versions").select("id, control_date, created_at, created_by, label, model").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw new Error(`report_versions: ${error.message}`);
  if (!data) return null;
  return { id: data.id, controlDate: data.control_date, createdAt: data.created_at, createdBy: data.created_by, label: data.label, model: data.model };
}
