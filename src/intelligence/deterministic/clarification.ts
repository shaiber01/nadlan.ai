import { formatILS, ils, parseMoneyInput, sum, type Agorot } from "../../domain/money";
import type { ClientQuestion, DemoState, ParsedReply, ReplyEffect } from "../../domain/types";

/**
 * Deterministic interpretation of a client's free-text reply to a clarification question.
 * Returns a structured effect or a validation message; never mutates state.
 */

const HEBREW_PUNCT = /[״"'’‘“”]/g;

export function normalizeText(text: string): string {
  return text.replace(HEBREW_PUNCT, "").replace(/[‎‏]/g, "").replace(/\s+/g, " ").trim();
}

function findProjectId(state: DemoState, fragment: string): string | null {
  const norm = normalizeText(fragment);
  for (const p of state.projects) {
    if (p.aliases.some((alias) => norm.includes(alias)) || norm.includes(p.nameHe)) return p.id;
  }
  return null;
}

/** Extract "<amount> ל<project>" pairs, or "<amount>/<amount>" in framework project order. */
function parseAllocation(state: DemoState, question: ClientQuestion, text: string): ParsedReply {
  const norm = normalizeText(text);
  const total = question.amount ?? 0;
  const record = state.erpRecords.find((r) => r.id === question.recordId);
  const frameworkProjects = record ? uniqueProjects(state, record) : [];
  if (/אין לי (עדיין )?פירוט|לא יודע|לא ידוע|אבדוק/.test(norm)) {
    return { ok: false, messageHe: "השאלה נשארת פתוחה; לא בוצע שינוי.", effect: { type: "open" } };
  }
  const split: Record<string, Agorot> = {};
  // Pattern B first: "X לכל אתר"
  const each = /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:₪|ש"ח|שח)?\s*לכל אתר/.exec(norm);
  if (each && frameworkProjects.length > 0) {
    const amount = parseMoneyInput(each[1]);
    if (amount != null) for (const p of frameworkProjects) split[p] = amount;
  }
  // Pattern A: segments like "40,000 ₪ למגורי הדרים" separated by "ו-", commas, semicolons, slashes or newlines
  if (Object.keys(split).length === 0) {
    const segments = norm
      .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
      .split(/\s+ו[-־]?\s*(?=\d)|[,;\n/]\s*|\s+ו(?=\s)/)
      .map((x) => x.trim())
      .filter(Boolean);
    const parsedSegments = segments.map((segment) => {
      const amountMatch = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(segment);
      const amount = amountMatch ? parseMoneyInput(amountMatch[1]) : null;
      const projectId = findProjectId(state, segment.replace(amountMatch?.[0] ?? "", ""));
      return { amount, projectId };
    });
    const withProjects = parsedSegments.filter((x) => x.amount != null && x.projectId);
    if (withProjects.length >= 2) {
      for (const x of withProjects) split[x.projectId!] = (split[x.projectId!] ?? 0) + x.amount!;
    } else {
      // Pattern C: plain numbers in framework project order
      const numbers = parsedSegments.map((x) => x.amount).filter((x): x is number => x != null);
      if (numbers.length === frameworkProjects.length && numbers.length >= 2 && parsedSegments.every((x) => !x.projectId)) {
        frameworkProjects.forEach((p, i) => (split[p] = numbers[i]));
      }
    }
  }
  const keys = Object.keys(split);
  if (keys.length < 2) {
    return { ok: false, messageHe: "לא הצלחתי להבין את החלוקה. אפשר לכתוב למשל: ״40,000 ₪ למגורי הדרים ו-20,000 ₪ למתחם הפארק״.", effect: null };
  }
  const sumSplit = sum(Object.values(split));
  if (sumSplit !== total) {
    return { ok: false, messageHe: `החלוקה מסתכמת ב-${formatILS(sumSplit)}, אך סכום החשבונית הוא ${formatILS(total)}. צריך לתקן את החלוקה לפני העדכון.`, effect: null };
  }
  if (Object.values(split).some((v) => v < 0)) {
    return { ok: false, messageHe: "סכומי החלוקה חייבים להיות חיוביים.", effect: null };
  }
  return { ok: true, messageHe: `החלוקה התקבלה: ${keys.map((k) => `${formatILS(split[k])} ל${state.projects.find((p) => p.id === k)?.nameHe}`).join(", ")}.`, effect: { type: "allocation", split } };
}

function uniqueProjects(state: DemoState, record: { sourceDocumentId: string | null }): string[] {
  const source = state.documents.find((d) => d.id === record.sourceDocumentId);
  const framework = state.documents.find((d) => d.id === source?.facts.contractId);
  return framework?.facts.frameworkProjectIds ?? [];
}

function parseFuturePrice(state: DemoState, question: ClientQuestion, text: string): ParsedReply {
  const norm = normalizeText(text);
  const record = state.erpRecords.find((r) => r.id === question.recordId);
  const code = record ? state.costCodes.find((c) => c.id === record.allocations[0].costCodeId) : undefined;
  const budgetPrice = code?.budgetUnitPrice ?? ils(3000);
  const purchasePrice = record?.unitPrice ?? ils(3300);
  if (/לא ידוע|עדיין לא|לא יודע|אבדוק/.test(norm)) return { ok: true, messageHe: "ההנחה נשארת פתוחה; התחזית המאושרת אינה משתנה.", effect: { type: "open" } };
  if (/חד[- ]פעמי|חריג|היתרה צפויה ב/.test(norm) && !/הערכה חדשה/.test(norm)) {
    const explicit = /(\d[\d,]*)\s*₪?/.exec(norm.replace(/^.*היתרה צפויה ב-?/, ""));
    const price = explicit ? (parseMoneyInput(explicit[1]) ?? budgetPrice) : budgetPrice;
    return { ok: true, messageHe: `הרכישה מסומנת כחד-פעמית; הנחת המחיר ליתרה נשארת ${formatILS(price)}.`, effect: { type: "future_price", unitPrice: price, keepBaseline: price === budgetPrice } };
  }
  if (/גם בהמשך|המחיר הצפוי|ימשיך|יישאר/.test(norm) && !/\d{3,}/.test(norm)) {
    return { ok: true, messageHe: `המחיר ${formatILS(purchasePrice)} יוגש לאישור כהנחת המחיר ליתרה.`, effect: { type: "future_price", unitPrice: purchasePrice } };
  }
  const amount = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(norm);
  if (amount) {
    const price = parseMoneyInput(amount[1]);
    if (price == null || price <= 0) return { ok: false, messageHe: "המחיר חייב להיות מספר חיובי.", effect: null };
    if (price < ils(500) || price > ils(20000)) return { ok: false, messageHe: `המחיר ${formatILS(price)} לטון נראה מחוץ לטווח סביר (500–20,000 ₪). נא לאמת.`, effect: null };
    return { ok: true, messageHe: `ההערכה ${formatILS(price)} לטון תוגש לאישור כהנחת מחיר; זו הערכה, לא הסכם ספק.`, effect: { type: "future_price", unitPrice: price } };
  }
  return { ok: false, messageHe: "לא הצלחתי להבין את התשובה. אפשר לבחור אחת מהתשובות המוצעות או לכתוב מחיר לטון.", effect: null };
}

function parseQuantityReason(text: string): ParsedReply {
  const norm = normalizeText(text);
  if (/הוחזר|החזרה|החזרנו/.test(norm)) return { ok: true, messageHe: "נדרש מסמך החזרה או זיכוי לפני הקטנת העלות המוכרת; ההתאמה הכספית ממתינה לראיה.", effect: { type: "quantity_reason", reason: "returned" } };
  if (/תוספת תכנון|שינוי תכנון|תכולה אחרת|שינוי מאושר/.test(norm) && !/אין שינוי/.test(norm)) return { ok: true, messageHe: "נפתחת בדיקת סיווג שינוי ותקציב; התקציב המקורי נשמר עד לאישור.", effect: { type: "quantity_reason", reason: "design_change" } };
  if (/בבדיקה|לא יודע|אבדוק|עדיין/.test(norm)) return { ok: true, messageHe: "הנושא נשאר פתוח; לא נטען בזבוז ולא בוצע שינוי.", effect: { type: "quantity_reason", reason: "investigating" } };
  if (/אותה יציקה|שימשו|נדרש|כל ה/.test(norm)) return { ok: true, messageHe: "הכמות הנוספת נצרכה ביציקה המתוכננת; העלות המוכרת מתעדכנת לפי החשבונית.", effect: { type: "quantity_reason", reason: "consumed" } };
  return { ok: false, messageHe: "לא הצלחתי להבין את התשובה. אפשר לציין: נצרך באותה יציקה, הוחזר לספק, שייך לתוספת תכנון, או עדיין בבדיקה.", effect: null };
}

function parseDuration(text: string): ParsedReply {
  const norm = normalizeText(text);
  if (/^לא|רק אבן דרך|אבן דרך בלבד|לא מאריך/.test(norm)) return { ok: true, messageHe: "רק אבן דרך זזה; משך האתר הכולל נשאר ולא נוספות תקורות.", effect: { type: "duration", confirm: false, milestoneOnly: true } };
  if (/לא בטוח|עדיין לא|לא ידוע/.test(norm)) return { ok: true, messageHe: "ההארכה אינה ודאית; תוצג כטווח מותנה ולא כתאריך ועלות מאושרים.", effect: { type: "open" } };
  if (/^כן|יפעל עד|יימשכו|כל העלויות/.test(norm)) {
    const months = /(\d{1,2})\s*חודש/.exec(norm);
    return { ok: true, messageHe: "אושר: ההארכה חלה על כל תקופת האתר ועל כל הרכיבים.", effect: { type: "duration", confirm: true, months: months ? Number(months[1]) : undefined } };
  }
  return { ok: false, messageHe: "לא הצלחתי להבין. אפשר לענות ״כן״ אם כל העלויות נמשכות, או לציין אילו רכיבים אינם נמשכים.", effect: null };
}

function parseDelivery(text: string): ParsedReply {
  const norm = normalizeText(text);
  if (/בדרך|יגיע|יסופק|נוספים/.test(norm)) return { ok: true, messageHe: "יתרת האספקה צפויה; הכמות שנרכשה נשארת כפי שהיא ומעקב אספקה נשאר פתוח עד לקבלת תעודה.", effect: { type: "delivery", outcome: "more_coming" } };
  if (/בירור|ספק|זיכוי/.test(norm)) return { ok: true, messageHe: "נדרש בירור מול הספק; נושא האספקה נשאר פתוח ולא בוצע שינוי בחשבונית.", effect: { type: "delivery", outcome: "clarify" } };
  return { ok: false, messageHe: "לא הצלחתי להבין. אפשר לציין אם הכמות הנותרת בדרך או שנדרש בירור מול הספק.", effect: null };
}

function parseDraftPrice(text: string): ParsedReply {
  const norm = normalizeText(text);
  if (/הסכם תקף|יש הסכם/.test(norm)) return { ok: true, messageHe: "נבדק הסכם תקף; אם תנאיו תואמים, ההנחה המקורית נשמרת.", effect: { type: "draft_price", unitPrice: null, hasContract: true } };
  const amount = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(norm);
  if (amount) {
    const price = parseMoneyInput(amount[1]);
    if (price == null || price <= 0) return { ok: false, messageHe: "המחיר חייב להיות חיובי.", effect: null };
    return { ok: true, messageHe: `מחיר ${formatILS(price)} למ״ק יוגש כעדכון לטיוטה.`, effect: { type: "draft_price", unitPrice: price } };
  }
  return { ok: false, messageHe: "אפשר לכתוב מחיר למ״ק או לציין שקיים הסכם תקף.", effect: null };
}

function parseFree(state: DemoState, question: ClientQuestion, text: string): ParsedReply {
  const norm = normalizeText(text);
  const suggested = question.suggestedReplies.find((s) => normalizeText(s.textHe) === norm);
  if (suggested) return { ok: true, messageHe: "התשובה נרשמה.", effect: suggested.effect };
  const record = state.erpRecords.find((r) => r.id === question.recordId);
  if (record) {
    for (const code of state.costCodes.filter((c) => c.projectId === record.projectId)) {
      if (code.aliases.some((alias) => norm.includes(alias)) || norm.includes(code.nameHe)) {
        return { ok: true, messageHe: `סעיף ${code.nameHe} נרשם כתשובה; ההצעה תוגש לבדיקה.`, effect: { type: "cost_code", costCodeId: code.id } as ReplyEffect };
      }
    }
  }
  if (/אבדוק|אחזור|לא יודע/.test(norm)) return { ok: true, messageHe: "השאלה נשארת פתוחה.", effect: { type: "open" } };
  return { ok: true, messageHe: "התשובה נרשמה כראיה; צוות הבקרה יבדוק אותה.", effect: { type: "custom" } };
}

export function interpretClarification(state: DemoState, question: ClientQuestion, reply: string): ParsedReply {
  const suggested = question.suggestedReplies.find((s) => normalizeText(s.textHe) === normalizeText(reply));
  if (suggested) {
    if (suggested.effect.type === "open") return { ok: false, messageHe: "השאלה נשארת פתוחה; לא בוצע שינוי.", effect: { type: "open" } };
    return { ok: true, messageHe: "התשובה התקבלה.", effect: suggested.effect };
  }
  switch (question.parser) {
    case "allocation":
      return parseAllocation(state, question, reply);
    case "future_price":
      return parseFuturePrice(state, question, reply);
    case "quantity_reason":
      return parseQuantityReason(reply);
    case "duration":
      return parseDuration(reply);
    case "delivery":
      return parseDelivery(reply);
    case "draft_price":
      return parseDraftPrice(reply);
    default:
      return parseFree(state, question, reply);
  }
}
