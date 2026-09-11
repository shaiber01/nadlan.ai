/**
 * Loads the deterministic Hadarim data package into Supabase, adds the saved report versions that ship with
 * the seed (src/hadarim/data/report-versions.json, exported from the database) and snapshots it all as the
 * project's seed (so "reset to seed" can restore it). Re-runnable: the project's rows are replaced.
 *
 *   npm run hadarim:seed            # uses the publishable key from src/hadarim/db/config.ts
 *   SUPABASE_SECRET_KEY=... npm run hadarim:seed   # or with a secret key
 */
import { createClient } from "@supabase/supabase-js";
import { documentFacts } from "../src/hadarim/data/documents";
import reportVersions from "../src/hadarim/data/report-versions.json";
import { generateHadarimPackage, openIssuesAtAugust } from "../src/hadarim/data/generate";
import { DEFAULT_PROJECT_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/hadarim/db/config";

const key = process.env.SUPABASE_SECRET_KEY ?? SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
const P = DEFAULT_PROJECT_ID;
const pkg = generateHadarimPackage();

function fail(step: string, error: unknown): never {
  console.error(`✗ ${step}:`, error);
  process.exit(1);
}

async function deleteProject() {
  // reverse dependency order; child tables of controls/forecasts cascade
  for (const table of ["report_versions", "audit", "controls", "change_log", "open_issues", "forecast_versions", "invoices", "purchase_orders", "boq_lines", "budget_changes", "contracts", "documents", "sections", "suppliers", "people"]) {
    const { error } = await supabase.from(table).delete().eq("project_id", P);
    if (error) fail(`delete ${table}`, error);
  }
  const { error } = await supabase.from("projects").delete().eq("id", P);
  if (error) fail("delete projects", error);
}

async function insert(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 200));
    if (error) fail(`insert ${table} (rows ${i}–${i + 200})`, error);
  }
  console.log(`  ${table}: ${rows.length}`);
}

/** Timestamps in the data module are "yyyy-mm-dd" or "yyyy-mm-ddThh:mm"; give them a zone. */
const ts = (s: string) => (s.length === 10 ? `${s}T09:00:00+03:00` : `${s}:00+03:00`);

