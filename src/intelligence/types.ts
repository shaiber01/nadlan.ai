import type { Agorot } from "../domain/money";
import type {
  Channel,
  ChatAnswer,
  ChatScope,
  CheckStatus,
  ClientQuestion,
  DemoState,
  EvidenceRef,
  FindingKind,
  FindingStatus,
  ParsedReply,
  ProposalKind,
  ProposalPayload,
  ProposalRow,
  QuestionParser,
  Severity,
  SuggestedReply,
  Task,
} from "../domain/types";

/**
 * Boundary for the (optional, future) AI provider. The deterministic adapter implemented in this demo
 * returns structured proposals, evidence and Hebrew text. Domain commands validate and apply them;
 * an adapter never owns ledger math or write authorization.
 */
export interface ProposalDraft {
  kind: ProposalKind;
  labelHe: string;
  titleHe: string;
  reasonHe: string;
  before: ProposalRow[];
  after: ProposalRow[];
  payload: ProposalPayload;
  evidence: EvidenceRef[];
  status?: "pending_review" | "needs_clarification";
  targetIds: string[];
  ruleId?: string;
  costCodeId?: string | null;
}

export interface QuestionDraft {
  contactId: string;
  textHe: string;
  suggestedReplies: SuggestedReply[];
  parser: QuestionParser;
  checkedHe: string[];
  amount?: Agorot;
  recordId?: string;
}

export interface AlertDraft {
  kind: "early_alert" | "opportunity" | "update";
  titleHe: string;
  textHe: string;
  recipientId: string;
  channel: Channel;
  amounts: Record<string, Agorot>;
  linkQuestion: boolean;
}

export interface TaskDraft {
  kind: Task["kind"];
  titleHe: string;
  descriptionHe: string;
  recordId: string | null;
}

export interface FindingDraft {
  dedupeKey: string;
  kind: FindingKind;
  projectId: string;
  costCodeId: string | null;
  recordIds: string[];
  documentIds: string[];
  titleHe: string;
  explanationHe: string;
  severity: Severity;
  status: FindingStatus;
  checkedHe: string[];
  evidence: EvidenceRef[];
  amounts: Record<string, Agorot>;
  numbers: Record<string, number>;
  blocksReport: boolean;
  proposals: ProposalDraft[];
  questions: QuestionDraft[];
  alerts: AlertDraft[];
  tasks: TaskDraft[];
  supersedesKeys?: string[];
}

export interface AnalysisResult {
  subjectId: string;
  stepsHe: string[];
  findings: FindingDraft[];
  recordCheckStatus?: CheckStatus;
}

export interface QueryContext {
  state: DemoState;
}

export interface IntelligenceAdapter {
  analyzeRecord(recordId: string, context: Readonly<{ state: DemoState }>): AnalysisResult;
  analyzeDocument(documentId: string, context: Readonly<{ state: DemoState }>): AnalysisResult;
  answerQuestion(text: string, scope: ChatScope, context: Readonly<QueryContext>): ChatAnswer;
  interpretClarification(question: ClientQuestion, reply: string, context: Readonly<{ state: DemoState }>): ParsedReply;
}
