/**
 * Hadarim v2 data model. Amounts are whole ILS before VAT (the data spec works in whole shekels;
 * the engine keeps integers). Dates are ISO yyyy-mm-dd.
 */
export type SectionId = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18";
/** A building id of the project (`HProject.buildings[].id`) or the project's shared bucket id. */
export type BuildingTag = string;
export type PersonId = "EYAL" | "ROI" | "DANA" | "SARIT";

export interface HBuilding {
  id: string;
  floors: number;
  floorsCast: number;
  unitsPerFloor: number;
}

/** A cost bucket of the per-building split that is not a building: the id is what invoices carry, the label is what reports show. */
export interface HCostBucket {
  id: string;
  labelHe: string;
}

/** Materiality policy of a project (report standard §5): when a section's variance is material and when it gets its own analysis. */
export interface HMateriality {
  /** A variance is material when it is at least this (₪) AND at least `pctOfSection` of the section's budget… */
  absolute: number;
  pctOfSection: number;
  /** …or at least this (₪) regardless of the section's size. */
  absoluteAlways: number;
  /** A section is analysed anyway when its budget exceeds this share (%) of the project budget… */
  budgetSharePct: number;
  /** …or when less than this share (%) of its forecast rests on commitments. */
  softBasisPct: number;
}

/** The thresholds of `budgetcontrolreportstandard.md`, used when a project sets none of its own. */
export const STANDARD_MATERIALITY: HMateriality = { absolute: 100_000, pctOfSection: 3, absoluteAlways: 250_000, budgetSharePct: 10, softBasisPct: 70 };

/** Assumptions behind the report's derived risks (§7); each is stated in the risk row it produces. */
export interface HRiskPolicy {
  /** Exposure assumed when an estimate rests on a quote that may expire: up to this share (%) of the estimate. */
  quoteExpiryExposurePct: number;
  /** Price step (₪ per unit) used to express the exposure of a remainder priced by an appendix. */
  priceStep: number;
}

export const STANDARD_RISK_POLICY: HRiskPolicy = { quoteExpiryExposurePct: 25, priceStep: 100 };

export interface HProject {
  id: "HADARIM";
  nameHe: string;
  companyHe: string;
  buildings: HBuilding[];
  /** The non-building buckets of the split: shared costs, and parking (sections with split = parking). */
  buckets: { shared: HCostBucket; parking: HCostBucket };
  materiality: HMateriality;
  riskPolicy: HRiskPolicy;
  checkPolicy: HCheckPolicy;
  units: number;
  grossSqm: number;
  startDate: string;
  budgetVersion: { number: number; approvedAt: string; amount: number };
  boqVersion: { number: number; date: string };
  controlDates: string[];
  currentControlDate: string;
  statusHe: string;
  /** Measured on site (not derived from spend); null/undefined = not measured. */
  physicalProgressPct?: number | null;
  schedule?: { contractEnd?: string; expectedEnd?: string; noteHe?: string };
}

export type ContactChannel = "whatsapp" | "email" | "phone";

export interface HPerson {
  id: PersonId;
  nameHe: string;
  roleHe: string;
  canWriteAllocation: boolean;
  /** How the full system would reach this person with a question. */
  channel?: ContactChannel;
}

/** Data-quality check policy of a project. */
export interface HCheckPolicy {
  /** An invoice still in review this many days after it was received is flagged. */
  reviewAgingDays: number;
}

export const STANDARD_CHECK_POLICY: HCheckPolicy = { reviewAgingDays: 30 };

export interface HSupplier {
  id: string;
  nameHe: string;
  kind: "subcontractor" | "supplier" | "service" | "consultant";
}

export interface HSection {
  id: SectionId;
  nameHe: string;
  /** Short name for prose and labels ("03-ברזל"). */
  shortHe: string;
  budget: number;
  /** Reporting kind: works are procured; overhead is an internal allocation; contingency is the reserve, reported on its own. */
  kind: "works" | "overhead" | "contingency";
  /** How the section is split per building in the optional secondary view. */
  split: "by_floors" | "by_units" | "shared" | "parking" | "per_building";
  contractIds: string[];
  /** Chapters of the Interministerial Specification (the Blue Book) the section covers; the first is the primary. */
  chapters?: string[];
}

