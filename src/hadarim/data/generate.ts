import { documentFacts, hadarimDocuments } from "./documents";
import { STANDARD_CHECK_POLICY, STANDARD_MATERIALITY, STANDARD_RISK_POLICY } from "./types";
import { addMonths, createRng, forceSum, lastDayOfMonth, monthKey } from "./rng";
import type {
  BuildingTag,
  HBoqLine,
  HChangeLogEntry,
  HContract,
  HForecastLine,
  HForecastVersion,
  HInvoice,
  HOpenIssue,
  HPerson,
  HProject,
  HPurchaseOrder,
  HSection,
  HSectionForecast,
  HSupplier,
  HadarimPackage,
  InvoiceStatus,
  PersonId,
  SectionId,
} from "./types";

/**
 * Deterministic generator for the Hadarim v2 data package (data spec §1–§9).
 * Every total in `docs/hadarim-v2-plan.md` §2 is produced here and pinned by tests.
 */

export const CONTROL_DATES = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"] as const;
export const CURRENT_CONTROL = "2026-09-01";
/** The day the presentation happens (invoice 1147 was keyed in by bookkeeping on 2.9). */
export const DEMO_DAY = "2026-09-03";
export const EARLIER_CONTROL_TOTALS: Record<string, number> = { "2026-05-01": 47_900_000, "2026-06-01": 47_950_000, "2026-07-01": 48_000_000 };

const MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const MONTH_HE: Record<string, string> = { "2025-11": "נובמבר 2025", "2025-12": "דצמבר 2025", "2026-01": "ינואר 2026", "2026-02": "פברואר 2026", "2026-03": "מרץ 2026", "2026-04": "אפריל 2026", "2026-05": "מאי 2026", "2026-06": "יוני 2026", "2026-07": "יולי 2026", "2026-08": "אוגוסט 2026" };

export const project: HProject = {
  id: "HADARIM",
  nameHe: "הדרים",
  companyHe: "אופק ביצוע בע״מ",
  buildings: [
    { id: "A", floors: 8, floorsCast: 7, unitsPerFloor: 3 },
    { id: "B", floors: 8, floorsCast: 5, unitsPerFloor: 3 },
  ],
  buckets: { shared: { id: "משותף", labelHe: "משותף" }, parking: { id: "חניון", labelHe: "חניון" } },
  materiality: { ...STANDARD_MATERIALITY },
  riskPolicy: { ...STANDARD_RISK_POLICY },
  checkPolicy: { ...STANDARD_CHECK_POLICY },
  units: 48,
  grossSqm: 8700,
  startDate: "2025-11-02",
  budgetVersion: { number: 3, approvedAt: "2026-03-15", amount: 48_000_000 },
  boqVersion: { number: 4, date: "2026-08-12" },
  controlDates: [...CONTROL_DATES],
  currentControlDate: CURRENT_CONTROL,
  physicalProgressPct: 38,
  schedule: { contractEnd: "2027-02", expectedEnd: "2027-02", noteHe: "ללא משמעות תקציבית ידועה מעבר להארכת ארגון אתר שכבר בתחזית" },
  statusHe: "בניין A: קומה 7 מתוך 8 יצוקה · בניין B: קומה 5 · תחילת בנייה בקומות התחתונות של A · שרוולי אינסטלציה וחשמל תת-קרקעיים · פיתוח שלב א׳ (עפר, קירות תומכים, תשתיות ראשיות) ברובו הושלם",
};

export const people: HPerson[] = [
  { id: "EYAL", nameHe: "אייל", roleHe: "מנהל פרויקט", canWriteAllocation: true, channel: "whatsapp" },
  { id: "ROI", nameHe: "רועי", roleHe: "סמנכ״ל ביצוע", canWriteAllocation: true, channel: "whatsapp" },
  { id: "DANA", nameHe: "דנה", roleHe: "מנכ״לית", canWriteAllocation: false, channel: "email" },
  { id: "SARIT", nameHe: "שרית", roleHe: "הנהלת חשבונות", canWriteAllocation: true, channel: "email" },
];

interface SiteVendor {
  id: string;
  nameHe: string;
  base: number;
  descHe: (monthHe: string) => string;
}

const SITE_VENDORS: SiteVendor[] = [
  { id: "SUP-CRANE", nameHe: "מנופי הגליל בע״מ", base: 30000, descHe: (m) => `השכרת מנוף צריח — ${m}` },
  { id: "SUP-GUARD", nameHe: "ש.ב. שמירה ואבטחה", base: 18000, descHe: (m) => `שמירה באתר — ${m}` },
  { id: "SUP-TOILET", nameHe: "סניטציה ניידת בע״מ", base: 2500, descHe: (m) => `שירותים ניידים — ${m}` },
  { id: "SUP-SCAFF", nameHe: "פיגומי הצפון", base: 12000, descHe: (m) => `השכרת פיגומים — ${m}` },
  { id: "SUP-FORM", nameHe: "טפסות מהיר בע״מ", base: 15000, descHe: (m) => `השכרת טפסות ותמיכות — ${m}` },
  { id: "SUP-UTIL", nameHe: "חשמל ומים לאתר (תאגיד)", base: 6000, descHe: (m) => `חשמל ומים לאתר — ${m}` },
  { id: "SUP-LAB", nameHe: "מעבדת איזוטופ", base: 4000, descHe: (m) => `בדיקות בטון וקרקע — ${m}` },
  { id: "SUP-SURVEY", nameHe: "א. לוי מודדים", base: 3500, descHe: (m) => `מדידות — ${m}` },
  { id: "SUP-SAFETY", nameHe: "ב. כהן יועץ בטיחות", base: 3000, descHe: (m) => `ייעוץ בטיחות — ${m}` },
  { id: "SUP-WASTE", nameHe: "פינוי פסולת ר.ד.", base: 5000, descHe: (m) => `פינוי פסולת בניין — ${m}` },
  { id: "SUP-PUMP", nameHe: "משאבות בטון ד.ר.", base: 12000, descHe: (m) => `משאבות בטון — ${m}` },
  { id: "SUP-FENCE", nameHe: "גידור והצללה ג.ש.", base: 2000, descHe: (m) => `גדרות ושערי אתר — ${m}` },
  { id: "SUP-OFFICE", nameHe: "יבילים למשרדי אתר", base: 6000, descHe: (m) => `השכרת משרדי אתר — ${m}` },
  { id: "SUP-COMMS", nameHe: "תקשורת ושילוט אתר", base: 1500, descHe: (m) => `תקשורת ושילוט — ${m}` },
  { id: "SUP-GEN", nameHe: "ג.מ. ציוד וגנרטורים", base: 4500, descHe: (m) => `השכרת גנרטור וציוד — ${m}` },
];

export const suppliers: HSupplier[] = [
  { id: "SUP-BM", nameHe: "ב.מ. בנייה מהירה בע״מ", kind: "subcontractor" },
  { id: "SUP-DORON", nameHe: "ע. דורון עבודות עפר", kind: "subcontractor" },
  { id: "SUP-NTB", nameHe: "נ.ת.ב. תשתיות ופיתוח בע״מ", kind: "subcontractor" },
  { id: "SUP-ITUM", nameHe: "איטום פלוס", kind: "subcontractor" },
  { id: "SUP-OREN", nameHe: "מעליות אורן", kind: "subcontractor" },
  { id: "SUP-SHY", nameHe: "ש.י. אינסטלציה", kind: "subcontractor" },
  { id: "SUP-AR", nameHe: "חשמל א.ר.", kind: "subcontractor" },
  { id: "SUP-GAL", nameHe: "גל בנייה קלה", kind: "subcontractor" },
  { id: "SUP-KOR", nameHe: "קור-אויר מערכות", kind: "subcontractor" },
  { id: "SUP-GILAD", nameHe: "אלומיניום גלעד", kind: "subcontractor" },
  { id: "SUP-PLADOT", nameHe: "פלדות הצפון בע״מ", kind: "supplier" },
  { id: "SUP-YCOHEN", nameHe: "י. כהן תשתיות בע״מ", kind: "subcontractor" },
  { id: "INTERNAL", nameHe: "הקצאה פנימית — הנהלה וביטוח", kind: "service" },
  ...SITE_VENDORS.map((v) => ({ id: v.id, nameHe: v.nameHe, kind: "service" as const })),
  { id: "SUP-PPE", nameHe: "ציוד מגן ובטיחות בע״מ", kind: "supplier" },
  { id: "SUP-GEO", nameHe: "ג. אבן יועצי קרקע", kind: "consultant" },
  { id: "SUP-TRANS", nameHe: "הובלות כבד ר.מ.", kind: "service" },
  { id: "SUP-INS", nameHe: "סוכנות ביטוח קבלנים", kind: "service" },
  { id: "SUP-ENG", nameHe: "משרד קונסטרוקטורים ד.ק.", kind: "consultant" },
  { id: "SUP-STD", nameHe: "מכון התקנים", kind: "service" },
];

