import { formatDate, isoDateOf } from "../../domain/dates";
import { formatILS, formatNumber, multiplyQuantity, splitProportionally, sum, type Agorot } from "../../domain/money";
import { costLineView, currentForecast, isRecognized, recognizedByCommitment } from "../../domain/selectors/financial";
import type { ApprovedRule, CostCategory, CostCode, DemoState, ErpRecord, EvidenceRef, ProposalRow, SourceDocument, SuggestedReply, WorkItem } from "../../domain/types";
import type { AnalysisResult, FindingDraft, ProposalDraft, QuestionDraft } from "../types";

/**
 * Deterministic rule registry (Section 9.2). Pure functions over state: they read documents' pre-extracted
 * facts and the ledger, and return structured drafts. They never mutate state or apply financial changes.
 */

const m = (agorot: Agorot) => formatILS(agorot);
const n = (value: number) => formatNumber(value);

export const materialHe: Record<CostCategory, string> = {
  steel: "ברזל לזיון",
  concrete: "בטון",
  frame: "עבודות שלד",
  equipment: "ציוד",
  waterproofing: "איטום",
  finishing: "עבודות גמר",
  site_overhead: "תקורות אתר",
  general: "עבודות כלליות",
};

function ev(documentId: string, anchorId?: string, version?: number): EvidenceRef {
  return { documentId, anchorId, version };
}

function docOf(state: DemoState, id: string | null | undefined): SourceDocument | undefined {
  if (!id) return undefined;
  const versions = state.documents.filter((d) => d.id === id);
  return versions.sort((a, b) => b.version - a.version)[0];
}

function isSuperseded(state: DemoState, docId: string): boolean {
  return state.documents.some((d) => d.supersedesId === docId);
}

function codeOf(state: DemoState, id: string): CostCode {
  return state.costCodes.find((c) => c.id === id)!;
}

function projectNameOf(state: DemoState, id: string): string {
  return state.projects.find((p) => p.id === id)?.nameHe ?? id;
}

function contactNameOf(state: DemoState, id: string): string {
  return state.contacts.find((c) => c.id === id)?.nameHe ?? id;
}

function row(labelHe: string, value: string): ProposalRow {
  return { labelHe, value };
}

function emptyFinding(partial: Partial<FindingDraft> & Pick<FindingDraft, "dedupeKey" | "kind" | "projectId" | "titleHe" | "explanationHe">): FindingDraft {
  return {
    costCodeId: null,
    recordIds: [],
    documentIds: [],
    severity: "risk",
    status: "pending_review",
    checkedHe: [],
    evidence: [],
    amounts: {},
    numbers: {},
    blocksReport: false,
    proposals: [],
    questions: [],
    alerts: [],
    tasks: [],
    ...partial,
  };
}

function hasSettledFinding(state: DemoState, kind: string, subjectId: string): boolean {
  return state.findings.some((f) => f.kind === kind && f.recordIds.includes(subjectId) && (f.status === "resolved" || f.status === "dismissed"));
}

function activeDeliveryNotes(state: DemoState, purchaseOrderId: string): SourceDocument[] {
  return state.documents.filter((d) => d.kind === "delivery_note" && d.facts.purchaseOrderId === purchaseOrderId && !isSuperseded(state, d.id)).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Record rules
// ---------------------------------------------------------------------------

function checkClassification(state: DemoState, record: ErpRecord): FindingDraft | null {
  if (record.kind !== "invoice" || record.allocations.length !== 1) return null;
  const source = docOf(state, record.sourceDocumentId);
  if (!source) return null;
  const po = docOf(state, source.facts.purchaseOrderId);
  const dn = po ? activeDeliveryNotes(state, po.id)[0] : undefined;
  const material = source.facts.material ?? po?.facts.material ?? dn?.facts.material;
  const allocation = record.allocations[0];
  const currentCode = codeOf(state, allocation.costCodeId);
  const decisive = source.facts.descriptionDecisive !== false || Boolean(po?.facts.material);
  if (hasSettledFinding(state, "classification", record.id)) return null;

  if (!material || !decisive) {
    if (record.erpDescriptionVague || source.facts.descriptionDecisive === false) {
      const codes = state.costCodes.filter((c) => c.projectId === record.projectId && c.coverage === "detailed");
      const replies: SuggestedReply[] = codes.slice(0, 3).map((c) => ({ id: `code-${c.id}`, textHe: c.nameHe, effect: { type: "cost_code", costCodeId: c.id } }));
      return emptyFinding({
        dedupeKey: `classification-ambiguous:${record.id}:${record.version}`,
        kind: "classification",
        projectId: record.projectId,
        costCodeId: allocation.costCodeId,
        recordIds: [record.id],
        documentIds: [source.id],
        titleHe: `סיווג לא חד-משמעי: ${record.descriptionHe}`,
        explanationHe: `החשבונית ${source.id} בסך ${m(record.amount)} אינה מפרטת את החומר, ואין הזמנה או תעודת משלוח מקושרת. במסמכים אין תיאור מכריע, ולא נמצאה הנחיה מאושרת. נדרש בירור לפני שינוי הסיווג.`,
        severity: "risk",
        status: "needs_clarification",
        checkedHe: [`נבדקה חשבונית ${source.id}: התיאור אינו מפרט חומר`, "לא נמצאה הזמנה או תעודת משלוח מקושרת", "לא נמצאה הנחיה מאושרת לסיווג"],
        evidence: [ev(source.id, source.anchors[0]?.id)],
        questions: [
          {
            contactId: "OPS",
            textHe: `החשבונית ${source.id} בסך ${m(record.amount)} מתארת ״${source.anchors.find((x) => x.id === "line1")?.text ?? record.descriptionHe}״ ללא פירוט חומר, ואין הזמנה או תעודת משלוח מקושרת. לאיזה סעיף תקציב שייכת ההוצאה?`,
            suggestedReplies: [...replies, { id: "unknown", textHe: "אבדוק ואחזור", effect: { type: "open" } }],
            parser: "free",
            checkedHe: ["חשבונית", "רשומת זיו"],
            amount: record.amount,
            recordId: record.id,
          },
        ],
      });
    }
    return null;
  }
  if (currentCode.category === material) return null;
  const target = state.costCodes.find((c) => c.projectId === record.projectId && c.category === material);
  if (!target) return null;
  const qtyText = source.facts.quantity != null ? `${n(source.facts.quantity)} ${source.facts.unit ?? ""} ` : "";
  const supportingDocs = ["החשבונית", po ? "ההזמנה" : null, dn ? "תעודת המשלוח" : null].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " ו$1");
  const evidence = [ev(source.id, "line1"), po ? ev(po.id, "line1") : null, dn ? ev(dn.id, "line1") : null, ev(`BUD-${record.projectId}-V1`, target.id.toLowerCase())].filter((x): x is EvidenceRef => x !== null);
  const proposal: ProposalDraft = {
    kind: "erp_correction",
    labelHe: "תיקון נתון",
    titleHe: `שינוי סיווג: ${currentCode.nameHe} ← ${target.nameHe}`,
    reasonHe: `${supportingDocs} מזהים ${materialHe[material]}; סכום החשבונית אינו משתנה.`,
    before: [row("סעיף תקציב", `${currentCode.nameHe} (${currentCode.id})`), row("סכום", m(record.amount))],
    after: [row("סעיף תקציב", `${target.nameHe} (${target.id})`), row("סכום", m(record.amount))],
    payload: { kind: "erp_correction", recordId: record.id, changes: { costCodeId: target.id } },
    evidence,
    targetIds: [record.id],
    costCodeId: target.id,
  };
  return emptyFinding({
    dedupeKey: `classification:${record.id}:${record.version}:${allocation.costCodeId}`,
    kind: "classification",
    projectId: record.projectId,
    costCodeId: allocation.costCodeId,
    recordIds: [record.id],
    documentIds: [source.id, ...(po ? [po.id] : []), ...(dn ? [dn.id] : [])],
    titleHe: `חשבונית שנרשמה בסעיף הלא נכון: ${record.descriptionHe}`,
    explanationHe: `החשבונית מתארת ${qtyText}${materialHe[material]}, אך נרשמה בסעיף ${currentCode.nameHe}. ${supportingDocs} תואמות לסעיף ${target.nameHe}. מוצע לשנות את הסיווג בלבד; סכום החשבונית לא משתנה.`,
    severity: "risk",
    checkedHe: [`נמצאה חשבונית תואמת: ${source.id}`, po ? `נמצאה הזמנה מקושרת: ${po.id}` : "לא נמצאה הזמנה מקושרת", dn ? `נמצאה תעודת משלוח: ${dn.id}` : "לא נמצאה תעודת משלוח", `הוגדרות סעיף ${target.nameHe} בתקציב המאושר תואמות לחומר`],
    evidence,
    amounts: { amount: record.amount },
    blocksReport: true,
    proposals: [proposal],
  });
}