/**
 * An approved change to the budget: a transfer between sections, an addition (owner-approved increase, or from
 * outside the project) or a reduction. The sections' `budget` is the original; the updated budget is original plus
 * the changes dated up to the control date. Keyed in the ERP or recorded by the agent on instruction; logged.
 */
export interface HBudgetChange {
  id: string;
  date: string;
  kind: "transfer" | "addition" | "reduction";
  fromSectionId: SectionId | null;
  toSectionId: SectionId | null;
  amount: number;
  reasonHe: string;
  referenceHe?: string;
  approvedById: PersonId;
  createdById: PersonId;
  createdAt?: string;
}

export const BUDGET_CHANGE_KIND_HE: Record<HBudgetChange["kind"], string> = { transfer: "העברה בין סעיפים", addition: "תוספת תקציב", reduction: "הפחתת תקציב" };

export interface HPriceAppendix {
  id: string;
  titleHe: string;
  validFrom: string;
  /** Price per unit of `unit` (default טון). */
  pricePerTon: number;
  unit?: string;
  documentId: string;
}

export interface HContract {
  id: string;
  sectionId: SectionId;
  supplierId: string;
  amount: number | null;
  signedAt: string;
  scopeHe: string;
  inclusionsHe: string[];
  exclusions: { clause: string; textHe: string; coveredByContractId?: string }[];
  retentionPct: number;
  closed?: { at: string; finalAccount: number };
  steelSuppliedByClient?: boolean;
  priceAppendices?: HPriceAppendix[];
  documentId?: string;
  noteHe?: string;
  /** BOQ chapter matched line by line against the contract scope (basis for a "verified match" positive finding). */
  boqMatchVerified?: boolean;
}

export type InvoiceDocType = "חשבון חלקי" | "חשבונית מס" | "חשבון סופי" | "חשבון מקדמה";
export type InvoiceStatus = "אושר" | "בבדיקה" | "שולם";

export interface HInvoice {
  id: number;
  supplierId: string;
  supplierDocNo: string;
  docType: InvoiceDocType;
  partialNo: number | null;
  period: string; // yyyy-mm
  date: string;
  dateReceived: string;
  enteredAt: string;
  enteredBy: PersonId;
  sectionId: SectionId;
  contractId: string | null;
  poId: number | null;
  descriptionHe: string;
  amount: number;
  cumulativePrev: number | null;
  cumulativeNow: number | null;
  retentionPct: number;
  retentionAmt: number;
  netPayable: number;
  building: BuildingTag | null;
  status: InvoiceStatus;
  approvedBy: PersonId | null;
  attachmentId: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
}

export interface HPurchaseOrder {
  id: number;
  date: string;
  supplierId: string;
  sectionId: SectionId;
  contractId: string | null;
  descriptionHe: string;
  qty: number;
  /** Unit the quantity is measured in. */
  unit: string;
  /**
   * Unit the price is quoted in — usually `unit`, but a supplier may quote per טון and deliver in ק״ג.
   * The order's value is the quantity converted into this unit, times `unitPrice` (see engine/units).
   */
  priceUnit: string;
  unitPrice: number;
  amount: number;
  deliveredQty: number;
  invoicedAmount: number;
  status: "פתוחה" | "סגורה";
  attachmentId: string | null;
  kind: "blanket" | "one_off";
}

export type Coverage = "covered" | "excluded" | "not_contracted";

export interface HBoqLine {
  id: string;
  chapter: string;
  chapterNameHe: string;
  descriptionHe: string;
  qty: number;
  unit: string;
  /** ₪ per `unit` before VAT; null when the line is not priced (a quantity-only list). */
  unitPrice: number | null;
  sectionId: SectionId;
  coverage: Coverage;
  coverageRef: string | null;
  coveredByContractId: string | null;
  noteHe?: string;
}

/** `allocation` = an internal budget allocation (overhead, contingency) — not procurement, so not an "estimate" in the report's uncovered figure. */
export type ForecastBasis = "invoice" | "contract" | "po" | "quote" | "appendix" | "estimate" | "allocation";