export const sections: HSection[] = [
  { id: "01", nameHe: "ארגון אתר, מנוף, שמירה ושירותי אתר", shortHe: "ארגון אתר", budget: 1_900_000, kind: "works", split: "shared", contractIds: [], chapters: ["00"] },
  { id: "02", nameHe: "שלד — עבודה ובטון (קבלן משנה)", shortHe: "שלד", budget: 12_600_000, kind: "works", split: "by_floors", contractIds: ["02-01"], chapters: ["02", "03"] },
  { id: "03", nameHe: "אספקת ברזל זיון", shortHe: "ברזל", budget: 3_000_000, kind: "works", split: "by_floors", contractIds: ["03-F"], chapters: ["02"] },
  { id: "04", nameHe: "עבודות עפר, דיפון וכלונסאות", shortHe: "עפר ודיפון", budget: 2_900_000, kind: "works", split: "shared", contractIds: ["04-01"], chapters: ["01", "23"] },
  { id: "05", nameHe: "איטום", shortHe: "איטום", budget: 900_000, kind: "works", split: "per_building", contractIds: ["05-01"], chapters: ["05"] },
  { id: "06", nameHe: "בנייה (בלוקים) וטיח", shortHe: "בנייה וטיח", budget: 2_400_000, kind: "works", split: "by_floors", contractIds: ["06-01"], chapters: ["04", "09"] },
  { id: "07", nameHe: "פיתוח ותשתיות חוץ", shortHe: "פיתוח", budget: 3_200_000, kind: "works", split: "shared", contractIds: ["07-01"], chapters: ["40", "51", "57"] },
  { id: "08", nameHe: "אינסטלציה ותברואה", shortHe: "אינסטלציה", budget: 2_300_000, kind: "works", split: "by_units", contractIds: ["08-01"], chapters: ["07"] },
  { id: "09", nameHe: "חשמל ותקשורת", shortHe: "חשמל", budget: 2_600_000, kind: "works", split: "by_units", contractIds: ["09-01"], chapters: ["08"] },
  { id: "10", nameHe: "מיזוג אוויר", shortHe: "מיזוג", budget: 1_500_000, kind: "works", split: "by_units", contractIds: ["10-01"], chapters: ["15"] },
  { id: "11", nameHe: "אלומיניום", shortHe: "אלומיניום", budget: 2_000_000, kind: "works", split: "by_units", contractIds: ["11-01"], chapters: ["12"] },
  { id: "12", nameHe: "ריצוף וחיפוי", shortHe: "ריצוף", budget: 2_700_000, kind: "works", split: "by_units", contractIds: [], chapters: ["10"] },
  { id: "13", nameHe: "נגרות, מסגרות ומעקות", shortHe: "נגרות", budget: 1_700_000, kind: "works", split: "by_units", contractIds: [], chapters: ["06"] },
  { id: "14", nameHe: "מעליות", shortHe: "מעליות", budget: 1_300_000, kind: "works", split: "per_building", contractIds: ["14-01"], chapters: ["16"] },
  { id: "15", nameHe: "צבע וגבס", shortHe: "צבע וגבס", budget: 1_100_000, kind: "works", split: "by_units", contractIds: [], chapters: ["11", "22"] },
  { id: "16", nameHe: "מערכות חניון (שערים, אוורור, כיבוי)", shortHe: "מערכות חניון", budget: 1_200_000, kind: "works", split: "parking", contractIds: [], chapters: ["34", "08"] },
  { id: "17", nameHe: "בלתי צפוי", shortHe: "בלתי צפוי", budget: 1_500_000, kind: "contingency", split: "shared", contractIds: [], chapters: [] },
  { id: "18", nameHe: "הנהלה, פיקוח, ביטוח ואגרות", shortHe: "הנהלה", budget: 3_200_000, kind: "overhead", split: "shared", contractIds: [], chapters: [] },
];

/** The seed's "script invoice": present in variant A (re-allocated live in the demo), removed in variant B (keyed in live). */
export const SCRIPT_INVOICE_ID = 1147;

