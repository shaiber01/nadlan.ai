import { formatILS, formatNumber, splitProportionally, sum, type Agorot } from "../money";
import type {
  Commitment,
  CostCode,
  CostLineView,
  DemoState,
  ErpRecord,
  ForecastVersion,
  LineCommitmentView,
  LineRecordView,
  LineWorkItemView,
  ProjectTotals,
  QuantityView,
  WorkItem,
} from "../types";

/**
 * Pure financial selectors. Every screen, chat answer, report, and export derives from these.
 * A = recognized incurred cost (posted invoice/opening/certificate/adjustment + accruals − reversals/credits)
 * C = Σ max(0, commitment value − recognized against it)
 * R = Σ accepted forecast of uncommitted work items
 * EAC = A + C + R ; V = EAC − B ; paid shown separately.
 */

const RECOGNIZED_KINDS: ReadonlySet<ErpRecord["kind"]> = new Set(["invoice", "opening_balance", "certificate", "accrual", "accrual_reversal", "credit", "adjustment"]);

export function isRecognized(record: ErpRecord): boolean {
  return RECOGNIZED_KINDS.has(record.kind);
}

export function isAccrualComponent(record: ErpRecord): boolean {
  return record.kind === "accrual" || record.kind === "accrual_reversal";
}

/** Payment allocated to each allocation row, proportional to row amounts, remainder to the last row. */
export function paidByAllocation(record: ErpRecord): Agorot[] {
  return splitProportionally(record.paid, record.allocations.map((al) => Math.abs(al.amount)));
}

export function recognizedByCommitment(state: Pick<DemoState, "erpRecords">): Map<string, Agorot> {
  const map = new Map<string, Agorot>();
  for (const record of state.erpRecords) {
    if (!isRecognized(record)) continue;
    for (const al of record.allocations) {
      if (!al.commitmentId) continue;
      map.set(al.commitmentId, (map.get(al.commitmentId) ?? 0) + al.amount);
    }
  }
  return map;
}

export function commitmentRemaining(commitment: Commitment, recognized: Agorot): { remaining: Agorot; overrun: Agorot } {
  if (commitment.status === "superseded" || commitment.status === "conditional") return { remaining: 0, overrun: 0 };
  const diff = commitment.value - recognized;
  return { remaining: Math.max(0, diff), overrun: Math.max(0, -diff) };
}

export function currentForecast(state: Pick<DemoState, "forecasts">, workItemId: string): ForecastVersion | null {
  let best: ForecastVersion | null = null;
  for (const f of state.forecasts) {
    if (f.workItemId !== workItemId) continue;
    if (f.status === "superseded") continue;
    if (!best || f.version > best.version) best = f;
  }
  return best;
}

export function documentById(state: Pick<DemoState, "documents">, id: string | null | undefined) {
  if (!id) return undefined;
  return state.documents.find((d) => d.id === id);
}

export function costCodeById(state: Pick<DemoState, "costCodes">, id: string): CostCode {
  const code = state.costCodes.find((c) => c.id === id);
  if (!code) throw new Error(`Unknown cost code ${id}`);
  return code;
}

