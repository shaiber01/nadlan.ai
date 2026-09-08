import { interpretClarification } from "../../intelligence/deterministic/clarification";
import { makeScenarioDocument } from "../../data/documents";
import { finishDateForDuration, formatDate } from "../dates";
import { formatILS, formatNumber, multiplyQuantity } from "../money";
import { costLineView, currentForecast } from "../selectors/financial";
import { addActivity, addAudit, bump, byId, contactName, nextId, projectName, replaceById, tick } from "../state-utils";
import type { ChangeProposal, Channel, ClientQuestion, Conversation, DemoState, Message, ProposalPayload, ReplyEffect, SimulatedDelivery } from "../types";
import { receiveDocuments, runPendingAnalyses, scheduleAnalysis } from "./core";
import { appendThreadNote, updateProposalDraftPrice } from "./review";

function question(state: DemoState, id: string): ClientQuestion {
  return byId(state.questions, id, "question");
}

function setQuestion(state: DemoState, id: string, patch: Partial<ClientQuestion>): DemoState {
  return { ...state, questions: replaceById(state.questions, id, (q) => ({ ...q, ...patch })) };
}

export function ensureConversation(state: DemoState, channel: Channel, purpose: Conversation["purpose"], contactId: string, projectId: string | null, titleHe: string): [DemoState, Conversation] {
  const existing = state.conversations.find((c) => c.channel === channel && c.purpose === purpose && c.contactId === contactId);
  if (existing) return [state, existing];
  const id = `CONV-${channel === "whatsapp" ? "WA" : "EM"}-${purpose.toUpperCase()}-${contactId}`;
  const conversation: Conversation = { id, channel, purpose, contactId, titleHe, messages: [], createdAt: state.clock, updatedAt: state.clock, projectId };
  return [{ ...state, conversations: [...state.conversations, conversation] }, conversation];
}

export function addMessage(state: DemoState, conversationId: string, message: Omit<Message, "id" | "at"> & { id?: string }): [DemoState, Message] {
  const [s1, generatedId] = nextId(state, "MSG");
  const full: Message = { ...message, id: message.id ?? generatedId, at: state.clock };
  return [{ ...s1, conversations: replaceById(s1.conversations, conversationId, (c) => ({ ...c, messages: [...c.messages, full], updatedAt: state.clock })) }, full];
}

function addDelivery(state: DemoState, delivery: Omit<SimulatedDelivery, "id" | "at">): DemoState {
  if (state.deliveries.some((d) => d.idempotencyKey === delivery.idempotencyKey)) return state;
  const [s1, id] = nextId(state, "DLV");
  return { ...s1, deliveries: [...s1.deliveries, { ...delivery, id, at: state.clock }] };
}

/** Provider review gate 1: an outgoing question is reviewed before it can be batched and released. */
export function reviewQuestion(state: DemoState, questionId: string, reviewerId = "REVIEWER"): DemoState {
  const q = question(state, questionId);
  if (q.status !== "pending_review" && q.status !== "draft") return state;
  let s = setQuestion(state, questionId, { status: "ready", reviewedBy: reviewerId });
  s = { ...s, findings: replaceById(s.findings, q.findingId, (f) => ({ ...f, status: "needs_clarification" })) };
  s = addActivity(s, "question", `השאלה נבדקה ונוספה לשאלות המרוכזות ל${contactName(s, q.contactId)}`, [questionId]);
  return bump(tick(s, 1));
}

export function setQuestionContact(state: DemoState, questionId: string, contactId: string): DemoState {
  if (!state.contacts.some((c) => c.id === contactId)) throw new Error("איש קשר לא קיים");
  return bump(setQuestion(state, questionId, { contactId }));
}