export const contracts: HContract[] = [
  {
    id: "02-01",
    sectionId: "02",
    supplierId: "SUP-BM",
    amount: 12_600_000,
    signedAt: "2025-10-20",
    scopeHe: "עבודות שלד — עבודה ובטון, שני בניינים וחניון",
    inclusionsHe: ["עבודות בטון יצוק באתר", "טפסות ותמיכות", "הרכבת ברזל זיון (הברזל מסופק ע״י המזמין)", "עבודות שלד החניון"],
    exclusions: [
      { clause: "2.5", textHe: "אספקת ברזל זיון — ע״י המזמין (אספקת ברזל ע״י המזמין)" },
      { clause: "2.6", textHe: "מעליות — אינן כלולות בחוזה זה", coveredByContractId: "14-01" },
      { clause: "2.7", textHe: "אלומיניום — אינו כלול בחוזה זה", coveredByContractId: "11-01" },
    ],
    retentionPct: 5,
    steelSuppliedByClient: true,
    noteHe: "נספח שינוי מס׳ 2 (18.8.2026): פירוט תכולה בחניון, ללא שינוי בסכום החוזה",
  },
  { id: "04-01", sectionId: "04", supplierId: "SUP-DORON", amount: 2_850_000, signedAt: "2025-10-15", scopeHe: "עבודות עפר, דיפון וכלונסאות", inclusionsHe: ["חפירה ופינוי", "דיפון", "כלונסאות"], exclusions: [], retentionPct: 5, closed: { at: "2026-04-30", finalAccount: 2_850_000 } },
  {
    id: "07-01",
    sectionId: "07",
    supplierId: "SUP-NTB",
    amount: 3_200_000,
    signedAt: "2026-01-05",
    scopeHe: "עבודות פיתוח ותשתיות חוץ",
    inclusionsHe: ["עבודות עפר לפיתוח", "קירות תומכים", "תשתיות ראשיות בתחום המגרש (מים, חשמל, תקשורת)", "ריצוף ואבן בשטחים החיצוניים", "גינון והשקיה בהיקף המפרט", "קווי ניקוז פנימיים בתחום המגרש"],
    exclusions: [
      { clause: "3.4", textHe: "לא כולל קווי ניקוז ראשיים מחוץ לקו הבניין ועד נקודת החיבור לתשתית העירונית" },
      { clause: "3.4", textHe: "לא כולל אגרות חיבור לתאגיד המים" },
      { clause: "3.4", textHe: "לא כולל עבודות סלילה ברשות הרבים" },
    ],
    retentionPct: 5,
    documentId: "contract_07_01_excerpt",
  },
  { id: "05-01", sectionId: "05", supplierId: "SUP-ITUM", amount: 900_000, signedAt: "2026-01-12", scopeHe: "עבודות איטום — יסודות, גגות, מרפסות וחדרים רטובים", inclusionsHe: ["איטום יסודות וקירות תת-קרקעיים", "איטום גגות", "איטום חדרים רטובים ומרפסות"], exclusions: [], retentionPct: 5, noteHe: "היקף כתב הכמויות פרק 05 נבדק מול החוזה שורה-שורה: התאמה מלאה", boqMatchVerified: true },
  { id: "14-01", sectionId: "14", supplierId: "SUP-OREN", amount: 1_300_000, signedAt: "2026-03-03", scopeHe: "4 מעליות (2 לכל בניין) — אספקה, התקנה והפעלה", inclusionsHe: ["4 מעליות נוסעים", "התקנה והרצה", "אישור מכון התקנים"], exclusions: [], retentionPct: 5, noteHe: "מקדמה 20% שולמה" },
  { id: "08-01", sectionId: "08", supplierId: "SUP-SHY", amount: 2_300_000, signedAt: "2026-05-18", scopeHe: "אינסטלציה ותברואה — 48 יח״ד וחניון", inclusionsHe: [], exclusions: [], retentionPct: 5 },
  { id: "09-01", sectionId: "09", supplierId: "SUP-AR", amount: 2_600_000, signedAt: "2026-05-18", scopeHe: "חשמל ותקשורת — 48 יח״ד, שטחים משותפים וחניון", inclusionsHe: [], exclusions: [], retentionPct: 5 },
  { id: "06-01", sectionId: "06", supplierId: "SUP-GAL", amount: 2_400_000, signedAt: "2026-06-02", scopeHe: "בנייה (בלוקים) וטיח", inclusionsHe: ["בנייה בבלוקים", "טיח פנים", "טיח חוץ"], exclusions: [], retentionPct: 5 },
  { id: "10-01", sectionId: "10", supplierId: "SUP-KOR", amount: 1_500_000, signedAt: "2026-07-14", scopeHe: "מיזוג אוויר — 48 יח״ד", inclusionsHe: [], exclusions: [], retentionPct: 5 },
  { id: "11-01", sectionId: "11", supplierId: "SUP-GILAD", amount: 2_000_000, signedAt: "2026-08-25", scopeHe: "אלומיניום — חלונות, ויטרינות ומעקות זכוכית", inclusionsHe: [], exclusions: [], retentionPct: 5, noteHe: "נסגר מנושאי הבקרה הקודמת (חתימת חוזה אלומיניום)" },
  {
    id: "03-F",
    sectionId: "03",
    supplierId: "SUP-PLADOT",
    amount: null,
    signedAt: "2025-11-01",
    scopeHe: "הסכם מסגרת לאספקת ברזל זיון — ללא סכום קבוע; מחיר לפי נספח מחיר בתוקף",
    inclusionsHe: ["ברזל זיון מצולע בכל הקטרים", "הובלה לאתר"],
    exclusions: [],
    retentionPct: 0,
    priceAppendices: [
      { id: "A", titleHe: "נספח א׳ — 4,000 ₪ לטון", validFrom: "2025-11-01", pricePerTon: 4000, documentId: "appendix_A_steel_price_2025_11" },
      { id: "A-2", titleHe: "נספח א׳-2 — 4,800 ₪ לטון", validFrom: "2026-07-15", pricePerTon: 4800, documentId: "appendix_A2_steel_price_2026_07_15" },
    ],
  },
];

