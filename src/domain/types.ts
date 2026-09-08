import type { Agorot } from "./money";

export type ISODate = string; // yyyy-mm-dd
export type ISODateTime = string; // yyyy-mm-ddTHH:MM:00+03:00
export type Role = "manager" | "reviewer";
export type ProjectId = string;
export type Channel = "whatsapp" | "email";

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export interface Company {
  id: string;
  nameHe: string;
  descriptionHe: string;
}

export interface Contact {
  id: string;
  nameHe: string;
  roleHe: string;
  email: string;
}

export interface Supplier {
  id: string;
  nameHe: string;
}

export type ProjectStatus = "active" | "draft";

export interface Project {
  id: ProjectId;
  nameHe: string;
  /** Short in-sentence form ("הדרים", "פארק"). */
  shortNameHe: string;
  status: ProjectStatus;
  cityHe: string;
  start?: ISODate;
  plannedFinish?: ISODate;
  plannedMonths?: number;
  /** Accepted forecast schedule, separate from the original plan (S14). */
  acceptedFinish?: ISODate;
  acceptedMonths?: number;
  aliases: string[];
}

export type CostCategory =
  | "steel"
  | "concrete"
  | "frame"
  | "equipment"
  | "waterproofing"
  | "finishing"
  | "site_overhead"
  | "general";

export type Coverage = "detailed" | "aggregate";

export interface CostCode {
  id: string;
  projectId: ProjectId;
  nameHe: string;
  category: CostCategory;
  budget: Agorot;
  plannedQuantity?: number;
  unit?: string;
  budgetUnitPrice?: Agorot;
  coverage: Coverage;
  /** Initialization checksum from the seed. Never used as a mutable ledger. */
  seedCheck: {
    incurred: Agorot;
    remainingCommitment: Agorot;
    remainingUncommitted: Agorot;
    paid: Agorot;
  };
  aliases: string[];
}

export interface BudgetLine {
  id: string;
  nameHe: string;
  quantity?: number;
  unit?: string;
  unitPrice?: Agorot;
  amount: Agorot;
}

export interface BudgetVersion {
  id: string;
  projectId: ProjectId;
  version: number;
  kind: "approved" | "draft";
  documentId: string;
  createdAt: ISODateTime;
  status: "current" | "superseded";
  lines: BudgetLine[];
  noteHe?: string;
}

// ---------------------------------------------------------------------------
// Source documents (immutable) and evidence
// ---------------------------------------------------------------------------

export type DocumentKind =
  | "budget"
  | "invoice"
  | "delivery_note"
  | "purchase_order"
  | "contract"
  | "plan"
  | "framework"
  | "quote"
  | "certificate"
  | "addendum"
  | "credit"
  | "change_order"
  | "schedule"
  | "opening_balance"
  | "forecast"
  | "commitment_balance"
  | "reply"
  | "approval";

export interface DocumentAnchor {
  id: string;
  labelHe?: string;
  text: string;
}

export interface MonthlyComponent {
  id: string;
  nameHe: string;
  amount: Agorot;
}

/** Pre-extracted structured reading of a document. Rules use these; the anchors show the text. */
export interface DocumentFacts {
  material?: CostCategory;
  spec?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: Agorot;
  amount?: Agorot;
  freightIncluded?: boolean;
  pumpingIncluded?: boolean;
  paymentTermsHe?: string;
  validUntil?: ISODate;
  purchaseOrderId?: string;
  contractId?: string;
  cumulativeApproved?: Agorot;
  priorCumulative?: Agorot;
  periodAmount?: Agorot;
  contractValue?: Agorot;
  frameworkProjectIds?: ProjectId[];
  allocationDetail?: boolean;
  deliveredQuantity?: number;
  plannedQuantity?: number;
  monthlyComponents?: MonthlyComponent[];
  componentIds?: string[];
  months?: number;
  siteStart?: ISODate;
  siteFinish?: ISODate;
  chargeType?: "freight" | "material" | "labor" | "rental" | "service";
  isAdditionalScope?: boolean;
  approved?: boolean;
  signed?: boolean;
  recoveryClaim?: Agorot;
  creditOfDocumentId?: string;
  matchesCertificateId?: string;
  destinationHe?: string;
  comparable?: boolean;
  incomparableReasonHe?: string;
  deliveryBasisHe?: string;
  descriptionDecisive?: boolean;
  supplierIdOverride?: string;
  /** Short task label used inside sentences ("תקרה A"). */
  taskHe?: string;
}

