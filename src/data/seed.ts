import { ils, formatILS, formatNumber } from "../domain/money";
import type {
  Allocation,
  BudgetVersion,
  Commitment,
  CostCode,
  DemoState,
  ErpRecord,
  ForecastVersion,
  Project,
  SourceDocument,
  WorkItem,
} from "../domain/types";
import { baselineDocuments, doc } from "./documents";

export const SEED_VERSION = "construction-demo-v1.1";
export const SEED_CLOCK = "2026-09-07T09:00:00+03:00";
export const PRIOR_REPORT_CUTOFF = "2026-08-31T09:00:00+03:00";
export const SEED_START = "2026-03-01T08:00:00+03:00";
export const REVIEWER_ID = "REVIEWER";

const OPENING_NOTE = "יתרת פתיחה מאומתת לצורכי ההדגמה; פירוט תנועות היסטוריות אינו נכלל בדמו.";

export const projectsSeed: Project[] = [
  { id: "HAD", nameHe: "מגורי הדרים", shortNameHe: "הדרים", status: "active", cityHe: "כפר סבא", start: "2026-03-01", plannedFinish: "2027-02-28", plannedMonths: 12, aliases: ["הדרים", "מגורי הדרים", "בהדרים", "להדרים"] },
  { id: "PAR", nameHe: "מתחם הפארק", shortNameHe: "פארק", status: "active", cityHe: "רעננה", aliases: ["הפארק", "מתחם הפארק", "בפארק", "פארק"] },
  { id: "GAN", nameHe: "גני השקד", shortNameHe: "גני השקד", status: "active", cityHe: "הוד השרון", aliases: ["גני השקד", "השקד", "בגני השקד"] },
  { id: "YAM", nameHe: "מרכז הים", shortNameHe: "מרכז הים", status: "active", cityHe: "הרצליה", aliases: ["מרכז הים", "הים", "במרכז הים"] },
  { id: "NOF", nameHe: "נוף הגבעה", shortNameHe: "נוף הגבעה", status: "draft", cityHe: "כפר סבא", aliases: ["נוף הגבעה", "הגבעה", "נוף"] },
];

type CostCodeSeed = Omit<CostCode, "seedCheck" | "aliases" | "coverage"> & {
  incurred: number;
  remainingCommitment: number;
  remainingUncommitted: number;
  paid: number;
  coverage?: "detailed" | "aggregate";
  aliases?: string[];
};

const cc = (s: CostCodeSeed): CostCode => ({
  id: s.id,
  projectId: s.projectId,
  nameHe: s.nameHe,
  category: s.category,
  budget: s.budget,
  plannedQuantity: s.plannedQuantity,
  unit: s.unit,
  budgetUnitPrice: s.budgetUnitPrice,
  coverage: s.coverage ?? "detailed",
  seedCheck: { incurred: ils(s.incurred), remainingCommitment: ils(s.remainingCommitment), remainingUncommitted: ils(s.remainingUncommitted), paid: ils(s.paid) },
  aliases: s.aliases ?? [],
});

export const costCodesSeed: CostCode[] = [
  cc({ id: "H10", projectId: "HAD", nameHe: "ברזל", category: "steel", budget: ils(1500000), incurred: 66000, remainingCommitment: 0, remainingUncommitted: 1440000, paid: 0, plannedQuantity: 500, unit: "טון", budgetUnitPrice: ils(3000), aliases: ["ברזל", "ברזלים", "ברזל לזיון", "הברזל"] }),
  cc({ id: "H20", projectId: "HAD", nameHe: "בטון", category: "concrete", budget: ils(1000000), incurred: 400000, remainingCommitment: 200000, remainingUncommitted: 400000, paid: 320000, plannedQuantity: 2500, unit: "מ״ק", budgetUnitPrice: ils(400), aliases: ["בטון", "הבטון"] }),
  cc({ id: "H30", projectId: "HAD", nameHe: "קבלן שלד", category: "frame", budget: ils(1000000), incurred: 200000, remainingCommitment: 800000, remainingUncommitted: 0, paid: 150000, aliases: ["קבלן השלד", "שלד", "קבלן שלד", "השלד"] }),
  cc({ id: "H40", projectId: "HAD", nameHe: "ציוד", category: "equipment", budget: ils(600000), incurred: 240000, remainingCommitment: 180000, remainingUncommitted: 180000, paid: 200000, aliases: ["ציוד", "השכרת ציוד", "הציוד"] }),
  cc({ id: "H50", projectId: "HAD", nameHe: "איטום", category: "waterproofing", budget: ils(400000), incurred: 100000, remainingCommitment: 250000, remainingUncommitted: 50000, paid: 80000, aliases: ["איטום", "קבלן איטום", "האיטום", "קבלן האיטום"] }),
  cc({ id: "H60", projectId: "HAD", nameHe: "עבודות גמר", category: "finishing", budget: ils(1000000), incurred: 300000, remainingCommitment: 300000, remainingUncommitted: 400000, paid: 250000, aliases: ["עבודות גמר", "גמר", "הגמר"] }),
  cc({ id: "H70", projectId: "HAD", nameHe: "תקורות אתר", category: "site_overhead", budget: ils(600000), incurred: 300000, remainingCommitment: 100000, remainingUncommitted: 200000, paid: 250000, aliases: ["תקורות", "תקורות אתר", "תקורה", "התקורות"] }),
  cc({ id: "P10", projectId: "PAR", nameHe: "ברזל", category: "steel", budget: ils(600000), incurred: 58000, remainingCommitment: 0, remainingUncommitted: 540000, paid: 58000, plannedQuantity: 200, unit: "טון", budgetUnitPrice: ils(3000), aliases: ["ברזל", "ברזלים", "הברזל"] }),
  cc({ id: "P40", projectId: "PAR", nameHe: "ציוד", category: "equipment", budget: ils(400000), incurred: 120000, remainingCommitment: 120000, remainingUncommitted: 160000, paid: 100000, aliases: ["ציוד", "הציוד"] }),
  cc({ id: "P60", projectId: "PAR", nameHe: "יתר עבודות הפרויקט", category: "general", budget: ils(3000000), incurred: 900000, remainingCommitment: 1100000, remainingUncommitted: 1000000, paid: 700000, coverage: "aggregate" }),
  cc({ id: "G60", projectId: "GAN", nameHe: "עבודות הפרויקט", category: "general", budget: ils(3000000), incurred: 1000000, remainingCommitment: 1200000, remainingUncommitted: 800000, paid: 800000, coverage: "aggregate" }),
  cc({ id: "Y60", projectId: "YAM", nameHe: "עבודות הפרויקט", category: "general", budget: ils(2000000), incurred: 500000, remainingCommitment: 700000, remainingUncommitted: 800000, paid: 450000, coverage: "aggregate" }),
];

