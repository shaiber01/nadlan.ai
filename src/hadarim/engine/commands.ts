import { DEMO_DAY, SCRIPT_INVOICE_ID, priceAppendixAt } from "../data/generate";
import type { BuildingTag, HInvoice, PersonId, SectionId } from "../data/types";
import { pkg, setPackage } from "./package";
import { CHECK_STEPS_HE, sectionShort, appendixUnit, carriedIssues, contractWithAppendices, documentById, findQuoteFor, proposedOrderCorrection, quoteFacts, runChecks, sectionLabel, type HFinding } from "./checks";
import { workingForecast } from "./forecast";
import { emptySession, type ChatMessage, type ChatOption, type ControlTask, type DataCorrection, type FindingDecision, type ForecastAdjustment, type RouteId, type Scene1Variant, type V2State } from "./model";

/**
 * Pure commands over V2State. Nothing here touches the DOM; the store applies them and persists.
 * The package (static data) is passed in so commands stay pure and testable.
 */

export { pkg, setPackage, SCRIPT_INVOICE_ID };

/** Who operates the control by default: the project manager if there is one, else the first person of the project. */
export function defaultOperatorId(): PersonId {
  return pkg.people.find((p) => p.roleHe.includes("פרויקט"))?.id ?? pkg.people[0].id;
}

/** The person who handles bookkeeping referrals: the accounting role if there is one, else someone who may write allocations. */
function accountantId(): PersonId {
  return pkg.people.find((p) => p.roleHe.includes("חשבונות"))?.id ?? pkg.people.find((p) => p.canWriteAllocation)?.id ?? pkg.people[0].id;
}

const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const mil = (v: number) => `${(v / 1_000_000).toFixed(2)} מ׳ ₪`;
const num = (v: number) => v.toLocaleString("he-IL");
const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");

function nextId(state: V2State, prefix: string): [V2State, string] {
  const n = (state.counters[prefix] ?? 0) + 1;
  return [{ ...state, counters: { ...state.counters, [prefix]: n } }, `${prefix}-${n}`];
}

function tick(state: V2State, minutes = 1): V2State {
  const [d, t] = state.clock.split("T");
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return { ...state, clock: `${d}T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}` };
}

function push(state: V2State, message: Omit<ChatMessage, "id" | "at">): V2State {
  const [s, id] = nextId(state, "MSG");
  return { ...s, control: { ...s.control, messages: [...s.control.messages, { ...message, id, at: s.clock }] } };
}

function audit(state: V2State, byId: PersonId, textHe: string, recordRef?: { type: "invoice" | "po" | "forecast"; id: string }): V2State {
  const [s, id] = nextId(state, "AUD");
  return { ...s, audit: [...s.audit, { id, at: s.clock, byId, textHe, recordRef }] };
}

/**
 * The offline starting state: the package's ERP rows, no control yet, the project's current control date.
 * Variant B removes the seed's script invoice so it can be keyed in live. The clock is the seed's demo
 * day; connected to the database the session gets the real time.
 */
export function initialState(variant: Scene1Variant = "A"): V2State {
  const invoices = variant === "B" ? pkg.invoices.filter((i) => i.id !== SCRIPT_INVOICE_ID) : pkg.invoices;
  const changeLog = variant === "B" ? pkg.changeLog.filter((c) => !(c.recordType === "invoice" && c.recordId === String(SCRIPT_INVOICE_ID))) : pkg.changeLog;
  const controlDate = pkg.project.currentControlDate;
  return {
    version: 1,
    variant,
    clock: `${DEMO_DAY}T09:00`,
    operatorId: defaultOperatorId(),
    erp: { invoices, purchaseOrders: pkg.purchaseOrders, changeLog },
    // issues carried from the previous control live in the session's task list (the database holds them in the same table)
    control: { ...emptySession(controlDate), tasks: carriedIssues(pkg, controlDate) },
    savedConfig: null,
    audit: [],
    counters: {},
  };
}

// ---------------------------------------------------------------------------
// ERP edits (the presenter's live changes)
// ---------------------------------------------------------------------------

export function updateInvoiceSection(state: V2State, invoiceId: number, sectionId: SectionId, byId: PersonId, noteHe = "שינוי ידני במערכת המידע"): V2State {
  const invoice = state.erp.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`חשבון ${invoiceId} לא נמצא`);
  if (invoice.sectionId === sectionId) return state;
  const person = pkg.people.find((p) => p.id === byId)!;
  if (!person.canWriteAllocation) throw new Error(`${person.nameHe} אינו מורשה לשינוי שיוך`);
  const [s1, logId] = nextId(state, "CL");
  const entry = { id: logId, recordType: "invoice" as const, recordId: String(invoiceId), field: "סעיף תקציבי", before: sectionLabel(invoice.sectionId), after: sectionLabel(sectionId), at: state.clock, byId, noteHe };
  const s2: V2State = { ...s1, erp: { ...s1.erp, invoices: s1.erp.invoices.map((i) => (i.id === invoiceId ? { ...i, sectionId } : i)), changeLog: [...s1.erp.changeLog, entry] } };
  return tick(s2);
}

export interface NewInvoiceInput {
  supplierId: string;
  supplierDocNo: string;
  date: string;
  amount: number;
  descriptionHe: string;
  sectionId: SectionId;
  contractId: string | null;
  attachmentId: string | null;
  byId: PersonId;
}

export function createInvoice(state: V2State, input: NewInvoiceInput): [V2State, HInvoice] {
  if (!(input.amount > 0)) throw new Error("סכום החשבון חייב להיות חיובי");
  // the ERP numbers invoices sequentially
  const id = state.erp.invoices.reduce((max, i) => Math.max(max, i.id), 0) + 1;
  const contract = input.contractId ? pkg.contracts.find((c) => c.id === input.contractId) : undefined;
  const prev = contract ? state.erp.invoices.filter((i) => i.contractId === contract.id && i.status !== "בבדיקה").reduce((a, i) => Math.max(a, i.cumulativeNow ?? 0), 0) : null;
  const retentionPct = contract?.retentionPct ?? 0;
  const retentionAmt = Math.round((input.amount * retentionPct) / 100);
  const invoice: HInvoice = {
    id,
    supplierId: input.supplierId,
    supplierDocNo: input.supplierDocNo,
    docType: contract ? "חשבון חלקי" : "חשבונית מס",
    partialNo: contract ? state.erp.invoices.filter((i) => i.contractId === contract.id).length + 1 : null,
    period: input.date.slice(0, 7),
    date: input.date,
    dateReceived: input.date,
    enteredAt: state.clock.slice(0, 10),
    enteredBy: input.byId,
    sectionId: input.sectionId,
    contractId: input.contractId,
    poId: null,
    descriptionHe: input.descriptionHe,
    amount: input.amount,
    cumulativePrev: prev,
    cumulativeNow: prev == null ? null : prev + input.amount,
    retentionPct,
    retentionAmt,
    netPayable: input.amount - retentionAmt,
    building: null,
    status: "אושר",
    approvedBy: input.byId,
    attachmentId: input.attachmentId,
    quantity: null,
    unit: null,
    unitPrice: null,
  };
  const [s1, logId] = nextId(state, "CL");
  const entry = { id: logId, recordType: "invoice" as const, recordId: String(id), field: "קליטה", before: "—", after: `חשבון נקלט · סעיף תקציבי ${sectionLabel(input.sectionId)}`, at: state.clock, byId: input.byId, noteHe: "הזנה במערכת המידע" };
  return [tick({ ...s1, erp: { ...s1.erp, invoices: [...s1.erp.invoices, invoice], changeLog: [...s1.erp.changeLog, entry] } }), invoice];
}