export interface SourceDocument {
  id: string;
  kind: DocumentKind;
  titleHe: string;
  date: ISODate;
  receivedAt: ISODateTime;
  supplierId: string | null;
  projectIds: ProjectId[];
  costCodeIds: string[];
  anchors: DocumentAnchor[];
  facts: DocumentFacts;
  version: number;
  /** Application annotation shown outside the immutable source body. */
  annotationHe?: string;
  scenarioOnly?: boolean;
  supersedesId?: string;
  generated?: boolean;
  bidderHe?: string;
}

export interface EvidenceRef {
  documentId: string;
  anchorId?: string;
  version?: number;
  labelHe?: string;
}

// ---------------------------------------------------------------------------
// Simulated ERP records (observed posted values) and their allocations
// ---------------------------------------------------------------------------

export type RecordKind =
  | "invoice"
  | "opening_balance"
  | "certificate"
  | "accrual"
  | "accrual_reversal"
  | "credit"
  | "adjustment";

/** verified = checked, no open issue; pending = analysis not finished; clarifying = checked, waiting for client context; flagged = confirmed posted-data problem. */
export type CheckStatus = "verified" | "pending" | "clarifying" | "flagged";

export interface Allocation {
  id: string;
  projectId: ProjectId;
  costCodeId: string;
  amount: Agorot;
  /** Forecast work item this cost fulfills (consumes), if any. */
  workItemId: string | null;
  /** Commitment this cost is recognized against, if any. */
  commitmentId: string | null;
  additionalScope?: boolean;
}

export interface ErpRecord {
  id: string;
  kind: RecordKind;
  projectId: ProjectId;
  supplierId: string | null;
  sourceDocumentId: string | null;
  relatedDocumentIds: string[];
  descriptionHe: string;
  date: ISODate;
  receivedAt: ISODateTime;
  quantity: number | null;
  unit: string | null;
  unitPrice: Agorot | null;
  amount: Agorot;
  allocations: Allocation[];
  /** Cumulative cash paid against this record (linked payment record, not invoice text). */
  paid: Agorot;
  version: number;
  checkStatus: CheckStatus;
  chargeType?: "freight" | "material" | "labor" | "rental" | "service";
  cumulativeApproved?: Agorot;
  priorCumulative?: Agorot;
  priorRecordId?: string | null;
  certificateId?: string;
  accrualOfCertificateId?: string;
  reversesRecordId?: string;
  creditOfRecordId?: string;
  historicalSummary?: boolean;
  sourceMissing?: boolean;
  erpDescriptionVague?: boolean;
  /** For records whose quantity was reconciled against sources. */
  verifiedQuantity?: number | null;
}

// ---------------------------------------------------------------------------
// Commitments and forecast work items
// ---------------------------------------------------------------------------

export type CommitmentKind = "contract" | "purchase_order" | "remaining_balance" | "change_order";

export interface CommitmentVersion {
  version: number;
  value: Agorot;
  documentId: string | null;
  at: ISODateTime;
  reasonHe: string;
}

export interface Commitment {
  id: string;
  projectId: ProjectId;
  costCodeId: string;
  supplierId: string | null;
  kind: CommitmentKind;
  titleHe: string;
  /** Approved gross value (contract total, PO total, or a remaining balance when kind = remaining_balance). */
  value: Agorot;
  documentId: string | null;
  status: "active" | "fulfilled" | "superseded" | "conditional";
  createdAt: ISODateTime;
  versions: CommitmentVersion[];
  quantity?: number;
  unit?: string;
  unitPrice?: Agorot;
}

export type WorkItemStatus = "uncommitted" | "committed" | "fulfilled" | "historical";

export interface WorkItem {
  id: string;
  projectId: ProjectId;
  costCodeId: string;
  titleHe: string;
  status: WorkItemStatus;
  commitmentId: string | null;
  quantity?: number;
  unit?: string;
  sourceDocumentId: string | null;
  group?: string;
  /** Billing period (yyyy-mm) for recurring monthly charges this item represents. */
  period?: string;
  createdAt: ISODateTime;
}