// ---------------------------------------------------------------------------
// Helpers to build records/commitments/work items with explicit links
// ---------------------------------------------------------------------------

interface RecordInput {
  id: string;
  kind: ErpRecord["kind"];
  projectId: string;
  costCodeId: string;
  supplierId: string | null;
  sourceDocumentId: string | null;
  relatedDocumentIds?: string[];
  descriptionHe: string;
  date: string;
  receivedAt: string;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  amount: number;
  paid: number;
  workItemId: string | null;
  commitmentId: string | null;
  historicalSummary?: boolean;
  cumulativeApproved?: number;
  priorCumulative?: number;
  verifiedQuantity?: number | null;
  chargeType?: ErpRecord["chargeType"];
}

export function makeRecord(r: RecordInput): ErpRecord {
  const allocation: Allocation = {
    id: `${r.id}-A1`,
    projectId: r.projectId,
    costCodeId: r.costCodeId,
    amount: ils(r.amount),
    workItemId: r.workItemId,
    commitmentId: r.commitmentId,
  };
  return {
    id: r.id,
    kind: r.kind,
    projectId: r.projectId,
    supplierId: r.supplierId,
    sourceDocumentId: r.sourceDocumentId,
    relatedDocumentIds: r.relatedDocumentIds ?? [],
    descriptionHe: r.descriptionHe,
    date: r.date,
    receivedAt: r.receivedAt,
    quantity: r.quantity ?? null,
    unit: r.unit ?? null,
    unitPrice: r.unitPrice == null ? null : ils(r.unitPrice),
    amount: ils(r.amount),
    allocations: [allocation],
    paid: ils(r.paid),
    version: 1,
    checkStatus: "verified",
    historicalSummary: r.historicalSummary,
    cumulativeApproved: r.cumulativeApproved == null ? undefined : ils(r.cumulativeApproved),
    priorCumulative: r.priorCumulative == null ? undefined : ils(r.priorCumulative),
    verifiedQuantity: r.verifiedQuantity === undefined ? r.quantity ?? null : r.verifiedQuantity,
    chargeType: r.chargeType,
  };
}

interface CommitmentInput {
  id: string;
  projectId: string;
  costCodeId: string;
  supplierId: string | null;
  kind: Commitment["kind"];
  titleHe: string;
  value: number;
  documentId: string | null;
  createdAt: string;
  status?: Commitment["status"];
  quantity?: number;
  unit?: string;
  unitPrice?: number;
}

export function makeCommitment(c: CommitmentInput): Commitment {
  return {
    id: c.id,
    projectId: c.projectId,
    costCodeId: c.costCodeId,
    supplierId: c.supplierId,
    kind: c.kind,
    titleHe: c.titleHe,
    value: ils(c.value),
    documentId: c.documentId,
    status: c.status ?? "active",
    createdAt: c.createdAt,
    versions: [{ version: 1, value: ils(c.value), documentId: c.documentId, at: c.createdAt, reasonHe: "מצב פתיחה" }],
    quantity: c.quantity,
    unit: c.unit,
    unitPrice: c.unitPrice == null ? undefined : ils(c.unitPrice),
  };
}

interface WorkItemInput {
  id: string;
  projectId: string;
  costCodeId: string;
  titleHe: string;
  status: WorkItem["status"];
  commitmentId?: string | null;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  forecast?: number;
  basisHe?: string;
  sourceDocumentId?: string | null;
  group?: string;
  period?: string;
  createdAt?: string;
  acceptedAt?: string;
}

export function makeWorkItem(w: WorkItemInput): { workItem: WorkItem; forecast: ForecastVersion | null } {
  const workItem: WorkItem = {
    id: w.id,
    projectId: w.projectId,
    costCodeId: w.costCodeId,
    titleHe: w.titleHe,
    status: w.status,
    commitmentId: w.commitmentId ?? null,
    quantity: w.quantity,
    unit: w.unit,
    sourceDocumentId: w.sourceDocumentId ?? null,
    group: w.group,
    period: w.period,
    createdAt: w.createdAt ?? SEED_START,
  };
  const forecast: ForecastVersion | null =
    w.forecast == null
      ? null
      : {
          id: `FV-${w.id}-1`,
          workItemId: w.id,
          version: 1,
          amount: ils(w.forecast),
          quantity: w.quantity,
          unitPrice: w.unitPrice == null ? undefined : ils(w.unitPrice),
          basisHe: w.basisHe ?? "הנחת תקציב מקורית",
          evidence: w.sourceDocumentId ? [{ documentId: w.sourceDocumentId, anchorId: "summary", version: 1 }] : [],
          status: "accepted",
          acceptedBy: REVIEWER_ID,
          acceptedAt: w.acceptedAt ?? w.createdAt ?? SEED_START,
        };
  return { workItem, forecast };
}

// ---------------------------------------------------------------------------
// Generated documents (their text is generated from their values)
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const a = (id: string, text: string, labelHe?: string) => ({ id, text, labelHe });

/** Mark a document whose text was generated from its own record values. */
export function generated(d: SourceDocument): SourceDocument {
  return { ...d, generated: true };
}

export interface ForecastDocInput {
  id: string;
  titleHe: string;
  projectId: string;
  costCodeId: string;
  date: string;
  receivedAt: string;
  lines: string[];
  facts?: SourceDocument["facts"];
  supersedesId?: string;
  version?: number;
  kind?: "forecast" | "commitment_balance";
  supplierId?: string | null;
}

export function forecastDocument(input: ForecastDocInput): SourceDocument {
  return generated(
    doc({
      id: input.id,
      kind: input.kind ?? "forecast",
      titleHe: input.titleHe,
      date: input.date,
      receivedAt: input.receivedAt,
      supplierId: input.supplierId ?? null,
      projectIds: [input.projectId],
      costCodeIds: [input.costCodeId],
      anchors: [a("summary", input.lines[0]), ...input.lines.slice(1).map((t, i) => a(`line${i + 2}`, t))],
      facts: input.facts ?? {},
      supersedesId: input.supersedesId,
      version: input.version ?? 1,
    }),
  );
}

export function budgetDocument(projectId: string, projectName: string, codes: CostCode[], id: string, date: string, literal: Record<string, string>): SourceDocument {
  return generated(
    doc({
      id,
      kind: "budget",
      titleHe: `תקציב מאושר — ${projectName} (גרסה 1)`,
      date,
      receivedAt: `${date}T08:00:00+03:00`,
      projectIds: [projectId],
      costCodeIds: codes.map((c) => c.id),
      anchors: codes.map((c) => {
        const anchorId = c.id.toLowerCase();
        const text = literal[anchorId] ?? `${c.nameHe}, סה״כ ${formatILS(c.budget)}.`;
        return a(anchorId, text, c.nameHe);
      }),
      facts: {},
    }),
  );
}