/** Create one consolidated WhatsApp message with every selected ready question. */
export function sendQuestionBatch(state: DemoState, questionIds: string[], contactIdOverride?: string): DemoState {
  const ready = questionIds.map((id) => question(state, id)).filter((q) => q.status === "ready");
  if (ready.length === 0) throw new Error("אין שאלות מוכנות לשליחה");
  const contactId = contactIdOverride ?? ready[0].contactId;
  const key = `question:${ready.map((q) => q.id).sort().join("+")}`;
  if (state.deliveries.some((d) => d.idempotencyKey === key)) return state;
  const name = contactName(state, contactId).split(" ")[0];
  const intro = ready.length === 1 ? `${name}, ריכזנו שאלה אחת שלא נפתרה מהמסמכים: ${ready[0].textHe}` : `${name}, ריכזנו ${formatNumber(ready.length)} שאלות שלא נפתרו מהמסמכים:\n${ready.map((q, i) => `${i + 1}. ${q.textHe}`).join("\n")}`;
  let [s, conversation] = ensureConversation(state, "whatsapp", "clarification", contactId, ready[0].projectId, `בירורים — ${contactName(state, contactId)}`);
  const [s2, message] = addMessage(s, conversation.id, { direction: "outbound", kind: "question", textHe: intro, attachments: [], authorId: "REVIEWER", questionId: ready[0].id });
  s = s2;
  for (const q of ready) s = setQuestion(s, q.id, { status: "sent", conversationId: conversation.id, sentMessageId: message.id, contactId });
  s = { ...s, findings: s.findings.map((f) => (ready.some((q) => q.findingId === f.id) ? { ...f, status: "question_sent" as const } : f)) };
  s = addDelivery(s, { kind: "question", questionIds: ready.map((q) => q.id), channel: "whatsapp", recipientId: contactId, conversationId: conversation.id, messageId: message.id, idempotencyKey: key });
  s = addActivity(s, "question", `נשלח בירור מרוכז ל${contactName(s, contactId)} ב-WhatsApp (${ready.length === 1 ? "שאלה אחת" : `${ready.length} שאלות`})`, ready.map((q) => q.id));
  return bump(tick(s, 3));
}

function replyMessageId(state: DemoState): [DemoState, string] {
  const prefix = state.activeScenarioId ? `MSG-${state.activeScenarioId}-REPLY` : "MSG-REPLY";
  const [s1, id] = nextId(state, prefix);
  return [s1, id.replace(/-(\d{4})$/, (_m, d) => `-${d.slice(1)}`)];
}

/** Validate and record a client's reply. Invalid replies change nothing; valid ones become immutable evidence and may create a proposal for review. */
export function recordClientReply(state: DemoState, questionId: string, text: string): DemoState {
  const q = question(state, questionId);
  if (!q.conversationId || (q.status !== "sent" && q.status !== "open")) throw new Error("השאלה טרם נשלחה");
  const parsed = interpretClarification(state, q, text);
  if (!parsed.ok && parsed.effect?.type !== "open") {
    return setQuestion(state, questionId, { parsedReply: parsed });
  }
  let [s, messageId] = replyMessageId(state);
  const [s2, message] = addMessage(s, q.conversationId, { id: messageId, direction: "inbound", kind: "reply", textHe: text, attachments: [], authorId: q.contactId, questionId });
  s = s2;
  s = setQuestion(s, questionId, { parsedReply: parsed, replyMessageId: message.id, status: parsed.effect?.type === "open" ? "open" : "answered" });
  s = addActivity(s, "reply", `התקבלה תשובה מ${contactName(s, q.contactId)}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`, [questionId, message.id]);
  if (parsed.effect && parsed.effect.type !== "open") s = applyReplyEffect(s, questionId, parsed.effect, message.id);
  else {
    const [s3, ack] = addMessage(s, q.conversationId, { direction: "outbound", kind: "update", textHe: "תודה, השאלה נשארת פתוחה עד לקבלת הפירוט. לא בוצע שינוי.", attachments: [], authorId: "REVIEWER", questionId });
    s = s3;
    void ack;
  }
  return bump(tick(s, 2));
}