function checkQuantityReconciliation(state: DemoState, record: ErpRecord): FindingDraft[] {
  if (record.kind !== "invoice") return [];
  const source = docOf(state, record.sourceDocumentId);
  if (!source || source.facts.quantity == null || source.facts.unitPrice == null || source.facts.amount == null) return [];
  const out: FindingDraft[] = [];
  const invQty = source.facts.quantity;
  const invPrice = source.facts.unitPrice;
  const invAmount = source.facts.amount;
  const unit = source.facts.unit ?? record.unit ?? "";
  const poId = source.facts.purchaseOrderId;
  const dn = poId ? activeDeliveryNotes(state, poId)[0] : state.documents.find((d) => d.kind === "delivery_note" && record.relatedDocumentIds.includes(d.id) && !isSuperseded(state, d.id));
  const delivered = dn?.facts.deliveredQuantity ?? null;
  const code = codeOf(state, record.allocations[0].costCodeId);
  const evidence = [ev(source.id, "line1"), dn ? ev(dn.id, dn.anchors[0].id) : null].filter((x): x is EvidenceRef => x !== null);

  const qtyMismatch = record.quantity !== invQty || record.unitPrice !== invPrice;
  const amountMismatch = record.amount !== invAmount;

  if (!hasSettledFinding(state, "quantity_mismatch", record.id) && qtyMismatch && !amountMismatch) {
    out.push(
      emptyFinding({
        dedupeKey: `quantity_mismatch:${record.id}:${record.version}`,
        kind: "quantity_mismatch",
        projectId: record.projectId,
        costCodeId: code.id,
        recordIds: [record.id],
        documentIds: [source.id, ...(dn ? [dn.id] : [])],
        titleHe: `אי-התאמה בכמות: ${record.descriptionHe}`,
        explanationHe: `נמצאה אי-התאמה בכמות: בזיו נרשמו ${n(record.quantity ?? 0)} ${unit}, ובחשבונית${dn ? " ובתעודת המשלוח" : ""} מופיעים ${n(invQty)} ${unit}. סכום החשבונית, ${m(invAmount)}, תואם ל-${n(invQty)} ${unit} במחיר ${m(invPrice)} ל${unit}. מוצע לתקן את הכמות ואת המחיר ליחידה.`,
        severity: "risk",
        checkedHe: [`נמצאה חשבונית תואמת: ${source.id} — ${n(invQty)} ${unit} × ${m(invPrice)}`, dn ? `נבדקה תעודת המשלוח ${dn.id}: ${n(delivered ?? 0)} ${unit}` : "לא נמצאה תעודת משלוח", `סכום החשבונית ${m(invAmount)} אומת: ${n(invQty)} × ${m(invPrice)}`],
        evidence,
        amounts: { amount: record.amount },
        numbers: { erpQuantity: record.quantity ?? 0, invoiceQuantity: invQty },
        blocksReport: false,
        proposals: [
          {
            kind: "erp_correction",
            labelHe: "תיקון נתון",
            titleHe: `תיקון כמות ומחיר ליחידה ברשומה ${record.id}`,
            reasonHe: "החשבונית ותעודת המשלוח תואמות זו לזו; סכום החשבונית אינו משתנה.",
            before: [row("כמות", `${n(record.quantity ?? 0)} ${unit}`), row("מחיר ליחידה", m(record.unitPrice ?? 0)), row("סכום", m(record.amount))],
            after: [row("כמות", `${n(invQty)} ${unit}`), row("מחיר ליחידה", m(invPrice)), row("סכום", m(record.amount))],
            payload: { kind: "erp_correction", recordId: record.id, changes: { quantity: invQty, unitPrice: invPrice, verifiedQuantity: invQty } },
            evidence,
            targetIds: [record.id],
            costCodeId: code.id,
          },
        ],
      }),
    );
  }

  if (!hasSettledFinding(state, "amount_correction", record.id) && amountMismatch) {
    const extra = invAmount - record.amount;
    out.push(
      emptyFinding({
        dedupeKey: `amount_correction:${record.id}:${record.version}`,
        kind: "amount_correction",
        projectId: record.projectId,
        costCodeId: code.id,
        recordIds: [record.id],
        documentIds: [source.id, ...(dn ? [dn.id] : [])],
        titleHe: `סכום הרשומה אינו תואם לחשבונית: ${record.descriptionHe}`,
        explanationHe: `בזיו נרשמו ${n(record.quantity ?? 0)} ${unit} בסך ${m(record.amount)}, אך בחשבונית ${source.id} מופיעים ${n(invQty)} ${unit} × ${m(invPrice)} = ${m(invAmount)}.${delivered != null ? ` תעודת המשלוח מאשרת ${n(delivered)} ${unit}.` : ""} מוצע לתקן את הכמות ואת הסכום ברשומה; החשבונית עצמה אינה משתנה. ההפרש המוכר: ${m(extra)}.`,
        severity: "urgent",
        checkedHe: [`נמצאה חשבונית יחידה לאספקה זו: ${source.id}`, dn ? `נבדקה תעודת המשלוח ${dn.id}: ${n(delivered ?? 0)} ${unit}` : "לא נמצאה תעודת משלוח", `המחיר ליחידה ${m(invPrice)} תואם להסכם`, "לא נמצאה חשבונית נוספת לאותה יציקה"],
        evidence,
        amounts: { amount: record.amount, corrected: invAmount, extra },
        numbers: { erpQuantity: record.quantity ?? 0, invoiceQuantity: invQty },
        blocksReport: true,
        proposals: [
          {
            kind: "erp_correction",
            labelHe: "תיקון נתון",
            titleHe: `תיקון כמות וסכום ברשומה ${record.id}`,
            reasonHe: `החשבונית היחידה לאספקה זו מציגה ${n(invQty)} ${unit} בסך ${m(invAmount)}.`,
            before: [row("כמות", `${n(record.quantity ?? 0)} ${unit}`), row("סכום", m(record.amount))],
            after: [row("כמות", `${n(invQty)} ${unit}`), row("סכום", m(invAmount))],
            payload: { kind: "erp_correction", recordId: record.id, changes: { quantity: invQty, unitPrice: invPrice, amount: invAmount, verifiedQuantity: invQty, sourceDocumentId: source.id } },
            evidence,
            targetIds: [record.id],
            costCodeId: code.id,
          },
        ],
      }),
    );
  }

  // Partial delivery: delivered less than purchased, no other delivery note for the same order.
  if (delivered != null && delivered < invQty && poId && !hasSettledFinding(state, "partial_delivery", record.id)) {
    const outstanding = invQty - delivered;
    const otherNotes = activeDeliveryNotes(state, poId).length;
    out.push(
      emptyFinding({
        dedupeKey: `partial_delivery:${record.id}:${dn?.id}`,
        kind: "partial_delivery",
        projectId: record.projectId,
        costCodeId: code.id,
        recordIds: [record.id],
        documentIds: [source.id, dn!.id],
        titleHe: `אספקה חלקית: התקבלו ${n(delivered)} מתוך ${n(invQty)} ${unit}`,
        explanationHe: `לפי תעודת המשלוח ${dn!.id} התקבלו ${n(delivered)} מתוך ${n(invQty)} ${unit} שבהזמנה ${poId}. זו אספקה חלקית אפשרית, לא הוכחה שהחשבונית שגויה. לא נמצאה תעודת משלוח נוספת, ולכן נדרש לברר אם ${n(outstanding)} ${unit} הנותרים בדרך או שצפוי זיכוי. הכמות שנרכשה נשארת ${n(invQty)} ${unit}.`,
        severity: "risk",
        status: "needs_clarification",
        checkedHe: [`נבדקה תעודת המשלוח ${dn!.id}: ${n(delivered)} ${unit}`, `חיפוש תעודת משלוח נוספת להזמנה ${poId}: ${otherNotes > 1 ? "נמצאו תעודות נוספות" : "לא נמצאה"}`, "לא נמצא זיכוי או הודעת ספק"],
        evidence,
        amounts: { amount: record.amount },
        numbers: { purchased: invQty, delivered, outstanding },
        questions: [
          {
            contactId: "OPS",
            textHe: `לפי תעודת המשלוח התקבלו ${n(delivered)} מתוך ${n(invQty)} ${unit} שבהזמנה ${poId}. לא נמצאה תעודת משלוח נוספת. האם ${n(outstanding)} ה${unit} הנותרים בדרך, או שנדרש בירור מול הספק?`,
            suggestedReplies: [
              { id: "more", textHe: `${n(outstanding)} ${unit} נוספים בדרך`, effect: { type: "delivery", outcome: "more_coming" } },
              { id: "clarify", textHe: "נדרש בירור מול הספק", effect: { type: "delivery", outcome: "clarify" } },
            ],
            parser: "delivery",
            checkedHe: ["חשבונית", "תעודת משלוח", "הזמנה"],
            recordId: record.id,
          },
        ],
      }),
    );
  }
  return out;
}

function ruleMatches(state: DemoState, rule: ApprovedRule, framework: SourceDocument, record: ErpRecord): { ok: boolean; reasonHe: string } {
  if (rule.status !== "active") return { ok: false, reasonHe: `הכלל ${rule.id} אינו פעיל (${rule.status === "expired" ? "פג תוקפו" : "הוחלף"})` };
  if (rule.companyId !== state.company.id) return { ok: false, reasonHe: "הכלל שייך לחברה אחרת" };
  if (rule.frameworkDocumentId !== framework.id) return { ok: false, reasonHe: `הכלל מתייחס למסגרת ${rule.frameworkDocumentId}, לא ל-${framework.id}` };
  if (rule.supplierId !== record.supplierId) return { ok: false, reasonHe: "הספק אינו תואם לכלל" };
  const frameworkProjects = [...(framework.facts.frameworkProjectIds ?? [])].sort().join(",");
  const ruleProjects = rule.scope.map((s) => s.projectId).sort().join(",");
  if (frameworkProjects !== ruleProjects) return { ok: false, reasonHe: "קבוצת האתרים במסגרת שונה מזו שבכלל" };
  const serviceDate = record.date;
  if (serviceDate < rule.validFrom || serviceDate > rule.validTo) return { ok: false, reasonHe: `תקופת החיוב (${formatDate(serviceDate)}) מחוץ לתוקף הכלל (${formatDate(rule.validFrom)}–${formatDate(rule.validTo)})` };
  return { ok: true, reasonHe: "" };
}

function checkAllocationCompleteness(state: DemoState, record: ErpRecord): FindingDraft | null {
  if (record.kind !== "invoice") return null;
  const source = docOf(state, record.sourceDocumentId);
  const framework = docOf(state, source?.facts.contractId);
  if (!source || !framework || framework.kind !== "framework") return null;
  const frameworkProjects = framework.facts.frameworkProjectIds ?? [];
  if (frameworkProjects.length < 2 || source.facts.allocationDetail !== false) return null;
  const allocatedProjects = new Set(record.allocations.map((al) => al.projectId));
  if (frameworkProjects.every((p) => allocatedProjects.has(p))) return null;
  if (hasSettledFinding(state, "missing_allocation", record.id) || hasSettledFinding(state, "rule_reuse", record.id)) return null;
  const currentProject = record.allocations[0].projectId;
  const others = frameworkProjects.filter((p) => p !== currentProject);
  const evidence = [ev(source.id, "allocation"), ev(framework.id, "billing")];
  const checked = [`נבדקה חשבונית ${source.id}: אין פירוט עלות לפי אתר`, `נבדקה מסגרת ${framework.id}: השיוך מחייב פירוט שימוש או אישור תפעול`];

  // Approved memory: reuse only a fully matching active rule
  const candidates = state.approvedRules.filter((r) => r.frameworkDocumentId === framework.id || r.supplierId === record.supplierId);
  let matched: ApprovedRule | null = null;
  for (const rule of candidates) {
    const check = ruleMatches(state, rule, framework, record);
    if (check.ok) {
      matched = rule;
      break;
    }
    checked.push(`נמצא כלל ${rule.id} אך לא נעשה בו שימוש: ${check.reasonHe}`);
  }
  if (matched) {
    const denominators = matched.ratio.map((r) => r.numerator / r.denominator);
    const parts = splitProportionally(record.amount, denominators);
    const allocations = matched.ratio.map((r, i) => {
      const code = state.costCodes.find((c) => c.projectId === r.projectId && c.category === "equipment")!;
      const item = state.workItems.find((w) => w.costCodeId === code.id && w.status === "uncommitted" && /SEP/.test(w.id));
      return { projectId: r.projectId, costCodeId: code.id, amount: parts[i], workItemId: item?.id ?? null, commitmentId: null };
    });
    const ratioText = matched.ratio.map((r) => `${ratioHe(r.numerator, r.denominator)} ל${projectNameOf(state, r.projectId)}`).join(" ו");
    checked.push(`נמצאה הנחיה מאושרת ${matched.id} (בתוקף עד ${formatDate(matched.validTo)})`, "נבדקו הספק, המסגרת, קבוצת האתרים ותקופת החיוב", "לא נדרש בירור נוסף עם הלקוח");
    return emptyFinding({
      dedupeKey: `rule_reuse:${record.id}:${matched.id}`,
      kind: "rule_reuse",
      projectId: currentProject,
      costCodeId: record.allocations[0].costCodeId,
      recordIds: [record.id],
      documentIds: [source.id, framework.id],
      titleHe: `שימוש בהנחיה מאושרת: ${source.titleHe}`,
      explanationHe: `נמצאה הנחיה מאושרת לאותה מסגרת ולאותם אתרים: ${ratioText}. החשבונית החדשה תואמת לתנאי הכלל. מוצע להשתמש בחלוקה המאושרת, ללא בירור נוסף עם ${contactNameOf(state, "OPS")}.`,
      severity: "info",
      checkedHe: checked,
      evidence: [...evidence, ...matched.sourceEvidence],
      amounts: { amount: record.amount },
      proposals: [
        {
          kind: "allocation",
          labelHe: "תיקון נתון",
          titleHe: `חלוקת ${source.id} לפי ${matched.id}`,
          reasonHe: `הנחיה מאושרת ${matched.id}: ${ratioText}.`,
          before: record.allocations.map((al) => row(projectNameOf(state, al.projectId), m(al.amount))),
          after: allocations.map((al) => row(projectNameOf(state, al.projectId), m(al.amount))),
          payload: { kind: "allocation", recordId: record.id, allocations, ruleId: matched.id },
          evidence: [...evidence, ...matched.sourceEvidence],
          targetIds: [record.id],
          ruleId: matched.id,
        },
      ],
    });
  }
  checked.push("לא נמצאה הנחיה מאושרת מתאימה למסגרת זו");
  const othersHe = others.map((p) => projectNameOf(state, p)).join(" ו");
  const question: QuestionDraft = {
    contactId: "OPS",
    textHe: `חשבונית ציוד ${source.id} בסך ${m(record.amount)} נרשמה כולה ל${projectNameOf(state, currentProject)}, אך המסגרת כוללת גם את ${othersHe}. איך לחלק את העלות בין האתרים?`,
    suggestedReplies: suggestedSplits(state, record.amount, frameworkProjects),
    parser: "allocation",
    checkedHe: [`חשבונית ${source.id}`, `מסגרת ${framework.id}`, "הנחיות מאושרות"],
    amount: record.amount,
    recordId: record.id,
  };
  return emptyFinding({
    dedupeKey: `missing_allocation:${record.id}:${record.version}`,
    kind: "missing_allocation",
    projectId: currentProject,
    costCodeId: record.allocations[0].costCodeId,
    recordIds: [record.id],
    documentIds: [source.id, framework.id],
    titleHe: `חסר פירוט שיוך בין אתרים: ${source.titleHe}`,
    explanationHe: `החשבונית נרשמה כולה ל${projectNameOf(state, currentProject)}, אך מסגרת ${framework.id} מאפשרת שימוש גם ב${othersHe}. לא נמצא במסמכים פירוט שימוש לפי אתר ואין הנחיה מאושרת מתאימה, ולכן נדרש בירור מול ${contactNameOf(state, "OPS")}.`,
    severity: "risk",
    status: "needs_clarification",
    checkedHe: checked,
    evidence,
    amounts: { amount: record.amount },
    questions: [question],
  });
}