// ---------------------------------------------------------------------------
// Baseline state
// ---------------------------------------------------------------------------

const B = "2026-08-31T08:00:00+03:00"; // opening balances received before the prior report cutoff

export function buildBaselineState(sessionId: string): DemoState {
  const records: ErpRecord[] = [
    makeRecord({ id: "TX-H-STEEL", kind: "invoice", projectId: "HAD", costCodeId: "H10", supplierId: "SUP-STEEL-A", sourceDocumentId: "INV-H-STEEL-001", relatedDocumentIds: ["DN-H-STEEL-001", "PO-H-STEEL-001"], descriptionHe: "ברזל לזיון R500 — 20 טון", date: "2026-09-07", receivedAt: "2026-09-07T08:40:00+03:00", quantity: 20, unit: "טון", unitPrice: 3300, amount: 66000, paid: 0, workItemId: "H-STEEL-FIRST-20", commitmentId: "PO-H-STEEL-001", chargeType: "material" }),
    makeRecord({ id: "OPEN-H20", kind: "opening_balance", projectId: "HAD", costCodeId: "H20", supplierId: null, sourceDocumentId: "OPEN-H20", descriptionHe: "יתרת פתיחה בטון עד 31/08", date: "2026-08-31", receivedAt: B, amount: 360000, paid: 320000, workItemId: "H-CONC-OPENING", commitmentId: null, historicalSummary: true }),
    makeRecord({ id: "TX-H-SLAB", kind: "invoice", projectId: "HAD", costCodeId: "H20", supplierId: "SUP-CONCRETE", sourceDocumentId: "INV-H-CONC-001", relatedDocumentIds: ["PLAN-SLAB-A"], descriptionHe: "בטון C30 — יציקת תקרה A", date: "2026-08-28", receivedAt: "2026-08-28T10:00:00+03:00", quantity: 100, unit: "מ״ק", unitPrice: 400, amount: 40000, paid: 0, workItemId: "H-CONC-SLAB-A", commitmentId: null, chargeType: "material" }),
    makeRecord({ id: "TX-H-FRAME", kind: "certificate", projectId: "HAD", costCodeId: "H30", supplierId: "SUP-FRAME", sourceDocumentId: "INV-H-FRAME-001", descriptionHe: "חשבון עבודות שלד מאושר", date: "2026-08-25", receivedAt: "2026-08-25T10:00:00+03:00", amount: 200000, paid: 150000, workItemId: "H-FRAME-WORK", commitmentId: "CT-H-FRAME", cumulativeApproved: 200000, priorCumulative: 0 }),
    makeRecord({ id: "OPEN-H40", kind: "opening_balance", projectId: "HAD", costCodeId: "H40", supplierId: null, sourceDocumentId: "OPEN-H40", descriptionHe: "יתרת פתיחה ציוד", date: "2026-08-31", receivedAt: B, amount: 180000, paid: 180000, workItemId: "H-EQ-OPENING", commitmentId: null, historicalSummary: true }),
    makeRecord({ id: "TX-EQ-SHARED", kind: "invoice", projectId: "HAD", costCodeId: "H40", supplierId: "SUP-EQUIPMENT", sourceDocumentId: "INV-EQ-001", relatedDocumentIds: ["EQ-FRAMEWORK-01"], descriptionHe: "השכרת ציוד אוגוסט — מסגרת משותפת", date: "2026-08-31", receivedAt: "2026-08-31T08:30:00+03:00", amount: 60000, paid: 20000, workItemId: "H-EQ-AUG", commitmentId: null, chargeType: "rental" }),
    makeRecord({ id: "TX-H-WATER", kind: "invoice", projectId: "HAD", costCodeId: "H50", supplierId: "SUP-WATER", sourceDocumentId: "INV-H-WATER-001", descriptionHe: "עבודות איטום בתכולת החוזה", date: "2026-08-25", receivedAt: "2026-08-25T11:00:00+03:00", amount: 100000, paid: 80000, workItemId: "H-WATER-CONTRACT", commitmentId: "CT-H-WATER" }),
    makeRecord({ id: "OPEN-H60", kind: "opening_balance", projectId: "HAD", costCodeId: "H60", supplierId: null, sourceDocumentId: "OPEN-H60", descriptionHe: "יתרת פתיחה עבודות גמר", date: "2026-08-31", receivedAt: B, amount: 300000, paid: 250000, workItemId: "H-FINISH-CONTRACT", commitmentId: "CT-H-FINISH", historicalSummary: true }),
    makeRecord({ id: "OPEN-H70", kind: "opening_balance", projectId: "HAD", costCodeId: "H70", supplierId: null, sourceDocumentId: "OPEN-H70", descriptionHe: "תקורות אתר — שישה חודשים שהוכרו", date: "2026-08-31", receivedAt: B, amount: 300000, paid: 250000, workItemId: "H-SITE-RECOGNIZED", commitmentId: null, historicalSummary: true }),
    makeRecord({ id: "TX-P-STEEL", kind: "invoice", projectId: "PAR", costCodeId: "P10", supplierId: "SUP-STEEL-B", sourceDocumentId: "INV-P-STEEL-001", descriptionHe: "ברזל R500 — 20 טון (מתחם הפארק)", date: "2026-09-02", receivedAt: "2026-09-02T10:00:00+03:00", quantity: 20, unit: "טון", unitPrice: 2900, amount: 58000, paid: 58000, workItemId: "P-STEEL-FIRST-20", commitmentId: null, chargeType: "material" }),
    makeRecord({ id: "OPEN-P40", kind: "opening_balance", projectId: "PAR", costCodeId: "P40", supplierId: null, sourceDocumentId: "OPEN-P40", descriptionHe: "יתרת פתיחה ציוד", date: "2026-08-31", receivedAt: B, amount: 120000, paid: 100000, workItemId: "P-EQ-OPENING", commitmentId: null, historicalSummary: true }),
    makeRecord({ id: "OPEN-P60", kind: "opening_balance", projectId: "PAR", costCodeId: "P60", supplierId: null, sourceDocumentId: "OPEN-P60", descriptionHe: "יתרת פתיחה יתר העבודות", date: "2026-08-31", receivedAt: B, amount: 900000, paid: 700000, workItemId: "P60-OPENING", commitmentId: null, historicalSummary: true }),
    makeRecord({ id: "OPEN-G60", kind: "opening_balance", projectId: "GAN", costCodeId: "G60", supplierId: null, sourceDocumentId: "OPEN-G60", descriptionHe: "יתרת פתיחה עבודות הפרויקט", date: "2026-08-31", receivedAt: B, amount: 1000000, paid: 800000, workItemId: "G60-OPENING", commitmentId: null, historicalSummary: true }),
    makeRecord({ id: "OPEN-Y60", kind: "opening_balance", projectId: "YAM", costCodeId: "Y60", supplierId: null, sourceDocumentId: "OPEN-Y60", descriptionHe: "יתרת פתיחה עבודות הפרויקט", date: "2026-08-31", receivedAt: B, amount: 500000, paid: 450000, workItemId: "Y60-OPENING", commitmentId: null, historicalSummary: true }),
  ];

  const commitments: Commitment[] = [
    makeCommitment({ id: "PO-H-STEEL-001", projectId: "HAD", costCodeId: "H10", supplierId: "SUP-STEEL-A", kind: "purchase_order", titleHe: "הזמנת רכש ברזל — 20 טון", value: 66000, documentId: "PO-H-STEEL-001", createdAt: "2026-09-04T09:00:00+03:00", quantity: 20, unit: "טון", unitPrice: 3300 }),
    makeCommitment({ id: "PO-H-CONC-REMAIN", projectId: "HAD", costCodeId: "H20", supplierId: "SUP-CONCRETE", kind: "purchase_order", titleHe: "בטון מוזמן — 500 מ״ק", value: 200000, documentId: "PO-H-CONC-REMAIN", createdAt: SEED_START, quantity: 500, unit: "מ״ק", unitPrice: 400 }),
    makeCommitment({ id: "CT-H-FRAME", projectId: "HAD", costCodeId: "H30", supplierId: "SUP-FRAME", kind: "contract", titleHe: "חוזה עבודות שלד", value: 1000000, documentId: "CT-H-FRAME", createdAt: SEED_START }),
    makeCommitment({ id: "CT-H-EQ-REMAIN", projectId: "HAD", costCodeId: "H40", supplierId: "SUP-EQUIPMENT", kind: "remaining_balance", titleHe: "התחייבויות ציוד ייעודיות שנותרו", value: 180000, documentId: "CT-H-EQ-REMAIN", createdAt: SEED_START }),
    makeCommitment({ id: "CT-H-WATER", projectId: "HAD", costCodeId: "H50", supplierId: "SUP-WATER", kind: "contract", titleHe: "חוזה עבודות איטום", value: 350000, documentId: "CT-H-WATER", createdAt: SEED_START }),
    makeCommitment({ id: "CT-H-FINISH", projectId: "HAD", costCodeId: "H60", supplierId: null, kind: "contract", titleHe: "חוזה עבודות גמר", value: 600000, documentId: "CT-H-FINISH", createdAt: SEED_START }),
    makeCommitment({ id: "CT-H-SITE-REMAIN", projectId: "HAD", costCodeId: "H70", supplierId: null, kind: "remaining_balance", titleHe: "תקורות אתר מחויבות שנותרו", value: 100000, documentId: "CT-H-SITE-REMAIN", createdAt: SEED_START }),
    makeCommitment({ id: "CT-P-EQ-REMAIN", projectId: "PAR", costCodeId: "P40", supplierId: "SUP-EQUIPMENT", kind: "remaining_balance", titleHe: "התחייבויות ציוד שנותרו", value: 120000, documentId: "CT-P-EQ-REMAIN", createdAt: SEED_START }),
    makeCommitment({ id: "BAL-P60-C", projectId: "PAR", costCodeId: "P60", supplierId: null, kind: "remaining_balance", titleHe: "התחייבויות שנותרו — יתר העבודות", value: 1100000, documentId: "BAL-P60", createdAt: SEED_START }),
    makeCommitment({ id: "BAL-G60-C", projectId: "GAN", costCodeId: "G60", supplierId: null, kind: "remaining_balance", titleHe: "התחייבויות שנותרו — עבודות הפרויקט", value: 1200000, documentId: "BAL-G60", createdAt: SEED_START }),
    makeCommitment({ id: "BAL-Y60-C", projectId: "YAM", costCodeId: "Y60", supplierId: null, kind: "remaining_balance", titleHe: "התחייבויות שנותרו — עבודות הפרויקט", value: 700000, documentId: "BAL-Y60", createdAt: SEED_START }),
  ];

  const wi = [
    // HAD steel
    makeWorkItem({ id: "H-STEEL-FIRST-20", projectId: "HAD", costCodeId: "H10", titleHe: "ברזל — 20 הטון הראשונים", status: "fulfilled", commitmentId: "PO-H-STEEL-001", quantity: 20, unit: "טון", unitPrice: 3000, forecast: 60000, basisHe: "תקציב: 3,000 ₪ לטון", sourceDocumentId: "FC-H-STEEL-V1", group: "FC-H-STEEL", createdAt: SEED_START }),
    makeWorkItem({ id: "H-STEEL-REMAINING", projectId: "HAD", costCodeId: "H10", titleHe: "ברזל — יתרת הרכש", status: "uncommitted", quantity: 480, unit: "טון", unitPrice: 3000, forecast: 1440000, basisHe: "תקציב: 3,000 ₪ לטון; מחיר עתידי טרם אושר", sourceDocumentId: "FC-H-STEEL", group: "FC-H-STEEL", createdAt: SEED_START }),
    // HAD concrete
    makeWorkItem({ id: "H-CONC-OPENING", projectId: "HAD", costCodeId: "H20", titleHe: "בטון — יתרת פתיחה", status: "historical", sourceDocumentId: "OPEN-H20" }),
    makeWorkItem({ id: "H-CONC-SLAB-A", projectId: "HAD", costCodeId: "H20", titleHe: "בטון — יציקת תקרה A", status: "fulfilled", quantity: 100, unit: "מ״ק", unitPrice: 400, forecast: 40000, basisHe: "תכנון יציקה: 100 מ״ק × 400 ₪", sourceDocumentId: "PLAN-SLAB-A" }),
    makeWorkItem({ id: "H-CONC-COMMITTED-500", projectId: "HAD", costCodeId: "H20", titleHe: "בטון מוזמן — 500 מ״ק", status: "committed", commitmentId: "PO-H-CONC-REMAIN", quantity: 500, unit: "מ״ק", unitPrice: 400, forecast: 200000, basisHe: "הזמנה: 500 מ״ק × 400 ₪", sourceDocumentId: "PO-H-CONC-REMAIN" }),
    makeWorkItem({ id: "H-CONC-REMAINING", projectId: "HAD", costCodeId: "H20", titleHe: "בטון — יתרה ללא התחייבות", status: "uncommitted", quantity: 1000, unit: "מ״ק", unitPrice: 400, forecast: 400000, basisHe: "תקציב: 400 ₪ למ״ק", sourceDocumentId: "FC-H-CONC" }),
    // HAD frame
    makeWorkItem({ id: "H-FRAME-WORK", projectId: "HAD", costCodeId: "H30", titleHe: "עבודות שלד — תכולת החוזה", status: "committed", commitmentId: "CT-H-FRAME", forecast: 1000000, basisHe: "חוזה קבוע 1,000,000 ₪", sourceDocumentId: "CT-H-FRAME" }),
    // HAD equipment
    makeWorkItem({ id: "H-EQ-OPENING", projectId: "HAD", costCodeId: "H40", titleHe: "ציוד — יתרת פתיחה", status: "historical", sourceDocumentId: "OPEN-H40" }),
    makeWorkItem({ id: "H-EQ-AUG", projectId: "HAD", costCodeId: "H40", titleHe: "ציוד — חשבונית אוגוסט", status: "fulfilled", sourceDocumentId: "INV-EQ-001", period: "2026-08" }),
    makeWorkItem({ id: "H-EQ-COMMITTED", projectId: "HAD", costCodeId: "H40", titleHe: "ציוד — התחייבויות ייעודיות", status: "committed", commitmentId: "CT-H-EQ-REMAIN", forecast: 180000, basisHe: "התחייבויות קיימות", sourceDocumentId: "CT-H-EQ-REMAIN" }),
    makeWorkItem({ id: "H-EQ-SEP", projectId: "HAD", costCodeId: "H40", titleHe: "ציוד — ספטמבר (מסגרת משותפת)", status: "uncommitted", forecast: 40000, basisHe: "תחזית חודשית לפי המסגרת", sourceDocumentId: "FC-H-EQ", group: "FC-H-EQ", period: "2026-09" }),
    makeWorkItem({ id: "H-EQ-LATER", projectId: "HAD", costCodeId: "H40", titleHe: "ציוד — חודשים מאוחרים יותר", status: "uncommitted", forecast: 140000, basisHe: "תחזית ציוד ללא התחייבות", sourceDocumentId: "FC-H-EQ", group: "FC-H-EQ" }),
    // HAD waterproofing
    makeWorkItem({ id: "H-WATER-CONTRACT", projectId: "HAD", costCodeId: "H50", titleHe: "איטום — תכולת החוזה", status: "committed", commitmentId: "CT-H-WATER", forecast: 350000, basisHe: "חוזה קבוע 350,000 ₪", sourceDocumentId: "CT-H-WATER" }),
    makeWorkItem({ id: "H-WATER-EXTRA", projectId: "HAD", costCodeId: "H50", titleHe: "איטום — עבודה נוספת ללא התחייבות", status: "uncommitted", forecast: 50000, basisHe: "עבודת איטום נפרדת שטרם הוזמנה", sourceDocumentId: "FC-H-WATER" }),
    // HAD finishing
    makeWorkItem({ id: "H-FINISH-CONTRACT", projectId: "HAD", costCodeId: "H60", titleHe: "עבודות גמר — חוזה", status: "committed", commitmentId: "CT-H-FINISH", forecast: 600000, basisHe: "חוזה 600,000 ₪", sourceDocumentId: "CT-H-FINISH" }),
    makeWorkItem({ id: "H-FINISH-REMAINING", projectId: "HAD", costCodeId: "H60", titleHe: "עבודות גמר — ללא התחייבות", status: "uncommitted", forecast: 400000, basisHe: "תחזית עבודות גמר שטרם הוזמנו", sourceDocumentId: "FC-H-FINISH" }),
    // HAD site overhead
    makeWorkItem({ id: "H-SITE-RECOGNIZED", projectId: "HAD", costCodeId: "H70", titleHe: "תקורות אתר — 6 חודשים שהוכרו", status: "historical", quantity: 6, unit: "חודשים", sourceDocumentId: "OPEN-H70" }),
    makeWorkItem({ id: "H-SITE-COMMITTED", projectId: "HAD", costCodeId: "H70", titleHe: "תקורות אתר — 2 חודשים מחויבים", status: "committed", commitmentId: "CT-H-SITE-REMAIN", quantity: 2, unit: "חודשים", unitPrice: 50000, forecast: 100000, basisHe: "התחייבות קיימת: 2 × 50,000 ₪", sourceDocumentId: "CT-H-SITE-REMAIN" }),
    makeWorkItem({ id: "H-SITE-REMAINING", projectId: "HAD", costCodeId: "H70", titleHe: "תקורות אתר — 4 חודשים ללא התחייבות", status: "uncommitted", quantity: 4, unit: "חודשים", unitPrice: 50000, forecast: 200000, basisHe: "תכנון: 4 × 50,000 ₪ עד 28/02/2027", sourceDocumentId: "FC-H-SITE" }),
    // PAR
    makeWorkItem({ id: "P-STEEL-FIRST-20", projectId: "PAR", costCodeId: "P10", titleHe: "ברזל — 20 הטון הראשונים", status: "fulfilled", quantity: 20, unit: "טון", unitPrice: 3000, forecast: 60000, basisHe: "תקציב: 3,000 ₪ לטון", sourceDocumentId: "FC-P-STEEL", group: "FC-P-STEEL" }),
    makeWorkItem({ id: "P-STEEL-REMAINING", projectId: "PAR", costCodeId: "P10", titleHe: "ברזל — יתרת הרכש", status: "uncommitted", quantity: 180, unit: "טון", unitPrice: 3000, forecast: 540000, basisHe: "תקציב: 3,000 ₪ לטון", sourceDocumentId: "FC-P-STEEL", group: "FC-P-STEEL" }),
    makeWorkItem({ id: "P-EQ-OPENING", projectId: "PAR", costCodeId: "P40", titleHe: "ציוד — יתרת פתיחה", status: "historical", sourceDocumentId: "OPEN-P40" }),
    makeWorkItem({ id: "P-EQ-COMMITTED", projectId: "PAR", costCodeId: "P40", titleHe: "ציוד — התחייבויות שנותרו", status: "committed", commitmentId: "CT-P-EQ-REMAIN", forecast: 120000, basisHe: "התחייבויות קיימות", sourceDocumentId: "CT-P-EQ-REMAIN" }),
    makeWorkItem({ id: "P-EQ-SEP", projectId: "PAR", costCodeId: "P40", titleHe: "ציוד — ספטמבר (מסגרת משותפת)", status: "uncommitted", forecast: 20000, basisHe: "תחזית חודשית לפי המסגרת", sourceDocumentId: "FC-P-EQ", group: "FC-P-EQ", period: "2026-09" }),
    makeWorkItem({ id: "P-EQ-LATER", projectId: "PAR", costCodeId: "P40", titleHe: "ציוד — חודשים מאוחרים יותר", status: "uncommitted", forecast: 140000, basisHe: "תחזית ציוד ללא התחייבות", sourceDocumentId: "FC-P-EQ", group: "FC-P-EQ" }),
    makeWorkItem({ id: "P60-OPENING", projectId: "PAR", costCodeId: "P60", titleHe: "יתר העבודות — יתרת פתיחה", status: "historical", sourceDocumentId: "OPEN-P60" }),
    makeWorkItem({ id: "P60-COMMITTED", projectId: "PAR", costCodeId: "P60", titleHe: "יתר העבודות — התחייבויות", status: "committed", commitmentId: "BAL-P60-C", forecast: 1100000, basisHe: "יתרת התחייבויות מצרפית", sourceDocumentId: "BAL-P60" }),
    makeWorkItem({ id: "P60-REMAINING", projectId: "PAR", costCodeId: "P60", titleHe: "יתר העבודות — ללא התחייבות", status: "uncommitted", forecast: 1000000, basisHe: "יתרת תחזית מצרפית", sourceDocumentId: "BAL-P60" }),
    // GAN / YAM
    makeWorkItem({ id: "G60-OPENING", projectId: "GAN", costCodeId: "G60", titleHe: "עבודות הפרויקט — יתרת פתיחה", status: "historical", sourceDocumentId: "OPEN-G60" }),
    makeWorkItem({ id: "G60-COMMITTED", projectId: "GAN", costCodeId: "G60", titleHe: "עבודות הפרויקט — התחייבויות", status: "committed", commitmentId: "BAL-G60-C", forecast: 1200000, basisHe: "יתרת התחייבויות מצרפית", sourceDocumentId: "BAL-G60" }),
    makeWorkItem({ id: "G60-REMAINING", projectId: "GAN", costCodeId: "G60", titleHe: "עבודות הפרויקט — ללא התחייבות", status: "uncommitted", forecast: 800000, basisHe: "יתרת תחזית מצרפית", sourceDocumentId: "BAL-G60" }),
    makeWorkItem({ id: "Y60-OPENING", projectId: "YAM", costCodeId: "Y60", titleHe: "עבודות הפרויקט — יתרת פתיחה", status: "historical", sourceDocumentId: "OPEN-Y60" }),
    makeWorkItem({ id: "Y60-COMMITTED", projectId: "YAM", costCodeId: "Y60", titleHe: "עבודות הפרויקט — התחייבויות", status: "committed", commitmentId: "BAL-Y60-C", forecast: 700000, basisHe: "יתרת התחייבויות מצרפית", sourceDocumentId: "BAL-Y60" }),
    makeWorkItem({ id: "Y60-REMAINING", projectId: "YAM", costCodeId: "Y60", titleHe: "עבודות הפרויקט — ללא התחייבות", status: "uncommitted", forecast: 800000, basisHe: "יתרת תחזית מצרפית", sourceDocumentId: "BAL-Y60" }),
  ];

  const workItems = wi.map((x) => x.workItem);
  const forecasts = wi.map((x) => x.forecast).filter((f): f is ForecastVersion => f !== null);

  // Generated documents: opening balances, forecast/commitment sources, budgets
  const projectName = (id: string) => projectsSeed.find((p) => p.id === id)!.nameHe;
  const codeOf = (id: string) => costCodesSeed.find((c) => c.id === id)!;
  const openingDocs = records.filter((r) => r.kind === "opening_balance").map((r) => generated(openingBalanceDocument(r, codeOf(r.allocations[0].costCodeId), projectName(r.projectId))));

  const forecastDocs: SourceDocument[] = [
    forecastDocument({ id: "FC-H-STEEL-V1", titleHe: "תחזית ברזל — מגורי הדרים (גרסה 1)", projectId: "HAD", costCodeId: "H10", date: "2026-03-01", receivedAt: SEED_START, lines: ["500 טון ברזל שטרם הוזמנו, לפי הנחת תקציב של 3,000 ₪ לטון = 1,500,000 ₪.", "מחיר עתידי טרם אושר; ההנחה נובעת מהתקציב המאושר."], facts: { material: "steel", quantity: 500, unit: "טון", unitPrice: ils(3000), amount: ils(1500000) } }),
    forecastDocument({ id: "FC-H-STEEL", titleHe: "תחזית ברזל — מגורי הדרים (גרסה 2)", projectId: "HAD", costCodeId: "H10", date: "2026-09-04", receivedAt: "2026-09-04T09:05:00+03:00", version: 2, supersedesId: "FC-H-STEEL-V1", lines: ["480 טון ברזל שטרם הוזמנו, לפי הנחת תקציב של 3,000 ₪ לטון = 1,440,000 ₪.", "מחיר עתידי טרם אושר; 20 הטון הראשונים הוזמנו בנפרד ב-PO-H-STEEL-001."], facts: { material: "steel", quantity: 480, unit: "טון", unitPrice: ils(3000), amount: ils(1440000) } }),
    forecastDocument({ id: "PO-H-CONC-REMAIN", kind: "commitment_balance", titleHe: "בטון מוזמן — 500 מ״ק", projectId: "HAD", costCodeId: "H20", supplierId: "SUP-CONCRETE", date: "2026-03-01", receivedAt: SEED_START, lines: ["500 מ״ק בטון עתידי מוזמן במחיר 400 ₪ למ״ק = 200,000 ₪."], facts: { material: "concrete", quantity: 500, unit: "מ״ק", unitPrice: ils(400), amount: ils(200000) } }),
    forecastDocument({ id: "FC-H-CONC", titleHe: "תחזית בטון — מגורי הדרים", projectId: "HAD", costCodeId: "H20", date: "2026-03-01", receivedAt: SEED_START, lines: ["1,000 מ״ק נוספים ללא התחייבות במחיר 400 ₪ למ״ק = 400,000 ₪."], facts: { material: "concrete", quantity: 1000, unit: "מ״ק", unitPrice: ils(400), amount: ils(400000) } }),
    forecastDocument({ id: "CT-H-EQ-REMAIN", kind: "commitment_balance", titleHe: "התחייבויות ציוד ייעודיות — מגורי הדרים", projectId: "HAD", costCodeId: "H40", supplierId: "SUP-EQUIPMENT", date: "2026-03-01", receivedAt: SEED_START, lines: ["התחייבויות ציוד ייעודיות לפרויקט שנותרו: 180,000 ₪."], facts: { amount: ils(180000) } }),
    forecastDocument({ id: "FC-H-EQ", titleHe: "תחזית ציוד ללא התחייבות — מגורי הדרים", projectId: "HAD", costCodeId: "H40", date: "2026-03-01", receivedAt: SEED_START, lines: ["תחזית ציוד ללא התחייבות: 180,000 ₪, מתוכם ספטמבר 40,000 ₪ (מסגרת משותפת) וחודשים מאוחרים יותר 140,000 ₪.", "המסגרת המשותפת אינה מבטיחה בעצמה את הרכישות החודשיות העתידיות."], facts: { amount: ils(180000) } }),
    forecastDocument({ id: "FC-H-WATER", titleHe: "עבודת איטום נוספת ללא התחייבות", projectId: "HAD", costCodeId: "H50", date: "2026-03-01", receivedAt: SEED_START, lines: ["עבודת איטום נפרדת ללא התחייבות: 50,000 ₪, מחוץ לחוזה CT-H-WATER."], facts: { amount: ils(50000) } }),
    forecastDocument({ id: "CT-H-FINISH", kind: "commitment_balance", titleHe: "חוזה עבודות גמר", projectId: "HAD", costCodeId: "H60", date: "2026-03-01", receivedAt: SEED_START, lines: ["חוזה עבודות גמר בסך 600,000 ₪; הוכרו 300,000 ₪; יתרה 300,000 ₪.", "התכולה אינה כוללת שלד, איטום ותקורות אתר."], facts: { contractValue: ils(600000) } }),
    forecastDocument({ id: "FC-H-FINISH", titleHe: "תחזית עבודות גמר ללא התחייבות", projectId: "HAD", costCodeId: "H60", date: "2026-03-01", receivedAt: SEED_START, lines: ["עבודות גמר שטרם הוזמנו: 400,000 ₪."], facts: { amount: ils(400000) } }),
    forecastDocument({ id: "CT-H-SITE-REMAIN", kind: "commitment_balance", titleHe: "תקורות אתר מחויבות שנותרו", projectId: "HAD", costCodeId: "H70", date: "2026-03-01", receivedAt: SEED_START, lines: ["תקורות אתר מחויבות שנותרו: 100,000 ₪ (2 חודשים × 50,000 ₪)."], facts: { amount: ils(100000), months: 2 } }),
    forecastDocument({ id: "FC-H-SITE", titleHe: "תקורות אתר ללא התחייבות", projectId: "HAD", costCodeId: "H70", date: "2026-03-01", receivedAt: SEED_START, lines: ["תקורות אתר ללא התחייבות: 200,000 ₪ (4 חודשים × 50,000 ₪ עד 28/02/2027)."], facts: { amount: ils(200000), months: 4 } }),
    forecastDocument({ id: "FC-P-STEEL", titleHe: "תחזית ברזל — מתחם הפארק", projectId: "PAR", costCodeId: "P10", date: "2026-03-01", receivedAt: SEED_START, lines: ["180 טון ללא התחייבות לפי 3,000 ₪ לטון = 540,000 ₪."], facts: { material: "steel", quantity: 180, unit: "טון", unitPrice: ils(3000), amount: ils(540000) } }),
    forecastDocument({ id: "CT-P-EQ-REMAIN", kind: "commitment_balance", titleHe: "התחייבויות ציוד שנותרו — מתחם הפארק", projectId: "PAR", costCodeId: "P40", supplierId: "SUP-EQUIPMENT", date: "2026-03-01", receivedAt: SEED_START, lines: ["התחייבויות ציוד שנותרו: 120,000 ₪."], facts: { amount: ils(120000) } }),
    forecastDocument({ id: "FC-P-EQ", titleHe: "תחזית ציוד ללא התחייבות — מתחם הפארק", projectId: "PAR", costCodeId: "P40", date: "2026-03-01", receivedAt: SEED_START, lines: ["תחזית ציוד ללא התחייבות: 160,000 ₪, מתוכם ספטמבר 20,000 ₪ (מסגרת משותפת) וחודשים מאוחרים יותר 140,000 ₪."], facts: { amount: ils(160000) } }),
    forecastDocument({ id: "BAL-P60", kind: "commitment_balance", titleHe: "יתרות — יתר עבודות מתחם הפארק", projectId: "PAR", costCodeId: "P60", date: "2026-03-01", receivedAt: SEED_START, lines: ["הוכרו 900,000 ₪; התחייבויות שנותרו 1,100,000 ₪; יתרה ללא התחייבות 1,000,000 ₪.", "סעיף מצרפי: פירוט לפי קטגוריה אינו זמין בדמו."], facts: {} }),
    forecastDocument({ id: "BAL-G60", kind: "commitment_balance", titleHe: "יתרות — עבודות גני השקד", projectId: "GAN", costCodeId: "G60", date: "2026-03-01", receivedAt: SEED_START, lines: ["הוכרו 1,000,000 ₪; התחייבויות שנותרו 1,200,000 ₪; יתרה ללא התחייבות 800,000 ₪.", "סעיף מצרפי: פירוט לפי קטגוריה אינו זמין בדמו."], facts: {} }),
    forecastDocument({ id: "BAL-Y60", kind: "commitment_balance", titleHe: "יתרות — עבודות מרכז הים", projectId: "YAM", costCodeId: "Y60", date: "2026-03-01", receivedAt: SEED_START, lines: ["הוכרו 500,000 ₪; התחייבויות שנותרו 700,000 ₪; יתרה ללא התחייבות 800,000 ₪.", "סעיף מצרפי: פירוט לפי קטגוריה אינו זמין בדמו."], facts: {} }),
  ];

  const budgetDocs: SourceDocument[] = [
    budgetDocument("HAD", "מגורי הדרים", costCodesSeed.filter((c) => c.projectId === "HAD"), "BUD-HAD-V1", "2026-03-01", {
      h10: "ברזל לזיון, 500 טון, 3,000 ₪ לטון, סה״כ 1,500,000 ₪.",
      h20: "בטון, 2,500 מ״ק, 400 ₪ למ״ק, סה״כ 1,000,000 ₪.",
      h70: "תקורות אתר, 12 חודשים, 50,000 ₪ לחודש.",
    }),
    budgetDocument("PAR", "מתחם הפארק", costCodesSeed.filter((c) => c.projectId === "PAR"), "BUD-PAR-V1", "2026-03-01", { p10: "ברזל לזיון, 200 טון, 3,000 ₪ לטון, סה״כ 600,000 ₪." }),
    budgetDocument("GAN", "גני השקד", costCodesSeed.filter((c) => c.projectId === "GAN"), "BUD-GAN-V1", "2026-03-01", {}),
    budgetDocument("YAM", "מרכז הים", costCodesSeed.filter((c) => c.projectId === "YAM"), "BUD-YAM-V1", "2026-03-01", {}),
  ];

  const budgetVersions: BudgetVersion[] = [
    { id: "BUD-HAD-V1", projectId: "HAD", version: 1, kind: "approved", documentId: "BUD-HAD-V1", createdAt: SEED_START, status: "current", lines: costCodesSeed.filter((c) => c.projectId === "HAD").map((c) => ({ id: c.id, nameHe: c.nameHe, quantity: c.plannedQuantity, unit: c.unit, unitPrice: c.budgetUnitPrice, amount: c.budget })) },
    { id: "BUD-PAR-V1", projectId: "PAR", version: 1, kind: "approved", documentId: "BUD-PAR-V1", createdAt: SEED_START, status: "current", lines: costCodesSeed.filter((c) => c.projectId === "PAR").map((c) => ({ id: c.id, nameHe: c.nameHe, quantity: c.plannedQuantity, unit: c.unit, unitPrice: c.budgetUnitPrice, amount: c.budget })) },
    { id: "BUD-GAN-V1", projectId: "GAN", version: 1, kind: "approved", documentId: "BUD-GAN-V1", createdAt: SEED_START, status: "current", lines: costCodesSeed.filter((c) => c.projectId === "GAN").map((c) => ({ id: c.id, nameHe: c.nameHe, amount: c.budget })) },
    { id: "BUD-YAM-V1", projectId: "YAM", version: 1, kind: "approved", documentId: "BUD-YAM-V1", createdAt: SEED_START, status: "current", lines: costCodesSeed.filter((c) => c.projectId === "YAM").map((c) => ({ id: c.id, nameHe: c.nameHe, amount: c.budget })) },
    {
      id: "BUD-NOF-DRAFT-V1",
      projectId: "NOF",
      version: 1,
      kind: "draft",
      documentId: "BUD-NOF-DRAFT-V1",
      createdAt: "2026-09-07T08:00:00+03:00",
      status: "current",
      lines: [
        { id: "N20", nameHe: "בטון", quantity: 1000, unit: "מ״ק", unitPrice: ils(300), amount: ils(300000) },
        { id: "N60", nameHe: "יתר עבודות הפרויקט", amount: ils(4700000) },
      ],
      noteHe: "טיוטה שטרם אושרה.",
    },
  ];

  return {
    seedVersion: SEED_VERSION,
    sessionId,
    clock: SEED_CLOCK,
    revision: 1,
    role: "manager",
    activeProjectId: "HAD",
    activeScenarioId: null,
    scenario: null,
    company: { id: "DEMO", nameHe: "אופק דמו", descriptionHe: "חברת ביצוע פיקטיבית" },
    contacts: [
      { id: "CEO", nameHe: "איתן ברק", roleHe: "מנהל החברה", email: "eitan@ofek-demo.example" },
      { id: "OPS", nameHe: "מאיה לוי", roleHe: "מנהלת תפעול", email: "maya@ofek-demo.example" },
      { id: "BUYER", nameHe: "נועם רז", roleHe: "מנהל רכש", email: "noam@ofek-demo.example" },
      { id: "REVIEWER", nameHe: "נועה", roleHe: "צוות הבקרה", email: "review@bakara-demo.example" },
    ],
    suppliers: [
      { id: "SUP-STEEL-A", nameHe: "ספק ברזל א׳" },
      { id: "SUP-STEEL-B", nameHe: "ספק ברזל ב׳" },
      { id: "SUP-CONCRETE", nameHe: "ספק בטון דמו" },
      { id: "SUP-FRAME", nameHe: "קבלן שלד דמו" },
      { id: "SUP-EQUIPMENT", nameHe: "ספק ציוד דמו" },
      { id: "SUP-WATER", nameHe: "קבלן איטום דמו" },
    ],
    projects: projectsSeed.map((p) => ({ ...p })),
    costCodes: costCodesSeed.map((c) => ({ ...c })),
    budgetVersions,
    documents: [...budgetDocs, ...baselineDocuments, ...openingDocs, ...forecastDocs],
    erpRecords: records,
    commitments,
    workItems,
    forecasts,
    findings: [],
    proposals: [],
    questions: [],
    conversations: [],
    alerts: [],
    approvedRules: [],
    auditEvents: [],
    reports: [],
    reportPreferences: { format: "xlsx", layout: "management_summary", channel: "email", recipientId: "CEO", frequency: "weekly", weekday: 1, hour: 9, projectIds: ["HAD"], showPaid: true, showQuantities: true },
    deliveries: [],
    recoveries: [],
    tasks: [],
    pendingAnalyses: [],
    chat: { messages: [], scope: { projectId: "HAD", reportId: null, costCodeId: null, portfolio: false }, lastContext: { projectId: "HAD", costCodeId: null } },
    counters: {},
    flags: { failNextErpWrite: false, skipMotion: false },
    activity: [],
    lastReceivedAt: "2026-09-07T08:40:00+03:00",
    steelExperiment: { plannedQuantity: 500, purchasedQuantity: 20, purchaseUnitPrice: ils(3300), candidateFuturePrice: ils(3000), rawErpQuantity: 20, version: 1 },
    processedCertificateIds: ["INV-H-FRAME-001"],
    introducedDocumentIds: [],
    reportCutoffForPrior: PRIOR_REPORT_CUTOFF,
    lastAnalysisAt: null,
  };
}

export function openingBalanceDocument(record: ErpRecord, costCode: CostCode, projectName: string): SourceDocument {
  return doc({
    id: record.id,
    kind: "opening_balance",
    titleHe: `יתרת פתיחה — ${projectName} · ${costCode.nameHe}`,
    date: record.date,
    receivedAt: record.receivedAt,
    projectIds: [record.projectId],
    costCodeIds: [costCode.id],
    anchors: [
      a("summary", `${projectName}, סעיף ${costCode.nameHe} (${costCode.id}): עלות שנצברה עד ${fmtDate(record.date)} בסך ${formatILS(record.amount)}${record.quantity ? ` (${formatNumber(record.quantity)} ${record.unit ?? ""})` : ""}.`),
      a("note", OPENING_NOTE),
    ],
    facts: { amount: record.amount },
    version: 1,
    annotationHe: "סיכום היסטורי מאומת; אינו חשבונית ספק בודדת.",
  });
}