/** Scene 7, change 2: the "[שנה]" affordance on the building-split note — tags an invoice with a building. */
export function updateInvoiceBuilding(state: V2State, invoiceId: number, building: BuildingTag | null, byId: PersonId): V2State {
  const invoice = state.erp.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`חשבון ${invoiceId} לא נמצא`);
  if (invoice.building === building) return state;
  const [s1, logId] = nextId(state, "CL");
  const entry = { id: logId, recordType: "invoice" as const, recordId: String(invoiceId), field: "בניין", before: invoice.building ?? "—", after: building ?? "—", at: state.clock, byId, noteHe: "פילוח לפי בניין בדוח הבקרה" };
  const s2: V2State = { ...s1, erp: { ...s1.erp, invoices: s1.erp.invoices.map((i) => (i.id === invoiceId ? { ...i, building } : i)), changeLog: [...s1.erp.changeLog, entry] } };
  return tick(audit(s2, byId, `חשבון ${invoiceId}: בניין ${entry.before} → ${entry.after} (פילוח הדוח)`, { type: "invoice", id: String(invoiceId) }));
}

export function updatePurchaseOrder(state: V2State, poId: number, patch: { qty?: number; unit?: string; unitPrice?: number }, byId: PersonId, noteHe = "תיקון במערכת המידע"): V2State {
  const po = state.erp.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new Error(`הזמנה ${poId} לא נמצאה`);
  const next = { ...po, ...patch };
  if (Math.round(next.qty * next.unitPrice) !== po.amount) throw new Error(`הסכום חייב להישאר ${nis(po.amount)}: כמות × מחיר יחידה אינם תואמים`);
  const [s1, logId] = nextId(state, "CL");
  const entry = { id: logId, recordType: "po" as const, recordId: String(poId), field: "כמות / יחידה / מחיר יח׳", before: `${num(po.qty)} ${po.unit} × ${po.unitPrice}`, after: `${num(next.qty)} ${next.unit} × ${num(next.unitPrice)}`, at: state.clock, byId, noteHe };
  return tick({ ...s1, erp: { ...s1.erp, purchaseOrders: s1.erp.purchaseOrders.map((p) => (p.id === poId ? next : p)), changeLog: [...s1.erp.changeLog, entry] } });
}

// ---------------------------------------------------------------------------
// The control conversation
// ---------------------------------------------------------------------------

export function controlSteps(state: V2State): { textHe: string; done: boolean; spinner?: boolean }[] {
  const invoices = state.erp.invoices.filter((i) => i.status !== "בבדיקה");
  const recorded = invoices.reduce((a, i) => a + i.amount, 0);
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.controlDate < state.control.controlDate).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0];
  const newSince = invoices.filter((i) => i.dateReceived >= previous.controlDate).length;
  return [
    { textHe: `תקציב מאושר — ${(pkg.project.budgetVersion.amount / 1_000_000).toFixed(1)} מ׳ ₪ (גרסה ${pkg.project.budgetVersion.number}, אושרה ${dateHe(pkg.project.budgetVersion.approvedAt)})`, done: true },
    { textHe: `בקרה קודמת — ${dateHe(previous.controlDate)}, תחזית ${(previous.totalEac / 1_000_000).toFixed(1)} מ׳ ₪`, done: true },
    { textHe: `חשבונות ספקים — ${num(state.erp.invoices.length)} חשבונות, ${(recorded / 1_000_000).toFixed(1)} מ׳ ₪ (${num(newSince)} חדשים מאז הבקרה הקודמת)`, done: true },
    { textHe: `הזמנות רכש פתוחות — ${num(state.erp.purchaseOrders.filter((p) => p.status === "פתוחה").length)}`, done: true },
    { textHe: `חוזי קבלני משנה — ${num(pkg.contracts.length)}`, done: true },
    { textHe: `כתב כמויות עדכני — גרסה ${pkg.project.boqVersion.number} (${dateHe(pkg.project.boqVersion.date)})`, done: true },
    { textHe: `בדיקות: ${CHECK_STEPS_HE.join(" · ")}`, done: true, spinner: true },
  ];
}

/** Scene 2: the operator asks for the control; checks run on the live ERP data. */
export function startControl(state: V2State, requestTextHe: string): V2State {
  let s = push(state, { role: "user", kind: "text", textHe: requestTextHe });
  const draft = pkg.forecasts.find((f) => f.controlDate === s.control.controlDate)!;
  const result = runChecks(pkg, s.erp, draft, s.control.controlDate);
  const liveChanged = result.findings.filter((f) => s.erp.changeLog.some((c) => c.recordId === f.record.id && c.at.startsWith(s.clock.slice(0, 10))));
  s = { ...s, control: { ...s.control, status: "running", requestedAt: s.clock, findings: result.findings, positives: result.positives, checkedHe: result.checkedHe, stepsRevealed: 0 } };
  s = push(s, { role: "system", kind: "steps", textHe: `מכין בקרה תקציבית ל${pkg.project.nameHe}`, steps: controlSteps(s).map((st) => ({ ...st, done: false })) });
  const summary = `סיימתי. נמצאו ${num(result.findings.length)} ממצאים שדורשים החלטה שלך לפני שאסגור את התחזית.${liveChanged.length ? ` ${liveChanged.length === 1 ? "אחד מהם ברשומה ששונתה היום." : `${num(liveChanged.length)} מהם ברשומות ששונו היום.`}` : ""}`;
  s = push(s, { role: "system", kind: "text", textHe: summary, options: [{ id: "review", labelHe: "נעבור על הממצאים", action: { type: "review_findings" } }] });
  return tick(s, 1);
}