function ratioHe(num: number, den: number): string {
  if (num === 2 && den === 3) return "שני שלישים";
  if (num === 1 && den === 3) return "שליש";
  if (num === 1 && den === 2) return "מחצית";
  return `${num}/${den}`;
}

function suggestedSplits(state: DemoState, amount: Agorot, projectIds: string[]): SuggestedReply[] {
  const [first, second] = projectIds;
  const twoThirds = splitProportionally(amount, [2, 1]);
  const equal = splitProportionally(amount, projectIds.map(() => 1));
  return [
    { id: "primary", textHe: `${m(twoThirds[0])} ל${projectNameOf(state, first)} ו-${m(twoThirds[1])} ל${projectNameOf(state, second)}`, effect: { type: "allocation", split: { [first]: twoThirds[0], [second]: twoThirds[1] } } },
    { id: "equal", textHe: `${m(equal[0])} לכל אתר`, effect: { type: "allocation", split: Object.fromEntries(projectIds.map((p, i) => [p, equal[i]])) } },
    { id: "unknown", textHe: "אין לי עדיין פירוט", effect: { type: "open" } },
  ];
}

function checkFuturePriceRisk(state: DemoState, record: ErpRecord): FindingDraft | null {
  if (record.kind !== "invoice" || record.allocations.length !== 1) return null;
  const code = codeOf(state, record.allocations[0].costCodeId);
  if (code.category !== "steel" || code.budgetUnitPrice == null || code.plannedQuantity == null) return null;
  if (record.verifiedQuantity == null || record.unitPrice == null || record.quantity !== record.verifiedQuantity) return null;
  if (record.unitPrice <= code.budgetUnitPrice) return null;
  if (hasSettledFinding(state, "price_risk", record.id)) return null;
  const items = state.workItems.filter((w) => w.costCodeId === code.id && w.status === "uncommitted");
  const remainingQty = sum(items.map((w) => currentForecast(state, w.id)?.quantity ?? w.quantity ?? 0));
  if (remainingQty <= 0) return null;
  const committedQty = state.workItems.filter((w) => w.costCodeId === code.id && w.status === "committed").reduce((acc, w) => acc + (w.quantity ?? 0), 0);
  const acceptedUnitPrice = currentForecast(state, items[0].id)?.unitPrice ?? code.budgetUnitPrice;
  if (acceptedUnitPrice >= record.unitPrice) return null;
  const diff = record.unitPrice - code.budgetUnitPrice;
  const actualPremium = multiplyQuantity(record.verifiedQuantity, diff);
  const futurePremium = multiplyQuantity(remainingQty, diff);
  const total = actualPremium + futurePremium;
  const source = docOf(state, record.sourceDocumentId);
  const po = docOf(state, source?.facts.purchaseOrderId);
  const budgetDoc = docOf(state, `BUD-${record.projectId}-V1`);
  const evidence = [source ? ev(source.id, "line1") : null, po ? ev(po.id, "scope") : null, budgetDoc ? ev(budgetDoc.id, code.id.toLowerCase()) : null, ev(items[0].sourceDocumentId ?? "FC-H-STEEL", "summary")].filter((x): x is EvidenceRef => x !== null);
  const remainingLabel = committedQty > 0 ? `${n(remainingQty)} הטון שנותרו ללא הזמנה במחיר קבוע` : `${n(remainingQty)} הטון שנותרו`;
  const alertText = `נרכשו רק ${n(record.verifiedQuantity)} מתוך ${n(code.plannedQuantity)} ${code.unit}, במחיר גבוה ב-${m(diff)} ל${code.unit} מהתקציב. החריגה ברכישה שכבר בוצעה היא ${m(actualPremium)}. אם גם ${remainingLabel} יירכשו ב-${m(record.unitPrice)} ל${code.unit}, תתווסף חריגה של ${m(futurePremium)}. החריגה הכוללת בסעיף תהיה ${m(total)}.`;
  return emptyFinding({
    dedupeKey: `price_risk:${record.id}:${remainingQty}`,
    kind: "price_risk",
    projectId: record.projectId,
    costCodeId: code.id,
    recordIds: [record.id],
    documentIds: [source?.id ?? "", po?.id ?? ""].filter(Boolean),
    titleHe: `סיכון מחיר עתידי ב${code.nameHe}: רכישה קטנה חושפת חריגה אפשרית`,
    explanationHe: alertText,
    severity: "risk",
    status: "conditional",
    checkedHe: [`מחיר הרכישה ${m(record.unitPrice)} לעומת תקציב ${m(code.budgetUnitPrice)} ל${code.unit}`, po ? `נבדקה ההזמנה ${po.id}: אינה קובעת מחיר ליתרה` : "לא נמצאה הזמנת מסגרת", `יתרת רכש ללא התחייבות: ${n(remainingQty)} ${code.unit}${committedQty ? ` (ועוד ${n(committedQty)} ${code.unit} במחיר קבוע)` : ""}`, "לא נמצא הסכם מחיר ליתרת הכמות"],
    evidence,
    amounts: { actualPremium, futurePremium, total, candidatePrice: record.unitPrice, budgetPrice: code.budgetUnitPrice },
    numbers: { purchased: record.verifiedQuantity, planned: code.plannedQuantity, remaining: remainingQty, committed: committedQty },
    alerts: [{ kind: "early_alert", titleHe: `התרעה מוקדמת: ${code.nameHe} — ${projectNameOf(state, record.projectId)}`, textHe: alertText, recipientId: "CEO", channel: "whatsapp", amounts: { actualPremium, futurePremium, total }, linkQuestion: true }],
    questions: [
      {
        contactId: "OPS",
        textHe: `האם ${m(record.unitPrice)} ל${code.unit} צפוי להיות המחיר גם ליתרת הרכישות, או שמדובר בהזמנה חריגה?`,
        suggestedReplies: [
          { id: "same", textHe: "זה המחיר הצפוי גם בהמשך", effect: { type: "future_price", unitPrice: record.unitPrice } },
          { id: "oneoff", textHe: `זו רכישה חד-פעמית; היתרה צפויה ב-${m(code.budgetUnitPrice)}`, effect: { type: "future_price", unitPrice: code.budgetUnitPrice, keepBaseline: true } },
          { id: "new", textHe: `יש הערכה חדשה של ${m(code.budgetUnitPrice + Math.round(diff / 2))} ל${code.unit}`, effect: { type: "future_price", unitPrice: code.budgetUnitPrice + Math.round(diff / 2) } },
          { id: "unknown", textHe: "עדיין לא ידוע", effect: { type: "open" } },
        ],
        parser: "future_price",
        checkedHe: ["חשבונית", "הזמנה", "תקציב", "תחזית"],
        amount: futurePremium,
        recordId: record.id,
      },
    ],
  });
}

function checkCumulativeCertificate(state: DemoState, record: ErpRecord): FindingDraft | null {
  if (record.kind !== "certificate") return null;
  const source = docOf(state, record.sourceDocumentId);
  if (!source || source.facts.cumulativeApproved == null || source.facts.priorCumulative == null) return null;
  const cumulative = source.facts.cumulativeApproved;
  const prior = source.facts.priorCumulative;
  const increment = cumulative - prior;
  if (record.amount === increment) return null;
  if (hasSettledFinding(state, "cumulative_duplicate", record.id)) return null;
  const commitmentId = record.allocations[0].commitmentId;
  const priorRecord = state.erpRecords.find((r) => r.id !== record.id && r.kind === "certificate" && r.allocations.some((al) => al.commitmentId === commitmentId) && r.cumulativeApproved === prior);
  const contract = docOf(state, commitmentId);
  const code = codeOf(state, record.allocations[0].costCodeId);
  if (!priorRecord && prior > 0) {
    return emptyFinding({
      dedupeKey: `cumulative_missing_prior:${record.id}:${record.version}`,
      kind: "missing_link",
      projectId: record.projectId,
      costCodeId: code.id,
      recordIds: [record.id],
      documentIds: [source.id],
      titleHe: `חשבון מצטבר ללא חשבון קודם מזוהה: ${source.titleHe}`,
      explanationHe: `בחשבון ${source.id} מופיע מצטבר מאושר של ${m(cumulative)} ומצטבר קודם של ${m(prior)}, אך לא נמצא בזיו או במסמכים חשבון קודם לחוזה. עד לבירור, הרשומה מסומנת ולא ניתן לאשר את הסכום לתקופה.`,
      severity: "urgent",
      status: "needs_clarification",
      checkedHe: [`חיפוש חשבון קודם לחוזה ${commitmentId}: לא נמצא`, "נבדקו הרשומות בזיו לחוזה זה"],
      evidence: [ev(source.id, "text")],
      amounts: { amount: record.amount, cumulative, prior },
      blocksReport: true,
      questions: [
        {
          contactId: "OPS",
          textHe: `התקבל חשבון מצטבר של ${m(cumulative)} לקבלן השלד עם מצטבר קודם של ${m(prior)}, אך לא נמצא חשבון קודם מאושר בזיו. האם קיים חשבון קודם שאושר ושולם? אם כן, נא לצרף אותו.`,
          suggestedReplies: [{ id: "will-send", textHe: "אבדוק ואשלח את החשבון הקודם", effect: { type: "open" } }],
          parser: "free",
          checkedHe: ["חשבון נוכחי", "רשומות זיו לחוזה"],
          amount: prior,
          recordId: record.id,
        },
      ],
    });
  }
  const evidence = [ev(source.id, "text"), priorRecord?.sourceDocumentId ? ev(priorRecord.sourceDocumentId, "text") : null, contract ? ev(contract.id, "billing") : null].filter((x): x is EvidenceRef => x !== null);
  return emptyFinding({
    dedupeKey: `cumulative_duplicate:${record.id}:${record.version}`,
    kind: "cumulative_duplicate",
    projectId: record.projectId,
    costCodeId: code.id,
    recordIds: [record.id, ...(priorRecord ? [priorRecord.id] : [])],
    documentIds: [source.id, ...(priorRecord?.sourceDocumentId ? [priorRecord.sourceDocumentId] : [])],
    titleHe: `חשבון מצטבר שנקלט במלואו: ${source.titleHe}`,
    explanationHe: `בחשבון הנוכחי אושר מצטבר של ${m(cumulative)}, אך ${m(prior)} כבר הוכרו בחשבון הקודם. התוספת לתקופה היא ${m(increment)}. קליטה של ${m(record.amount)} נוספים תחזור על ${m(prior)} שכבר נרשמו.`,
    severity: "urgent",
    checkedHe: [`נמצא החשבון הקודם ${priorRecord?.sourceDocumentId ?? priorRecord?.id}: מצטבר ${m(prior)}, הוכר ושולם`, contract ? `נבדק סעיף החיוב במצטבר בחוזה ${contract.id}` : "לא נמצא חוזה מקושר", `חושב ההפרש לתקופה: ${m(cumulative)} − ${m(prior)} = ${m(increment)}`],
    evidence,
    amounts: { amount: record.amount, cumulative, prior, increment },
    blocksReport: true,
    proposals: [
      {
        kind: "erp_correction",
        labelHe: "תיקון נתון",
        titleHe: `תיקון סכום לתקופה: ${m(record.amount)} ← ${m(increment)}`,
        reasonHe: `החשבון מוצג במצטבר; רק ההפרש מהמצטבר הקודם הוא עלות התקופה.${priorRecord && !record.priorRecordId ? " מוצע גם לקשר את החשבון הקודם." : ""}`,
        before: [row("סכום שנקלט", m(record.amount)), row("חשבון קודם מקושר", record.priorRecordId ?? "ללא")],
        after: [row("סכום לתקופה", m(increment)), row("חשבון קודם מקושר", priorRecord?.id ?? "ללא")],
        payload: { kind: "erp_correction", recordId: record.id, changes: { amount: increment, priorRecordId: priorRecord?.id, cumulativeApproved: cumulative, priorCumulative: prior } },
        evidence,
        targetIds: [record.id],
        costCodeId: code.id,
      },
    ],
  });
}