export interface ForecastVersion {
  id: string;
  workItemId: string;
  version: number;
  amount: Agorot;
  quantity?: number;
  unitPrice?: Agorot;
  basisHe: string;
  evidence: EvidenceRef[];
  status: "accepted" | "superseded" | "needs_revalidation";
  acceptedBy: string;
  acceptedAt: ISODateTime;
  validUntil?: ISODate;
}

// ---------------------------------------------------------------------------
// Findings, proposals, questions, alerts, conversations
// ---------------------------------------------------------------------------

export type FindingKind =
  | "classification"
  | "quantity_mismatch"
  | "partial_delivery"
  | "missing_allocation"
  | "price_risk"
  | "commitment_overrun"
  | "cumulative_duplicate"
  | "unbilled_work"
  | "invoice_match"
  | "quantity_variance"
  | "amount_correction"
  | "contract_charge"
  | "scope_change"
  | "duration_impact"
  | "rule_reuse"
  | "cross_project_opportunity"
  | "budget_assumption"
  | "missing_link"
  | "delivery_issue"
  | "commitment_conditional"
  | "site_clarification";

export type FindingStatus =
  | "pending_review"
  | "needs_clarification"
  | "conditional"
  | "proposal_created"
  | "question_sent"
  | "resolved"
  | "dismissed"
  | "superseded";

export type Severity = "info" | "risk" | "urgent" | "opportunity";

export interface Finding {
  id: string;
  kind: FindingKind;
  projectId: ProjectId;
  costCodeId: string | null;
  recordIds: string[];
  documentIds: string[];
  titleHe: string;
  explanationHe: string;
  status: FindingStatus;
  severity: Severity;
  /** "מה כבר נבדק" — steps the deterministic analysis actually performed. */
  checkedHe: string[];
  evidence: EvidenceRef[];
  proposalIds: string[];
  questionIds: string[];
  alertIds: string[];
  taskIds: string[];
  resolutionHe?: string;
  amounts: Record<string, Agorot>;
  numbers: Record<string, number>;
  /** Confirmed posted-data error affecting reported values: blocks final report delivery until applied. */
  blocksReport: boolean;
  createdAt: ISODateTime;
  createdAtRevision: number;
  sessionId: string;
  dedupeKey: string;
  supersededById?: string;
}

export type ProposalKind =
  | "erp_correction"
  | "allocation"
  | "accrual"
  | "invoice_match"
  | "credit"
  | "commitment"
  | "forecast"
  | "draft_budget"
  | "duration"
  | "rule"
  | "dismiss_flag";

export type ProposalStatus =
  | "needs_clarification"
  | "pending_review"
  | "approved"
  | "applied"
  | "apply_failed"
  | "rejected"
  | "superseded";

export interface ProposalRow {
  labelHe: string;
  value: string;
}

export interface ForecastItemChange {
  workItemId: string;
  amount: Agorot;
  quantity?: number;
  unitPrice?: Agorot;
  basisHe: string;
  evidence: EvidenceRef[];
  validUntil?: ISODate;
  titleHe?: string;
}