function newProposal(state: DemoState, base: Omit<ChangeProposal, "id" | "createdAt" | "createdAtRevision" | "sessionId" | "targetVersions">): [DemoState, ChangeProposal] {
  const [s1, id] = nextId(state, "PRP");
  const targetVersions: Record<string, number> = {};
  for (const t of base.targetIds) {
    const r = state.erpRecords.find((x) => x.id === t);
    if (r) targetVersions[t] = r.version;
  }
  const p: ChangeProposal = { ...base, id, createdAt: state.clock, createdAtRevision: state.revision, sessionId: state.sessionId, targetVersions };
  const s: DemoState = { ...s1, proposals: [...s1.proposals, p], findings: replaceById(s1.findings, p.findingId!, (f) => ({ ...f, proposalIds: [...f.proposalIds, id], status: "proposal_created" as const })) };
  return [s, p];
}

function applyReplyEffect(state: DemoState, questionId: string, effect: ReplyEffect, replyMessageId: string): DemoState {
  const q = question(state, questionId);
  const finding = byId(state.findings, q.findingId, "finding");
  let s = state;
  const ack = (text: string) => {
    const [s2] = addMessage(s, q.conversationId!, { direction: "outbound", kind: "update", textHe: text, attachments: [], authorId: "REVIEWER", questionId });
    s = s2;
  };
  switch (effect.type) {
    case "allocation": {
      const record = byId(s.erpRecords, q.recordId!, "record");
      const allocations = Object.entries(effect.split).map(([projectId, amount]) => {
        const code = s.costCodes.find((c) => c.projectId === projectId && c.category === "equipment") ?? s.costCodes.find((c) => c.projectId === projectId)!;
        return { projectId, costCodeId: code.id, amount, workItemId: null, commitmentId: null };
      });
      const [s2, p] = newProposal(s, {
        kind: "allocation",
        findingId: finding.id,
        projectId: finding.projectId,
        costCodeId: finding.costCodeId,
        targetIds: [record.id],
        titleHe: `חלוקת חשבונית ${record.sourceDocumentId ?? record.id} בין האתרים לפי תשובת ${contactName(s, q.contactId)}`,
        reasonHe: `תשובת ${contactName(s, q.contactId)} ב-WhatsApp: ${allocations.map((a) => `${formatILS(a.amount)} ל${projectName(s, a.projectId)}`).join(", ")}. התשובה היא ראיה תומכת; העדכון בזיו מחייב בדיקה של צוות הבקרה.`,
        before: record.allocations.map((al) => ({ labelHe: projectName(s, al.projectId), value: formatILS(al.amount) })),
        after: allocations.map((a) => ({ labelHe: projectName(s, a.projectId), value: formatILS(a.amount) })),
        payload: { kind: "allocation", recordId: record.id, allocations },
        evidence: [...finding.evidence],
        status: "pending_review",
        sourceReplyMessageId: replyMessageId,
        labelHe: "תיקון נתון",
      });
      s = s2;
      ack(`תודה. החלוקה נרשמה כראיה והועברה לבדיקת צוות הבקרה לפני העדכון בזיו (${p.id}).`);
      break;
    }
    case "future_price": {
      const record = byId(s.erpRecords, q.recordId!, "record");
      const code = byId(s.costCodes, record.allocations[0].costCodeId, "cost code");
      if (effect.keepBaseline || effect.unitPrice == null) {
        s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "resolved", resolutionHe: `הרכישה סומנה כחד-פעמית; ההנחה ליתרה נשארת ${formatILS(effect.unitPrice ?? code.budgetUnitPrice ?? 0)} ל${code.unit}.` })), alerts: s.alerts.map((a) => (a.findingId === finding.id ? { ...a, status: "resolved" as const } : a)) };
        s = setQuestion(s, questionId, { status: "resolved", resolutionHe: "הרכישה חד-פעמית; ההנחה לא השתנתה" });
        ack(`תודה. הרכישה סומנה כחד-פעמית; הנחת המחיר ליתרה נשארת ${formatILS(effect.unitPrice ?? code.budgetUnitPrice ?? 0)} ל${code.unit} והסיכון המותנה נסגר.`);
        for (const alertId of finding.alertIds) {
          const alert = s.alerts.find((a) => a.id === alertId);
          if (alert?.conversationId) s = appendThreadNote(s, alert.conversationId, `עודכן: לפי ${contactName(s, q.contactId)} הרכישה חד-פעמית; הנחת המחיר ליתרת הברזל נשארת ${formatILS(effect.unitPrice ?? code.budgetUnitPrice ?? 0)} לטון.`, { alertId });
        }
        break;
      }
      const [s2, p] = createFuturePriceProposal(s, code.id, effect.unitPrice, { findingId: finding.id, replyMessageId, contactId: q.contactId });
      s = s2;
      ack(`תודה. ההנחה של ${formatILS(effect.unitPrice)} ל${code.unit} נרשמה כהערכה (לא הסכם ספק) והועברה לבדיקת צוות הבקרה (${p.id}).`);
      break;
    }
    case "quantity_reason": {
      if (effect.reason === "consumed") {
        s = setQuestion(s, questionId, { status: "resolved", resolutionHe: "הכמות הנוספת נצרכה באותה יציקה" });
        s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "resolved", resolutionHe: "הכמות הנוספת נצרכה ביציקה המתוכננת; אין החזרה ואין שינוי תכולה. סטיית כמות מקומית של 20% ביציקה זו; אין הקשה על יתר הפרויקט." })) };
        ack("תודה. הכמות הנוספת תוכר לפי החשבונית; תיקון הרשומה בזיו ממתין לאישור צוות הבקרה.");
      } else if (effect.reason === "returned") {
        s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "needs_clarification", resolutionHe: "נדרש מסמך החזרה או זיכוי לפני הקטנת העלות המוכרת" })) };
        s = { ...s, proposals: s.proposals.map((p) => (p.findingId !== finding.id && p.kind === "erp_correction" && p.status === "pending_review" && p.targetIds.includes(q.recordId ?? "") ? { ...p, status: "needs_clarification" as const, reasonHe: `${p.reasonHe} — ממתין למסמך החזרה/זיכוי בגין 20 מ״ק.` } : p)) };
        s = setQuestion(s, questionId, { status: "open", resolutionHe: "ממתין למסמך החזרה" });
        ack("תודה. עד לקבלת מסמך החזרה או זיכוי מהספק, ההתאמה הכספית מושהית ולא בוצע שינוי.");
      } else if (effect.reason === "design_change") {
        const [s2, fid] = nextId(s, "FND");
        s = { ...s2, findings: [...s2.findings, { ...finding, id: fid, kind: "scope_change", titleHe: "סיווג שינוי תכנון — יציקת תקרה A", explanationHe: "לפי התשובה הכמות הנוספת שייכת לתוספת תכנון. נפתחת בדיקת סיווג שינוי ובחינת תקציב/תחזית; התקציב המקורי נשמר עד לאישור.", status: "needs_clarification", proposalIds: [], questionIds: [], alertIds: [], taskIds: [], dedupeKey: `design_change:${finding.id}`, createdAt: s2.clock, createdAtRevision: s2.revision }] };
        s = setQuestion(s, questionId, { status: "resolved", resolutionHe: "נפתחה בדיקת שינוי תכנון" });
        ack("תודה. נפתחה בדיקת סיווג שינוי; התקציב המקורי נשמר עד לאישור השינוי.");
      } else {
        s = setQuestion(s, questionId, { status: "open", resolutionHe: "עדיין בבדיקה" });
        ack("תודה. הנושא נשאר פתוח; לא נטען בזבוז ולא בוצע שינוי בתחזית.");
      }
      break;
    }
    case "duration": {
      const project = byId(s.projects, finding.projectId, "project");
      if (!effect.confirm) {
        s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "resolved", resolutionHe: "רק אבן דרך זזה; משך האתר הכולל נשאר ולא נוספו תקורות" })) };
        s = setQuestion(s, questionId, { status: "resolved" });
        ack("תודה. משך האתר הכולל נשאר; לא נוספות תקורות.");
        break;
      }
      const months = effect.months ?? finding.numbers.months ?? 14;
      const componentIds = effect.componentIds ?? (finding.documentIds.length ? undefined : undefined);
      const plan = s.documents.find((d) => d.kind === "plan" && d.projectIds.includes(project.id) && d.facts.monthlyComponents);
      const allComponents = plan?.facts.monthlyComponents?.map((c) => c.id) ?? [];
      const selected = componentIds ?? (finding.numbers.componentCount ? finding.documentIds : allComponents);
      const finish = finishDateForDuration(project.start ?? "2026-03-01", months);
      const isPrimary = months === 14 && selected.length === allComponents.length;
      const document = isPrimary
        ? makeScenarioDocument("SCHEDULE-H-14", s.clock)
        : {
            ...makeScenarioDocument("SCHEDULE-H-14", s.clock),
            id: `SCHEDULE-${project.id}-${months}-CUSTOM`,
            titleHe: `עדכון לוח זמנים — ${months} חודשים (לפי תשובת ${contactName(s, q.contactId)})`,
            anchors: [{ id: "text", labelHe: "עדכון", text: `עדכון לאחר בירור: משך האתר הכולל מתארך ל-${months} חודשים; סיום חדש ${formatDate(finish)}. הרכיבים הממשיכים: ${selected.map((id) => plan?.facts.monthlyComponents?.find((c) => c.id === id)?.nameHe ?? id).join(", ")}. מקור: תשובת ${contactName(s, q.contactId)} (${replyMessageId}).` }],
            facts: { months, siteFinish: finish, approved: true, componentIds: selected },
            generated: true,
          };
      s = receiveDocuments(s, [document], { note: `נוצר מסמך לוח זמנים ${document.id} מתוך התשובה` });
      s = runPendingAnalyses(s);
      s = setQuestion(s, questionId, { status: "answered" });
      s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "resolved", resolutionHe: `אושרה הארכה ל-${months} חודשים; נוצר ${document.id}` })) };
      ack(`תודה. ההארכה ל-${months} חודשים (סיום ${formatDate(finish)}) נרשמה; השפעת התחזית ממתינה לאישור צוות הבקרה.`);
      break;
    }
    case "delivery": {
      const [s2, taskId] = nextId(s, "TSK");
      s = { ...s2, tasks: [...s2.tasks, { id: taskId, kind: effect.outcome === "more_coming" ? "delivery_followup" : "supplier_clarification", projectId: finding.projectId, recordId: q.recordId ?? null, findingId: finding.id, titleHe: effect.outcome === "more_coming" ? "מעקב אספקה: יתרת הכמות בדרך" : "בירור מול הספק: יתרת אספקה", descriptionHe: effect.outcome === "more_coming" ? "לוודא קבלת תעודת משלוח ליתרת הכמות. הכמות שנרכשה והחשבונית אינן משתנות." : "לברר מול הספק אם יתרת הכמות תסופק או שצפוי זיכוי. עד אז נושא האספקה פתוח.", status: "open", createdAt: s2.clock }] };
      s = setQuestion(s, questionId, { status: effect.outcome === "more_coming" ? "resolved" : "open", resolutionHe: effect.outcome === "more_coming" ? "יתרת הכמות בדרך; מעקב אספקה פתוח" : "נדרש בירור מול הספק" });
      s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "needs_clarification", resolutionHe: effect.outcome === "more_coming" ? "יתרת האספקה בדרך; החשבונית ללא שינוי" : "בירור מול הספק פתוח; החשבונית ללא שינוי" })) };
      ack(effect.outcome === "more_coming" ? "תודה. נעקוב אחרי תעודת המשלוח ליתרה; החשבונית והכמות שנרכשה לא משתנות." : "תודה. נושא האספקה נשאר פתוח לבירור מול הספק; לא בוצע שינוי בחשבונית.");
      break;
    }
    case "draft_price": {
      if (effect.hasContract) {
        s = receiveDocuments(s, [makeScenarioDocument("CT-NOF-CONC-300", s.clock)]);
        s = scheduleAnalysis(s, { documentId: "BUD-NOF-DRAFT-V1" });
        s = runPendingAnalyses(s);
        s = setQuestion(s, questionId, { status: "answered" });
        ack("תודה. ההסכם התקבל ונבדק מול המפרט והתנאים; ההחלטה על ההנחה ממתינה לצוות הבקרה.");
      } else if (effect.unitPrice != null) {
        const pending = s.proposals.find((p) => p.findingId === finding.id && p.kind === "draft_budget" && p.status === "pending_review");
        if (pending) s = updateProposalDraftPrice(s, pending.id, effect.unitPrice);
        s = setQuestion(s, questionId, { status: "answered" });
        ack(`תודה. המחיר ${formatILS(effect.unitPrice)} למ״ק עודכן בהצעה לעדכון הטיוטה.`);
      }
      break;
    }
    case "cost_code": {
      const record = byId(s.erpRecords, q.recordId!, "record");
      const code = byId(s.costCodes, effect.costCodeId, "cost code");
      const current = byId(s.costCodes, record.allocations[0].costCodeId, "cost code");
      const [s2, p] = newProposal(s, {
        kind: "erp_correction",
        findingId: finding.id,
        projectId: finding.projectId,
        costCodeId: code.id,
        targetIds: [record.id],
        titleHe: `שינוי סיווג לפי תשובת הלקוח: ${current.nameHe} ← ${code.nameHe}`,
        reasonHe: `תשובת ${contactName(s, q.contactId)}: ההוצאה שייכת לסעיף ${code.nameHe}. התשובה היא ראיה; העדכון מחייב בדיקה.`,
        before: [{ labelHe: "סעיף תקציב", value: `${current.nameHe} (${current.id})` }],
        after: [{ labelHe: "סעיף תקציב", value: `${code.nameHe} (${code.id})` }],
        payload: { kind: "erp_correction", recordId: record.id, changes: { costCodeId: code.id } } as ProposalPayload,
        evidence: finding.evidence,
        status: "pending_review",
        sourceReplyMessageId: replyMessageId,
        labelHe: "תיקון נתון",
      });
      s = s2;
      ack(`תודה. הסיווג לסעיף ${code.nameHe} הועבר לבדיקת צוות הבקרה (${p.id}).`);
      break;
    }
    case "custom":
      ack("תודה. התשובה נרשמה כראיה; צוות הבקרה יבדוק אותה.");
      break;
    case "open":
      break;
  }
  return s;
}