function checkContractCharge(state: DemoState, record: ErpRecord): FindingDraft | null {
  if (record.kind !== "invoice" || record.chargeType !== "freight") return null;
  const source = docOf(state, record.sourceDocumentId);
  const contract = docOf(state, source?.facts.contractId);
  if (!source || !contract || contract.facts.freightIncluded !== true) return null;
  if (hasSettledFinding(state, "contract_charge", record.id)) return null;
  const existing = state.findings.find((f) => f.kind === "contract_charge" && f.recordIds.includes(record.id) && f.status !== "superseded");
  if (existing) return null;
  const addendum = state.documents.find((d) => d.kind === "addendum" && d.facts.chargeType === "freight" && d.facts.contractId === contract.id && d.facts.approved);
  const code = codeOf(state, record.allocations[0].costCodeId);
  const evidence = [ev(source.id, "line1"), ev(contract.id, "freight")];
  if (addendum) {
    return emptyFinding({
      dedupeKey: `contract_charge_addendum:${record.id}:${addendum.id}`,
      kind: "contract_charge",
      projectId: record.projectId,
      costCodeId: code.id,
      recordIds: [record.id],
      documentIds: [source.id, contract.id, addendum.id],
      titleHe: `חיוב הובלה עם תוספת מאושרת: ${source.titleHe}`,
      explanationHe: `חויבו ${m(record.amount)} בנפרד עבור הובלה. נמצאה תוספת מאושרת (${addendum.id}) לאספקה מיוחדת מחוץ לתנאי ההסכם. לאחר בדיקת ההתאמה לאספקה זו, אפשר לסגור את הדגל ולהשאיר את העלות.`,
      severity: "info",
      checkedHe: [`נבדק סעיף ההובלה בחוזה ${contract.id}`, `נמצאה תוספת מאושרת ${addendum.id}`, "נבדקה התאמת התוספת לאספקה המסוימת"],
      evidence: [...evidence, ev(addendum.id, "text")],
      amounts: { amount: record.amount },
      proposals: [
        {
          kind: "dismiss_flag",
          labelHe: "סגירת דגל",
          titleHe: "סגירת החיוב לבירור — התוספת המאושרת תואמת",
          reasonHe: `התוספת ${addendum.id} מאשרת חיוב הובלה של ${m(addendum.facts.amount ?? record.amount)} לאספקה מיוחדת.`,
          before: [row("סטטוס", "חיוב לבירור מול הספק"), row("עלות", m(record.amount))],
          after: [row("סטטוס", "חיוב תקין לפי תוספת"), row("עלות", m(record.amount))],
          payload: { kind: "dismiss_flag", findingId: "", recordId: record.id },
          evidence: [...evidence, ev(addendum.id, "text")],
          targetIds: [record.id],
          costCodeId: code.id,
        },
      ],
    });
  }
  return emptyFinding({
    dedupeKey: `contract_charge:${record.id}:${record.version}`,
    kind: "contract_charge",
    projectId: record.projectId,
    costCodeId: code.id,
    recordIds: [record.id],
    documentIds: [source.id, contract.id],
    titleHe: `חיוב שאינו תואם את תנאי החוזה: ${source.titleHe}`,
    explanationHe: `חויבו ${m(record.amount)} בנפרד עבור הובלה. לפי סעיף ההובלה בחוזה, הובלה רגילה לאתר כלולה במחיר. לא נמצאה תוספת מאושרת לחיוב הזה. מוצע לברר את החיוב ולבקש זיכוי.`,
    severity: "risk",
    checkedHe: [`נבדק סעיף ההובלה בחוזה ${contract.id}: הובלה כלולה במחיר`, "לא נמצאה תוספת מאושרת לחיוב", "לא נמצאה חשבונית זהה נוספת"],
    evidence,
    amounts: { amount: record.amount },
    tasks: [{ kind: "credit_request", titleHe: `בקשת זיכוי: ${source.id}`, descriptionHe: `לבקש מהספק זיכוי בסך ${m(record.amount)} — הובלה כלולה במחיר לפי ${contract.id}.`, recordId: record.id }],
  });
}

/** Delivered/invoiced quantity above the planned task quantity needs operational context before interpretation (S11). */
function checkQuantityVariance(state: DemoState, record: ErpRecord): FindingDraft | null {
  if (record.kind !== "invoice") return null;
  const source = docOf(state, record.sourceDocumentId);
  const plan = state.documents.find((d) => d.kind === "plan" && record.relatedDocumentIds.includes(d.id) && d.facts.plannedQuantity != null);
  if (!source || !plan || source.facts.quantity == null) return null;
  const planned = plan.facts.plannedQuantity!;
  const delivered = source.facts.quantity;
  if (delivered <= planned) return null;
  if (hasSettledFinding(state, "quantity_variance", record.id)) return null;
  if (state.findings.some((f) => f.kind === "quantity_variance" && f.recordIds.includes(record.id) && f.status !== "superseded")) return null;
  const code = codeOf(state, record.allocations[0].costCodeId);
  const unit = source.facts.unit ?? record.unit ?? "";
  const extra = delivered - planned;
  const variance = Math.round((extra / planned) * 100);
  const task = plan.facts.taskHe ?? plan.titleHe.replace("תכנון ", "");
  return emptyFinding({
    dedupeKey: `quantity_variance:${record.id}:${source.id}`,
    kind: "quantity_variance",
    projectId: record.projectId,
    costCodeId: code.id,
    recordIds: [record.id],
    documentIds: [source.id, plan.id],
    titleHe: `חריגת כמות ב${task}: סופקו ${n(delivered)} ${unit} לעומת ${n(planned)} מתוכננים`,
    explanationHe: `ל${task} תוכננו ${n(planned)} ${unit} וסופקו ${n(delivered)} ${unit} (סטייה מקומית של ${variance}%). המחיר ליחידה תקין. כמות עודפת יכולה לנבוע משינוי תכנון מאושר, החזרה, בעיית מדידה או צריכת יתר; נדרש הקשר תפעולי לפני פרשנות, ואין להקיש מכך על יתר הפרויקט.`,
    severity: "risk",
    status: "needs_clarification",
    checkedHe: [`נבדק התכנון ${plan.id}: ${n(planned)} ${unit}, ללא אישור לשינוי כמות`, `נבדקה החשבונית ${source.id}: ${n(delivered)} ${unit} × ${m(source.facts.unitPrice ?? 0)}`, "לא נמצא מסמך החזרה או הוראת שינוי"],
    evidence: [ev(plan.id, "quantity"), ev(source.id, "line1")],
    amounts: { extraCost: multiplyQuantity(extra, source.facts.unitPrice ?? 0) },
    numbers: { planned, delivered, extra, variancePercent: variance },
    questions: [
      {
        contactId: "OPS",
        textHe: `ל${task} תוכננו ${n(planned)} ${unit} וסופקו ${n(delivered)} ${unit}. האם הכמות הנוספת נדרשה לאותה יציקה, הוחזרה לספק, או שייכת לתכולה אחרת?`,
        suggestedReplies: [
          { id: "consumed", textHe: `כל ${n(delivered)} ה${unit} שימשו לאותה יציקה. אין החזרה ואין שינוי מאושר בתכולה.`, effect: { type: "quantity_reason", reason: "consumed" } },
          { id: "returned", textHe: `${n(extra)} ${unit} הוחזרו`, effect: { type: "quantity_reason", reason: "returned" } },
          { id: "design", textHe: "הכמות שייכת לתוספת תכנון", effect: { type: "quantity_reason", reason: "design_change" } },
          { id: "investigating", textHe: "עדיין בבדיקה", effect: { type: "quantity_reason", reason: "investigating" } },
        ],
        parser: "quantity_reason",
        checkedHe: ["תכנון היציקה", "חשבונית", "תעודת משלוח"],
        recordId: record.id,
      },
    ],
  });
}

function checkAllocationAmount(_state: DemoState, record: ErpRecord): FindingDraft | null {
  const total = sum(record.allocations.map((al) => al.amount));
  if (total === record.amount) return null;
  return emptyFinding({
    dedupeKey: `allocation_total:${record.id}:${record.version}`,
    kind: "amount_correction",
    projectId: record.projectId,
    costCodeId: record.allocations[0]?.costCodeId ?? null,
    recordIds: [record.id],
    titleHe: `סכום השיוכים אינו תואם לסכום הרשומה`,
    explanationHe: `סכום שורות השיוך (${m(total)}) שונה מסכום הרשומה (${m(record.amount)}).`,
    severity: "urgent",
    blocksReport: true,
  });
}