export type ProposalPayload =
  | {
      kind: "erp_correction";
      recordId: string;
      changes: {
        costCodeId?: string;
        quantity?: number | null;
        unitPrice?: Agorot | null;
        amount?: Agorot;
        verifiedQuantity?: number | null;
        priorRecordId?: string;
        sourceDocumentId?: string;
        cumulativeApproved?: Agorot;
        priorCumulative?: Agorot;
      };
    }
  | {
      kind: "allocation";
      recordId: string;
      allocations: { projectId: ProjectId; costCodeId: string; amount: Agorot; workItemId: string | null; commitmentId: string | null }[];
      ruleId?: string;
    }
  | {
      kind: "accrual";
      projectId: ProjectId;
      costCodeId: string;
      commitmentId: string;
      certificateDocumentId: string;
      amount: Agorot;
      supplierId: string | null;
    }
  | {
      kind: "invoice_match";
      accrualRecordId: string;
      invoiceDocumentId: string;
      amount: Agorot;
      commitmentId: string;
      projectId: ProjectId;
      costCodeId: string;
      supplierId: string | null;
    }
  | {
      kind: "credit";
      originalRecordId: string;
      creditDocumentId: string;
      amount: Agorot;
    }
  | {
      kind: "commitment";
      projectId: ProjectId;
      costCodeId: string;
      /** update an existing commitment's value */
      commitmentId?: string;
      newValue?: Agorot;
      /** or create a new commitment */
      create?: {
        id: string;
        supplierId: string | null;
        kind: CommitmentKind;
        titleHe: string;
        value: Agorot;
        documentId: string | null;
        quantity?: number;
        unit?: string;
        unitPrice?: Agorot;
      };
      workItem: { id: string; titleHe: string; quantity?: number; unit?: string; forecastAmount: Agorot; basisHe: string; evidence: EvidenceRef[] };
      /** work items consumed by this commitment (uncommitted -> committed) */
      consumeWorkItemIds?: string[];
      /** split: reduce this uncommitted item to the given quantity/amount */
      reduceWorkItem?: { workItemId: string; quantity: number; unitPrice: Agorot; amount: Agorot };
      recovery?: { id: string; amount: Agorot; documentId: string; titleHe: string };
      conditional?: boolean;
    }
  | {
      kind: "forecast";
      projectId: ProjectId;
      costCodeId: string;
      items: ForecastItemChange[];
      newWorkItems?: { id: string; titleHe: string; quantity?: number; unit?: string; amount: Agorot; basisHe: string; evidence: EvidenceRef[]; group?: string }[];
      recovery?: { id: string; amount: Agorot; documentId: string; titleHe: string };
    }
  | {
      kind: "draft_budget";
      projectId: ProjectId;
      lineId: string;
      unitPrice: Agorot;
      quantity: number;
      noteHe: string;
    }
  | {
      kind: "duration";
      projectId: ProjectId;
      months: number;
      finish: ISODate;
      componentIds: string[];
      extraMonths: number;
      extraAmount: Agorot;
      workItemId: string;
      costCodeId: string;
      documentId: string | null;
    }
  | {
      kind: "rule";
      rule: ApprovedRule;
    }
  | {
      kind: "dismiss_flag";
      findingId: string;
      recordId: string | null;
    };

export interface ChangeProposal {
  id: string;
  kind: ProposalKind;
  findingId: string | null;
  projectId: ProjectId;
  costCodeId: string | null;
  targetIds: string[];
  titleHe: string;
  reasonHe: string;
  before: ProposalRow[];
  after: ProposalRow[];
  payload: ProposalPayload;
  evidence: EvidenceRef[];
  status: ProposalStatus;
  createdAt: ISODateTime;
  createdAtRevision: number;
  reviewedBy?: string;
  reviewedAt?: ISODateTime;
  appliedAt?: ISODateTime;
  rejectionReasonHe?: string;
  failure?: { at: ISODateTime; messageHe: string; attempts: number };
  appliedAuditId?: string;
  /** Versions of targets when the proposal was computed. Stale -> recalc and re-review. */
  targetVersions: Record<string, number>;
  sessionId: string;
  sourceReplyMessageId?: string;
  ruleId?: string;
  /** manual code override explanation (S03 branch) */
  manualNoteHe?: string;
  labelHe: string;
}

export type ReplyEffect =
  | { type: "allocation"; split: Record<ProjectId, Agorot> }
  | { type: "future_price"; unitPrice: Agorot | null; keepBaseline?: boolean }
  | { type: "open" }
  | { type: "quantity_reason"; reason: "consumed" | "returned" | "design_change" | "investigating" }
  | { type: "duration"; confirm: boolean; months?: number; componentIds?: string[]; milestoneOnly?: boolean }
  | { type: "delivery"; outcome: "more_coming" | "clarify" }
  | { type: "draft_price"; unitPrice: Agorot | null; hasContract?: boolean }
  | { type: "cost_code"; costCodeId: string }
  | { type: "custom" };

export interface SuggestedReply {
  id: string;
  textHe: string;
  effect: ReplyEffect;
}

