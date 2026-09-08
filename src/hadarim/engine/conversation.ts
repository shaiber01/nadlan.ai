import { SECTION_SHORT_HE } from "./checks";
import { confirmQuote, decide, pkg, saveConfig, setReportConfig, startControl } from "./commands";
import { uncoveredByBasis } from "./forecast";
import type { V2State } from "./model";
import { buildReport } from "./report";

/**
 * Deterministic intent handling for the control conversation: report requests, live report changes
 * (scene 7), configuration save (scene 8) and questions about the control (scene 9 and reserves).
 */

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const num = (v: number) => v.toLocaleString("he-IL");
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");

function normalize(text: string): string {
  return text.replace(/[״"'’]/g, "").replace(/\s+/g, " ").trim();
}

function pushUser(state: V2State, textHe: string): V2State {
  const n = (state.counters.MSG ?? 0) + 1;
  return { ...state, counters: { ...state.counters, MSG: n }, control: { ...state.control, messages: [...state.control.messages, { id: `MSG-${n}`, role: "user", kind: "text", textHe, at: state.clock }] } };
}

function pushSystem(state: V2State, textHe: string, extra: { sourcesHe?: string[]; documentId?: string; tableRows?: string[][] } = {}): V2State {
  const n = (state.counters.MSG ?? 0) + 1;
  return { ...state, counters: { ...state.counters, MSG: n }, control: { ...state.control, messages: [...state.control.messages, { id: `MSG-${n}`, role: "system", kind: "answer", textHe, at: state.clock, ...extra }] } };
}

export function handleUserText(state: V2State, rawText: string): V2State {
  const text = normalize(rawText);
  if (!text) return state;
  const open = state.control.findings.find((f) => {
    const d = state.control.decisions[f.id];
    return state.control.messages.some((m) => m.kind === "finding" && m.findingId === f.id) && (!d || d.status === "open" || d.pending?.kind === "quote");
  });

  // Free text while a finding card is waiting for a decision -> decide with text
  if (open && state.control.status === "reviewing" && !/^(תכין|הכן|הוסף|תציג|הצג|תכין גרסה|הכן גרסה|מה השתנה|למה|אילו|מה עדיין|שמור)/.test(text)) {
    return decideFree(state, open.id, rawText);
  }
  if (/(תכין|הכן|תריץ|הרץ).*(בקרה|דוח)|בקרה תקציבית/.test(text)) {
    if (state.control.status !== "idle") return pushSystem(pushUser(state, rawText), "הבקרה לתאריך זה כבר רצה. אפשר לשאול עליה, לשנות את הדוח, או לאפס את ההדגמה כדי להריץ מחדש.");
    return startControl(state, rawText);
  }
  if (/השוואה לבקרה הקודמת|שינוי מגמות|מגמות|השוואה/.test(text)) {
    return setReportConfig(state, { includeTrends: true }, rawText, "נוסף לדוח סעיף ״השוואה לבקרה הקודמת ומגמות״: תחזית כוללת, סעיפים ששונו, נושאים פתוחים, ומגמת התחזית לאורך הבקרות.");
  }
  if (/לפי בניין|פילוח|בניין A|בניין ב/.test(text)) {
    const report = buildReport(pkg, { ...state, control: { ...state.control, reportConfig: { ...state.control.reportConfig, splitByBuilding: true } } });
    return setReportConfig(state, { splitByBuilding: true }, rawText, `טבלת הסעיפים מוצגת עכשיו לפי בניין: A, B, חניון ומשותף. ${report.sections.byBuildingNoteHe ?? ""}`.trim());
  }
  if (/גרסה ל(דנה|מנכ)|עמוד אחד|למנכ/.test(text)) {
    return setReportConfig(state, { ceoVersion: true }, rawText, "נפתחה לשונית ״גרסה למנכ״לית״: סיכום מנהלים, טבלת ההשפעות, נושאים פתוחים ושורת סיכונים אחת. אותם מספרים, אותם מקורות. שתי הגרסאות מקושרות לאותה בקרה; שינוי נתון באחת יתעדכן בשנייה.");
  }
  if (/^שמור/.test(text)) return saveConfig(state, true);
  if (/לא עכשיו/.test(text)) return saveConfig(state, false);
  return answerQuestion(state, rawText);
}

function decideFree(state: V2State, findingId: string, text: string): V2State {
  const decision = state.control.decisions[findingId];
  if (decision?.pending?.kind === "quote") {
    const yes = /כן|הוסף|מתאים|תואם/.test(text);
    return confirmQuote(state, findingId, yes);
  }
  return decide(state, findingId, null, text);
}

export function answerQuestion(state: V2State, rawText: string): V2State {
  const text = normalize(rawText);
  let s = pushUser(state, rawText);
  const report = buildReport(pkg, s);
  const wf = report.working;
  const previous = pkg.forecasts.find((f) => f.controlDate === wf.previousControlDate)!;
  const change = wf.totalEac - wf.previousTotalEac;
  const steel = wf.sections.find((x) => x.sectionId === "03")!;
  const dev = wf.sections.find((x) => x.sectionId === "07")!;
  const label = report.finalized ? "סופית" : "טיוטה";

  if (/(מה השתנה|השתנה|לעומת הקודמת|מהבקרה הקודמת)/.test(text) && !/נסגר|קנינו|אומדן|פיתוח/.test(text)) {
    const priceAdj = s.control.adjustments.filter((a) => a.changeType === "price").reduce((a, x) => a + x.amount, 0);
    const covAdj = s.control.adjustments.filter((a) => a.changeType === "coverage_gap").reduce((a, x) => a + x.amount, 0);
    const parts = [priceAdj ? `${num(priceAdj / 1000)} א׳ בעקבות עדכון מחיר הברזל` : "", covAdj ? `${num(covAdj / 1000)} א׳ בעקבות עבודה שלא נכללה בכיסוי החוזי` : ""].filter(Boolean);
    return pushSystem(s, `משווה בקרה ${dateHe(wf.controlDate)} (${label}) לבקרה ${dateHe(previous.controlDate)}. התחזית ${change === 0 ? "לא השתנתה" : `${change > 0 ? "עלתה" : "ירדה"} ב-${nis(Math.abs(change))}`}${parts.length ? `: ${parts.join(", ")}` : ""}.${s.control.corrections.length ? ` בנוסף תוקנו ${s.control.corrections.length === 2 ? "שני" : num(s.control.corrections.length)} שדות נתונים ללא השפעה על התחזית הכוללת.` : ""}`, { sourcesHe: [`תחזית ${dateHe(previous.controlDate)}`, `בקרה ${dateHe(wf.controlDate)} — סעיף 4א`] });
  }
  if (/קנינו יותר|יותר ברזל|כמות/.test(text)) {
    const line = steel.lines.find((l) => l.kind === "uncovered")!;
    const prevLine = previous.sections!.find((x) => x.sectionId === "03")!.lines.find((l) => l.kind === "uncovered")!;
    const sameQty = (line.qty ?? 0) === (prevLine.qty ?? 0);
    return pushSystem(s, `לא. כמות היתרה ${sameQty ? "לא השתנתה" : "השתנתה"} — ${num(prevLine.qty ?? 0)} טון בשתי הבקרות. העלייה נובעת מהמחיר: ${num(prevLine.qty ?? 0)} × ${num(prevLine.unitPrice ?? 0)} = ${nis(prevLine.amount)} → ${num(line.qty ?? 0)} × ${num(line.unitPrice ?? 0)} = ${nis(line.amount)}. הפרש: ${nis(line.amount - prevLine.amount)}. מקור: נספח מחיר פלדות הצפון, בתוקף מ-15.7.2026.`, { documentId: "appendix_A2_steel_price_2026_07_15", sourcesHe: ["נספח א׳-2", `תחזית ${dateHe(previous.controlDate)} — שורת יתרת ברזל`] });
  }
  if (/נסגרו|נושאים.*קודמת|הבקרה הקודמת.*נסגר/.test(text)) {
    const closed = previous.openIssues.filter((o) => o.status === "closed");
    const stillOpen = previous.openIssues.filter((o) => o.status === "open");
    return pushSystem(s, `נסגרו ${num(closed.length)} מתוך ${num(previous.openIssues.length)}: ${closed.map((o) => `${o.titleHe.split(" (")[0]} (${dateHe(o.closedAt!)})`).join(", ")}. פתוח: ${stillOpen.map((o) => o.titleHe).join(", ")}.`, { sourcesHe: [`תחזית ${dateHe(previous.controlDate)} — נושאים לטיפול`, "יומן שינויים"] });
  }
  if (/אומדן|לא הוזמן|מבוסס על|טרם הוזמן/.test(text)) {
    const u = uncoveredByBasis(wf);
    const items = u.lines.filter((l) => l.amount > 0);
    const total = items.reduce((a, l) => a + l.amount, 0);
    const packages = items.filter((l) => l.basis === "estimate" && ["12", "13", "15", "16"].includes(l.sectionId));
    const steelItem = items.find((l) => l.sectionId === "03");
    const drainageItem = items.find((l) => l.basis === "quote");
    const parts = [packages.length ? `${["12", "13", "15", "16"].filter((id) => packages.some((p) => p.sectionId === id)).length} חבילות שטרם נחתמו (${packages.map((p) => `${p.sectionId}-${SECTION_SHORT_HE[p.sectionId]}`).join(", ")} — ${nis(packages.reduce((a, p) => a + p.amount, 0))})` : "", steelItem ? `יתרת ברזל ${num((steelItem.qty ?? 0) - 12)} טון (${nis(steelItem.amount - (s.control.adjustments.find((a) => a.committedPortion)?.committedPortion?.amount ?? 0))} — 12 טון כבר הוזמנו)` : "", drainageItem ? `קו ניקוז חוץ (${nis(drainageItem.amount)})` : "", ...items.filter((l) => l.sectionId === "01" || l.sectionId === "18").map((l) => `${l.descriptionHe.split(" — ")[0]} (${nis(l.amount)})`)].filter(Boolean);
    return pushSystem(s, `${num(items.length)} פריטים, ${nis(total)}: ${parts.join("; ")}.`, { sourcesHe: ["נספח ז׳ — פירוט יתרה להשלמה לא מכוסה"] });
  }
  if (/פיתוח עלה|למה פיתוח|פיתוח.*יותר/.test(text)) {
    const transferred = s.control.corrections.filter((c) => c.recordType === "invoice" && c.afterHe.startsWith("07")).map((c) => s.erp.invoices.find((i) => String(i.id) === c.recordId)!).filter(Boolean);
    const transfer = transferred.reduce((a, i) => a + i.amount, 0);
    const prevDev = previous.sections!.find((x) => x.sectionId === "07")!;
    const covAdj = s.control.adjustments.filter((a) => a.sectionId === "07").reduce((a, x) => a + x.amount, 0);
    const recordedDelta = dev.recorded - prevDev.recorded;
    const eacDelta = dev.eac - prevDev.eac;
    return pushSystem(s, `פיתוח עלה ב-${nis(eacDelta)} בתחזית הסעיף${transfer ? `, אבל רק ${nis(covAdj)} מזה הם עלות חדשה` : ""}: ${transfer ? `${nis(transfer)} העברת חשבון ${transferred.map((i) => i.id).join(", ")} משלד — לא עלות חדשה, הסה״כ לפרויקט לא השתנה (ה״נרשם״ של פיתוח עלה, יתרת החוזה ירדה באותו סכום); ` : `${nis(recordedDelta)} נרשמו בתקופה מול יתרת החוזה; `}${covAdj ? `${nis(covAdj)} אומדן לקו ניקוז — תוספת אמיתית.` : ""}`, { sourcesHe: ["סעיף 4ב — תיקוני נתונים", "סעיף 4א — שינויים בתחזית"] });
  }
  if (/סטייה|חריגה|מול התקציב/.test(text)) {
    const variance = wf.totalEac - wf.totalBudget;
    return pushSystem(s, `תחזית לגמר ${nis(wf.totalEac)} מול תקציב ${nis(wf.totalBudget)}: ${variance > 0 ? `חריגה של ${nis(variance)}` : "בתוך התקציב"}. סעיפים מעל סף המהותיות: ${report.sections.rows.filter((r) => r.highlighted).map((r) => `${r.sectionId}-${SECTION_SHORT_HE[r.sectionId]} (${r.variance >= 0 ? "+" : "−"}${nis(Math.abs(r.variance))})`).join(", ") || "אין"}.`);
  }
  return pushSystem(s, "בדמו אפשר לשאול על: מה השתנה מהבקרה הקודמת, האם החריגה בברזל נובעת מכמות, אילו נושאים נסגרו, מה עדיין מבוסס על אומדן, ולמה פיתוח עלה. אפשר גם לבקש שינוי בדוח: השוואה לבקרה הקודמת, פילוח לפי בניין, או גרסה למנכ״לית.");
}

export const suggestedQuestionsHe = ["מה השתנה בבקרה האחרונה לעומת הקודמת?", "אז החריגה בברזל נובעת מזה שקנינו יותר?", "אילו נושאים מהבקרה הקודמת כבר נסגרו?", "מה עדיין מבוסס על אומדן ולא על הזמנה?", "למה פיתוח עלה ביותר מ-120 אלף?"];