export function analyzeRecord(state: DemoState, recordId: string): AnalysisResult {
  const record = state.erpRecords.find((r) => r.id === recordId);
  if (!record) return { subjectId: recordId, stepsHe: [], findings: [] };
  const steps: string[] = [];
  const findings: FindingDraft[] = [];
  const source = docOf(state, record.sourceDocumentId);
  if (source) steps.push(`נמצאה חשבונית תואמת: ${source.id}`);
  else if (record.kind === "invoice" && record.sourceMissing) steps.push("חשבונית המקור טרם התקבלה");

  const push = (f: FindingDraft | FindingDraft[] | null) => {
    if (!f) return;
    for (const x of Array.isArray(f) ? f : [f]) findings.push(x);
  };
  push(checkAllocationAmount(state, record));
  push(checkClassification(state, record));
  push(checkQuantityReconciliation(state, record));
  push(checkQuantityVariance(state, record));
  push(checkCumulativeCertificate(state, record));
  push(checkContractCharge(state, record));
  push(checkAllocationCompleteness(state, record));
  push(checkFuturePriceRisk(state, record));

  for (const f of findings) steps.push(...f.checkedHe.slice(0, 2));
  const blocking = findings.some((f) => f.blocksReport || f.status === "needs_clarification");
  if (findings.length === 0) steps.push("לא נמצאו אי-התאמות");
  return { subjectId: recordId, stepsHe: dedupe(steps), findings, recordCheckStatus: blocking ? "flagged" : "verified" };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Document rules (approvals, invoices matching accruals, credits, addenda, change orders, quotes, orders, schedules)
// ---------------------------------------------------------------------------

export function analyzeDocument(state: DemoState, documentId: string): AnalysisResult {
  const document = docOf(state, documentId);
  if (!document) return { subjectId: documentId, stepsHe: [], findings: [] };
  const findings: FindingDraft[] = [];
  const steps: string[] = [];
  const push = (f: FindingDraft | null) => {
    if (f) findings.push(f);
  };
  switch (document.kind) {
    case "approval":
      push(unbilledWork(state, document));
      break;
    case "invoice":
      push(invoiceMatchesAccrual(state, document));
      break;
    case "credit":
      push(creditForCharge(state, document));
      break;
    case "addendum":
      push(contractAddendum(state, document));
      break;
    case "change_order":
      push(changeOrder(state, document));
      break;
    case "quote":
      push(steelQuote(state, document));
      break;
    case "purchase_order":
      push(futureFixedPriceOrder(state, document));
      break;
    case "schedule":
      push(scheduleChange(state, document));
      break;
    case "budget":
      findings.push(...draftBudgetAssumptions(state, document.projectIds[0]));
      break;
    default:
      break;
  }
  for (const f of findings) steps.push(...f.checkedHe.slice(0, 2));
  if (findings.length === 0) steps.push(`המסמך ${document.id} נבדק; לא נדרשה פעולה`);
  return { subjectId: documentId, stepsHe: dedupe(steps), findings };
}

function unbilledWork(state: DemoState, document: SourceDocument): FindingDraft | null {
  const contractId = document.facts.contractId;
  const commitment = state.commitments.find((c) => c.id === contractId);
  if (!commitment || document.facts.amount == null) return null;
  if (state.erpRecords.some((r) => r.accrualOfCertificateId === document.id)) return null;
  const code = codeOf(state, commitment.costCodeId);
  const amount = document.facts.amount;
  const line = costLineView(state, code.id);
  const contractRecognized = recognizedByCommitment(state).get(commitment.id) ?? 0;
  const invoicedForContract = state.erpRecords.filter((r) => isRecognized(r) && !["accrual", "accrual_reversal"].includes(r.kind) && r.allocations.some((al) => al.commitmentId === commitment.id)).reduce((acc, r) => acc + sum(r.allocations.filter((al) => al.commitmentId === commitment.id).map((al) => al.amount)), 0);
  const evidence = [ev(document.id, "text"), ev(commitment.documentId ?? commitment.id, "value")];
  if (document.facts.isAdditionalScope) {
    return emptyFinding({
      dedupeKey: `unbilled_scope:${document.id}`,
      kind: "unbilled_work",
      projectId: commitment.projectId,
      costCodeId: code.id,
      documentIds: [document.id],
      titleHe: `אישור ביצוע לתכולה נוספת: ${document.titleHe}`,
      explanationHe: `האישור מתייחס לעבודה שאינה בתכולת החוזה ${commitment.id}. אין לצרוך את יתרת החוזה; יש לטפל בה כהוראת שינוי (כמו בתרחיש 13).`,
      severity: "risk",
      status: "needs_clarification",
      checkedHe: [`נבדק החוזה ${commitment.id}: העבודה מחוץ לתכולה`],
      evidence,
      amounts: { amount },
    });
  }
  if (!document.facts.approved) {
    return emptyFinding({
      dedupeKey: `unbilled_unapproved:${document.id}`,
      kind: "unbilled_work",
      projectId: commitment.projectId,
      costCodeId: code.id,
      documentIds: [document.id],
      titleHe: `נדרש אישור ביצוע: ${document.titleHe}`,
      explanationHe: `דווח על עבודה בסך ${m(amount)} שטרם חויבה, אך אין אישור ביצוע. ההכרה בעלות ממתינה לאישור.`,
      severity: "info",
      status: "needs_clarification",
      checkedHe: ["לא נמצא אישור ביצוע חתום"],
      evidence,
      amounts: { amount },
      proposals: [
        {
          kind: "accrual",
          labelHe: "הצעה לעדכון",
          titleHe: `הכרה בעבודה שבוצעה וטרם חויבה — ${m(amount)} (ממתין לאישור ביצוע)`,
          reasonHe: "נדרש אישור ביצוע לפני ההכרה.",
          before: [row("עלות שנצברה", m(line.incurred))],
          after: [row("עלות שנצברה", m(line.incurred + amount))],
          payload: { kind: "accrual", projectId: commitment.projectId, costCodeId: code.id, commitmentId: commitment.id, certificateDocumentId: document.id, amount, supplierId: commitment.supplierId },
          evidence,
          status: "needs_clarification",
          targetIds: [commitment.id],
          costCodeId: code.id,
        },
      ],
    });
  }
  const remainingAfter = Math.max(0, commitment.value - contractRecognized - amount);
  return emptyFinding({
    dedupeKey: `unbilled_work:${document.id}`,
    kind: "unbilled_work",
    projectId: commitment.projectId,
    costCodeId: code.id,
    documentIds: [document.id, commitment.documentId ?? ""].filter(Boolean),
    titleHe: `עבודה שבוצעה והחשבונית עוד לא הגיעה: ${code.nameHe}`,
    explanationHe: `נרשמו עד כה חשבוניות בסך ${m(invoicedForContract)}, אבל יש גם עבודה מאושרת בסך ${m(amount)} שטרם חויבה. לכן העלות שנצברה היא ${m(line.incurred + amount)}. העבודה כבר נכללה בהתחייבות החוזית, ולכן תחזית העלות הכוללת אינה גדלה.`,
    severity: "info",
    checkedHe: [`נבדק אישור הביצוע ${document.id}: מאושר, בתכולת החוזה`, `נבדק החוזה ${commitment.id}: יתרה לפני ההכרה ${m(commitment.value - contractRecognized)}`, "לא נמצאה חשבונית לעבודה זו"],
    evidence,
    amounts: { amount },
    proposals: [
      {
        kind: "accrual",
        labelHe: "הצעה לעדכון",
        titleHe: `הכרה בעבודה שבוצעה וטרם חויבה — ${m(amount)}`,
        reasonHe: "העבודה אושרה ונכללת בהתחייבות החוזית; ההכרה מעבירה סכום מההתחייבות לעלות שנצברה.",
        before: [row("חשבוניות שנקלטו", m(line.incurredInvoiced)), row("עבודה שבוצעה וטרם חויבה", m(line.incurredAccrued)), row("התחייבויות שנותרו", m(line.commitments)), row("תחזית עלות לסיום", m(line.eac))],
        after: [row("חשבוניות שנקלטו", m(line.incurredInvoiced)), row("עבודה שבוצעה וטרם חויבה", m(line.incurredAccrued + amount)), row("התחייבויות שנותרו", m(line.commitments - (commitment.value - contractRecognized) + remainingAfter)), row("תחזית עלות לסיום", m(line.eac))],
        payload: { kind: "accrual", projectId: commitment.projectId, costCodeId: code.id, commitmentId: commitment.id, certificateDocumentId: document.id, amount, supplierId: commitment.supplierId },
        evidence,
        targetIds: [commitment.id],
        costCodeId: code.id,
      },
    ],
  });
}

function invoiceMatchesAccrual(state: DemoState, document: SourceDocument): FindingDraft | null {
  const certId = document.facts.matchesCertificateId;
  if (!certId) return null;
  const accrual = state.erpRecords.find((r) => r.kind === "accrual" && r.accrualOfCertificateId === certId && !state.erpRecords.some((x) => x.reversesRecordId === r.id));
  if (!accrual) return null;
  if (state.erpRecords.some((r) => r.sourceDocumentId === document.id)) return null;
  const commitment = state.commitments.find((c) => c.id === accrual.allocations[0].commitmentId)!;
  const code = codeOf(state, accrual.allocations[0].costCodeId);
  const amount = document.facts.amount ?? accrual.amount;
  const line = costLineView(state, code.id);
  const evidence = [ev(document.id, "text"), ev(certId, "text")];
  return emptyFinding({
    dedupeKey: `invoice_match:${document.id}`,
    kind: "invoice_match",
    projectId: commitment.projectId,
    costCodeId: code.id,
    recordIds: [accrual.id],
    documentIds: [document.id, certId],
    titleHe: `חשבונית עבור עבודה שכבר הוכרה: ${document.titleHe}`,
    explanationHe: `התקבלה חשבונית ${document.id} בסך ${m(amount)} בגין העבודה שכבר הוכרה לפי ${certId}. מוצע לקלוט את החשבונית ולקזז את הרישום הזמני, כך שהעלות שנצברה נשארת ${m(line.incurred)} ואין הכרה כפולה.`,
    severity: "info",
    checkedHe: [`נמצא רישום זמני ${accrual.id} בסך ${m(accrual.amount)} לאותו אישור ביצוע`, `סכום החשבונית ${m(amount)} תואם לרישום הזמני`],
    evidence,
    amounts: { amount },
    proposals: [
      {
        kind: "invoice_match",
        labelHe: "תיקון נתון",
        titleHe: `קליטת ${document.id} וקיזוז הרישום הזמני`,
        reasonHe: "החשבונית מחליפה את רכיב העבודה שטרם חויבה; אין הכרה נוספת בעלות.",
        before: [row("חשבוניות שנקלטו", m(line.incurredInvoiced)), row("עבודה שבוצעה וטרם חויבה", m(line.incurredAccrued)), row("עלות שנצברה", m(line.incurred))],
        after: [row("חשבוניות שנקלטו", m(line.incurredInvoiced + amount)), row("עבודה שבוצעה וטרם חויבה", m(line.incurredAccrued - accrual.amount)), row("עלות שנצברה", m(line.incurred + amount - accrual.amount))],
        payload: { kind: "invoice_match", accrualRecordId: accrual.id, invoiceDocumentId: document.id, amount, commitmentId: commitment.id, projectId: commitment.projectId, costCodeId: code.id, supplierId: commitment.supplierId },
        evidence,
        targetIds: [accrual.id],
        costCodeId: code.id,
      },
    ],
  });
}

function creditForCharge(state: DemoState, document: SourceDocument): FindingDraft | null {
  const originalDocId = document.facts.creditOfDocumentId;
  const original = state.erpRecords.find((r) => r.sourceDocumentId === originalDocId);
  if (!original || document.facts.amount == null) return null;
  if (state.erpRecords.some((r) => r.sourceDocumentId === document.id)) return null;
  const code = codeOf(state, original.allocations[0].costCodeId);
  const line = costLineView(state, code.id);
  const evidence = [ev(document.id, "text"), ev(originalDocId!, "line1")];
  return emptyFinding({
    dedupeKey: `credit:${document.id}`,
    kind: "contract_charge",
    projectId: original.projectId,
    costCodeId: code.id,
    recordIds: [original.id],
    documentIds: [document.id, originalDocId!],
    titleHe: `זיכוי שאושר: ${m(document.facts.amount)}`,
    explanationHe: `התקבל זיכוי מאושר בסך ${m(document.facts.amount)} כנגד ${originalDocId}. מוצע לרשום התאמת עלות מקושרת של ${formatILS(-document.facts.amount)}; החשבונית המקורית והזיכוי נשארים שניהם לעיון.`,
    severity: "info",
    checkedHe: [`הזיכוי מתייחס לחשבונית ${originalDocId}`, `סכום הזיכוי ${m(document.facts.amount)} תואם לחיוב`],
    evidence,
    amounts: { amount: document.facts.amount },
    supersedesKeys: [`contract_charge:${original.id}:${original.version}`],
    proposals: [
      {
        kind: "credit",
        labelHe: "תיקון נתון",
        titleHe: `רישום זיכוי ${document.id} כנגד ${original.id}`,
        reasonHe: "זיכוי הספק מאושר; אין תשלום או תקבול בפועל בדמו.",
        before: [row("עלות שנצברה בסעיף", m(line.incurred))],
        after: [row("עלות שנצברה בסעיף", m(line.incurred - document.facts.amount))],
        payload: { kind: "credit", originalRecordId: original.id, creditDocumentId: document.id, amount: document.facts.amount },
        evidence,
        targetIds: [original.id],
        costCodeId: code.id,
      },
    ],
  });
}

function contractAddendum(state: DemoState, document: SourceDocument): FindingDraft | null {
  if (document.facts.chargeType === "freight") {
    // handled by the freight record re-analysis
    const original = state.erpRecords.find((r) => r.chargeType === "freight" && docOf(state, r.sourceDocumentId)?.facts.contractId === document.facts.contractId);
    return original ? checkContractCharge({ ...state, findings: state.findings.map((f) => (f.kind === "contract_charge" && f.recordIds.includes(original.id) ? { ...f, status: "superseded" as const } : f)) }, original) : null;
  }
  const commitment = state.commitments.find((c) => c.id === document.facts.contractId);
  if (!commitment || document.facts.amount == null) return null;
  const code = codeOf(state, commitment.costCodeId);
  const line = costLineView(state, code.id);
  const amount = document.facts.amount;
  const newValue = document.facts.contractValue ?? commitment.value + amount;
  if (commitment.versions.some((v) => v.documentId === document.id)) return null;
  const evidence = [ev(document.id, "text"), ev(commitment.documentId ?? commitment.id, "value")];
  const recognized = recognizedByCommitment(state).get(commitment.id) ?? 0;
  const newRemaining = newValue - recognized;
  const known = recognized + newRemaining;
  if (!document.facts.signed) {
    return emptyFinding({
      dedupeKey: `commitment_conditional:${document.id}`,
      kind: "commitment_conditional",
      projectId: commitment.projectId,
      costCodeId: code.id,
      documentIds: [document.id],
      titleHe: `טיוטת תוספת שטרם נחתמה: ${document.titleHe}`,
      explanationHe: `קיימת טיוטת תוספת בסך ${m(amount)} לחוזה ${commitment.id} שטרם נחתמה. עד לחתימה היא מוצגת כסיכון מותנה; ההתחייבות המאושרת נשארת ${m(line.commitments)}.`,
      severity: "risk",
      status: "conditional",
      checkedHe: [`נבדקה הטיוטה ${document.id}: ללא חתימה`, `החוזה ${commitment.id} ללא שינוי`],
      evidence,
      amounts: { futurePremium: amount, amount },
    });
  }
  return emptyFinding({
    dedupeKey: `commitment_overrun:${document.id}`,
    kind: "commitment_overrun",
    projectId: commitment.projectId,
    costCodeId: code.id,
    documentIds: [document.id, commitment.documentId ?? ""].filter(Boolean),
    titleHe: `התחייבויות חושפות חריגה לפני הגעת החשבוניות: ${code.nameHe}`,
    explanationHe: `עד כה נצברו ${m(line.incurred)} בלבד, אבל לאחר התוספת החתומה נותרו התחייבויות של ${m(newRemaining)}. העלות הידועה לפי ההסכמים היא כבר ${m(known)} — לפחות ${m(known - code.budget)} מעל תקציב הסעיף, עוד לפני חשבוניות נוספות.`,
    severity: known > code.budget ? "urgent" : "info",
    checkedHe: [`נבדקה התוספת ${document.id}: חתומה, ${m(amount)}`, `סך החוזה המעודכן ${m(newValue)} לעומת תקציב ${m(code.budget)}`, "החשבוניות והתשלומים אינם משתנים"],
    evidence,
    amounts: { amount, newValue, known, overrun: known - code.budget },
    proposals: [
      {
        kind: "commitment",
        labelHe: "הצעה לעדכון",
        titleHe: `עדכון התחייבות: ${commitment.titleHe} ${m(commitment.value)} ← ${m(newValue)}`,
        reasonHe: "תוספת חתומה לחוזה; העבודה טרם חויבה ולכן נכנסת להתחייבויות, לא לעלות שנצברה.",
        before: [row("סך חוזה", m(commitment.value)), row("התחייבויות שנותרו", m(line.commitments)), row("תחזית עלות לסיום", m(line.eac))],
        after: [row("סך חוזה", m(newValue)), row("התחייבויות שנותרו", m(line.commitments + amount)), row("תחזית עלות לסיום", m(line.eac + amount))],
        payload: {
          kind: "commitment",
          projectId: commitment.projectId,
          costCodeId: code.id,
          commitmentId: commitment.id,
          newValue,
          workItem: { id: `${commitment.id}-ADD-${document.id}`, titleHe: `תכולה נוספת לפי ${document.id}`, forecastAmount: amount, basisHe: `תוספת חתומה ${document.id}`, evidence: [ev(document.id, "text")] },
        },
        evidence,
        targetIds: [commitment.id],
        costCodeId: code.id,
      },
    ],
  });
}

function changeOrder(state: DemoState, document: SourceDocument): FindingDraft | null {
  const commitment = state.commitments.find((c) => c.id === document.facts.contractId);
  if (!commitment || document.facts.amount == null) return null;
  if (state.commitments.some((c) => c.documentId === document.id) || state.workItems.some((w) => w.sourceDocumentId === document.id)) return null;
  const code = codeOf(state, commitment.costCodeId);
  const line = costLineView(state, code.id);
  const amount = document.facts.amount;
  const recovery = document.facts.recoveryClaim;
  const evidence = [ev(document.id, "text"), ev(commitment.documentId ?? commitment.id, "scope")];
  const recoveryNote = recovery != null ? ` דרישת ההחזר מהלקוח עדיין ממתינה לאישור, ולכן מוצגת בנפרד ואינה מקטינה את תחזית העלות.` : "";
  const recoveryPayload = recovery != null ? { id: `REC-${document.id}`, amount: recovery, documentId: document.id, titleHe: `דרישת החזר מלקוח הקצה — ${document.titleHe}` } : undefined;
  if (document.facts.signed) {
    return emptyFinding({
      dedupeKey: `scope_change:${document.id}`,
      kind: "scope_change",
      projectId: commitment.projectId,
      costCodeId: code.id,
      documentIds: [document.id],
      titleHe: `הוראת שינוי שלא נכנסה לתחזית: ${code.nameHe}`,
      explanationHe: `אושרה תוספת עבודה בעלות ${m(amount)} שטרם נכללה בתחזית. צריך להוסיף אותה לעלות הצפויה.${recoveryNote}`,
      severity: "risk",
      checkedHe: [`נבדקה הוראת השינוי ${document.id}: חתומה על ידי החברה והקבלן`, `התכולה מחוץ לחוזה ${commitment.id} ומחוץ לתחזית העבודה הנוספת הקיימת`, "דרישת ההחזר נבדקה בנפרד: טרם אושרה"],
      evidence,
      amounts: { amount, recovery: recovery ?? 0 },
      proposals: [
        {
          kind: "commitment",
          labelHe: "הצעה לעדכון",
          titleHe: `הוספת התחייבות ${m(amount)} — ${document.titleHe}`,
          reasonHe: "הוראת שינוי חתומה מול הקבלן: העבודה טרם בוצעה, ולכן נכנסת להתחייבויות.",
          before: [row("התחייבויות שנותרו", m(line.commitments)), row("תחזית עלות לסיום", m(line.eac)), row("החזר מלקוח", "—")],
          after: [row("התחייבויות שנותרו", m(line.commitments + amount)), row("תחזית עלות לסיום", m(line.eac + amount)), row("החזר מלקוח", recovery != null ? `${m(recovery)} — ממתין לאישור (נפרד)` : "—")],
          payload: {
            kind: "commitment",
            projectId: commitment.projectId,
            costCodeId: code.id,
            create: { id: `CO-${document.id}`, supplierId: commitment.supplierId, kind: "change_order", titleHe: document.titleHe, value: amount, documentId: document.id },
            workItem: { id: `WI-${document.id}`, titleHe: `תוספת איטום לפי ${document.id}`, forecastAmount: amount, basisHe: `הוראת שינוי ${document.id}`, evidence: [ev(document.id, "text")] },
            recovery: recoveryPayload,
          },
          evidence,
          targetIds: [code.id],
          costCodeId: code.id,
        },
      ],
    });
  }
  if (document.facts.approved) {
    return emptyFinding({
      dedupeKey: `scope_change_internal:${document.id}`,
      kind: "scope_change",
      projectId: commitment.projectId,
      costCodeId: code.id,
      documentIds: [document.id],
      titleHe: `תוספת שאושרה פנימית וטרם הוזמנה: ${code.nameHe}`,
      explanationHe: `החברה אישרה תכולה נוספת בעלות מוערכת של ${m(amount)}, אך טרם התחייבה מול ספק. ההערכה נכנסת ליתרת העבודה ללא התחייבות.${recoveryNote}`,
      severity: "risk",
      checkedHe: [`נבדק המסמך ${document.id}: אישור פנימי ללא חתימת קבלן`],
      evidence,
      amounts: { amount },
      proposals: [
        {
          kind: "forecast",
          labelHe: "הצעה לעדכון",
          titleHe: `הוספת ${m(amount)} ליתרת העבודה ללא התחייבות`,
          reasonHe: "אישור פנימי ללא התחייבות ספק: הערכה נבדקת ביתרת העבודה.",
          before: [row("יתרת עבודה ללא התחייבות", m(line.uncommitted)), row("תחזית עלות לסיום", m(line.eac))],
          after: [row("יתרת עבודה ללא התחייבות", m(line.uncommitted + amount)), row("תחזית עלות לסיום", m(line.eac + amount))],
          payload: { kind: "forecast", projectId: commitment.projectId, costCodeId: code.id, items: [], newWorkItems: [{ id: `WI-${document.id}`, titleHe: `תוספת מאושרת פנימית לפי ${document.id}`, amount, basisHe: `אומדן מאושר פנימית ${document.id}`, evidence: [ev(document.id, "text")] }], recovery: recoveryPayload },
          evidence,
          targetIds: [code.id],
          costCodeId: code.id,
        },
      ],
    });
  }
  return emptyFinding({
    dedupeKey: `scope_change_proposed:${document.id}`,
    kind: "commitment_conditional",
    projectId: commitment.projectId,
    costCodeId: code.id,
    documentIds: [document.id],
    titleHe: `תוספת מוצעת שטרם אושרה: ${code.nameHe}`,
    explanationHe: `הוצעה תוספת עבודה בעלות ${m(amount)} שטרם אושרה. היא מוצגת כסיכון מותנה ואינה נכללת בתחזית המאושרת.`,
    severity: "risk",
    status: "conditional",
    checkedHe: [`נבדק המסמך ${document.id}: ללא אישור`],
    evidence,
    amounts: { futurePremium: amount, amount },
  });
}

function steelQuote(state: DemoState, document: SourceDocument): FindingDraft | null {
  if (document.facts.material !== "steel" || document.facts.unitPrice == null) return null;
  const code = state.costCodes.find((c) => c.projectId === document.projectIds[0] && c.category === "steel");
  if (!code) return null;
  const items = state.workItems.filter((w) => w.costCodeId === code.id && w.status === "uncommitted");
  if (items.length === 0) return null;
  if (state.forecasts.some((f) => f.evidence.some((e) => e.documentId === document.id))) return null;
  const today = isoDateOf(state.clock);
  const evidence = [ev(document.id, "text")];
  const remainingQty = sum(items.map((w) => currentForecast(state, w.id)?.quantity ?? w.quantity ?? 0));
  const acceptedPrice = currentForecast(state, items[0].id)?.unitPrice ?? code.budgetUnitPrice ?? 0;
  const currentR = sum(items.map((w) => currentForecast(state, w.id)?.amount ?? 0));
  if (document.facts.validUntil && document.facts.validUntil < today) {
    return emptyFinding({ dedupeKey: `quote_expired:${document.id}`, kind: "cross_project_opportunity", projectId: code.projectId, costCodeId: code.id, documentIds: [document.id], titleHe: `הצעה שפג תוקפה: ${document.titleHe}`, explanationHe: `ההצעה ${document.id} הייתה בתוקף עד ${formatDate(document.facts.validUntil)}. אי אפשר לבסס עליה תחזית; נדרשת הצעה מעודכנת. התחזית המאושרת נשארת ${m(currentR)}.`, severity: "info", status: "needs_clarification", checkedHe: [`תוקף ההצעה: ${formatDate(document.facts.validUntil)} — פג`], evidence, amounts: {} });
  }
  if (document.facts.freightIncluded === false) {
    return emptyFinding({ dedupeKey: `quote_incomparable:${document.id}`, kind: "cross_project_opportunity", projectId: code.projectId, costCodeId: code.id, documentIds: [document.id], titleHe: `הצעה ללא רכיב הובלה: ${document.titleHe}`, explanationHe: `ההצעה אינה כוללת הובלה, ורכיב ההובלה אינו ידוע. לא ניתן להשוות אותה להנחת התחזית הכוללת הובלה עד לקבלת מחיר הובלה.`, severity: "info", status: "needs_clarification", checkedHe: ["נבדקו תנאי ההצעה: הובלה אינה כלולה"], evidence, amounts: {} });
  }
  if (document.facts.comparable === false) return null;
  const price = document.facts.unitPrice;
  const newR = sum(items.map((w) => multiplyQuantity(currentForecast(state, w.id)?.quantity ?? w.quantity ?? 0, price)));
  const improvement = currentR - newR;
  const line = costLineView(state, code.id);
  return emptyFinding({
    dedupeKey: `steel_quote:${document.id}`,
    kind: "cross_project_opportunity",
    projectId: code.projectId,
    costCodeId: code.id,
    documentIds: [document.id],
    titleHe: `הצעה חדשה לברזל: ${m(price)} ל${code.unit ?? "טון"}`,
    explanationHe: `התקבלה הצעה תקפה: ${n(document.facts.quantity ?? remainingQty)} ${code.unit} ב-${m(price)} ל${code.unit} כולל הובלה, בתוקף עד ${formatDate(document.facts.validUntil ?? today)}. מול ההנחה המאושרת של ${m(acceptedPrice)}, התחזית ליתרה תרד ל-${m(newR)} (שיפור של ${m(improvement)}). ההצעה היא בסיס לתחזית בלבד; טרם הוצאה הזמנה.${newR + line.incurred > code.budget ? ` הסעיף עדיין מעל התקציב ב-${m(newR + line.incurred - code.budget)}.` : ""}`,
    severity: improvement > 0 ? "opportunity" : "info",
    checkedHe: [`נבדק המפרט: ${document.facts.spec ?? "—"} תואם לרכישות הקיימות`, "נבדקו תנאים: הובלה כלולה, שוטף + 60", `תוקף: עד ${formatDate(document.facts.validUntil ?? today)}`, `כמות בהצעה: ${n(document.facts.quantity ?? 0)} ${code.unit} לעומת יתרה ${n(remainingQty)} ${code.unit}`],
    evidence,
    amounts: { newR, currentR, improvement, price },
    proposals: [
      {
        kind: "forecast",
        labelHe: "הצעה לעדכון תחזית",
        titleHe: `עדכון הנחת המחיר ליתרת הברזל: ${m(acceptedPrice)} ← ${m(price)}`,
        reasonHe: `הצעה תקפה ${document.id}; נשארת בסיס לתחזית עד להזמנה חתומה.`,
        before: [row("מחיר ליחידה מאושר", m(acceptedPrice)), row("יתרת עבודה ללא התחייבות", m(currentR)), row("תחזית עלות לסיום", m(line.eac))],
        after: [row("מחיר ליחידה מאושר", m(price)), row("יתרת עבודה ללא התחייבות", m(newR)), row("תחזית עלות לסיום", m(line.eac - improvement))],
        payload: {
          kind: "forecast",
          projectId: code.projectId,
          costCodeId: code.id,
          items: items.map((w) => {
            const qty = currentForecast(state, w.id)?.quantity ?? w.quantity ?? 0;
            return { workItemId: w.id, quantity: qty, unitPrice: price, amount: multiplyQuantity(qty, price), basisHe: `הצעה ${document.id}: ${m(price)} ל${code.unit} כולל הובלה, בתוקף עד ${formatDate(document.facts.validUntil ?? today)}`, evidence, validUntil: document.facts.validUntil };
          }),
        },
        evidence,
        targetIds: items.map((w) => w.id),
        costCodeId: code.id,
      },
    ],
  });
}

function futureFixedPriceOrder(state: DemoState, document: SourceDocument): FindingDraft | null {
  if (!document.facts.signed || document.facts.quantity == null || document.facts.unitPrice == null) return null;
  if (state.commitments.some((c) => c.documentId === document.id)) return null;
  // Only orders for future (not yet delivered/invoiced) quantities create a new commitment; fulfilled baseline POs are linked already.
  if (state.erpRecords.some((r) => docOf(state, r.sourceDocumentId)?.facts.purchaseOrderId === document.id)) return null;
  const code = state.costCodes.find((c) => c.projectId === document.projectIds[0] && c.category === document.facts.material);
  if (!code) return null;
  const item = state.workItems.find((w) => w.costCodeId === code.id && w.status === "uncommitted" && (w.quantity ?? 0) >= document.facts.quantity!);
  if (!item) return null;
  const forecast = currentForecast(state, item.id);
  const itemQty = forecast?.quantity ?? item.quantity ?? 0;
  const itemPrice = forecast?.unitPrice ?? code.budgetUnitPrice ?? 0;
  const orderQty = document.facts.quantity;
  const orderValue = document.facts.amount ?? multiplyQuantity(orderQty, document.facts.unitPrice);
  const remainingQty = itemQty - orderQty;
  const remainingAmount = multiplyQuantity(remainingQty, itemPrice);
  const removedForecast = multiplyQuantity(orderQty, itemPrice);
  const line = costLineView(state, code.id);
  const evidence = [ev(document.id, "text")];
  return emptyFinding({
    dedupeKey: `fixed_order:${document.id}`,
    kind: "commitment_overrun",
    projectId: code.projectId,
    costCodeId: code.id,
    documentIds: [document.id],
    titleHe: `הזמנה במחיר קבוע לחלק מהכמות: ${document.titleHe}`,
    explanationHe: `נחתמה הזמנה ל-${n(orderQty)} ${code.unit} במחיר קבוע של ${m(document.facts.unitPrice)} ל${code.unit} (${m(orderValue)}). הכמות עוברת מיתרת העבודה ללא התחייבות להתחייבויות, ואינה חשופה עוד לשינוי מחיר. ${n(remainingQty)} ${code.unit} נותרים ללא התחייבות.`,
    severity: "info",
    checkedHe: [`נבדקה ההזמנה ${document.id}: חתומה, ${n(orderQty)} ${code.unit} × ${m(document.facts.unitPrice)}`, `יתרת העבודה ללא התחייבות לפני: ${n(itemQty)} ${code.unit}`],
    evidence,
    amounts: { orderValue, removedForecast },
    numbers: { orderQty, remainingQty },
    proposals: [
      {
        kind: "commitment",
        labelHe: "הצעה לעדכון",
        titleHe: `רישום התחייבות ${m(orderValue)} והקטנת יתרת העבודה ללא התחייבות`,
        reasonHe: "הזמנה חתומה לכמות עתידית: ההתחייבות מחליפה את ערך התחזית של אותה כמות.",
        before: [row("התחייבויות שנותרו", m(line.commitments)), row("יתרת עבודה ללא התחייבות", `${m(line.uncommitted)} (${n(itemQty)} ${code.unit})`), row("תחזית עלות לסיום", m(line.eac))],
        after: [row("התחייבויות שנותרו", m(line.commitments + orderValue)), row("יתרת עבודה ללא התחייבות", `${m(line.uncommitted - removedForecast)} (${n(remainingQty)} ${code.unit})`), row("תחזית עלות לסיום", m(line.eac + orderValue - removedForecast))],
        payload: {
          kind: "commitment",
          projectId: code.projectId,
          costCodeId: code.id,
          create: { id: document.id, supplierId: document.supplierId, kind: "purchase_order", titleHe: document.titleHe, value: orderValue, documentId: document.id, quantity: orderQty, unit: code.unit, unitPrice: document.facts.unitPrice },
          workItem: { id: `${item.id}-LOCKED-${orderQty}`, titleHe: `${code.nameHe} — ${n(orderQty)} ${code.unit} במחיר קבוע`, quantity: orderQty, unit: code.unit, forecastAmount: orderValue, basisHe: `הזמנה חתומה ${document.id}`, evidence },
          reduceWorkItem: { workItemId: item.id, quantity: remainingQty, unitPrice: itemPrice, amount: remainingAmount },
        },
        evidence,
        targetIds: [item.id],
        costCodeId: code.id,
      },
    ],
  });
}

function scheduleChange(state: DemoState, document: SourceDocument): FindingDraft | null {
  const project = state.projects.find((p) => p.id === document.projectIds[0]);
  if (!project || document.facts.months == null || !document.facts.approved) return null;
  const plan = state.documents.find((d) => d.kind === "plan" && d.facts.monthlyComponents && d.projectIds.includes(project.id));
  if (!plan?.facts.monthlyComponents) return null;
  if (state.workItems.some((w) => w.sourceDocumentId === document.id)) return null;
  const code = state.costCodes.find((c) => c.projectId === project.id && c.category === "site_overhead")!;
  const baseMonths = project.acceptedMonths ?? project.plannedMonths ?? plan.facts.months ?? 12;
  const extraMonths = document.facts.months - baseMonths;
  if (extraMonths <= 0) return null;
  const componentIds = document.facts.componentIds ?? plan.facts.monthlyComponents.map((c) => c.id);
  const components = plan.facts.monthlyComponents.filter((c) => componentIds.includes(c.id));
  const monthly = sum(components.map((c) => c.amount));
  const extra = monthly * extraMonths;
  const line = costLineView(state, code.id);
  const evidence = [ev(document.id, "text"), ev(plan.id, "monthly")];
  return emptyFinding({
    dedupeKey: `duration:${document.id}`,
    kind: "duration_impact",
    projectId: project.id,
    costCodeId: code.id,
    documentIds: [document.id, plan.id],
    titleHe: `עיכוב בלוח הזמנים מגדיל את עלויות האתר: ${extraMonths} חודשים נוספים`,
    explanationHe: `משך האתר מתעדכן מ-${n(baseMonths)} ל-${n(document.facts.months)} חודשים (סיום ${formatDate(document.facts.siteFinish ?? project.plannedFinish)}). העלות החודשית של הרכיבים הממשיכים (${components.map((c) => c.nameHe).join(", ")}) היא ${m(monthly)}; ${n(extraMonths)} חודשים נוספים מוסיפים ${m(extra)} ליתרת העבודה ללא התחייבות. לא נוצרת חשבונית או תשלום.`,
    severity: "risk",
    checkedHe: [`נבדק תכנון האתר ${plan.id}: ${components.map((c) => `${c.nameHe} ${m(c.amount)}`).join(", ")}`, `העדכון ${document.id} מאושר: משך ${n(document.facts.months)} חודשים`, "התקציב המאושר אינו משתנה"],
    evidence,
    amounts: { extra, monthly },
    numbers: { months: document.facts.months, extraMonths },
    proposals: [
      {
        kind: "duration",
        labelHe: "הצעה לעדכון תחזית",
        titleHe: `הארכת משך האתר ל-${n(document.facts.months)} חודשים: +${m(extra)}`,
        reasonHe: `${n(extraMonths)} חודשים × ${m(monthly)} לחודש לרכיבים הממשיכים.`,
        before: [row("סיום מאושר", formatDate(project.acceptedFinish ?? project.plannedFinish)), row("יתרת עבודה ללא התחייבות", m(line.uncommitted)), row("תחזית עלות לסיום", m(line.eac))],
        after: [row("סיום מאושר", formatDate(document.facts.siteFinish ?? project.plannedFinish)), row("יתרת עבודה ללא התחייבות", m(line.uncommitted + extra)), row("תחזית עלות לסיום", m(line.eac + extra))],
        payload: { kind: "duration", projectId: project.id, months: document.facts.months, finish: document.facts.siteFinish ?? project.plannedFinish ?? "", componentIds, extraMonths, extraAmount: extra, workItemId: `H-SITE-EXT-${document.id}`, costCodeId: code.id, documentId: document.id },
        evidence,
        targetIds: [project.id],
        costCodeId: code.id,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Draft budget assumption comparison (S02)
// ---------------------------------------------------------------------------

export function draftBudgetAssumptions(state: DemoState, projectId: string): FindingDraft[] {
  const version = state.budgetVersions.filter((b) => b.projectId === projectId && b.kind === "draft" && b.status === "current")[0];
  if (!version) return [];
  const today = isoDateOf(state.clock);
  const out: FindingDraft[] = [];
  for (const line of version.lines) {
    if (line.unitPrice == null || line.quantity == null) continue;
    const draftDoc = docOf(state, version.documentId);
    const material = draftDoc?.facts.material ?? "concrete";
    const spec = draftDoc?.facts.spec;
    const quotes = state.documents.filter((d) => d.kind === "quote" && d.projectIds.includes(projectId) && d.facts.material === material);
    const comparable = quotes.filter((q) => q.facts.comparable && q.facts.spec === spec && q.facts.freightIncluded && (!q.facts.validUntil || q.facts.validUntil >= today));
    const expired = quotes.filter((q) => q.facts.comparable && q.facts.validUntil && q.facts.validUntil < today);
    const excluded = quotes.filter((q) => q.facts.comparable === false);
    const contract = state.documents.find((d) => d.kind === "contract" && d.projectIds.includes(projectId) && d.facts.material === material && d.facts.signed && d.facts.unitPrice === line.unitPrice);
    const checked = [
      ...comparable.map((q) => `${q.id}: ${m(q.facts.unitPrice ?? 0)} למ״ק, ${q.facts.spec}, כולל הובלה, ללא שאיבה, ${q.facts.paymentTermsHe}, בתוקף עד ${formatDate(q.facts.validUntil)}`),
      ...excluded.map((q) => `${q.id} לא נכלל בהשוואה — מפרט ותנאים שונים (${q.facts.incomparableReasonHe ?? ""})`),
      ...expired.map((q) => `${q.id} פג תוקף ב-${formatDate(q.facts.validUntil)}`),
    ];
    const dedupeKey = `budget_assumption:${version.id}:${line.id}:${line.unitPrice}`;
    if (contract) {
      if (state.findings.some((f) => f.dedupeKey === `${dedupeKey}:contract`)) continue;
      out.push(
        emptyFinding({
          dedupeKey: `${dedupeKey}:contract`,
          supersedesKeys: [dedupeKey],
          kind: "budget_assumption",
          projectId,
          costCodeId: line.id,
          documentIds: [version.documentId, contract.id],
          titleHe: `הנחת מחיר ${line.nameHe} נתמכת בהסכם תקף`,
          explanationHe: `קיים הסכם תקף (${contract.id}) ל-${n(contract.facts.quantity ?? line.quantity)} ${line.unit} ${materialHe[material]} במחיר ${m(line.unitPrice)} ל${line.unit}, באותו מפרט ובאותם תנאים. ההנחה בטיוטה נשארת כפי שהיא.`,
          severity: "info",
          checkedHe: [`נבדק ההסכם ${contract.id}: מפרט ${contract.facts.spec}, הובלה כלולה, ${contract.facts.paymentTermsHe}`, ...checked],
          evidence: [ev(contract.id, "text"), ev(version.documentId, "concrete")],
          amounts: {},
          proposals: [
            {
              kind: "dismiss_flag",
              labelHe: "סגירת בדיקה",
              titleHe: `השארת הנחת ${m(line.unitPrice)} ל${line.unit} — הסכם תקף`,
              reasonHe: `ההסכם ${contract.id} תומך במחיר ובתנאים.`,
              before: [row("מחיר ליחידה בטיוטה", m(line.unitPrice))],
              after: [row("מחיר ליחידה בטיוטה", `${m(line.unitPrice)} (ללא שינוי)`)],
              payload: { kind: "dismiss_flag", findingId: "", recordId: null },
              evidence: [ev(contract.id, "text")],
              targetIds: [line.id],
              costCodeId: line.id,
            },
          ],
        }),
      );
      continue;
    }
    if (state.findings.some((f) => f.dedupeKey === dedupeKey)) continue;
    if (comparable.length === 0) {
      if (expired.length > 0) {
        out.push(emptyFinding({ dedupeKey: `${dedupeKey}:expired`, kind: "budget_assumption", projectId, costCodeId: line.id, documentIds: [version.documentId], titleHe: `הצעות המחיר ל${line.nameHe} פגו תוקף`, explanationHe: `ההצעות ששימשו להשוואה פגו תוקף. החלטת מחיר חדשה דורשת הצעות מעודכנות; הטיוטה שאושרה קודם אינה משתנה.`, severity: "info", status: "needs_clarification", checkedHe: checked, evidence: [ev(version.documentId, "concrete")], amounts: {} }));
      }
      continue;
    }
    const prices = comparable.map((q) => q.facts.unitPrice ?? 0).sort((x, y) => x - y);
    const min = prices[0];
    const max = prices[prices.length - 1];
    if (line.unitPrice >= min) continue;
    const lowGap = multiplyQuantity(line.quantity, min - line.unitPrice);
    const highGap = multiplyQuantity(line.quantity, max - line.unitPrice);
    const defaultPrice = prices[Math.floor(prices.length / 2)];
    const newAmount = multiplyQuantity(line.quantity, defaultPrice);
    const total = sum(version.lines.map((l) => l.amount));
    out.push(
      emptyFinding({
        dedupeKey,
        kind: "budget_assumption",
        projectId,
        costCodeId: line.id,
        documentIds: [version.documentId, ...comparable.map((q) => q.id), ...excluded.map((q) => q.id)],
        titleHe: `הנחת מחיר ${line.nameHe} נמוכה מהצעות המחיר`,
        explanationHe: `מחיר ה${line.nameHe.toLowerCase()} בטיוטה הוא ${m(line.unitPrice)} ל${line.unit}. ב${comparable.length === 3 ? "שלוש" : n(comparable.length)} הצעות ההדגמה המתאימות למפרט ולתנאים מופיעים ${m(min).replace(" ₪", "")}–${m(max)} ל${line.unit}. בכמות של ${n(line.quantity)} ${line.unit}, הפער האפשרי הוא ${m(lowGap).replace(" ₪", "")}–${m(highGap)}. כדאי לאמת את ההנחה לפני אישור התקציב.`,
        severity: "risk",
        checkedHe: [`נבדקה טיוטת התקציב ${version.documentId}: ${n(line.quantity)} ${line.unit} × ${m(line.unitPrice)}`, ...checked],
        evidence: [ev(version.documentId, "concrete"), ...comparable.map((q) => ev(q.id, "price")), ...excluded.map((q) => ev(q.id, "exclusion"))],
        amounts: { lowGap, highGap, draftPrice: line.unitPrice, minPrice: min, maxPrice: max },
        numbers: { quantity: line.quantity },
        proposals: [
          {
            kind: "draft_budget",
            labelHe: "הצעה לעדכון טיוטה",
            titleHe: `עדכון מחיר ${line.nameHe} בטיוטה: ${m(line.unitPrice)} ← ${m(defaultPrice)}`,
            reasonHe: `ברירת מחדל: ההצעה האמצעית מבין ההצעות המתאימות. אפשר לבחור מחיר אחר לפני העדכון.`,
            before: [row("מחיר ליחידה", m(line.unitPrice)), row(`סה״כ ${line.nameHe}`, m(line.amount)), row("סך הטיוטה", m(total))],
            after: [row("מחיר ליחידה", m(defaultPrice)), row(`סה״כ ${line.nameHe}`, m(newAmount)), row("סך הטיוטה", m(total - line.amount + newAmount))],
            payload: { kind: "draft_budget", projectId, lineId: line.id, unitPrice: defaultPrice, quantity: line.quantity, noteHe: `עודכן לפי השוואת הצעות מחיר (${comparable.map((q) => q.id).join(", ")})` },
            evidence: comparable.map((q) => ev(q.id, "price")),
            targetIds: [version.id],
            costCodeId: line.id,
          },
        ],
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cost-code level: cross-project comparison (S16)
// ---------------------------------------------------------------------------

export function analyzeCostCode(state: DemoState, costCodeId: string): AnalysisResult {
  const code = codeOf(state, costCodeId);
  const findings: FindingDraft[] = [];
  if (code.category === "steel") {
    const items = state.workItems.filter((w) => w.costCodeId === code.id && w.status === "uncommitted");
    const remainingQty = sum(items.map((w) => currentForecast(state, w.id)?.quantity ?? w.quantity ?? 0));
    const accepted = items.length ? (currentForecast(state, items[0].id)?.unitPrice ?? code.budgetUnitPrice ?? 0) : 0;
    const ownSpec = state.erpRecords.filter((r) => r.allocations.some((al) => al.costCodeId === code.id)).map((r) => docOf(state, r.sourceDocumentId)?.facts.spec).find(Boolean);
    const others = state.erpRecords
      .filter((r) => r.kind === "invoice" && r.projectId !== code.projectId)
      .map((r) => ({ record: r, doc: docOf(state, r.sourceDocumentId) }))
      .filter((x) => x.doc?.facts.material === "steel" && x.doc?.facts.spec === ownSpec && x.doc?.facts.unitPrice != null && x.doc.facts.unitPrice < accepted)
      .sort((a, b) => (a.doc!.facts.unitPrice ?? 0) - (b.doc!.facts.unitPrice ?? 0));
    const best = others[0];
    if (best && remainingQty > 0) {
      const price = best.doc!.facts.unitPrice!;
      const gap = accepted - price;
      const opportunity = multiplyQuantity(remainingQty, gap);
      const dedupeKey = `cross_project:${code.id}:${best.record.id}:${accepted}`;
      if (!state.findings.some((f) => f.dedupeKey === dedupeKey)) {
        findings.push(
          emptyFinding({
            dedupeKey,
            kind: "cross_project_opportunity",
            projectId: code.projectId,
            costCodeId: code.id,
            recordIds: [best.record.id],
            documentIds: [best.doc!.id],
            titleHe: `הזדמנות רכש: ${projectNameOf(state, best.record.projectId)} רכש את אותו מפרט ב-${m(price)} ל${code.unit}`,
            explanationHe: `ב${projectNameOf(state, best.record.projectId)} נרכש ברזל מאותו מפרט ב-${m(price)} ל${code.unit}. זו רכישה קודמת, ולכן המחיר והזמינות ליתרת ${projectNameOf(state, code.projectId).replace("מגורי ", "")} דורשים בדיקה. מול הנחת התחזית של ${m(accepted)}, פער של ${m(gap)} על ${n(remainingQty)} ${code.unit} משקף הזדמנות אפשרית של ${m(opportunity)}.`,
            severity: "opportunity",
            checkedHe: [`מפרט: ${ownSpec} בשני הפרויקטים`, `תאריך הרכישה: ${formatDate(best.record.date)}; כמות ${n(best.record.quantity ?? 0)} ${code.unit}`, `תנאים: ${best.doc!.facts.paymentTermsHe ?? "—"}; הובלה ${best.doc!.facts.freightIncluded ? "כלולה" : "לא כלולה"} (${best.doc!.facts.destinationHe ?? ""})`, "ההצעה אינה זמינה אוטומטית ליתרה; נדרשת הצעה חדשה"],
            evidence: [ev(best.doc!.id, "line1"), ev(best.doc!.id, "limitation"), ev(items[0].sourceDocumentId ?? "FC-H-STEEL", "summary")],
            amounts: { opportunity, gap, otherPrice: price, accepted },
            numbers: { remaining: remainingQty },
          }),
        );
      }
    }
  }
  return { subjectId: costCodeId, stepsHe: findings.flatMap((f) => f.checkedHe.slice(0, 2)), findings };
}

export function workItemsForCode(state: DemoState, costCodeId: string): WorkItem[] {
  return state.workItems.filter((w) => w.costCodeId === costCodeId);
}