export type QuestionParser = "allocation" | "future_price" | "quantity_reason" | "duration" | "delivery" | "draft_price" | "free";

export type QuestionStatus = "draft" | "pending_review" | "ready" | "sent" | "answered" | "open" | "resolved" | "superseded";

export interface ParsedReply {
  ok: boolean;
  messageHe: string;
  effect: ReplyEffect | null;
}

export interface ClientQuestion {
  id: string;
  findingId: string;
  projectId: ProjectId;
  contactId: string;
  textHe: string;
  suggestedReplies: SuggestedReply[];
  parser: QuestionParser;
  status: QuestionStatus;
  conversationId?: string;
  sentMessageId?: string;
  replyMessageId?: string;
  parsedReply?: ParsedReply;
  checkedHe: string[];
  createdAt: ISODateTime;
  amount?: Agorot;
  recordId?: string;
  reviewedBy?: string;
  resolutionHe?: string;
  proposalId?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  kind: "xlsx";
  reportId: string;
}

export interface Message {
  id: string;
  direction: "outbound" | "inbound";
  kind: "question" | "reply" | "alert" | "report" | "update" | "note";
  textHe: string;
  at: ISODateTime;
  attachments: Attachment[];
  questionId?: string;
  alertId?: string;
  reportId?: string;
  deliveryId?: string;
  authorId: string;
  actions?: { labelHe: string; action: "open_calculation" | "open_question" | "open_report"; targetId: string }[];
}