/** Forecast proposal for the uncommitted steel items at a candidate future price (from a reply, a quote, or the what-if panel). */
export function createFuturePriceProposal(state: DemoState, costCodeId: string, unitPrice: number, basis: { findingId?: string | null; replyMessageId?: string; contactId?: string; quoteDocumentId?: string; label?: string }): [DemoState, ChangeProposal] {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error("המחיר חייב להיות מספר חיובי");
  const code = byId(state.costCodes, costCodeId, "cost code");
  const items = state.workItems.filter((w) => w.costCodeId === costCodeId && w.status === "uncommitted");
  const line = costLineView(state, costCodeId);
  const changes = items.map((w) => {
    const current = currentForecast(state, w.id);
    const qty = current?.quantity ?? w.quantity ?? 0;
    return { workItemId: w.id, quantity: qty, unitPrice, amount: multiplyQuantity(qty, unitPrice), basisHe: basis.quoteDocumentId ? `הצעה ${basis.quoteDocumentId}: ${formatILS(unitPrice)} ל${code.unit}` : `הנחת מחיר שאושרה: ${formatILS(unitPrice)} ל${code.unit}${basis.contactId ? ` (הערכת ${contactName(state, basis.contactId)}, לא הסכם ספק)` : ""}`, evidence: [...(basis.quoteDocumentId ? [{ documentId: basis.quoteDocumentId, anchorId: "text" }] : []), ...(basis.replyMessageId ? [{ documentId: basis.replyMessageId, labelHe: "תשובת הלקוח" }] : [])] };
  });
  const newR = changes.reduce((a, c) => a + c.amount, 0);
  const acceptedPrice = currentForecast(state, items[0]?.id ?? "")?.unitPrice ?? code.budgetUnitPrice ?? 0;
  const findingId = basis.findingId ?? state.findings.find((f) => f.kind === "price_risk" && f.costCodeId === costCodeId && !["resolved", "superseded", "dismissed"].includes(f.status))?.id ?? null;
  const [s1, id] = nextId(state, "PRP");
  const p: ChangeProposal = {
    id,
    kind: "forecast",
    findingId,
    projectId: code.projectId,
    costCodeId,
    targetIds: items.map((w) => w.id),
    titleHe: `הצעה לעדכון תחזית: ${code.nameHe} — הנחת מחיר ${formatILS(unitPrice)} ל${code.unit} ליתרה`,
    reasonHe: basis.label ?? (basis.replyMessageId ? `לפי תשובת ${contactName(state, basis.contactId ?? "OPS")} ב-WhatsApp. ההערכה היא הנחת תחזית, לא התחייבות חתומה.` : `הנחת מחיר עתידי שנבחרה בפאנל ההדגמה. נשארת הנחה עד לאישור.`),
    before: [{ labelHe: "מחיר ליחידה מאושר", value: formatILS(acceptedPrice) }, { labelHe: "יתרת עבודה ללא התחייבות", value: formatILS(line.uncommitted) }, { labelHe: "תחזית עלות לסיום", value: formatILS(line.eac) }, { labelHe: "חריגה צפויה", value: formatILS(line.variance) }],
    after: [{ labelHe: "מחיר ליחידה מאושר", value: formatILS(unitPrice) }, { labelHe: "יתרת עבודה ללא התחייבות", value: formatILS(newR) }, { labelHe: "תחזית עלות לסיום", value: formatILS(line.eac - line.uncommitted + newR) }, { labelHe: "חריגה צפויה", value: formatILS(line.eac - line.uncommitted + newR - line.budget) }],
    payload: { kind: "forecast", projectId: code.projectId, costCodeId, items: changes },
    evidence: [...changes[0]?.evidence ?? [], { documentId: `BUD-${code.projectId}-V1`, anchorId: code.id.toLowerCase() }, { documentId: items[0]?.sourceDocumentId ?? "FC-H-STEEL", anchorId: "summary" }],
    status: "pending_review",
    createdAt: state.clock,
    createdAtRevision: state.revision,
    targetVersions: {},
    sessionId: state.sessionId,
    sourceReplyMessageId: basis.replyMessageId,
    labelHe: "הצעה לעדכון תחזית",
  };
  let s: DemoState = { ...s1, proposals: [...s1.proposals.map((x) => (x.kind === "forecast" && x.costCodeId === costCodeId && x.status === "pending_review" ? { ...x, status: "superseded" as const } : x)), p] };
  if (findingId) s = { ...s, findings: replaceById(s.findings, findingId, (f) => ({ ...f, proposalIds: [...f.proposalIds, id] })) };
  s = addActivity(s, "forecast", `נוצרה הצעה לעדכון תחזית: ${code.nameHe} ${formatILS(unitPrice)} ל${code.unit}`, [id]);
  return [bump(s), p];
}