export function revealNextStep(state: V2State): V2State {
  const idx = state.control.messages.findIndex((m) => m.kind === "steps");
  if (idx < 0) return state;
  const message = state.control.messages[idx];
  const steps = message.steps ?? [];
  const firstUndone = steps.findIndex((st) => !st.done);
  if (firstUndone < 0) return state;
  const nextSteps = steps.map((st, i) => (i === firstUndone ? { ...st, done: true } : st));
  const messages = state.control.messages.map((m, i) => (i === idx ? { ...m, steps: nextSteps } : m));
  const allDone = nextSteps.every((st) => st.done);
  return { ...state, control: { ...state.control, messages, stepsRevealed: firstUndone + 1, status: allDone ? "reviewing" : state.control.status } };
}

export function revealAllSteps(state: V2State): V2State {
  let s = state;
  for (let i = 0; i < 12; i += 1) s = revealNextStep(s);
  return s;
}

function findingMessage(f: HFinding): Omit<ChatMessage, "id" | "at"> {
  return {
    role: "system",
    kind: "finding",
    textHe: f.titleHe,
    findingId: f.id,
    options: f.decision.options.map((o) => ({ id: o.id, labelHe: o.labelHe, action: { type: "decide", findingId: f.id, choiceId: o.id } })),
  };
}

/** "נעבור על הממצאים": the first open finding card enters the conversation. */
export function reviewFindings(state: V2State): V2State {
  const next = state.control.findings.find((f) => !state.control.decisions[f.id] || state.control.decisions[f.id].status === "open");
  if (!next) return state;
  if (state.control.messages.some((m) => m.kind === "finding" && m.findingId === next.id)) return state;
  return push({ ...state, control: { ...state.control, status: "reviewing" } }, findingMessage(next));
}

function setDecision(state: V2State, findingId: string, patch: Partial<FindingDecision>): V2State {
  const current = state.control.decisions[findingId] ?? { findingId, status: "open" as const };
  return { ...state, control: { ...state.control, decisions: { ...state.control.decisions, [findingId]: { ...current, ...patch } } } };
}

function finding(state: V2State, findingId: string): HFinding {
  const f = state.control.findings.find((x) => x.id === findingId);
  if (!f) throw new Error("ממצא לא נמצא");
  return f;
}

/** A decision button or free text on a finding card. */
export function decide(state: V2State, findingId: string, choiceId: string | null, freeTextHe?: string): V2State {
  const f = finding(state, findingId);
  let s = push(state, { role: "user", kind: "text", textHe: freeTextHe ?? f.decision.options.find((o) => o.id === choiceId)?.labelHe ?? "" });
  s = setDecision(s, findingId, { choiceId: choiceId ?? undefined, freeTextHe });
  switch (f.kind) {
    case "allocation":
      return decideAllocation(s, f, choiceId, freeTextHe);
    case "unit":
      return decideUnit(s, f, choiceId);
    case "price":
      return decidePrice(s, f, choiceId);
    case "coverage":
      return decideCoverage(s, f, choiceId, freeTextHe);
  }
}

function decideAllocation(state: V2State, f: HFinding, choiceId: string | null, freeTextHe?: string): V2State {
  const invoice = state.erp.invoices.find((i) => i.id === Number(f.record.id))!;
  const contract = pkg.contracts.find((c) => c.id === invoice.contractId)!;
  const yes = choiceId === "yes_target" || (!!freeTextHe && /כן|לפיתוח|שייך/.test(freeTextHe));
  if (choiceId === "no_stay") {
    let s = setDecision(state, f.id, { status: "handled", routeId: undefined, auditHe: `השיוך נשאר ${sectionLabel(invoice.sectionId)} לפי החלטת ${pkg.people.find((p) => p.id === state.operatorId)?.nameHe}`, resolvedAt: state.clock });
    s = push(s, { role: "system", kind: "text", textHe: `הבנתי. החשבון נשאר ב-${sectionLabel(invoice.sectionId)}. ההחלטה נרשמה בדוח כהערה, כי היא סותרת את החוזה ${contract.id} ואת היסטוריית הספק.` });
    return nextFinding(s);
  }
  if (!yes) {
    let s = setDecision(state, f.id, { status: "referred", ownerId: accountantId(), auditHe: "הועבר לבירור" });
    s = push(s, { role: "system", kind: "text", textHe: `נרשם כ״לא בטוח״. הממצא יישאר פתוח ויועבר להנהלת חשבונות לבירור; הדוח יציג את ${nis(invoice.amount)} כ״בבירור״ בין ${sectionLabel(invoice.sectionId)} ל-${sectionLabel(contract.sectionId)}.` });
    return nextFinding(s);
  }
  let s = setDecision(state, f.id, { pending: { kind: "route" } });
  s = push(s, {
    role: "system",
    kind: "text",
    textHe: `לעדכן את השיוך במערכת המידע? (חשבון ${invoice.id}: ${sectionLabel(invoice.sectionId)} → ${sectionLabel(contract.sectionId)})`,
    options: [
      { id: "update", labelHe: "עדכן", action: { type: "route", findingId: f.id, routeId: "update" } },
      { id: "refer_accounting", labelHe: "העבר להנהלת חשבונות", action: { type: "route", findingId: f.id, routeId: "refer_accounting" } },
      { id: "forecast_only", labelHe: "רק בתחזית", action: { type: "route", findingId: f.id, routeId: "forecast_only" } },
    ],
  });
  return s;
}

/** The person who executes order corrections on site (VP execution if there is one, else the operator). */
function executionOwnerId(state: V2State): PersonId {
  return pkg.people.find((p) => p.roleHe.includes("ביצוע"))?.id ?? state.operatorId;
}

function personName(id: PersonId | undefined): string {
  return pkg.people.find((p) => p.id === id)?.nameHe ?? id ?? "";
}

