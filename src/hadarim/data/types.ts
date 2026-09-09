/**
 * Hadarim v2 data model. Amounts are whole ILS before VAT (the data spec works in whole shekels;
 * the engine keeps integers). Dates are ISO yyyy-mm-dd.
 */
export type SectionId = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18";
/** A building id of the project (`HProject.buildings[].id`) or the shared tag. */
export type BuildingTag = string;
/** Invoices and costs that belong to no single building. */
export const SHARED_BUILDING = "משותף";
/** The parking bucket of the per-building split (sections with split = parking). */
export const PARKING_BUCKET = "חניון";
export type PersonId = "EYAL" | "ROI" | "DANA" | "SARIT";

export interface HBuilding {
  id: string;
  floors: number;
  floorsCast: number;
  unitsPerFloor: number;
}

export interface HProject {
  id: "HADARIM";
  nameHe: string;
  companyHe: string;
  buildings: HBuilding[];
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

export interface HPerson {
  id: PersonId;
  nameHe: string;
  roleHe: string;
  canWriteAllocation: boolean;
}

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
}

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
  unit: string;
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
  recordType: "invoice" | "po" | "contract";
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

export interface HDocument {
  id: string;
  kind: "invoice" | "quote" | "appendix" | "contract_excerpt" | "boq_page";
  titleHe: string;
  date: string;
  supplierId: string | null;
  fileName: string;
  blocks: HDocumentBlock[];
  footerHe: string;
  /** Anchor ids for highlighting a specific block from a finding source. */
  anchors: Record<string, number>;
  /**
   * Structured facts extracted from the document (what an OCR/extraction step would produce), e.g. for a
   * quote: qty, unit, unitPrice, amount, validUntil, boqLineId; for a price appendix: pricePerTon, validFrom.
   */
  facts?: Record<string, unknown>;
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
}