export function projectById(state: Pick<DemoState, "projects">, id: string) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown project ${id}`);
  return p;
}

function recordView(record: ErpRecord, allocationIndex: number): LineRecordView {
  const al = record.allocations[allocationIndex];
  const paidParts = paidByAllocation(record);
  return {
    recordId: record.id,
    kind: record.kind,
    descriptionHe: record.descriptionHe,
    date: record.date,
    amount: al.amount,
    paid: paidParts[allocationIndex] ?? 0,
    sourceDocumentId: record.sourceDocumentId,
    supplierId: record.supplierId,
    checkStatus: record.checkStatus,
    quantity: record.allocations.length === 1 ? record.quantity : null,
    unit: record.unit,
    unitPrice: record.allocations.length === 1 ? record.unitPrice : null,
    workItemId: al.workItemId,
    commitmentId: al.commitmentId,
    historicalSummary: Boolean(record.historicalSummary),
  };
}

function workItemView(state: DemoState, item: WorkItem, commitmentViews: LineCommitmentView[]): LineWorkItemView {
  const forecast = currentForecast(state, item.id);
  const committed = item.commitmentId ? commitmentViews.find((c) => c.commitmentId === item.commitmentId) : undefined;
  const amount = item.status === "uncommitted" ? (forecast?.amount ?? 0) : item.status === "committed" ? (committed?.remaining ?? 0) : (forecast?.amount ?? 0);
  return {
    workItemId: item.id,
    titleHe: item.titleHe,
    status: item.status,
    amount,
    quantity: forecast?.quantity ?? item.quantity,
    unit: item.unit,
    unitPrice: forecast?.unitPrice,
    basisHe: forecast?.basisHe ?? (item.status === "committed" ? "לפי התחייבות" : "—"),
    sourceDocumentId: item.sourceDocumentId,
    forecastVersionId: forecast?.id ?? null,
    evidence: forecast?.evidence ?? (item.sourceDocumentId ? [{ documentId: item.sourceDocumentId }] : []),
    needsRevalidation: forecast?.status === "needs_revalidation",
  };
}

function quantityView(state: DemoState, code: CostCode, records: ErpRecord[], items: WorkItem[]): QuantityView | null {
  if (!code.unit || code.plannedQuantity == null || code.category !== "steel") return null;
  const lineRecords = records.filter((r) => r.kind === "invoice" && r.allocations.some((al) => al.costCodeId === code.id));
  let purchasedRaw = 0;
  let purchasedVerified: number | null = 0;
  let delivered: number | null = 0;
  let hasDeliveryDoc = false;
  for (const r of lineRecords) {
    purchasedRaw += r.quantity ?? 0;
    if (r.verifiedQuantity == null) purchasedVerified = null;
    else if (purchasedVerified != null) purchasedVerified += r.verifiedQuantity;
    // active delivery note: the latest received delivery note referencing the same purchase order
    const poId = documentById(state, r.sourceDocumentId)?.facts.purchaseOrderId;
    if (poId) {
      const notes = state.documents
        .filter((d) => d.kind === "delivery_note" && d.facts.purchaseOrderId === poId && !state.documents.some((x) => x.supersedesId === d.id))
        .sort((x, y) => (x.receivedAt < y.receivedAt ? 1 : -1));
      if (notes[0]?.facts.deliveredQuantity != null) {
        hasDeliveryDoc = true;
        delivered = (delivered ?? 0) + notes[0].facts.deliveredQuantity;
      }
    }
  }
  if (!hasDeliveryDoc) delivered = null;
  const committedQuantity = items.filter((i) => i.status === "committed").reduce((acc, i) => acc + (i.quantity ?? 0), 0);
  const outstanding = delivered != null && purchasedVerified != null ? Math.max(0, purchasedVerified - delivered) : null;
  return {
    unit: code.unit,
    planned: code.plannedQuantity,
    purchasedVerified,
    purchasedRaw,
    delivered,
    outstandingDelivery: outstanding,
    remainingToProcure: purchasedVerified == null ? null : code.plannedQuantity - purchasedVerified - committedQuantity,
    committedQuantity: committedQuantity || null,
  };
}

export function costLineView(state: DemoState, costCodeId: string): CostLineView {
  const code = costCodeById(state, costCodeId);
  const recognizedMap = recognizedByCommitment(state);
  const records: LineRecordView[] = [];
  let incurredInvoiced = 0;
  let incurredAccrued = 0;
  let paid = 0;
  let provisional = false;
  const lineRecords: ErpRecord[] = [];
  for (const record of state.erpRecords) {
    if (!isRecognized(record)) continue;
    record.allocations.forEach((al, index) => {
      if (al.costCodeId !== costCodeId) return;
      lineRecords.push(record);
      const view = recordView(record, index);
      records.push(view);
      if (isAccrualComponent(record)) incurredAccrued += al.amount;
      else incurredInvoiced += al.amount;
      paid += view.paid;
      if (record.checkStatus === "pending" || record.checkStatus === "flagged") provisional = true;
    });
  }
  const commitmentViews: LineCommitmentView[] = state.commitments
    .filter((c) => c.costCodeId === costCodeId && c.status !== "superseded")
    .map((c) => {
      const recognized = recognizedMap.get(c.id) ?? 0;
      const { remaining, overrun } = commitmentRemaining(c, recognized);
      return { commitmentId: c.id, titleHe: c.titleHe, kind: c.kind, value: c.value, recognized, remaining, documentId: c.documentId, status: c.status, overrun, supplierId: c.supplierId };
    });
  const items = state.workItems.filter((w) => w.costCodeId === costCodeId);
  const workItems = items.map((w) => workItemView(state, w, commitmentViews));
  const commitments = sum(commitmentViews.map((c) => c.remaining));
  const uncommitted = sum(workItems.filter((w) => w.status === "uncommitted").map((w) => w.amount));
  const incurred = incurredInvoiced + incurredAccrued;
  const eac = incurred + commitments + uncommitted;
  return {
    costCodeId,
    projectId: code.projectId,
    nameHe: code.nameHe,
    category: code.category,
    coverage: code.coverage,
    budget: code.budget,
    incurredInvoiced,
    incurredAccrued,
    incurred,
    commitments,
    uncommitted,
    eac,
    variance: eac - code.budget,
    paid,
    provisional,
    commitmentOverrun: sum(commitmentViews.map((c) => c.overrun)),
    records: records.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)),
    commitmentViews,
    workItems,
    quantities: quantityView(state, code, lineRecords, items),
    needsRevalidation: workItems.some((w) => w.needsRevalidation),
  };
}

export function projectLines(state: DemoState, projectId: string): CostLineView[] {
  return state.costCodes.filter((c) => c.projectId === projectId).map((c) => costLineView(state, c.id));
}

export function totalsOf(lines: CostLineView[]): ProjectTotals {
  const t: ProjectTotals = { budget: 0, incurredInvoiced: 0, incurredAccrued: 0, incurred: 0, commitments: 0, uncommitted: 0, eac: 0, variance: 0, paid: 0, provisional: false };
  for (const l of lines) {
    t.budget += l.budget;
    t.incurredInvoiced += l.incurredInvoiced;
    t.incurredAccrued += l.incurredAccrued;
    t.incurred += l.incurred;
    t.commitments += l.commitments;
    t.uncommitted += l.uncommitted;
    t.eac += l.eac;
    t.paid += l.paid;
    t.provisional = t.provisional || l.provisional;
  }
  t.variance = t.eac - t.budget;
  return t;
}

export function projectTotals(state: DemoState, projectId: string): ProjectTotals {
  return totalsOf(projectLines(state, projectId));
}

export function activeProjects(state: Pick<DemoState, "projects">) {
  return state.projects.filter((p) => p.status === "active");
}

export function portfolioTotals(state: DemoState): ProjectTotals {
  const lines = activeProjects(state).flatMap((p) => projectLines(state, p.id));
  return totalsOf(lines);
}

export function draftBudgetTotal(state: DemoState, projectId: string): { total: Agorot; version: number; lines: { id: string; nameHe: string; amount: Agorot; quantity?: number; unit?: string; unitPrice?: Agorot }[] } | null {
  const versions = state.budgetVersions.filter((b) => b.projectId === projectId && b.kind === "draft");
  if (versions.length === 0) return null;
  const current = versions.find((v) => v.status === "current") ?? versions[versions.length - 1];
  return { total: sum(current.lines.map((l) => l.amount)), version: current.version, lines: current.lines };
}

/** Remaining expected cash payment for one commitment (contract) = recognized unpaid + remaining net commitment. */
export function contractRemainingPayment(state: DemoState, commitmentId: string): { unpaidRecognized: Agorot; unbilledRecognized: Agorot; remainingCommitment: Agorot; total: Agorot } {
  const commitment = state.commitments.find((c) => c.id === commitmentId);
  if (!commitment) throw new Error(`Unknown commitment ${commitmentId}`);
  let recognized = 0;
  let paid = 0;
  let unbilled = 0;
  for (const record of state.erpRecords) {
    if (!isRecognized(record)) continue;
    const parts = paidByAllocation(record);
    record.allocations.forEach((al, i) => {
      if (al.commitmentId !== commitmentId) return;
      recognized += al.amount;
      paid += parts[i] ?? 0;
      if (isAccrualComponent(record)) unbilled += al.amount;
    });
  }
  const remaining = commitmentRemaining(commitment, recognized).remaining;
  const unpaidInvoiced = recognized - unbilled - paid;
  return { unpaidRecognized: unpaidInvoiced, unbilledRecognized: unbilled, remainingCommitment: remaining, total: unpaidInvoiced + unbilled + remaining };
}

/** Company-wide category subtotal restricted to projects with detailed coverage for that category. */
export function categoryCoverage(state: DemoState, category: CostCode["category"]): { detailed: { projectId: string; costCodeId: string; incurred: Agorot }[]; aggregateOnlyProjectIds: string[]; subtotal: Agorot } {
  const detailed: { projectId: string; costCodeId: string; incurred: Agorot }[] = [];
  const aggregateOnly: string[] = [];
  for (const p of activeProjects(state)) {
    const codes = state.costCodes.filter((c) => c.projectId === p.id);
    const match = codes.find((c) => c.category === category && c.coverage === "detailed");
    if (match) detailed.push({ projectId: p.id, costCodeId: match.id, incurred: costLineView(state, match.id).incurred });
    else if (codes.some((c) => c.coverage === "aggregate")) aggregateOnly.push(p.id);
  }
  return { detailed, aggregateOnlyProjectIds: aggregateOnly, subtotal: sum(detailed.map((d) => d.incurred)) };
}

export function describeLine(line: CostLineView): string {
  return `${line.nameHe}: תקציב ${formatILS(line.budget)}, נצבר ${formatILS(line.incurred)}, התחייבויות ${formatILS(line.commitments)}, יתרה ${formatILS(line.uncommitted)}, תחזית ${formatILS(line.eac)}`;
}

export function describeQuantity(q: QuantityView | null): string {
  if (!q) return "";
  return `${q.purchasedVerified == null ? "טרם אומת" : formatNumber(q.purchasedVerified)} מתוך ${formatNumber(q.planned ?? 0)} ${q.unit}`;
}