function decideUnit(state: V2State, f: HFinding, choiceId: string | null): V2State {
  const po = state.erp.purchaseOrders.find((p) => p.id === Number(f.record.id))!;
  const proposed = proposedOrderCorrection(pkg, po);
  if (choiceId === "open_quote") {
    if (!proposed.documentId) {
      let s = setDecision(state, f.id, { status: "referred", ownerId: state.operatorId, auditHe: "אין הצעה מצורפת — לבדוק מול הספק" });
      s = push(s, { role: "system", kind: "text", textHe: `להזמנה ${po.id} אין הצעה מצורפת. הממצא נשאר פתוח עד לבירור מול הספק; בתחזית הכמות אינה נספרת פעמיים.` });
      return nextFinding(s);
    }
    return push(state, { role: "system", kind: "text", textHe: "פותח את ההצעה המצורפת.", documentId: proposed.documentId, options: [{ id: "doc", labelHe: "פתח PDF", action: { type: "open_document", documentId: proposed.documentId } }, { id: "yes", labelHe: `כן, ${num(proposed.qty)} ${proposed.unit}`, action: { type: "decide", findingId: f.id, choiceId: "yes_tons" } }] });
  }
  const executor = executionOwnerId(state);
  let s = setDecision(state, f.id, { pending: { kind: "route" } });
  s = push(s, {
    role: "system",
    kind: "text",
    textHe: `לתקן בהזמנה ${po.id}: כמות ${num(proposed.qty)} · יחידה ${proposed.unit} · מחיר יח׳ ${num(proposed.unitPrice)} ₪ (הסכום ${nis(po.amount)} נשאר)?`,
    options: [
      { id: "update", labelHe: "עדכן", action: { type: "route", findingId: f.id, routeId: "update" } },
      { id: "refer_roi", labelHe: `העבר ל${personName(executor)} לביצוע`, action: { type: "route", findingId: f.id, routeId: "refer_roi" } },
    ],
  });
  return s;
}

/** Quantity an open order really covers: the attached quote's quantity when there is one, else the order's field. */
function orderQuantity(po: V2State["erp"]["purchaseOrders"][number]): number {
  return quoteFacts(documentById(pkg, po.attachmentId))?.qty ?? po.qty;
}

function decidePrice(state: V2State, f: HFinding, choiceId: string | null): V2State {
  const draft = pkg.forecasts.find((x) => x.controlDate === state.control.controlDate)!;
  const line = draft.sections!.flatMap((sec) => sec.lines).find((l) => l.id === f.record.id)!;
  const contract = contractWithAppendices(pkg, f.sectionId)!;
  const appendix = priceAppendixAt(contract, state.control.controlDate)!;
  const unit = appendixUnit(appendix);
  const short = sectionShort(f.sectionId);
  const qty = line.qty ?? 0;
  if (choiceId === "partial") {
    let s = setDecision(state, f.id, { status: "referred", ownerId: state.operatorId, auditHe: "נדרש פירוט הכמות במחיר הישן" });
    s = push(s, { role: "system", kind: "text", textHe: `כדי לחשב, אני צריכה לדעת כמה ${unit} מכוסים בהזמנות במחיר הישן. ${[f.checkHe, ...(f.notesHe ?? [])].filter(Boolean).join(" ")} אפשר לכתוב את הכמות, או לאשר שהמחיר החדש חל על כל ${num(qty)} ה${unit}.`, options: [{ id: "all", labelHe: `כן, על כל ${num(qty)} ה${unit}`, action: { type: "decide", findingId: f.id, choiceId: "all" } }] });
    return s;
  }
  const newAmount = qty * appendix.pricePerTon;
  const impact = newAmount - line.amount;
  // open orders on the framework agreement are already commitments: that part of the remainder is not an estimate any more
  const openOrders = state.erp.purchaseOrders.filter((p) => p.contractId === contract.id && p.status === "פתוחה");
  const orderedQty = openOrders.reduce((a, p) => a + orderQuantity(p), 0);
  const committedPortion = openOrders.length ? { poId: openOrders[0].id, poIds: openOrders.map((p) => p.id), qty: orderedQty, amount: openOrders.reduce((a, p) => a + p.amount, 0) } : undefined;
  const adjustment: ForecastAdjustment = {
    id: `ADJ-${f.id}`,
    sectionId: f.sectionId,
    changeType: "price",
    descriptionHe: `${line.descriptionHe.split(" — ")[0]} — ${num(qty)} ${unit} × ${num(appendix.pricePerTon)} ₪ (נספח ${appendix.id})`,
    basisHe: `נספח מחיר ${appendix.id} בתוקף מ-${dateHe(appendix.validFrom)}`,
    basis: "appendix",
    sourceRef: `נספח ${appendix.id} — ${num(appendix.pricePerTon)} ₪/${unit}`,
    documentId: appendix.documentId,
    amount: impact,
    findingId: f.id,
    qty,
    unit,
    unitPrice: appendix.pricePerTon,
    replacesLineId: line.id,
    committedPortion,
  };
  let s: V2State = { ...state, control: { ...state.control, adjustments: [...state.control.adjustments.filter((a) => a.id !== adjustment.id), adjustment] } };
  s = setDecision(s, f.id, { status: "handled", resolvedAt: s.clock, auditHe: `אושר: המחיר ${num(appendix.pricePerTon)} ₪/${unit} חל על כל ${num(qty)} ה${unit} · תוספת ${nis(impact)}` });
  const wf = workingForecast(pkg, s.erp, s.control.adjustments, s.control.controlDate);
  const section = wf.sections.find((x) => x.sectionId === f.sectionId)!;
  const rec = section.recorded;
  s = push(s, { role: "system", kind: "text", textHe: `תחזית סעיף ${short}: ${nis(rec)} + ${nis(newAmount)} = ${nis(rec + newAmount)} · תוספת ${nis(impact)} · חריגה של ${Math.round(((rec + newAmount - section.budget) / section.budget) * 100)}% מתקציב הסעיף.${committedPortion ? ` הזמנת ${num(committedPortion.qty)} ה${unit} כלולה בתוך ${num(qty)} ה${unit}.` : ""}` });
  s = push(s, { role: "system", kind: "log", textHe: `תחזית בכותרת: ${mil(wf.previousTotalEac)} → ${mil(wf.totalEac)}` });
  s = audit(s, s.operatorId, `תחזית ${short}: מחיר יתרה ${num(line.unitPrice ?? 0)} → ${num(appendix.pricePerTon)} ₪/${unit} · +${nis(impact)} · מקור נספח ${appendix.id}`, { type: "forecast", id: line.id });
  return nextFinding(tick(s));
}

/** Short name of a BOQ line for prose (up to the first comma). */
function boqItem(f: HFinding): string {
  const boq = pkg.boq.find((l) => l.id === f.record.id);
  return boq ? boq.descriptionHe.split(",")[0] : f.titleHe.split(" — ")[0];
}