export interface Conversation {
  id: string;
  channel: Channel;
  purpose: "clarification" | "alert" | "report";
  contactId: string;
  titleHe: string;
  messages: Message[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  projectId: ProjectId | null;
}

export type AlertStatus = "draft" | "pending_review" | "delivered" | "acknowledged" | "resolved" | "superseded";

export interface Alert {
  id: string;
  findingId: string;
  kind: "early_alert" | "opportunity" | "update";
  projectId: ProjectId;
  titleHe: string;
  textHe: string;
  status: AlertStatus;
  recipientId: string;
  channel: Channel;
  createdAt: ISODateTime;
  reviewedBy?: string;
  deliveredAt?: ISODateTime;
  conversationId?: string;
  messageId?: string;
  amounts: Record<string, Agorot>;
  linkedQuestionId?: string;
  calculationFindingId: string;
}

// ---------------------------------------------------------------------------
// Approved knowledge, audit, tasks, recovery
// ---------------------------------------------------------------------------

export interface RuleApplication {
  id: string;
  kind: "origin" | "reuse";
  recordId: string;
  proposalId: string;
  at: ISODateTime;
  noteHe: string;
}

export interface ApprovedRule {
  id: string;
  version: number;
  companyId: string;
  titleHe: string;
  supplierId: string | null;
  frameworkDocumentId: string | null;
  scope: { projectId: ProjectId; costCodeId: string }[];
  descriptionHe: string;
  ratio: { projectId: ProjectId; numerator: number; denominator: number }[];
  validFrom: ISODate;
  validTo: ISODate;
  sourceEvidence: EvidenceRef[];
  originQuestionId?: string;
  originProposalId?: string;
  originReplyMessageId?: string;
  approvedBy: string;
  approvedAt: ISODateTime;
  status: "active" | "expired" | "superseded";
  conditionsHe: string[];
  applications: RuleApplication[];
}

export interface AuditEvent {
  id: string;
  at: ISODateTime;
  actorId: string;
  actorNameHe: string;
  actorRoleHe: string;
  kind: string;
  textHe: string;
  entityIds: string[];
  before?: ProposalRow[];
  after?: ProposalRow[];
  evidence: EvidenceRef[];
  proposalId?: string;
  projectId?: ProjectId;
  costCodeId?: string;
  reportRelevant: boolean;
}

export interface RecoveryRecord {
  id: string;
  projectId: ProjectId;
  costCodeId: string;
  documentId: string;
  amount: Agorot;
  status: "pending_customer_approval" | "approved" | "rejected";
  titleHe: string;
  createdAt: ISODateTime;
}

export interface Task {
  id: string;
  kind: "credit_request" | "supplier_clarification" | "delivery_followup";
  projectId: ProjectId;
  recordId: string | null;
  findingId: string;
  titleHe: string;
  descriptionHe: string;
  status: "open" | "done" | "cancelled";
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Reports and financial views (serializable so snapshots can freeze them)
// ---------------------------------------------------------------------------

export type ReportLayout = "management_summary" | "cost_code_detail";

export interface ReportPreferences {
  format: "xlsx";
  layout: ReportLayout;
  channel: Channel;
  recipientId: string;
  frequency: "weekly";
  weekday: number; // 1 = Monday
  hour: number;
  projectIds: ProjectId[];
  showPaid: boolean;
  showQuantities: boolean;
}

export interface LineRecordView {
  recordId: string;
  kind: RecordKind;
  descriptionHe: string;
  date: ISODate;
  amount: Agorot;
  paid: Agorot;
  sourceDocumentId: string | null;
  supplierId: string | null;
  checkStatus: CheckStatus;
  quantity: number | null;
  unit: string | null;
  unitPrice: Agorot | null;
  workItemId: string | null;
  commitmentId: string | null;
  historicalSummary: boolean;
}

export interface LineCommitmentView {
  commitmentId: string;
  titleHe: string;
  kind: CommitmentKind;
  value: Agorot;
  recognized: Agorot;
  remaining: Agorot;
  documentId: string | null;
  status: Commitment["status"];
  overrun: Agorot;
  supplierId: string | null;
}

export interface LineWorkItemView {
  workItemId: string;
  titleHe: string;
  status: WorkItemStatus;
  amount: Agorot;
  quantity?: number;
  unit?: string;
  unitPrice?: Agorot;
  basisHe: string;
  sourceDocumentId: string | null;
  forecastVersionId: string | null;
  evidence: EvidenceRef[];
  needsRevalidation: boolean;
}

export interface QuantityView {
  unit: string;
  planned: number | null;
  purchasedVerified: number | null;
  purchasedRaw: number | null;
  delivered: number | null;
  outstandingDelivery: number | null;
  remainingToProcure: number | null;
  committedQuantity: number | null;
}

export interface CostLineView {
  costCodeId: string;
  projectId: ProjectId;
  nameHe: string;
  category: CostCategory;
  coverage: Coverage;
  budget: Agorot;
  incurredInvoiced: Agorot;
  incurredAccrued: Agorot;
  incurred: Agorot;
  commitments: Agorot;
  uncommitted: Agorot;
  eac: Agorot;
  variance: Agorot;
  paid: Agorot;
  provisional: boolean;
  commitmentOverrun: Agorot;
  records: LineRecordView[];
  commitmentViews: LineCommitmentView[];
  workItems: LineWorkItemView[];
  quantities: QuantityView | null;
  needsRevalidation: boolean;
}

export interface ProjectTotals {
  budget: Agorot;
  incurredInvoiced: Agorot;
  incurredAccrued: Agorot;
  incurred: Agorot;
  commitments: Agorot;
  uncommitted: Agorot;
  eac: Agorot;
  variance: Agorot;
  paid: Agorot;
  provisional: boolean;
}

export interface FrozenNote {
  id: string;
  kind: "open_question" | "conditional_risk" | "opportunity" | "open_issue" | "assumption";
  titleHe: string;
  textHe: string;
  amount?: Agorot;
  costCodeId?: string | null;
}

export interface FrozenReport {
  projectNameHe: string;
  lines: CostLineView[];
  totals: ProjectTotals;
  notes: FrozenNote[];
  availableDocumentIds: string[];
  recordIds: string[];
  acceptedFinish: ISODate | null;
  plannedFinish: ISODate | null;
  evidenceVersions: EvidenceRef[];
  /** Portfolio totals at the time of the report (for context only). */
  portfolio: ProjectTotals;
  qualificationsHe: string[];
}

export type ReportStatus = "draft" | "pending_review" | "approved" | "delivered" | "superseded" | "blocked";

export interface ReportSnapshot {
  id: string;
  projectId: ProjectId;
  reportDate: ISODate;
  version: number;
  generatedAt: ISODateTime;
  dataThrough: ISODateTime;
  sourceRevision: number;
  status: ReportStatus;
  layout: ReportLayout;
  channel: Channel;
  recipientId: string;
  reviewedBy?: string;
  reviewedAt?: ISODateTime;
  deliveredAt?: ISODateTime;
  previousReportId: string | null;
  frozen: FrozenReport;
  attachmentName: string;
  scheduledPeriod: string | null;
  blockingIssueIds: string[];
  showPaid: boolean;
  showQuantities: boolean;
  deliveryIds: string[];
  seededHistory?: boolean;
}

export interface SimulatedDelivery {
  id: string;
  kind: "report" | "alert" | "question" | "update";
  reportId?: string;
  alertId?: string;
  questionIds?: string[];
  channel: Channel;
  recipientId: string;
  at: ISODateTime;
  conversationId: string;
  messageId: string;
  idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatScope {
  projectId: ProjectId | null;
  reportId: string | null;
  costCodeId: string | null;
  portfolio: boolean;
}

export interface ChatAnswer {
  headlineHe: string;
  breakdownHe: string[];
  evidence: EvidenceRef[];
  actions: { labelHe: string; route: string }[];
  scopeLabelHe: string;
  needsProjectChoice?: boolean;
  qualificationHe?: string;
  calculationRows?: ProposalRow[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  textHe: string;
  at: ISODateTime;
  answer?: ChatAnswer;
  scope?: ChatScope;
}

export interface ChatState {
  messages: ChatMessage[];
  scope: ChatScope;
  lastContext: { projectId: ProjectId | null; costCodeId: string | null };
}

// ---------------------------------------------------------------------------
// Activity, scheduling, scenarios, experiments
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: string;
  at: ISODateTime;
  textHe: string;
  kind: "received" | "analyzed" | "proposal" | "applied" | "question" | "reply" | "alert" | "report" | "rule" | "clock" | "scenario" | "forecast" | "failure";
  entityIds: string[];
}

export interface PendingAnalysis {
  id: string;
  recordId: string;
  recordVersion: number;
  sessionId: string;
  scheduledAt: ISODateTime;
  documentId?: string;
}

export interface ScenarioProgress {
  scenarioId: string;
  receivedEventIds: string[];
  stepIndex: number;
  guidanceHidden: boolean;
  startedAt: ISODateTime;
  tourStepIndex: number | null;
  seededHistoryHe: string[];
}

export interface SteelExperiment {
  plannedQuantity: number;
  purchasedQuantity: number;
  purchaseUnitPrice: Agorot;
  candidateFuturePrice: Agorot;
  rawErpQuantity: number;
  version: number;
}

export interface DemoFlags {
  failNextErpWrite: boolean;
  skipMotion: boolean;
}

export interface DemoState {
  seedVersion: string;
  sessionId: string;
  clock: ISODateTime;
  revision: number;
  role: Role;
  activeProjectId: ProjectId;
  activeScenarioId: string | null;
  scenario: ScenarioProgress | null;
  company: Company;
  contacts: Contact[];
  suppliers: Supplier[];
  projects: Project[];
  costCodes: CostCode[];
  budgetVersions: BudgetVersion[];
  documents: SourceDocument[];
  erpRecords: ErpRecord[];
  commitments: Commitment[];
  workItems: WorkItem[];
  forecasts: ForecastVersion[];
  findings: Finding[];
  proposals: ChangeProposal[];
  questions: ClientQuestion[];
  conversations: Conversation[];
  alerts: Alert[];
  approvedRules: ApprovedRule[];
  auditEvents: AuditEvent[];
  reports: ReportSnapshot[];
  reportPreferences: ReportPreferences;
  deliveries: SimulatedDelivery[];
  recoveries: RecoveryRecord[];
  tasks: Task[];
  pendingAnalyses: PendingAnalysis[];
  chat: ChatState;
  counters: Record<string, number>;
  flags: DemoFlags;
  activity: ActivityEvent[];
  lastReceivedAt: ISODateTime | null;
  steelExperiment: SteelExperiment;
  processedCertificateIds: string[];
  /** Records a document was linked to when introduced by a scenario event, for isolation checks. */
  introducedDocumentIds: string[];
  reportCutoffForPrior: ISODateTime;
  lastAnalysisAt: ISODateTime | null;
}