export interface HForecastLine {
  id: string;
  sectionId: SectionId;
  descriptionHe: string;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number;
  basis: ForecastBasis;
  sourceRef: string | null;
  kind: "remaining_commitment" | "uncovered";
}

export interface HSectionForecast {
  sectionId: SectionId;
  budget: number;
  recorded: number;
  committed: number;
  remainingCommitment: number;
  uncovered: number;
  eac: number;
  lines: HForecastLine[];
  coverageNoteHe?: string;
}

export interface HOpenIssue {
  id: string;
  titleHe: string;
  sectionId: SectionId | null;
  ownerId: PersonId;
  dueDate: string | null;
  openedInControl: string;
  status: "open" | "closed";
  closedAt: string | null;
  impactIfIgnoredHe?: string;
}

export interface HForecastVersion {
  controlDate: string;
  status: "final" | "draft";
  totalEac: number;
  sections: HSectionForecast[] | null;
  openIssues: HOpenIssue[];
  qualificationsHe: string[];
}

export interface HChangeLogEntry {
  id: string;
  /** "document": a deletion in the project folder (the row is gone; the entry says who removed which file). */
  recordType: "invoice" | "po" | "contract" | "budget" | "document";
  recordId: string;
  field: string;
  before: string;
  after: string;
  at: string;
  byId: PersonId;
  noteHe: string;
}

export interface HDocumentBlock {
  kind: "heading" | "paragraph" | "table" | "highlight" | "signature" | "stamp";
  text?: string;
  rows?: string[][];
  highlight?: boolean;
}

export type DocumentKind = "invoice" | "quote" | "appendix" | "contract_excerpt" | "boq_page" | "delivery_note" | "letter" | "other";

export const DOCUMENT_KIND_HE: Record<DocumentKind, string> = { invoice: "חשבון", quote: "הצעת מחיר", appendix: "נספח מחיר", contract_excerpt: "קטע מחוזה", boq_page: "עמוד מכתב כמויות", delivery_note: "תעודת משלוח", letter: "מכתב", other: "אחר" };

export interface HDocument {
  id: string;
  kind: DocumentKind;
  titleHe: string;
  date: string;
  supplierId: string | null;
  fileName: string;
  /** The seed's simulated pages; empty for a real file. */
  blocks: HDocumentBlock[];
  footerHe: string;
  /** Anchor ids for highlighting a specific block from a finding source. */
  anchors: Record<string, number>;
  /** A real file in Storage (bucket `documents`, path <project>/<document>/<file>); absent for the seed's pages. */
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Text extracted from the file by the tools (pdf.js / decoded text); absent until extracted or when the file has none. */
  text?: string;
  uploadedById?: string;
  uploadedAt?: string;
  /** The ERP record the document belongs to, when known (set at upload or by the agent when classifying). */
  recordRef?: { type: "invoice" | "po" | "contract"; id: string };
  /** One-line description the agent wrote after reading. */
  summaryHe?: string;
  /**
   * Structured facts extracted from the document (what an OCR/extraction step would produce), e.g. for a
   * quote: qty, unit, unitPrice, amount, validUntil, boqLineId; for a price appendix: pricePerTon, validFrom.
   */
  facts?: Record<string, unknown>;
  /** Where the facts came from: the seed, the agent reading the document, or an extraction service. */
  factsSource?: { method: "seed" | "agent" | "extraction"; byId?: string; at?: string; noteHe?: string };
  /** Set when a newer upload replaced this document: the id of the current one. A replaced document stays in the folder, marked, and is neither pending nor compared. */
  supersededBy?: string;
}

/** Normalised quote/order facts used by the checks; derived from `HDocument.facts`. */
export interface QuoteFacts {
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  validUntil: string | null;
  boqLineId: string | null;
}

export interface HadarimPackage {
  project: HProject;
  people: HPerson[];
  suppliers: HSupplier[];
  sections: HSection[];
  contracts: HContract[];
  invoices: HInvoice[];
  purchaseOrders: HPurchaseOrder[];
  boq: HBoqLine[];
  forecasts: HForecastVersion[];
  changeLog: HChangeLogEntry[];
  documents: HDocument[];
  /** Approved budget changes (empty in the seed; the ERP and the agent add them). */
  budgetChanges: HBudgetChange[];
}