function supplierNameOf(doc: { supplierId: string | null; titleHe: string } | undefined): string {
  return (doc?.supplierId && pkg.suppliers.find((s) => s.id === doc.supplierId)?.nameHe) || doc?.titleHe.split(" — ")[1] || "הספק";
}

function decideCoverage(state: V2State, f: HFinding, choiceId: string | null, freeTextHe?: string): V2State {
  const boq = pkg.boq.find((l) => l.id === f.record.id)!;
  const item = boqItem(f);
  if (choiceId === "other_contract") {
    const covering = pkg.contracts.filter((c) => c.inclusionsHe.some((t) => item.split(" ").filter((w) => w.length >= 4).some((w) => t.includes(w))));
    let s = setDecision(state, f.id, { status: "referred", ownerId: state.operatorId, auditHe: covering.length ? `נטען כיסוי בחוזה אחר — לבדוק מול ${covering.map((c) => c.id).join(", ")}` : "נטען כיסוי בחוזה אחר — לא נמצא חוזה תואם" });
    s = push(s, { role: "system", kind: "text", textHe: covering.length ? `בדקתי את ${num(pkg.contracts.length)} החוזים: ${covering.map((c) => `חוזה ${c.id}`).join(", ")} מזכיר תכולה דומה — נדרש אישור שהעבודה כלולה בו. עד אז הממצא נשאר פתוח.` : `בדקתי את ${num(pkg.contracts.length)} החוזים: אף אחד מהם אינו כולל ״${item}״. הממצא נשאר פתוח עד שיצורף חוזה או הזמנה. בדוח יופיע כפער כיסוי לא מוערך.` });
    return nextFinding(s);
  }
  if (choiceId === "self") {
    let s = setDecision(state, f.id, { status: "handled", auditHe: "ביצוע עצמי — נדרש אומדן פנימי", resolvedAt: state.clock });
    s = push(s, { role: "system", kind: "text", textHe: "נרשם: ביצוע עצמי. כדי שהתחזית לא תישאר ללא בסיס, אוסיף שורת ״יתרה לא מכוסה — אומדן פנימי״ עם סימון שהסכום טרם נקבע. אפשר לכתוב סכום כשיהיה." });
    return nextFinding(s);
  }
  const wantsOrder = choiceId === "order" || (!!freeTextHe && /להזמין|הזמנה|הצעה/.test(freeTextHe));
  if (!wantsOrder) return push(state, { role: "system", kind: "text", textHe: `לא הבנתי את ההחלטה. אפשר לבחור באחד הכפתורים או לכתוב מה לעשות עם ${item}.` });
  const searched = !!freeTextHe && /תיקיי|הצעה/.test(freeTextHe);
  const terms = [...new Set([item.split(" ").filter((w) => w.length >= 4)[0] ?? item, ...(boq.descriptionHe.match(/Ø\S+/g) ?? []), `${num(boq.qty)} ${boq.unit}`])];
  const doc = findQuoteFor(pkg, boq);
  const facts = quoteFacts(doc);
  if (!doc || !facts || facts.amount == null) {
    const [s1, taskId] = nextId(state, "TASK");
    let s = push(s1, { role: "system", kind: "steps", textHe: "מחפש בתיקיית הפרויקט", steps: [{ textHe: `מחפש בתיקיית הפרויקט: ${terms.map((t) => `״${t}״`).join(" · ")}`, done: true }, { textHe: "לא נמצאה הצעת מחיר תואמת", done: true }] });
    const task: ControlTask = { id: taskId, titleHe: `הצעת מחיר — ${item}`, sectionId: f.sectionId, ownerId: s.operatorId, dueDate: null, openedInControl: s.control.controlDate, status: "open", closedAt: null, findingId: f.id, impactIfIgnoredHe: "העבודה נשארת ללא אומדן בתחזית" };
    s = { ...s, control: { ...s.control, tasks: [...s.control.tasks, task] } };
    s = setDecision(s, f.id, { status: "referred", ownerId: s.operatorId, auditHe: "נדרשת הצעת מחיר — לא נמצאה בתיקיית הפרויקט" });
    s = push(s, { role: "system", kind: "text", textHe: `לא נמצאה הצעת מחיר ל${item} בתיקיית הפרויקט. נפתח נושא לטיפול: ״${task.titleHe}״ · אחראי: ${personName(s.operatorId)}. עד אז הפער יופיע בדוח כפער כיסוי לא מוערך.` });
    return nextFinding(s);
  }
  const unitHe = facts.unit ?? boq.unit;
  const descriptionHe = facts.qty != null && facts.unitPrice != null ? `${item} · ${num(facts.qty)} ${unitHe} × ${num(facts.unitPrice)} ₪/${unitHe}` : `${item} · ${nis(facts.amount)}`;
  const scopeMatches = facts.qty == null || (facts.qty === boq.qty && (!facts.unit || facts.unit === boq.unit));
  let s = push(state, { role: "system", kind: "steps", textHe: "מחפש בתיקיית הפרויקט", steps: [{ textHe: `מחפש בתיקיית הפרויקט: ${terms.map((t) => `״${t}״`).join(" · ")}`, done: true }, { textHe: `נמצא: ${doc.titleHe} — ${dateHe(doc.date)}`, done: true }] });
  s = setDecision(s, f.id, { pending: { kind: "quote", documentId: doc.id, amount: facts.amount, validUntil: facts.validUntil ?? "", descriptionHe } });
  s = push(s, {
    role: "system",
    kind: "text",
    textHe: `הצעה: ${descriptionHe} = ${nis(facts.amount)}${facts.validUntil ? ` · בתוקף עד ${dateHe(facts.validUntil)}` : ""}. ${scopeMatches ? `ההיקף תואם לכתב הכמויות (${num(boq.qty)} ${boq.unit}).` : `שימו לב: ההיקף בהצעה (${num(facts.qty ?? 0)} ${unitHe}) שונה מכתב הכמויות (${num(boq.qty)} ${boq.unit}).`}${searched ? "" : " (ההצעה אותרה בתיקיית הפרויקט.)"}`,
    documentId: doc.id,
    options: [
      { id: "doc", labelHe: "פתח PDF", action: { type: "open_document", documentId: doc.id } },
      { id: "accept", labelHe: "כן, הוסף לתחזית כאומדן", action: { type: "confirm_quote", findingId: f.id, accept: true } },
      { id: "reject", labelHe: "לא — היקף שונה", action: { type: "confirm_quote", findingId: f.id, accept: false } },
    ],
  });
  return s;
}