export function priceAppendixAt(contract: HContract, date: string) {
  return [...(contract.priceAppendices ?? [])].filter((a) => a.validFrom <= date).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

interface InvoiceSeed {
  supplierId: string;
  supplierDocNo: string;
  docType: HInvoice["docType"];
  partialNo: number | null;
  period: string;
  date: string;
  sectionId: SectionId;
  contractId: string | null;
  poId: number | null;
  descriptionHe: string;
  amount: number;
  retentionPct: number;
  building: BuildingTag | null;
  status: InvoiceStatus;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  attachmentId?: string;
  enteredAt?: string;
  enteredBy?: PersonId;
  approvedBy?: PersonId | null;
  cumulative?: boolean;
  key?: string;
}

function statusFor(date: string, explicit?: InvoiceStatus): InvoiceStatus {
  if (explicit) return explicit;
  if (date < "2026-06-01") return "שולם";
  if (date < "2026-07-15") return "שולם";
  return "אושר";
}

function buildInvoiceSeeds(): InvoiceSeed[] {
  const rng = createRng(20260901);
  const seeds: InvoiceSeed[] = [];

  // Section 01: fifteen service vendors, ten months, exactly 1,250,000
  const siteAmounts: number[] = [];
  const siteSlots: { vendor: SiteVendor; month: string }[] = [];
  for (const month of MONTHS) for (const vendor of SITE_VENDORS) {
    siteSlots.push({ vendor, month });
    siteAmounts.push(rng.jitter(vendor.base, 0.08, 10));
  }
  const adjusted = forceSum(siteAmounts, 1_250_000);
  siteSlots.forEach(({ vendor, month }, i) => {
    const [y, m] = month.split("-").map(Number);
    const date = lastDayOfMonth(y, m);
    const trap = vendor.id === "SUP-CRANE" && month === "2026-06";
    seeds.push({
      supplierId: vendor.id,
      supplierDocNo: `${month.replace("-", "")}-${vendor.id.slice(4, 7)}`,
      docType: "חשבונית מס",
      partialNo: null,
      period: month,
      date,
      sectionId: "01",
      contractId: null,
      poId: null,
      descriptionHe: trap ? "מנוף צריח — שלד בניין A" : vendor.descHe(MONTH_HE[month]),
      amount: adjusted[i],
      retentionPct: 0,
      building: project.buckets.shared.id,
      status: statusFor(date),
      quantity: 1,
      unit: "חודש",
      unitPrice: adjusted[i],
    });
  });

  // Section 02: shell partials 1–10, cumulative 8,400,000, retention 5%
  const shell = [400_000, 600_000, 750_000, 850_000, 900_000, 950_000, 1_000_000, 1_000_000, 1_000_000, 950_000];
  shell.forEach((amount, i) => {
    const month = MONTHS[i];
    const [y, m] = month.split("-").map(Number);
    const date = i === 9 ? "2026-08-28" : lastDayOfMonth(y, m);
    seeds.push({ supplierId: "SUP-BM", supplierDocNo: `שלד-${i + 1}`, docType: "חשבון חלקי", partialNo: i + 1, period: month, date, sectionId: "02", contractId: "02-01", poId: null, descriptionHe: `חשבון חלקי מס׳ ${i + 1} — עבודות שלד, ${MONTH_HE[month]}`, amount, retentionPct: 5, building: i < 4 ? "A" : i % 2 === 0 ? "A" : "B", status: statusFor(date), cumulative: true });
  });

  // Section 03: eighteen steel deliveries, 450 t at 4,000
  const steel: [string, number, number | null][] = [
    ["2025-12-04", 24, null], ["2025-12-18", 25, null], ["2026-01-08", 26, null], ["2026-01-22", 22, null], ["2026-02-05", 28, null], ["2026-02-19", 24, null], ["2026-03-05", 25, null], ["2026-03-19", 26, null], ["2026-04-02", 24, null], ["2026-04-16", 22, null], ["2026-05-07", 25, null], ["2026-05-21", 26, null], ["2026-06-04", 24, null], ["2026-06-18", 23, null], ["2026-07-02", 24, null], ["2026-07-16", 22, null], ["2026-08-12", 35, 2240], ["2026-08-28", 25, 2240],
  ];
  steel.forEach(([date, tons, poId], i) => {
    const kgTrap = i === 9; // quantity in kg AND unit kg: consistent, must not fire
    seeds.push({
      supplierId: "SUP-PLADOT",
      supplierDocNo: `ת.מ. ${4410 + i * 7}`,
      docType: "חשבונית מס",
      partialNo: null,
      period: monthKey(date),
      date,
      sectionId: "03",
      contractId: "03-F",
      poId,
      descriptionHe: kgTrap ? `אספקת ברזל זיון מצולע — ${tons * 1000} ק״ג` : `אספקת ברזל זיון מצולע — ${tons} טון`,
      amount: tons * 4000,
      retentionPct: 0,
      building: i % 2 === 0 ? "A" : "B",
      status: statusFor(date),
      quantity: kgTrap ? tons * 1000 : tons,
      unit: kgTrap ? "ק״ג" : "טון",
      unitPrice: kgTrap ? 4 : 4000,
    });
  });

  // Section 04: partials 1–6 + final account = 2,850,000, closed 30.4
  const earth = [500_000, 600_000, 550_000, 500_000, 350_000, 250_000];
  earth.forEach((amount, i) => {
    const month = MONTHS[i];
    const [y, m] = month.split("-").map(Number);
    const date = i === 5 ? "2026-04-20" : lastDayOfMonth(y, m);
    seeds.push({ supplierId: "SUP-DORON", supplierDocNo: `עפר-${i + 1}`, docType: "חשבון חלקי", partialNo: i + 1, period: month, date, sectionId: "04", contractId: "04-01", poId: null, descriptionHe: `חשבון חלקי מס׳ ${i + 1} — עבודות עפר, דיפון וכלונסאות`, amount, retentionPct: 5, building: project.buckets.shared.id, status: "שולם", cumulative: true });
  });
  seeds.push({ supplierId: "SUP-DORON", supplierDocNo: "עפר-סופי", docType: "חשבון סופי", partialNo: 7, period: "2026-04", date: "2026-04-30", sectionId: "04", contractId: "04-01", poId: null, descriptionHe: "חשבון סופי — עבודות עפר, דיפון וכלונסאות (סגירת חוזה 04-01)", amount: 100_000, retentionPct: 5, building: project.buckets.shared.id, status: "שולם", cumulative: true });

  // Section 05: waterproofing partials
  [["2026-06-30", 90_000], ["2026-07-31", 110_000], ["2026-08-28", 120_000]].forEach(([date, amount], i) => {
    seeds.push({ supplierId: "SUP-ITUM", supplierDocNo: `איטום-${i + 1}`, docType: "חשבון חלקי", partialNo: i + 1, period: monthKey(date as string), date: date as string, sectionId: "05", contractId: "05-01", poId: null, descriptionHe: `חשבון חלקי מס׳ ${i + 1} — איטום יסודות וקירות תת-קרקעיים`, amount: amount as number, retentionPct: 5, building: "A", status: statusFor(date as string), cumulative: true });
  });
  seeds.push({ supplierId: "SUP-ITUM", supplierDocNo: "איטום-4", docType: "חשבון חלקי", partialNo: 4, period: "2026-08", date: "2026-08-30", sectionId: "05", contractId: "05-01", poId: null, descriptionHe: "חשבון חלקי מס׳ 4 — איטום מרפסות בניין A", amount: 60_000, retentionPct: 5, building: "A", status: "בבדיקה", cumulative: true, approvedBy: null });

  // Section 06: blocks
  seeds.push({ supplierId: "SUP-GAL", supplierDocNo: "בנייה-1", docType: "חשבון חלקי", partialNo: 1, period: "2026-08", date: "2026-08-25", sectionId: "06", contractId: "06-01", poId: null, descriptionHe: "חשבון חלקי מס׳ 1 — בנייה בבלוקים, קומות 1–3 בניין A", amount: 180_000, retentionPct: 5, building: "A", status: "אושר", cumulative: true });
  seeds.push({ supplierId: "SUP-GAL", supplierDocNo: "בנייה-2", docType: "חשבון חלקי", partialNo: 2, period: "2026-08", date: "2026-08-31", sectionId: "06", contractId: "06-01", poId: null, descriptionHe: "חשבון חלקי מס׳ 2 — בנייה בבלוקים, קומה 4 בניין A", amount: 95_000, retentionPct: 5, building: "A", status: "בבדיקה", cumulative: true, approvedBy: null });

  // Section 07: development partials 1–7, partial 7 = invoice 1147
  const dev: [string, number][] = [["2026-02-28", 250_000], ["2026-03-31", 400_000], ["2026-04-30", 450_000], ["2026-05-31", 400_000], ["2026-06-30", 350_000], ["2026-07-31", 250_000], ["2026-08-31", 180_000]];
  dev.forEach(([date, amount], i) => {
    const last = i === 6;
    seeds.push({
      key: last ? "INV-1147" : undefined,
      supplierId: "SUP-NTB",
      supplierDocNo: last ? "2026-087" : `2026-0${41 + i * 7}`,
      docType: "חשבון חלקי",
      partialNo: i + 1,
      period: monthKey(date),
      date,
      sectionId: "07",
      contractId: "07-01",
      poId: null,
      descriptionHe: last ? "עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳" : `חשבון חלקי מס׳ ${i + 1} — עבודות פיתוח ותשתיות חוץ`,
      amount,
      retentionPct: 5,
      building: last ? null : project.buckets.shared.id,
      status: statusFor(date),
      cumulative: true,
      attachmentId: last ? "inv_1147_ntb_partial7" : undefined,
      enteredAt: last ? "2026-09-02" : undefined,
      enteredBy: "SARIT",
    });
  });

  // Sections 08, 09
  [["2026-07-31", 150_000, "אושר"], ["2026-08-29", 200_000, "אושר"], ["2026-08-31", 120_000, "בבדיקה"]].forEach(([date, amount, status], i) => {
    seeds.push({ supplierId: "SUP-SHY", supplierDocNo: `אינ-${i + 1}`, docType: "חשבון חלקי", partialNo: i + 1, period: monthKey(date as string), date: date as string, sectionId: "08", contractId: "08-01", poId: null, descriptionHe: `חשבון חלקי מס׳ ${i + 1} — אינסטלציה, צנרת תת-קרקעית ושרוולים`, amount: amount as number, retentionPct: 5, building: i % 2 === 0 ? "A" : "B", status: status as InvoiceStatus, cumulative: true, approvedBy: status === "בבדיקה" ? null : undefined });
  });
  [["2026-07-31", 120_000, "אושר"], ["2026-08-29", 160_000, "אושר"], ["2026-08-31", 140_000, "בבדיקה"]].forEach(([date, amount, status], i) => {
    seeds.push({ supplierId: "SUP-AR", supplierDocNo: `חש-${i + 1}`, docType: "חשבון חלקי", partialNo: i + 1, period: monthKey(date as string), date: date as string, sectionId: "09", contractId: "09-01", poId: null, descriptionHe: `חשבון חלקי מס׳ ${i + 1} — חשמל, שרוולים והארקות יסוד`, amount: amount as number, retentionPct: 5, building: i % 2 === 0 ? "A" : "B", status: status as InvoiceStatus, cumulative: true, approvedBy: status === "בבדיקה" ? null : undefined });
  });

  // Section 14: elevator advance
  seeds.push({ supplierId: "SUP-OREN", supplierDocNo: "מק-1", docType: "חשבון מקדמה", partialNo: null, period: "2026-03", date: "2026-03-15", sectionId: "14", contractId: "14-01", poId: null, descriptionHe: "חשבון מקדמה 20% — 4 מעליות (טרם נמדדה כמות בכתב הכמויות)", amount: 260_000, retentionPct: 0, building: project.buckets.shared.id, status: "שולם" });

  // Section 18: monthly allocations
  MONTHS.forEach((month, i) => {
    const [y, m] = month.split("-").map(Number);
    const date = lastDayOfMonth(y, m);
    seeds.push({ supplierId: "INTERNAL", supplierDocNo: `הקצאה-${i + 1}`, docType: "חשבונית מס", partialNo: null, period: month, date, sectionId: "18", contractId: null, poId: null, descriptionHe: `הקצאת הנהלה, פיקוח, ביטוח ואגרות — ${MONTH_HE[month]}`, amount: 210_000, retentionPct: 0, building: project.buckets.shared.id, status: statusFor(date) });
  });

  // One more invoice in review (lab)
  seeds.push({ supplierId: "SUP-LAB", supplierDocNo: "202608-LABX", docType: "חשבונית מס", partialNo: null, period: "2026-08", date: "2026-08-30", sectionId: "01", contractId: null, poId: null, descriptionHe: "בדיקות נוספות — קורות קומה 7 בניין A", amount: 4_500, retentionPct: 0, building: "A", status: "בבדיקה", quantity: 1, unit: "חודש", unitPrice: 4_500, approvedBy: null });

  return seeds;
}

export function buildInvoices(): HInvoice[] {
  const seeds = buildInvoiceSeeds();
  const ordered = seeds.map((s, i) => ({ s, i })).sort((a, b) => (a.s.date < b.s.date ? -1 : a.s.date > b.s.date ? 1 : a.i - b.i));
  const indexOf1147 = ordered.findIndex((x) => x.s.key === "INV-1147");
  const start = 1147 - indexOf1147;
  const cumulative = new Map<string, number>();
  return ordered.map(({ s }, idx) => {
    const id = start + idx;
    let cumulativePrev: number | null = null;
    let cumulativeNow: number | null = null;
    if (s.cumulative && s.contractId) {
      const prev = cumulative.get(s.contractId) ?? 0;
      cumulativePrev = prev;
      cumulativeNow = prev + s.amount;
      if (s.status !== "בבדיקה") cumulative.set(s.contractId, cumulativeNow);
    }
    const retentionAmt = Math.round((s.amount * s.retentionPct) / 100);
    const enteredAt = s.enteredAt ?? addDaysIso(s.date, s.date.endsWith("-31") || s.date.endsWith("-30") ? 2 : 1);
    return {
      id,
      supplierId: s.supplierId,
      supplierDocNo: s.supplierDocNo,
      docType: s.docType,
      partialNo: s.partialNo,
      period: s.period,
      date: s.date,
      dateReceived: s.date,
      enteredAt,
      enteredBy: s.enteredBy ?? "SARIT",
      sectionId: s.sectionId,
      contractId: s.contractId,
      poId: s.poId,
      descriptionHe: s.descriptionHe,
      amount: s.amount,
      cumulativePrev,
      cumulativeNow,
      retentionPct: s.retentionPct,
      retentionAmt,
      netPayable: s.amount - retentionAmt,
      building: s.building,
      status: s.status,
      approvedBy: s.approvedBy === undefined ? (s.status === "בבדיקה" ? null : "EYAL") : s.approvedBy,
      attachmentId: s.attachmentId ?? null,
      quantity: s.quantity ?? null,
      unit: s.unit ?? null,
      unitPrice: s.unitPrice ?? null,
    };
  });
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export function buildPurchaseOrders(invoices: HInvoice[]): HPurchaseOrder[] {
  const orders: HPurchaseOrder[] = [];
  let nextId = 2201;
  for (const vendor of SITE_VENDORS) {
    const invoiced = invoices.filter((i) => i.supplierId === vendor.id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
    orders.push({ id: nextId++, date: "2025-11-01", supplierId: vendor.id, sectionId: "01", contractId: null, descriptionHe: `הזמנת מסגרת — ${vendor.descHe("").replace(" — ", "")} — ${BLANKET_MONTHS} חודשים`, qty: BLANKET_MONTHS, unit: "חודשים", priceUnit: "חודשים", unitPrice: vendor.base, amount: vendor.base * BLANKET_MONTHS, deliveredQty: 10, invoicedAmount: invoiced, status: "פתוחה", attachmentId: null, kind: "blanket" });
  }
  const oneOffs: [string, SectionId, string, number, string, number][] = [
    ["SUP-GEN", "01", "השכרת מלגזה טלסקופית — 3 חודשים", 3, "חודשים", 9_000],
    ["SUP-TRANS", "01", "מכולות אחסון — 6 יח׳", 6, "יח׳", 2_400],
    ["SUP-PPE", "01", "ציוד מגן אישי — 120 ערכות", 120, "ערכה", 180],
    ["SUP-PPE", "01", "שילוט בטיחות ותמרור אתר — 40 יח׳", 40, "יח׳", 220],
    ["SUP-LAB", "01", "בדיקות בטון — 200 דגימות", 200, "דגימה", 95],
    ["SUP-GEO", "04", "בדיקות קרקע ויעוץ ביסוס — 25 בדיקות", 25, "בדיקה", 1_800],
    ["SUP-GEN", "01", "אספקת דלק לגנרטור — 6,000 ליטר", 6000, "ליטר", 6.5],
    ["SUP-ITUM", "05", "חומרי איטום לתיקונים — 800 ליטר", 800, "ליטר", 42],
    ["SUP-TRANS", "01", "שירותי הובלה כבדה — 20 הובלות", 20, "הובלה", 1_900],
    ["SUP-ENG", "18", "פיקוח עליון קונסטרוקטור — 12 ביקורים", 12, "ביקור", 3_500],
    ["SUP-INS", "18", "ביטוח עבודות קבלניות — פוליסה שנתית", 1, "פוליסה", 210_000],
    ["SUP-STD", "18", "בדיקות מכון התקנים — 6 בדיקות", 6, "בדיקה", 4_200],
    ["SUP-GEN", "01", "השכרת מדחס וכלי אוויר — 4 חודשים", 4, "חודשים", 3_200],
    ["SUP-SAFETY", "01", "הדרכות בטיחות תקופתיות — 8 הדרכות", 8, "הדרכה", 1_400],
    ["SUP-SURVEY", "01", "מדידת AS-MADE שלד בניין A — 1 קומפ׳", 1, "קומפ׳", 12_000],
    ["SUP-WASTE", "01", "מכולות פסולת נוספות — 30 פינויים", 30, "פינוי", 650],
    ["SUP-COMMS", "01", "מצלמות אבטחה לאתר — 8 יח׳", 8, "יח׳", 1_150],
    ["SUP-FENCE", "01", "גדר הצללה נוספת לחזית — 120 מ׳", 120, "מ׳", 95],
    ["SUP-OFFICE", "01", "מיזוג למשרדי אתר — 3 יח׳", 3, "יח׳", 3_400],
    ["SUP-PUMP", "01", "משאבת בטון סטטית לקומות עליונות — 2 חודשים", 2, "חודשים", 14_000],
    ["SUP-ENG", "18", "יועץ אקוסטיקה — חוות דעת", 1, "קומפ׳", 18_000],
    ["SUP-ENG", "18", "יועץ נגישות — ליווי עד טופס 4", 1, "קומפ׳", 22_000],
  ];
  oneOffs.forEach(([supplierId, sectionId, descriptionHe, qty, unit, unitPrice], i) => {
    const amount = Math.round(qty * unitPrice);
    const date = addMonths("2025-12-10", Math.floor(i / 3));
    orders.push({ id: nextId++, date, supplierId, sectionId, contractId: null, descriptionHe, qty, unit, priceUnit: unit, unitPrice, amount, deliveredQty: i % 3 === 0 ? qty : Math.floor(qty / 2), invoicedAmount: 0, status: "פתוחה", attachmentId: null, kind: "one_off" });
  });
  // PO 2240: closed, old price, legitimately issued before appendix A-2
  orders.push({ id: 2240, date: "2026-07-01", supplierId: "SUP-PLADOT", sectionId: "03", contractId: "03-F", descriptionHe: "ברזל זיון מצולע, קטרים 10–16 מ״מ — 60 טון", qty: 60, unit: "טון", priceUnit: "טון", unitPrice: 4000, amount: 240_000, deliveredQty: 60, invoicedAmount: 240_000, status: "סגורה", attachmentId: null, kind: "one_off" });
  // PO 2291: the unit error
  orders.push({ id: 2291, date: "2026-08-22", supplierId: "SUP-PLADOT", sectionId: "03", contractId: "03-F", descriptionHe: "ברזל זיון מצולע, קטרים 8–16 מ״מ", qty: 12000, unit: "טון", priceUnit: "טון", unitPrice: 4.8, amount: 57_600, deliveredQty: 0, invoicedAmount: 0, status: "פתוחה", attachmentId: "quote_pladot_12t", kind: "one_off" });
  return orders.sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// BOQ v4
// ---------------------------------------------------------------------------

interface ChapterSpec {
  chapter: string;
  nameHe: string;
  sectionId: SectionId;
  lines: [string, number, string][];
  coverageRefOverride?: string;
}

const CHAPTERS: ChapterSpec[] = [
  { chapter: "01", nameHe: "עבודות עפר", sectionId: "04", lines: [["חפירה כללית בכל סוגי הקרקע", 9_800, "מ״ק"], ["חפירת תעלות ליסודות", 1_200, "מ״ק"], ["מילוי מובא מהודק", 2_600, "מ״ק"], ["פינוי עודפי עפר", 7_200, "מ״ק"], ["הידוק שתית", 3_100, "מ״ר"], ["דיפון זמני", 620, "מ״ר"]] },
  { chapter: "02", nameHe: "בטון יצוק באתר", sectionId: "02", lines: [["בטון רזה", 210, "מ״ק"], ["רפסודת יסוד ב-30", 1_150, "מ״ק"], ["קירות תת-קרקעיים ב-30", 640, "מ״ק"], ["עמודים ב-30", 380, "מ״ק"], ["קורות ב-30", 520, "מ״ק"], ["תקרות ב-30 עובי 22 ס״מ", 2_980, "מ״ק"], ["מדרגות", 96, "מ״ק"], ["קירות ממ״ד ב-30", 410, "מ״ק"], ["מוטות פלדה מצולעים לזיון", 750, "טון"], ["רשתות פלדה מרותכות", 38, "טון"], ["טפסות לקירות", 9_100, "מ״ר"], ["טפסות לתקרות", 13_500, "מ״ר"], ["איטום פני בטון בתת-קרקע", 3_100, "מ״ר"], ["הכנות לפתחים ושרוולים", 1, "קומפ׳"]] },
  { chapter: "04", nameHe: "בנייה", sectionId: "06", lines: [["בנייה בבלוקי בטון 20 ס״מ", 6_400, "מ״ר"], ["בנייה בבלוקי בטון 10 ס״מ", 4_100, "מ״ר"], ["בנייה בבלוקי איטונג 15 ס״מ", 2_200, "מ״ר"], ["חגורות ועמודונים", 210, "מ״ק"], ["משקופים סמויים", 480, "יח׳"], ["ארגזי תריסים", 190, "יח׳"]] },
  { chapter: "05", nameHe: "איטום", sectionId: "05", lines: [["איטום יסודות ביריעות ביטומניות", 3_100, "מ״ר"], ["איטום קירות תת-קרקעיים", 2_400, "מ״ר"], ["איטום גגות", 1_350, "מ״ר"], ["איטום חדרים רטובים", 1_450, "מ״ר"], ["איטום מרפסות", 960, "מ״ר"], ["איטום קירות חניון", 1_800, "מ״ר"]] },
  { chapter: "06", nameHe: "נגרות ומסגרות", sectionId: "13", lines: [["דלתות כניסה לדירות", 48, "יח׳"], ["דלתות פנים", 336, "יח׳"], ["מעקות מתכת למדרגות", 420, "מ׳"], ["מעקות מרפסות (מסגרות)", 380, "מ׳"], ["דלתות אש לחניון", 22, "יח׳"], ["ארונות חשמל ותקשורת", 48, "יח׳"], ["סולמות ופתחי גישה", 12, "יח׳"], ["שערים לחדרי מכונות", 6, "יח׳"]] },
  { chapter: "07", nameHe: "תברואה", sectionId: "08", lines: [["צנרת מים קרים וחמים", 4_800, "מ׳"], ["צנרת דלוחין וביוב פנימית", 3_900, "מ׳"], ["כלים סניטריים", 192, "יח׳"], ["מערכת הגברת לחץ", 2, "קומפ׳"], ["צנרת גז", 1_100, "מ׳"], ["מערכת סולארית", 48, "יח׳"], ["ניקוז מזגנים", 1_400, "מ׳"], ["שרוולים תת-קרקעיים", 1, "קומפ׳"]] },
  { chapter: "08", nameHe: "חשמל", sectionId: "09", lines: [["לוחות חשמל דירתיים", 48, "יח׳"], ["לוח חשמל ראשי", 2, "יח׳"], ["נקודות מאור", 3_360, "יח׳"], ["נקודות כוח", 2_880, "יח׳"], ["תשתיות תקשורת", 48, "יח׳"], ["הארקת יסוד", 2, "קומפ׳"], ["תאורת חירום ושילוט", 210, "יח׳"], ["אינטרקום", 48, "יח׳"]] },
  { chapter: "09", nameHe: "טיח", sectionId: "06", lines: [["טיח פנים", 14_800, "מ״ר"], ["טיח חוץ", 6_300, "מ״ר"], ["טיח תרמי", 1_200, "מ״ר"], ["פינות מגן", 4_100, "מ׳"]] },
  { chapter: "10", nameHe: "ריצוף וחיפוי", sectionId: "12", lines: [["ריצוף גרניט פורצלן 60/60", 4_900, "מ״ר"], ["ריצוף חדרים רטובים", 1_450, "מ״ר"], ["חיפוי קירות חדרים רטובים", 3_100, "מ״ר"], ["ריצוף מרפסות", 960, "מ״ר"], ["ריצוף לובי וחדרי מדרגות", 620, "מ״ר"], ["שיש למטבחים", 48, "יח׳"], ["פנלים", 5_400, "מ׳"], ["ריצוף חניון (החלקת בטון)", 2_400, "מ״ר"]] },
  { chapter: "11", nameHe: "צבע", sectionId: "15", lines: [["צבע פנים על טיח", 14_800, "מ״ר"], ["צבע חוץ", 6_300, "מ״ר"], ["צבע על גבס", 5_100, "מ״ר"], ["צביעת מסגרות", 620, "מ״ר"]] },
  { chapter: "12", nameHe: "אלומיניום", sectionId: "11", lines: [["חלונות הזזה", 288, "יח׳"], ["ויטרינות סלון", 48, "יח׳"], ["תריסי גלילה", 288, "יח׳"], ["מעקות זכוכית למרפסות", 380, "מ׳"], ["דלתות כניסה ללובי", 4, "יח׳"], ["רפפות למערכות", 96, "יח׳"]] },
  { chapter: "15", nameHe: "מיזוג אוויר", sectionId: "10", lines: [["מזגנים מיני-מרכזיים דירתיים", 48, "יח׳"], ["תעלות אוויר", 2_300, "מ׳"], ["צנרת גז מיזוג", 1_900, "מ׳"], ["מפזרי אוויר", 480, "יח׳"], ["בקרה ותרמוסטטים", 48, "יח׳"], ["אוורור חדרים רטובים", 144, "יח׳"]] },
  { chapter: "17", nameHe: "מעליות", sectionId: "14", lines: [["מעלית נוסעים 8 תחנות", 4, "יח׳"], ["הרצה ואישור מכון התקנים", 4, "קומפ׳"]] },
  { chapter: "22", nameHe: "גבס", sectionId: "15", lines: [["תקרות גבס", 3_800, "מ״ר"], ["קירות גבס", 1_300, "מ״ר"], ["סינרי גבס", 2_100, "מ׳"], ["פתחי גישה", 96, "יח׳"]] },
  { chapter: "23", nameHe: "כלונסאות", sectionId: "04", lines: [["כלונסאות קדוחים קוטר 60", 1_450, "מ׳"], ["כלונסאות קדוחים קוטר 80", 620, "מ׳"], ["ראשי כלונסאות", 96, "יח׳"], ["בדיקות סוניות", 96, "יח׳"]] },
  { chapter: "34", nameHe: "גילוי וכיבוי אש", sectionId: "16", lines: [["מערכת ספרינקלרים לחניון", 2_400, "מ״ר"], ["גלאי עשן ולוח בקרה", 1, "קומפ׳"], ["עמדות כיבוי", 14, "יח׳"], ["מערכת שחרור עשן", 1, "קומפ׳"]] },
  { chapter: "40", nameHe: "פיתוח האתר", sectionId: "07", lines: [["קירות תומכים מבטון", 210, "מ״ק"], ["ריצוף אבן משתלבת", 1_650, "מ״ר"], ["גינון והשקיה", 1, "קומפ׳"], ["גדר היקפית", 240, "מ׳"], ["תאורת חוץ", 32, "יח׳"], ["ריהוט גן", 1, "קומפ׳"], ["מדרגות חוץ", 42, "מ׳"], ["רמפות לחניון", 2, "קומפ׳"]] },
  { chapter: "44", nameHe: "שערים ומחסומים", sectionId: "16", lines: [["שער חניון חשמלי", 2, "יח׳"], ["מחסום זרוע", 2, "יח׳"]] },
  { chapter: "51", nameHe: "סלילה", sectionId: "07", lines: [["מצע סוג א׳", 1_100, "מ״ק"], ["אספלט לחניה עילית", 1_300, "מ״ר"], ["אבני שפה", 420, "מ׳"], ["סימון וצביעה", 1, "קומפ׳"]] },
  { chapter: "57", nameHe: "קווי מים, ביוב וניקוז", sectionId: "07", lines: [["צינור מים פוליאתילן 110 מ״מ, כולל חפירה ומילוי", 140, "מ׳"], ["קו ביוב PVC SN8 200 מ״מ בתחום המגרש", 95, "מ׳"], ["שוחות בקרה לביוב קוטר 100 ס״מ", 6, "יח׳"], ["קווי ניקוז פנימיים PVC 250 מ״מ", 60, "מ׳"], ["צינור ניקוז PVC קשיח SN8 קוטר 400 מ״מ, כולל חפירה, מצע ומילוי, עומק עד 2.5 מ׳", 80, "מ׳"], ["מחבר לתשתית עירונית כולל קידוח ואטימה", 1, "קומפ׳"]] },
];

export function buildBoq(): HBoqLine[] {
  const lines: HBoqLine[] = [];
  for (const ch of CHAPTERS) {
    const section = sections.find((s) => s.id === ch.sectionId)!;
    const contractId = section.contractIds.find((c) => c !== "03-F") ?? null;
    ch.lines.forEach(([descriptionHe, qty, unit], i) => {
      const sub = String(Math.floor(i / 3) + 1).padStart(2, "0");
      const item = String(((i % 3) + 1) * 10).padStart(3, "0");
      const id = ch.chapter === "57" && i === 4 ? "57.03.040" : `${ch.chapter}.${sub}.${item}`;
      let sectionId = ch.sectionId;
      let coverage: HBoqLine["coverage"] = contractId ? "covered" : "not_contracted";
      let coverageRef: string | null = contractId ? `חוזה ${contractId}` : null;
      let coveredBy: string | null = contractId;
      let noteHe: string | undefined;
      if (ch.chapter === "02" && (descriptionHe.includes("פלדה") || descriptionHe.includes("רשתות"))) {
        sectionId = "03";
        coverage = "covered";
        coverageRef = "הסכם מסגרת ⁨03-F⁩ (אספקה ע״י המזמין, מוחרג מחוזה השלד 02-01 §2.5)";
        coveredBy = "03-F";
      }
      if (id === "57.03.040") {
        coverage = "excluded";
        coverageRef = "חוזה 07-01 §3.4 — מוחרג";
        coveredBy = null;
        noteHe = "קו ראשי עד נקודת החיבור העירונית";
      }
      if (ch.chapter === "17") {
        coverageRef = "חוזה 14-01 (מוחרג מחוזה השלד 02-01 §2.6 ומכוסה בחוזה המעליות)";
        noteHe = "מוחרג מחוזה השלד אך מכוסה — אין פער";
      }
      lines.push({ id, chapter: ch.chapter, chapterNameHe: ch.nameHe, descriptionHe, qty, unit, sectionId, coverage, coverageRef, coveredByContractId: coveredBy, noteHe });
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Forecasts
// ---------------------------------------------------------------------------

export function recordedBySection(invoices: HInvoice[], throughDate: string): Record<SectionId, number> {
  const out = Object.fromEntries(sections.map((s) => [s.id, 0])) as Record<SectionId, number>;
  for (const inv of invoices) {
    if (inv.status === "בבדיקה") continue;
    if (inv.dateReceived >= throughDate) continue;
    out[inv.sectionId] += inv.amount;
  }
  return out;
}

const MONTHLY_OVERHEAD = 210_000;
/** Planned site duration in months (Nov 2025 – Feb 2027); blanket site-service orders cover the budgeted 15 months. */
const PROJECT_MONTHS = 16;
const BLANKET_MONTHS = 15;

/** Roll a control forecast: recorded through the control date, remaining commitments, and the uncovered lines carried from the previous control. */
export function buildForecast(controlDate: string, invoices: HInvoice[], purchaseOrders: HPurchaseOrder[], status: "final" | "draft", openIssues: HOpenIssue[]): HForecastVersion {
  const recorded = recordedBySection(invoices, controlDate);
  const monthsElapsed = MONTHS.filter((m) => `${m}-01` < controlDate).length;
  const out: HSectionForecast[] = sections.map((section) => {
    const lines: HForecastLine[] = [];
    const rec = recorded[section.id];
    let committed = 0;
    let remainingCommitment = 0;
    let uncovered = 0;
    let coverageNoteHe: string | undefined;
    const contract = contracts.find((c) => section.contractIds.includes(c.id) && c.amount != null && c.signedAt < controlDate);
    const contractNotYetSigned = contracts.find((c) => section.contractIds.includes(c.id) && c.amount != null && c.signedAt >= controlDate);
    switch (section.id) {
      case "01": {
        const blanket = purchaseOrders.filter((p) => p.sectionId === "01" && p.kind === "blanket");
        committed = blanket.reduce((a, p) => a + p.amount, 0);
        const poMonthsLeft = Math.max(0, BLANKET_MONTHS - monthsElapsed);
        const poRemaining = blanket.reduce((a, p) => a + p.unitPrice * poMonthsLeft, 0);
        const target = 1_950_000 - rec;
        const poLine = Math.min(poRemaining, target);
        lines.push({ id: `${controlDate}-01-po`, sectionId: "01", descriptionHe: `יתרת הזמנות מסגרת לשירותי אתר — ${poMonthsLeft} חודשים`, qty: poMonthsLeft, unit: "חודשים", unitPrice: null, amount: poLine, basis: "po", sourceRef: "הזמנות מסגרת 2201–2215", kind: "remaining_commitment" });
        remainingCommitment = poLine;
        uncovered = target - poLine;
        lines.push({ id: `${controlDate}-01-est`, sectionId: "01", descriptionHe: `אומדן הארכת ארגון אתר — ${PROJECT_MONTHS - BLANKET_MONTHS} חודש נוסף לפי לוח הזמנים המעודכן`, qty: null, unit: null, unitPrice: null, amount: uncovered, basis: "estimate", sourceRef: "לוח זמנים מעודכן 06/2026", kind: "uncovered" });
        break;
      }
      case "03": {
        const framework = contracts.find((c) => c.id === "03-F")!;
        const deliveredTons = Math.round(rec / 4000);
        const openPo = purchaseOrders.filter((p) => p.sectionId === "03" && p.date < controlDate && p.status === "סגורה" && p.deliveredQty > 0 && p.id === 2240 && controlDate <= "2026-08-01");
        const poTons = openPo.reduce((a, p) => a + p.qty, 0);
        committed = openPo.reduce((a, p) => a + p.amount, 0);
        remainingCommitment = committed;
        for (const p of openPo) lines.push({ id: `${controlDate}-03-po${p.id}`, sectionId: "03", descriptionHe: `הזמנה ${p.id} — ${p.qty} טון במחיר ${p.unitPrice.toLocaleString("he-IL")} ₪/טון`, qty: p.qty, unit: "טון", unitPrice: p.unitPrice, amount: p.amount, basis: "po", sourceRef: `הזמנת רכש ${p.id}`, kind: "remaining_commitment" });
        const remainingTons = 750 - deliveredTons - poTons;
        const appendix = framework.priceAppendices!.find((a) => a.id === "A")!;
        uncovered = remainingTons * appendix.pricePerTon;
        lines.push({ id: `${controlDate}-03-rem`, sectionId: "03", descriptionHe: `יתרת ברזל זיון לפי כתב הכמויות — ${remainingTons} טון`, qty: remainingTons, unit: "טון", unitPrice: appendix.pricePerTon, amount: uncovered, basis: "appendix", sourceRef: `נספח א׳ (11/2025) — ${appendix.pricePerTon.toLocaleString("he-IL")} ₪/טון`, kind: "uncovered" });
        break;
      }
      case "17": {
        uncovered = section.budget;
        lines.push({ id: `${controlDate}-17`, sectionId: "17", descriptionHe: "בלתי צפוי — יתרה לא מנוצלת", qty: null, unit: null, unitPrice: null, amount: uncovered, basis: "allocation", sourceRef: "תקציב גרסה 3", kind: "uncovered" });
        break;
      }
      case "18": {
        const remainingMonths = PROJECT_MONTHS - monthsElapsed;
        uncovered = section.budget - rec;
        lines.push({ id: `${controlDate}-18`, sectionId: "18", descriptionHe: `הנהלה, פיקוח, ביטוח ואגרות — ${remainingMonths} חודשים × ${MONTHLY_OVERHEAD.toLocaleString("he-IL")} ₪ (מותאם לתקציב)`, qty: remainingMonths, unit: "חודשים", unitPrice: null, amount: uncovered, basis: "allocation", sourceRef: "תקציב גרסה 3 — הקצאה חודשית", kind: "uncovered" });
        break;
      }
      default: {
        if (contract) {
          committed = contract.closed ? contract.closed.finalAccount : contract.amount!;
          remainingCommitment = Math.max(0, committed - rec);
          if (remainingCommitment > 0) lines.push({ id: `${controlDate}-${section.id}-ct`, sectionId: section.id, descriptionHe: `יתרת חוזה ${contract.id} — ${suppliers.find((s) => s.id === contract.supplierId)?.nameHe}`, qty: null, unit: null, unitPrice: null, amount: remainingCommitment, basis: "contract", sourceRef: `חוזה ${contract.id}`, kind: "remaining_commitment" });
          if (section.id === "07") coverageNoteHe = "חבילת הפיתוח מכוסה בחוזה 07-01; אומדן נוסף: 0";
          if (contract.closed) coverageNoteHe = `החוזה נסגר בחשבון סופי ${contract.closed.at.split("-").reverse().join(".")} — סטייה חיובית מאומתת`;
        } else if (contractNotYetSigned) {
          uncovered = section.budget - rec;
          lines.push({ id: `${controlDate}-${section.id}-est`, sectionId: section.id, descriptionHe: `${section.nameHe} — אומדן עד חתימת חוזה (${contractNotYetSigned.id} במו״מ)`, qty: null, unit: null, unitPrice: null, amount: uncovered, basis: "estimate", sourceRef: "אומדן פנימי לפי תקציב", kind: "uncovered" });
        } else {
          uncovered = section.budget - rec;
          lines.push({ id: `${controlDate}-${section.id}-est`, sectionId: section.id, descriptionHe: `${section.nameHe} — אומדן פנימי, טרם נחתם חוזה`, qty: null, unit: null, unitPrice: null, amount: uncovered, basis: "estimate", sourceRef: "אומדן פנימי לפי תקציב", kind: "uncovered" });
        }
      }
    }
    const eac = rec + remainingCommitment + uncovered;
    return { sectionId: section.id, budget: section.budget, recorded: rec, committed, remainingCommitment, uncovered, eac, lines, coverageNoteHe };
  });
  return {
    controlDate,
    status,
    totalEac: out.reduce((a, s) => a + s.eac, 0),
    sections: out,
    openIssues,
    qualificationsHe: status === "draft" ? ["טיוטה: תחזית שגולגלה מהבקרה הקודמת; ההנחות טרם נבדקו מול המסמכים העדכניים"] : ["הנחת הצמדה: חוזי המשנה בפרויקט אינם צמודים; הסכם מסגרת הברזל מתעדכן בנספחי מחיר בכתב"],
  };
}

export const openIssuesAtAugust: HOpenIssue[] = [
  { id: "OI-1", titleHe: "שינוי מס׳ 2 בחוזה השלד — פירוט תכולה בחניון", sectionId: "02", ownerId: "ROI", dueDate: "2026-08-20", openedInControl: "2026-07-01", status: "closed", closedAt: "2026-08-18" },
  { id: "OI-2", titleHe: "חתימת חוזה אלומיניום (11-01)", sectionId: "11", ownerId: "EYAL", dueDate: "2026-08-31", openedInControl: "2026-07-01", status: "closed", closedAt: "2026-08-25" },
  { id: "OI-3", titleHe: "אישור תאגיד/עירייה לחיבור ביוב", sectionId: "07", ownerId: "EYAL", dueDate: null, openedInControl: "2026-07-01", status: "open", closedAt: null, impactIfIgnoredHe: "עיכוב בחיבור המבנה לתשתית העירונית לקראת אכלוס" },
];

export const changeLog: HChangeLogEntry[] = [
  { id: "CL-1", recordType: "contract", recordId: "02-01", field: "נספחים", before: "נספח שינוי מס׳ 1", after: "נספח שינוי מס׳ 2 (ללא שינוי בסכום)", at: "2026-08-18T11:20", byId: "ROI", noteHe: "סגירת נושא מהבקרה הקודמת" },
  { id: "CL-2", recordType: "contract", recordId: "11-01", field: "סטטוס", before: "במו״מ", after: "נחתם 25.8.2026", at: "2026-08-25T16:05", byId: "EYAL", noteHe: "חוזה אלומיניום גלעד" },
  { id: "CL-3", recordType: "po", recordId: "2240", field: "סטטוס", before: "פתוחה", after: "סגורה — סופק במלואו", at: "2026-08-28T14:40", byId: "SARIT", noteHe: "אספקה אחרונה 28.8" },
  { id: "CL-4", recordType: "po", recordId: "2291", field: "יצירה", before: "—", after: "הזמנה נוצרה: 12,000 טון × 4.80 ₪ = 57,600 ₪", at: "2026-08-22T10:12", byId: "EYAL", noteHe: "לפי הצעת פלדות הצפון 8834" },
  { id: "CL-5", recordType: "invoice", recordId: "1147", field: "קליטה", before: "—", after: "חשבון חלקי 7 נקלט · סעיף תקציבי 07 — פיתוח", at: "2026-09-02T09:41", byId: "SARIT", noteHe: "קליטת חשבון עסקה 2026-087" },
];

export function generateHadarimPackage(): HadarimPackage {
  const invoices = buildInvoices();
  const purchaseOrders = buildPurchaseOrders(invoices);
  const boq = buildBoq();
  const forecasts: HForecastVersion[] = [
    ...CONTROL_DATES.slice(0, 3).map((d) => ({ controlDate: d, status: "final" as const, totalEac: EARLIER_CONTROL_TOTALS[d], sections: null, openIssues: [], qualificationsHe: [] })),
    buildForecast("2026-08-01", invoices, purchaseOrders, "final", openIssuesAtAugust),
    buildForecast(CURRENT_CONTROL, invoices, purchaseOrders, "draft", openIssuesAtAugust),
  ];
  // the seed's documents were typed in with their facts: all of them count as processed (method "seed")
  const documents = hadarimDocuments.map((d) => {
    const facts = (documentFacts as Record<string, Record<string, unknown> | undefined>)[d.id];
    return { ...d, ...(facts ? { facts } : {}), factsSource: { method: "seed" as const } };
  });
  return { project, people, suppliers, sections, contracts, invoices, purchaseOrders, boq, forecasts, changeLog, documents, budgetChanges: [] };
}