async function main() {
  console.log(`Seeding project ${P} into ${SUPABASE_URL} …`);
  await deleteProject();

  const documentIds = new Set(pkg.documents.map((d) => d.id));
  const poIds = new Set(pkg.purchaseOrders.map((p) => p.id));
  const contractIds = new Set(pkg.contracts.map((c) => c.id));
  let droppedRefs = 0;
  const ref = <T>(value: T | null | undefined, set: Set<T>): T | null => {
    if (value == null) return null;
    if (set.has(value)) return value;
    droppedRefs += 1;
    return null;
  };

  await insert("projects", [
    {
      id: P,
      name_he: pkg.project.nameHe,
      company_he: pkg.project.companyHe,
      units: pkg.project.units,
      gross_sqm: pkg.project.grossSqm,
      start_date: pkg.project.startDate,
      status_he: pkg.project.statusHe,
      budget_version: { number: pkg.project.budgetVersion.number, approved_at: pkg.project.budgetVersion.approvedAt, amount: pkg.project.budgetVersion.amount },
      boq_version: { number: pkg.project.boqVersion.number, date: pkg.project.boqVersion.date },
      control_dates: pkg.project.controlDates,
      current_control_date: pkg.project.currentControlDate,
      buildings: pkg.project.buildings.map((b) => ({ id: b.id, floors: b.floors, floors_cast: b.floorsCast, units_per_floor: b.unitsPerFloor })),
      buckets: { shared: { id: pkg.project.buckets.shared.id, label_he: pkg.project.buckets.shared.labelHe }, parking: { id: pkg.project.buckets.parking.id, label_he: pkg.project.buckets.parking.labelHe } },
      materiality: { absolute: pkg.project.materiality.absolute, pct_of_section: pkg.project.materiality.pctOfSection, absolute_always: pkg.project.materiality.absoluteAlways, budget_share_pct: pkg.project.materiality.budgetSharePct, soft_basis_pct: pkg.project.materiality.softBasisPct },
      risk_policy: { quote_expiry_exposure_pct: pkg.project.riskPolicy.quoteExpiryExposurePct, price_step: pkg.project.riskPolicy.priceStep },
      check_policy: { review_aging_days: pkg.project.checkPolicy.reviewAgingDays },
      physical_progress_pct: pkg.project.physicalProgressPct ?? null,
      schedule: pkg.project.schedule ?? {},
    },
  ]);
  await insert("people", pkg.people.map((p) => ({ project_id: P, id: p.id, name_he: p.nameHe, role_he: p.roleHe, can_write_allocation: p.canWriteAllocation, channel: p.channel ?? null })));
  await insert("suppliers", pkg.suppliers.map((s) => ({ project_id: P, id: s.id, name_he: s.nameHe, kind: s.kind })));
  await insert("sections", pkg.sections.map((s, i) => ({ project_id: P, id: s.id, name_he: s.nameHe, short_name_he: s.shortHe, kind: s.kind, budget: s.budget, split: s.split, position: i + 1, chapters: s.chapters ?? [] })));
  // documentFacts is keyed by document id
  const factsFor = (documentId: string): Record<string, unknown> => ((documentFacts as Record<string, Record<string, unknown> | undefined>)[documentId] ?? {});
  await insert("documents", pkg.documents.map((d) => ({ project_id: P, id: d.id, kind: d.kind, title_he: d.titleHe, date: d.date, supplier_id: d.supplierId, file_name: d.fileName, blocks: d.blocks, footer_he: d.footerHe, anchors: d.anchors, facts: factsFor(d.id), facts_source: { method: "seed" } })));
  await insert("contracts", pkg.contracts.map((c) => ({
    project_id: P,
    id: c.id,
    section_id: c.sectionId,
    supplier_id: c.supplierId,
    amount: c.amount,
    signed_at: c.signedAt,
    scope_he: c.scopeHe,
    inclusions_he: c.inclusionsHe,
    exclusions: c.exclusions.map((e) => ({ clause: e.clause, text_he: e.textHe, covered_by_contract_id: e.coveredByContractId ?? null })),
    retention_pct: c.retentionPct,
    closed: c.closed ? { at: c.closed.at, final_account: c.closed.finalAccount } : null,
    steel_supplied_by_client: c.steelSuppliedByClient ?? false,
    price_appendices: c.priceAppendices ? c.priceAppendices.map((a) => ({ id: a.id, title_he: a.titleHe, price_per_ton: a.pricePerTon, valid_from: a.validFrom, document_id: a.documentId })) : null,
    document_id: ref(c.documentId, documentIds),
    note_he: c.noteHe ?? null,
    boq_match_verified: c.boqMatchVerified ?? false,
  })));
  await insert("purchase_orders", pkg.purchaseOrders.map((p) => ({
    project_id: P,
    id: p.id,
    date: p.date,
    supplier_id: p.supplierId,
    section_id: p.sectionId,
    contract_id: ref(p.contractId, contractIds),
    description_he: p.descriptionHe,
    qty: p.qty,
    unit: p.unit,
    price_unit: p.priceUnit,
    unit_price: p.unitPrice,
    amount: p.amount,
    delivered_qty: p.deliveredQty,
    invoiced_amount: p.invoicedAmount,
    status: p.status,
    attachment_id: ref(p.attachmentId, documentIds),
    kind: p.kind,
  })));
  await insert("invoices", pkg.invoices.map((i) => ({
    project_id: P,
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
    contract_id: ref(i.contractId, contractIds),
    po_id: ref(i.poId, poIds),
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
    attachment_id: ref(i.attachmentId, documentIds),
    quantity: i.quantity,
    unit: i.unit,
    unit_price: i.unitPrice,
  })));
  await insert("boq_lines", pkg.boq.map((l, idx) => ({ project_id: P, id: l.id, chapter: l.chapter, chapter_name_he: l.chapterNameHe, description_he: l.descriptionHe, qty: l.qty, unit: l.unit, unit_price: l.unitPrice, section_id: l.sectionId, coverage: l.coverage, coverage_ref: l.coverageRef, covered_by_contract_id: ref(l.coveredByContractId, contractIds), note_he: l.noteHe ?? null, position: idx + 1 })));
  await insert("forecast_versions", pkg.forecasts.map((f) => ({ project_id: P, control_date: f.controlDate, status: f.status, total_eac: f.totalEac, has_sections: !!f.sections, qualifications_he: f.qualificationsHe ?? [] })));
  await insert("forecast_sections", pkg.forecasts.flatMap((f) => (f.sections ?? []).map((s) => ({ project_id: P, control_date: f.controlDate, section_id: s.sectionId, budget: s.budget, recorded: s.recorded, committed: s.committed, remaining_commitment: s.remainingCommitment, uncovered: s.uncovered, eac: s.eac, coverage_note_he: s.coverageNoteHe ?? null }))));
  await insert("forecast_lines", pkg.forecasts.flatMap((f) => (f.sections ?? []).flatMap((s) => s.lines.map((l, idx) => ({ project_id: P, control_date: f.controlDate, id: l.id, section_id: s.sectionId, description_he: l.descriptionHe, qty: l.qty, unit: l.unit, unit_price: l.unitPrice, amount: l.amount, basis: l.basis, source_ref: l.sourceRef, kind: l.kind, position: idx + 1 })))));
  await insert("open_issues", openIssuesAtAugust.map((o) => ({ project_id: P, id: o.id, title_he: o.titleHe, section_id: o.sectionId, owner_id: o.ownerId, due_date: o.dueDate, opened_in_control: o.openedInControl, status: o.status, closed_at: o.closedAt, impact_if_ignored_he: o.impactIfIgnoredHe ?? null })));
  await insert("change_log", pkg.changeLog.map((c) => ({ project_id: P, record_type: c.recordType, record_id: c.recordId, field: c.field, before: c.before, after: c.after, at: ts(c.at), by_id: c.byId, note_he: c.noteHe ?? null })));

  if (droppedRefs) console.log(`  (${droppedRefs} dangling references set to null)`);

  // the saved report versions that ship with the seed: author and dates as saved, the Word file path not (it was local)
  await insert("report_versions", reportVersions.map((v) => ({ project_id: P, control_date: v.controlDate, label: v.label, created_by: v.createdBy, created_at: v.createdAt, model: v.model, docx_path: null })));

  const { error } = await supabase.rpc("snapshot_project_seed", { p_project_id: P });
  if (error) fail("snapshot_project_seed", error);
  console.log("✓ seed snapshot taken — reset_project('HADARIM') restores this state");
}

main().catch((e) => fail("seed", e));