export function confirmQuote(state: V2State, findingId: string, accept: boolean): V2State {
  const f = finding(state, findingId);
  const decision = state.control.decisions[findingId];
  if (!decision?.pending || decision.pending.kind !== "quote") return state;
  const quote = decision.pending;
  let s = push(state, { role: "user", kind: "text", textHe: accept ? "כן, הוסף לתחזית כאומדן" : "לא — היקף שונה" });
  if (!accept) {
    s = setDecision(s, findingId, { pending: undefined, status: "referred", ownerId: s.operatorId, auditHe: "ההצעה אינה תואמת להיקף — נדרשת הצעה מעודכנת" });
    s = push(s, { role: "system", kind: "text", textHe: "נרשם. ההצעה לא נכנסת לתחזית. הממצא נשאר פתוח עם משימה: לקבל הצעה מעודכנת להיקף הנכון." });
    return nextFinding(s);
  }
  const doc = documentById(pkg, quote.documentId);
  const facts = quoteFacts(doc);
  const supplierHe = supplierNameOf(doc);
  const item = boqItem(f);
  const validUntil = quote.validUntil || null;
  const adjustment: ForecastAdjustment = {
    id: `ADJ-${findingId}`,
    sectionId: f.sectionId,
    changeType: "coverage_gap",
    descriptionHe: `${item} — ${facts?.qty != null ? `${num(facts.qty)} ${facts.unit ?? ""}`.trim() : nis(quote.amount)} (אומדן לפי הצעת ${supplierHe}, טרם הוזמן)`,
    basisHe: `הצעת מחיר ${supplierHe}${doc ? ` ${dateHe(doc.date)}` : ""}${validUntil ? `, בתוקף עד ${dateHe(validUntil)}` : ""}`,
    basis: "quote",
    sourceRef: `הצעת ${supplierHe} ${quote.documentId} · ${f.record.id}`,
    documentId: quote.documentId,
    amount: quote.amount,
    findingId,
    ...(facts?.qty != null ? { qty: facts.qty } : {}),
    ...(facts?.unit ? { unit: facts.unit } : {}),
    ...(facts?.unitPrice != null ? { unitPrice: facts.unitPrice } : {}),
  };
  const [s2, taskId] = nextId(s, "TASK");
  const task: ControlTask = { id: taskId, titleHe: `הסדרת הזמנה — ${item}`, sectionId: f.sectionId, ownerId: s.operatorId, dueDate: validUntil, openedInControl: s.control.controlDate, status: "open", closedAt: null, findingId, impactIfIgnoredHe: validUntil ? "פקיעת ההצעה ותמחור מחדש" : "העבודה נשארת אומדן ללא הזמנה" };
  s = { ...s2, control: { ...s2.control, adjustments: [...s2.control.adjustments.filter((a) => a.id !== adjustment.id), adjustment], tasks: [...s2.control.tasks, task] } };
  s = setDecision(s, findingId, { pending: undefined, status: "handled", resolvedAt: s.clock, auditHe: `נוסף לתחזית כאומדן ${nis(quote.amount)} לפי הצעת ${supplierHe}; משימת הזמנה ל${personName(s.operatorId)}${validUntil ? ` עד ${dateHe(validUntil)}` : ""}` });
  const wf = workingForecast(pkg, s.erp, s.control.adjustments, s.control.controlDate);
  s = push(s, { role: "system", kind: "text", textHe: `נוסף לתחזית: ${nis(quote.amount)} · אומדן · טרם הוזמן. לא מוצג כהתחייבות. נפתח נושא לטיפול: ״${task.titleHe}״ · אחראי: ${personName(s.operatorId)}${validUntil ? ` · יעד: לפני פקיעת ההצעה (${dateHe(validUntil)})` : ""}.` });
  s = push(s, { role: "system", kind: "log", textHe: `תחזית בכותרת: ${mil(wf.totalEac)}` });
  s = audit(s, s.operatorId, `תחזית ${sectionShort(f.sectionId)}: נוסף אומדן ${nis(quote.amount)} ל${item} לפי הצעת ${supplierHe}`, { type: "forecast", id: f.record.id });
  return nextFinding(tick(s));
}

