import type { ContactChannel, HChangeLogEntry, HInvoice, HOpenIssue, HPurchaseOrder, PersonId, SectionId } from "../data/types";
import type { HFinding, HPositive } from "./checks";

/**
 * Control-session model for the Hadarim v2 demo. One control (1.9.2026) is prepared live:
 * findings are decided one by one, decisions produce either ERP corrections (no forecast effect)
 * or forecast adjustments (typed per the report standard §4a), and the report is built from all of it.
 */

export type DecisionStatus = "open" | "handled" | "pending_execution" | "referred" | "forecast_only";
export type RouteId = "update" | "refer_accounting" | "forecast_only" | "refer_roi";

export interface FindingDecision {
  findingId: string;
  status: DecisionStatus;
  choiceId?: string;
  freeTextHe?: string;
  routeId?: RouteId;
  ownerId?: PersonId;
  auditHe?: string;
  verifiedHe?: string;
  resolvedAt?: string;
  /** Interim state for multi-step decisions (e.g. quote found, awaiting confirmation). */
  pending?: { kind: "quote"; documentId: string; amount: number; validUntil: string; descriptionHe: string } | { kind: "route" };
}

/** Closed list of forecast change types from the standard, section 4a. */
export type ChangeType = "price" | "quantity" | "scope" | "coverage_gap" | "basis" | "indexation" | "schedule" | "claim" | "contingency";

export const CHANGE_TYPE_HE: Record<ChangeType, string> = {
  price: "שינוי מחיר",
  quantity: "שינוי כמות",
  scope: "שינוי היקף",
  coverage_gap: "פער כיסוי חוזי",
  basis: "שינוי בסיס",
  indexation: "הצמדה",
  schedule: "לו״ז",
  claim: "תביעה/דרישה של קבלן",
  contingency: "שימוש בבלתי צפוי",
};

export interface ForecastAdjustment {
  id: string;
  sectionId: SectionId;
  changeType: ChangeType;
  descriptionHe: string;
  basisHe: string;
  basis: "contract" | "po" | "quote" | "appendix" | "estimate";
  sourceRef: string;
  documentId?: string;
  amount: number;
  findingId?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  /** Replaces an existing draft forecast line (by id) or adds a new uncovered line. */
  replacesLineId?: string;
  /** The part of a replaced remainder that approved orders already cover (becomes a commitment line). */
  committedPortion?: { poId: number; poIds?: number[]; qty: number; amount: number };
}

export interface DataCorrection {
  id: string;
  recordType: "invoice" | "po";
  recordId: string;
  fieldHe: string;
  beforeHe: string;
  afterHe: string;
  approvedById: PersonId;
  crossSectionHe: string;
  /** Absent for an instructed correction made outside a control finding. */
  findingId?: string;
  at: string;
  status: "applied" | "pending_execution";
}

export interface ControlTask extends Omit<HOpenIssue, "status"> {
  status: "open" | "closed" | "pending_execution";
  findingId?: string;
}

export interface ReportConfig {
  includeTrends: boolean;
  splitByBuilding: boolean;
  /** Secondary view by the chapters of the Interministerial Specification (sections by their primary chapter). */
  byChapter?: boolean;
  ceoVersion: boolean;
  execSummaryMaxLines: number;
  savedAs: string | null;
}

export interface ChatOption {
  id: string;
  labelHe: string;
  action: { type: "decide"; findingId: string; choiceId: string } | { type: "route"; findingId: string; routeId: RouteId } | { type: "confirm_quote"; findingId: string; accept: boolean } | { type: "review_findings" } | { type: "open_report" } | { type: "save_config"; save: boolean } | { type: "open_document"; documentId: string } | { type: "open_record"; recordType: "invoice" | "po" | "contract"; recordId: string } | { type: "export"; format: "pdf" | "docx" } | { type: "send"; toId: PersonId };
}

export interface ChatMessage {
  id: string;
  role: "user" | "system";
  kind: "text" | "steps" | "finding" | "report" | "log";
  textHe: string;
  at: string;
  steps?: { textHe: string; done: boolean; spinner?: boolean }[];
  findingId?: string;
  options?: ChatOption[];
  documentId?: string;
}

/** A note the controller adds to the control — feeds the report's risks, events, decisions, assumptions, change orders and claims. */
export interface ControlNote {
  id: string;
  kind: "risk" | "event" | "decision" | "assumption" | "note" | "change_order" | "claim" | "review_pass";
  textHe: string;
  sectionId?: SectionId;
  exposureHe?: string;
  likelihoodHe?: string;
  triggerHe?: string;
  ownerId?: PersonId;
  at: string;
  byId: PersonId;
}

/**
 * A question the controller put to a person who has knowledge the operator lacks. The full system sends it
 * over the person's channel (WhatsApp, email, phone) and records the reply; in this prototype the reply is
 * given in the Claude session on that person's behalf.
 */
export interface ControlQuestion {
  id: string;
  toId: PersonId;
  channel: ContactChannel;
  textHe: string;
  findingId?: string;
  askedAt: string;
  askedById: PersonId;
  status: "open" | "answered";
  answerHe?: string;
  answeredAt?: string;
  answeredById?: PersonId;
}

export interface ControlSession {
  controlDate: string;
  notes: ControlNote[];
  questions: ControlQuestion[];
  status: "idle" | "running" | "reviewing" | "report";
  requestedAt: string | null;
  findings: HFinding[];
  positives: HPositive[];
  checkedHe: string[];
  decisions: Record<string, FindingDecision>;
  adjustments: ForecastAdjustment[];
  corrections: DataCorrection[];
  tasks: ControlTask[];
  messages: ChatMessage[];
  reportConfig: ReportConfig;
  finalized: boolean;
  stepsRevealed: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  byId: PersonId;
  textHe: string;
  recordRef?: { type: "invoice" | "po" | "forecast"; id: string };
}

export interface ErpState {
  invoices: HInvoice[];
  purchaseOrders: HPurchaseOrder[];
  changeLog: HChangeLogEntry[];
}

export type Scene1Variant = "A" | "B";

export interface V2State {
  version: 1;
  /** Scene-1 variant the seed was prepared for: A = invoice 1147 exists and is re-allocated live; B = it is keyed in live. */
  variant: Scene1Variant;
  clock: string; // yyyy-mm-ddTHH:MM (demo day, advances a few minutes per action)
  operatorId: PersonId;
  erp: ErpState;
  control: ControlSession;
  savedConfig: ReportConfig | null;
  audit: AuditEntry[];
  counters: Record<string, number>;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = { includeTrends: false, splitByBuilding: false, byChapter: false, ceoVersion: false, execSummaryMaxLines: 5, savedAs: null };

export function emptySession(controlDate: string): ControlSession {
  return { controlDate, notes: [], questions: [], status: "idle", requestedAt: null, findings: [], positives: [], checkedHe: [], decisions: {}, adjustments: [], corrections: [], tasks: [], messages: [], reportConfig: { ...DEFAULT_REPORT_CONFIG }, finalized: false, stepsRevealed: 0 };
}
