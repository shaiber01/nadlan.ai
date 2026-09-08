import { Badge } from "./primitives";
import type { AlertStatus, CheckStatus, FindingStatus, ProposalStatus, QuestionStatus, ReportStatus, Severity } from "../domain/types";

type Tone = "neutral" | "primary" | "amber" | "red" | "green" | "navy";

const proposal: Record<ProposalStatus, [string, Tone]> = {
  needs_clarification: ["נדרש בירור", "amber"],
  pending_review: ["ממתין לבדיקת צוות הבקרה", "amber"],
  approved: ["אושר וממתין לעדכון", "primary"],
  applied: ["עודכן בזיו — סביבת הדגמה", "green"],
  apply_failed: ["העדכון לא הושלם", "red"],
  rejected: ["ההצעה נדחתה", "neutral"],
  superseded: ["הוחלף", "neutral"],
};

const finding: Record<FindingStatus, [string, Tone]> = {
  pending_review: ["ממתין לבדיקת צוות הבקרה", "amber"],
  needs_clarification: ["נדרש בירור", "amber"],
  conditional: ["סיכון מותנה", "amber"],
  proposal_created: ["נוצרה הצעה", "primary"],
  question_sent: ["ממתין לתשובת הלקוח", "primary"],
  resolved: ["טופל", "green"],
  dismissed: ["נסגר עם הסבר", "neutral"],
  superseded: ["הוחלף", "neutral"],
};

const question: Record<QuestionStatus, [string, Tone]> = {
  draft: ["טיוטה", "neutral"],
  pending_review: ["ממתין לבדיקת צוות הבקרה", "amber"],
  ready: ["מוכן לשליחה", "primary"],
  sent: ["ממתין לתשובת הלקוח", "primary"],
  answered: ["התקבלה תשובה", "green"],
  open: ["פתוח — ממתין לפירוט", "amber"],
  resolved: ["טופל", "green"],
  superseded: ["הוחלף", "neutral"],
};

const alert: Record<AlertStatus, [string, Tone]> = {
  draft: ["טיוטה", "neutral"],
  pending_review: ["ממתין לבדיקת צוות הבקרה", "amber"],
  delivered: ["נמסר", "green"],
  acknowledged: ["נקרא", "green"],
  resolved: ["טופל", "green"],
  superseded: ["הוחלף", "neutral"],
};

const report: Record<ReportStatus, [string, Tone]> = {
  draft: ["טיוטה", "neutral"],
  pending_review: ["ממתין לבדיקת צוות הבקרה", "amber"],
  approved: ["אושר למסירה", "primary"],
  delivered: ["נמסר", "green"],
  superseded: ["הוחלף", "neutral"],
  blocked: ["חסום עד לתיקון", "red"],
};

const check: Record<CheckStatus, [string, Tone]> = {
  verified: ["נבדק", "green"],
  pending: ["טרם הושלמה הבדיקה", "amber"],
  clarifying: ["נדרש בירור", "amber"],
  flagged: ["דורש טיפול", "red"],
};

const severity: Record<Severity, [string, Tone]> = {
  info: ["מידע", "neutral"],
  risk: ["סיכון", "amber"],
  urgent: ["דחוף", "red"],
  opportunity: ["הזדמנות לבדיקה", "green"],
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const [text, tone] = proposal[status];
  return <Badge tone={tone} dot>{text}</Badge>;
}
export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const [text, tone] = finding[status];
  return <Badge tone={tone} dot>{text}</Badge>;
}
export function QuestionStatusBadge({ status }: { status: QuestionStatus }) {
  const [text, tone] = question[status];
  return <Badge tone={tone} dot>{text}</Badge>;
}
export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const [text, tone] = alert[status];
  return <Badge tone={tone} dot>{text}</Badge>;
}
export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const [text, tone] = report[status];
  return <Badge tone={tone} dot>{text}</Badge>;
}
export function CheckStatusBadge({ status }: { status: CheckStatus }) {
  const [text, tone] = check[status];
  return <Badge tone={tone} dot>{text}</Badge>;
}
export function SeverityBadge({ severity: s }: { severity: Severity }) {
  const [text, tone] = severity[s];
  return <Badge tone={tone}>{text}</Badge>;
}

export const statusText = { proposal, finding, question, alert, report, check };