/** Route an approved correction: write to the ERP with permission check and re-read verification, or refer it. */
export function route(state: V2State, findingId: string, routeId: RouteId): V2State {
  const f = finding(state, findingId);
  const operator = pkg.people.find((p) => p.id === state.operatorId)!;
  const executor = executionOwnerId(state);
  const accountant = pkg.people.find((p) => p.roleHe.includes("חשבונות") || p.canWriteAllocation)?.id ?? state.operatorId;
  let s = push(state, { role: "user", kind: "text", textHe: { update: "עדכן", refer_accounting: "העבר להנהלת חשבונות", forecast_only: "רק בתחזית", refer_roi: `העבר ל${personName(executor)} לביצוע` }[routeId] });
  if (f.kind === "allocation") {
    const invoice = s.erp.invoices.find((i) => i.id === Number(f.record.id))!;
    const contract = pkg.contracts.find((c) => c.id === invoice.contractId)!;
    const before = sectionLabel(invoice.sectionId);
    const after = sectionLabel(contract.sectionId);
    if (routeId === "update") {
      if (!operator.canWriteAllocation) {
        s = push(s, { role: "system", kind: "text", textHe: `⟳ בודק הרשאה — ${operator.nameHe}, ${operator.roleHe}, אינו מורשה לשינוי שיוך. מעביר להנהלת חשבונות.` });
        return route(s, findingId, "refer_accounting");
      }
      s = updateInvoiceSection(s, invoice.id, contract.sectionId, s.operatorId, `אישור ממצא ${f.id} בבקרה ${dateHe(s.control.controlDate)}`);
      const verified = s.erp.invoices.find((i) => i.id === invoice.id)!.sectionId === contract.sectionId;
      const [s2, corrId] = nextId(s, "COR");
      const correction: DataCorrection = { id: corrId, recordType: "invoice", recordId: String(invoice.id), fieldHe: "סעיף תקציבי", beforeHe: before, afterHe: after, approvedById: s.operatorId, crossSectionHe: `${sectionLabel(invoice.sectionId)} −${nis(invoice.amount)} · ${after} +${nis(invoice.amount)}`, findingId, at: s.clock, status: "applied" };
      s = { ...s2, control: { ...s2.control, corrections: [...s2.control.corrections, correction] } };
      s = setDecision(s, findingId, { pending: undefined, status: "handled", routeId, resolvedAt: s.clock, auditHe: `חשבון ${invoice.id} · לפני: ${before} · אחרי: ${after} · אישר: ${operator.nameHe} · ${dateHe(s.clock)} ${s.clock.slice(11, 16)}`, verifiedHe: verified ? `חשבון ${invoice.id} נקרא מחדש — סעיף = ${after}` : "האימות נכשל" });
      s = push(s, { role: "system", kind: "steps", textHe: "מעדכן במערכת המידע", steps: [{ textHe: `בודק הרשאה — ${operator.nameHe}, ${operator.roleHe}, מורשה לשינוי שיוך בפרויקט ${pkg.project.nameHe}`, done: true }, { textHe: "מעדכן במערכת המידע...", done: true }, { textHe: `בוצע. אימות: חשבון ${invoice.id} נקרא מחדש — סעיף = ${after}`, done: true }] });
      s = push(s, { role: "system", kind: "log", textHe: `תיעוד: חשבון ${invoice.id} · לפני: ${before} · אחרי: ${after} · אישר: ${operator.nameHe} · ${dateHe(s.clock)} ${s.clock.slice(11, 16)}` });
      s = audit(s, s.operatorId, `חשבון ${invoice.id}: שיוך ${before} → ${after} (ממצא ${f.id}); אימות בקריאה חוזרת`, { type: "invoice", id: String(invoice.id) });
      return nextFinding(tick(s));
    }
    if (routeId === "refer_accounting") {
      const [s2, taskId] = nextId(s, "TASK");
      s = { ...s2, control: { ...s2.control, tasks: [...s2.control.tasks, { id: taskId, titleHe: `תיקון שיוך חשבון ${invoice.id} (${before} → ${after})`, sectionId: contract.sectionId, ownerId: accountant, dueDate: null, openedInControl: s.control.controlDate, status: "pending_execution", closedAt: null, findingId }] } };
      s = setDecision(s, findingId, { pending: undefined, status: "pending_execution", routeId, ownerId: accountant, auditHe: `הועבר ל${personName(accountant)} לביצוע: ${before} → ${after}` });
      s = push(s, { role: "system", kind: "text", textHe: `נשלח ל${personName(accountant)}. הממצא יישאר ״ממתין לביצוע״ עד שהתיקון יאומת במערכת המידע. בדוח: החשבון יוצג ב-${after} עם הערה שהתיקון במקור ממתין.` });
      return nextFinding(s);
    }
    // forecast_only
    const [s2, corrId] = nextId(s, "COR");
    s = { ...s2, control: { ...s2.control, corrections: [...s2.control.corrections, { id: corrId, recordType: "invoice", recordId: String(invoice.id), fieldHe: "סעיף תקציבי (בתחזית בלבד)", beforeHe: before, afterHe: after, approvedById: s.operatorId, crossSectionHe: `${before} −${nis(invoice.amount)} · ${after} +${nis(invoice.amount)} — במערכת המידע ללא שינוי`, findingId, at: s.clock, status: "pending_execution" }] } };
    s = setDecision(s, findingId, { pending: undefined, status: "forecast_only", routeId, auditHe: `תוקן בתחזית בלבד; מערכת המידע ללא שינוי` });
    s = push(s, { role: "system", kind: "text", textHe: `נרשם בתחזית בלבד. שימו לב: מערכת המידע תמשיך להציג את החשבון ב-${before}, והפער יחזור בבקרה הבאה אם לא יתוקן במקור.` });
    return nextFinding(s);
  }
  if (f.kind === "unit") {
    const po = s.erp.purchaseOrders.find((p) => p.id === Number(f.record.id))!;
    const proposed = proposedOrderCorrection(pkg, po);
    const before = `${num(po.qty)} ${po.unit} × ${po.unitPrice}`;
    const after = `${num(proposed.qty)} ${proposed.unit} × ${num(proposed.unitPrice)} ₪`;
    if (routeId === "update") {
      s = updatePurchaseOrder(s, po.id, { qty: proposed.qty, unit: proposed.unit, unitPrice: proposed.unitPrice }, s.operatorId, `אישור ממצא ${f.id}`);
      const [s2, corrId] = nextId(s, "COR");
      s = { ...s2, control: { ...s2.control, corrections: [...s2.control.corrections, { id: corrId, recordType: "po", recordId: String(po.id), fieldHe: "כמות / יחידה / מחיר יח׳", beforeHe: before, afterHe: after, approvedById: s.operatorId, crossSectionHe: "ללא השפעה בין סעיפים", findingId, at: s.clock, status: "applied" }] } };
      s = setDecision(s, findingId, { pending: undefined, status: "handled", routeId, resolvedAt: s.clock, auditHe: `הזמנה ${po.id} · לפני: ${before} · אחרי: ${after} · אישר: ${operator.nameHe}`, verifiedHe: `הזמנה ${po.id} נקראה מחדש — ${after}` });
      s = push(s, { role: "system", kind: "steps", textHe: "מעדכן במערכת המידע", steps: [{ textHe: `בודק הרשאה — ${operator.nameHe}, מורשה לתיקון הזמנות בפרויקט ${pkg.project.nameHe}`, done: true }, { textHe: "מעדכן במערכת המידע...", done: true }, { textHe: `בוצע. אימות: הזמנה ${po.id} נקראה מחדש — ${after}; הסכום ${nis(po.amount)} ללא שינוי`, done: true }] });
      s = audit(s, s.operatorId, `הזמנה ${po.id}: ${before} → ${after} (ממצא ${f.id})`, { type: "po", id: String(po.id) });
      return nextFinding(tick(s));
    }
    // the order is part of a remainder the forecast already carries (same section, same unit): it must not be counted twice
    const draft = pkg.forecasts.find((x) => x.controlDate === s.control.controlDate);
    const remainder = draft?.sections?.find((x) => x.sectionId === po.sectionId)?.lines.find((l) => l.kind === "uncovered" && l.qty != null && (l.unit ?? proposed.unit) === proposed.unit);
    const [s2, taskId] = nextId(s, "TASK");
    s = { ...s2, control: { ...s2.control, tasks: [...s2.control.tasks, { id: taskId, titleHe: `תיקון כמות ויחידה בהזמנה ${po.id}`, sectionId: po.sectionId, ownerId: executor, dueDate: null, openedInControl: s.control.controlDate, status: "pending_execution", closedAt: null, findingId }], corrections: [...s2.control.corrections, { id: `COR-${po.id}`, recordType: "po", recordId: String(po.id), fieldHe: "כמות / יחידה / מחיר יח׳", beforeHe: before, afterHe: after, approvedById: s.operatorId, crossSectionHe: "ללא השפעה בין סעיפים — ממתין לביצוע", findingId, at: s.clock, status: "pending_execution" }] } };
    s = setDecision(s, findingId, { pending: undefined, status: "pending_execution", routeId, ownerId: executor, auditHe: `הועבר ל${personName(executor)} לביצוע: ${before} → ${after}` });
    s = push(s, { role: "system", kind: "text", textHe: `נשלח ל${personName(executor)}. הממצא יישאר ״ממתין לביצוע״ עד שהתיקון יאומת במערכת המידע.${remainder ? ` לתחזית: הזמנה ${po.id} היא חלק מיתרת ה${sectionShort(po.sectionId)} (${num(remainder.qty ?? 0)} ${proposed.unit}) שכבר בתחזית — לא נספרת פעמיים.` : ""}` });
    return nextFinding(s);
  }
  return s;
}