/** Provider review gate 1 for outbound alerts: release the early alert to the customer channel and the linked clarification to OPS. */
export function reviewAndReleaseAlert(state: DemoState, alertId: string, reviewerId = "REVIEWER", options: { combineForOps?: boolean; questionContactId?: string; recipientId?: string } = {}): DemoState {
  const alert = byId(state.alerts, alertId, "alert");
  if (alert.status === "delivered" || alert.status === "acknowledged") return state;
  const key = `alert:${alert.id}:${alert.channel}:${options.recipientId ?? alert.recipientId}`;
  if (state.deliveries.some((d) => d.idempotencyKey === key)) return state;
  let s = state;
  const finding = byId(s.findings, alert.findingId, "finding");
  const linkedQuestion = alert.linkedQuestionId ? s.questions.find((q) => q.id === alert.linkedQuestionId) : undefined;
  const questionContactId = options.questionContactId ?? linkedQuestion?.contactId ?? "OPS";
  const recipientId = options.combineForOps ? questionContactId : (options.recipientId ?? alert.recipientId);
  const [s1, conversation] = ensureConversation(s, alert.channel, options.combineForOps ? "clarification" : "alert", recipientId, alert.projectId, options.combineForOps ? `בירורים — ${contactName(s, recipientId)}` : `התרעות — ${contactName(s, recipientId)}`);
  s = s1;
  const name = contactName(s, recipientId).split(" ")[0];
  const text = options.combineForOps && linkedQuestion ? `${name}, ${alert.textHe}\n\n${linkedQuestion.textHe}` : `${name}, ${alert.textHe}`;
  const [s2, message] = addMessage(s, conversation.id, {
    direction: "outbound",
    kind: "alert",
    textHe: text,
    attachments: [],
    authorId: reviewerId,
    alertId: alert.id,
    questionId: options.combineForOps ? linkedQuestion?.id : undefined,
    actions: [{ labelHe: "פתח את החישוב", action: "open_calculation", targetId: finding.id }, ...(linkedQuestion ? [{ labelHe: "בדוק את הנחת המחיר", action: "open_question" as const, targetId: linkedQuestion.id }] : [])],
  });
  s = s2;
  s = { ...s, alerts: replaceById(s.alerts, alertId, (a) => ({ ...a, status: "delivered", reviewedBy: reviewerId, deliveredAt: s.clock, conversationId: conversation.id, messageId: message.id })) };
  s = addDelivery(s, { kind: "alert", alertId: alert.id, channel: alert.channel, recipientId, conversationId: conversation.id, messageId: message.id, idempotencyKey: key });
  const [s3] = addAudit(s, { actorId: reviewerId, kind: "alert_released", textHe: `התרעה מוקדמת אושרה ושוחררה ל${contactName(s, recipientId)} ב-WhatsApp: ${alert.titleHe}`, entityIds: [alert.id, finding.id], projectId: alert.projectId, costCodeId: finding.costCodeId ?? undefined });
  s = s3;
  if (linkedQuestion) {
    if (options.combineForOps) {
      s = setQuestion(s, linkedQuestion.id, { status: "sent", conversationId: conversation.id, sentMessageId: message.id, contactId: recipientId, reviewedBy: reviewerId });
      s = addDelivery(s, { kind: "question", questionIds: [linkedQuestion.id], channel: "whatsapp", recipientId, conversationId: conversation.id, messageId: message.id, idempotencyKey: `question:${linkedQuestion.id}` });
    } else {
      s = setQuestion(s, linkedQuestion.id, { status: "ready", reviewedBy: reviewerId, contactId: questionContactId });
      s = sendQuestionBatch(s, [linkedQuestion.id], questionContactId);
    }
  }
  s = { ...s, findings: replaceById(s.findings, finding.id, (f) => ({ ...f, status: "question_sent" })) };
  s = addActivity(s, "alert", `התרעה מוקדמת נמסרה ל${contactName(s, recipientId)} ב-WhatsApp: ${alert.titleHe}`, [alert.id]);
  return bump(tick(s, 3));
}

export function acknowledgeAlert(state: DemoState, alertId: string): DemoState {
  const alert = byId(state.alerts, alertId, "alert");
  if (alert.status !== "delivered") return state;
  return bump({ ...state, alerts: replaceById(state.alerts, alertId, (a) => ({ ...a, status: "acknowledged" })) });
}

/** Chat's "open a clarification" action creates an in-app draft question (never a real message). */
export function draftClientQuestion(state: DemoState, findingId: string, contactId: string, textHe: string): DemoState {
  const finding = byId(state.findings, findingId, "finding");
  const [s1, id] = nextId(state, "Q");
  const q: ClientQuestion = { id, findingId, projectId: finding.projectId, contactId, textHe, suggestedReplies: [], parser: "free", status: "pending_review", checkedHe: finding.checkedHe, createdAt: state.clock };
  return bump({ ...s1, questions: [...s1.questions, q], findings: replaceById(s1.findings, findingId, (f) => ({ ...f, questionIds: [...f.questionIds, id] })) });
}