/** After each decision: introduce the next open finding, or announce the report. */
function nextFinding(state: V2State): V2State {
  const open = state.control.findings.filter((f) => {
    const d = state.control.decisions[f.id];
    return !d || d.status === "open" || d.pending;
  });
  const pendingCard = open.find((f) => !state.control.messages.some((m) => m.kind === "finding" && m.findingId === f.id));
  if (pendingCard) return push(state, findingMessage(pendingCard));
  if (open.length === 0 && state.control.status !== "report") {
    const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
    let s: V2State = { ...state, control: { ...state.control, status: "report" } };
    s = push(s, { role: "system", kind: "report", textHe: `כל ${num(state.control.findings.length)} הממצאים טופלו. הדוח מוכן. תחזית לגמר ${mil(wf.totalEac)} מול תקציב ${mil(wf.totalBudget)}.`, options: [{ id: "open", labelHe: "פתח את הדוח", action: { type: "open_report" } }] });
    return s;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Report configuration (scene 7 live changes, scene 8 save)
// ---------------------------------------------------------------------------

/** The scene-8 prompt: what a saved configuration keeps (structure) and what it never keeps (data). */
export function savePromptHe(config: V2State["control"]["reportConfig"]): string {
  const kept = ["מבנה הסעיפים לפי התקן", config.includeTrends ? "השוואה לבקרה קודמת ומגמות" : "", config.splitByBuilding ? "פילוח לפי בניין" : "", `סיכום מנהלים עד ${config.execSummaryMaxLines} שורות`, "טבלת אחריות (נושאים לטיפול)", "הפרדה בין תיקוני נתונים לשינויי תחזית", config.ceoVersion ? "גרסה נפרדת למנכ״לית" : ""].filter(Boolean);
  return `לשמור את התצורה הזו לבקרות הבאות של ${pkg.project.nameHe}? מה יישמר: ${kept.join(" · ")}. מה לא יישמר: הנתונים והמסקנות — יחושבו מחדש בכל בקרה.`;
}

export function setReportConfig(state: V2State, patch: Partial<V2State["control"]["reportConfig"]>, userTextHe?: string, systemTextHe?: string, extraOptions: ChatOption[] = []): V2State {
  let s = userTextHe ? push(state, { role: "user", kind: "text", textHe: userTextHe }) : state;
  const config = { ...s.control.reportConfig, ...patch };
  s = { ...s, control: { ...s.control, reportConfig: config } };
  if (systemTextHe) {
    s = push(s, { role: "system", kind: "text", textHe: systemTextHe, options: [{ id: "open", labelHe: "פתח את הדוח", action: { type: "open_report" } }, ...extraOptions] });
    // scene 8: the full save prompt once the CEO version is on (the script's third change) or the presenter asked for all three
    const askInFull = patch.ceoVersion === true || (config.includeTrends && config.splitByBuilding && config.ceoVersion);
    s = push(s, {
      role: "system",
      kind: "text",
      textHe: askInFull ? savePromptHe(config) : "לשמור את התצורה הזו לבקרות הבאות?",
      options: [
        { id: "save", labelHe: "שמור", action: { type: "save_config", save: true } },
        { id: "later", labelHe: "לא עכשיו", action: { type: "save_config", save: false } },
      ],
    });
  }
  return tick(s);
}

/** Scene 7: "[שלח לדנה]" — a simulated hand-off; the demo has no mailbox, so the send is logged and audited. */
export function sendReport(state: V2State, toId: PersonId): V2State {
  const to = pkg.people.find((p) => p.id === toId)!;
  const version = state.control.reportConfig.ceoVersion && /^מנכ/.test(to.roleHe) ? "הגרסה למנכ״לית" : "הדוח המלא";
  // a button action, not a chat turn: the exports on the same message stay available afterwards
  const month = `${state.control.controlDate.slice(5, 7)}/${state.control.controlDate.slice(0, 4)}`;
  const s = push(state, { role: "system", kind: "log", textHe: `נשלח ל${to.nameHe} (${to.roleHe}): ${version} של בקרה ${month}, ${state.control.finalized ? "גרסה סופית" : "טיוטה"} · קישור לאותה גרסת בקרה · ${dateHe(state.clock)} ${state.clock.slice(11, 16)}` });
  return tick(audit(s, s.operatorId, `הדוח נשלח ל${to.nameHe} (${version})`));
}

export function saveConfig(state: V2State, save: boolean): V2State {
  let s = push(state, { role: "user", kind: "text", textHe: save ? "שמור" : "לא עכשיו" });
  if (!save) return push(s, { role: "system", kind: "text", textHe: "בסדר. התצורה לא נשמרה; הבקרה הבאה תתחיל מהמבנה הבסיסי." });
  const saved = { ...s.control.reportConfig, savedAs: `תצורת בקרה — ${pkg.project.nameHe}` };
  s = { ...s, savedConfig: saved, control: { ...s.control, reportConfig: saved } };
  return push(s, { role: "system", kind: "text", textHe: `נשמר: ״${saved.savedAs}״. לא הוגדרה משימה מחזורית.` });
}

export function finalizeControl(state: V2State): V2State {
  if (state.control.finalized) return state;
  let s: V2State = { ...state, control: { ...state.control, finalized: true } };
  s = audit(s, s.operatorId, `בקרה ${dateHe(s.control.controlDate)} נסגרה כגרסה סופית`);
  return s;
}

export function resetDemo(variant: Scene1Variant = "A"): V2State {
  return initialState(variant);
}

/** Every issue of the control: those carried from earlier controls and the tasks opened during this one. */
export function allIssues(state: V2State): ControlTask[] {
  return state.control.tasks;
}

export type { ChatOption };
