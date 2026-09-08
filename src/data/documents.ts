import { ils } from "../domain/money";
import type { DocumentAnchor, DocumentFacts, DocumentKind, ISODate, ISODateTime, ProjectId, SourceDocument } from "../domain/types";
import { at } from "../domain/dates";

interface DocInput {
  id: string;
  kind: DocumentKind;
  titleHe: string;
  date: ISODate;
  receivedAt?: ISODateTime;
  supplierId?: string | null;
  projectIds: ProjectId[];
  costCodeIds?: string[];
  anchors: DocumentAnchor[];
  facts?: DocumentFacts;
  annotationHe?: string;
  scenarioOnly?: boolean;
  supersedesId?: string;
  version?: number;
  bidderHe?: string;
}

export function doc(input: DocInput): SourceDocument {
  return {
    id: input.id,
    kind: input.kind,
    titleHe: input.titleHe,
    date: input.date,
    receivedAt: input.receivedAt ?? at(input.date, 8, 0),
    supplierId: input.supplierId ?? null,
    projectIds: input.projectIds,
    costCodeIds: input.costCodeIds ?? [],
    anchors: input.anchors,
    facts: input.facts ?? {},
    version: input.version ?? 1,
    annotationHe: input.annotationHe,
    scenarioOnly: input.scenarioOnly,
    supersedesId: input.supersedesId,
    bidderHe: input.bidderHe,
  };
}

const a = (id: string, text: string, labelHe?: string): DocumentAnchor => ({ id, text, labelHe });

/**
 * Baseline supplier/planning documents (Section 6.1). Their Hebrew bodies are the literal demo content.
 * Payment status, matching status, and fixture explanations are application annotations, never part of the body.
 */
export const baselineDocuments: SourceDocument[] = [
  doc({
    id: "INV-H-STEEL-001",
    kind: "invoice",
    titleHe: "חשבונית ברזל — ספק ברזל א׳",
    date: "2026-09-07",
    receivedAt: "2026-09-07T08:40:00+03:00",
    supplierId: "SUP-STEEL-A",
    projectIds: ["HAD"],
    costCodeIds: ["H10"],
    anchors: [
      a("header", "ספק ברזל א׳; פרויקט מגורי הדרים.", "כותרת"),
      a("line1", "ברזל לזיון, דגם הדגמה R500, 20 טון × 3,300 ₪ = 66,000 ₪ לפני מע״מ.", "שורה 1"),
      a("terms", "המחיר כולל הובלה לאתר; תשלום שוטף + 60; ללא התחייבות לרכישות נוספות.", "תנאים"),
    ],
    facts: {
      material: "steel",
      spec: "R500",
      quantity: 20,
      unit: "טון",
      unitPrice: ils(3300),
      amount: ils(66000),
      freightIncluded: true,
      paymentTermsHe: "שוטף + 60",
      purchaseOrderId: "PO-H-STEEL-001",
      descriptionDecisive: true,
      chargeType: "material",
    },
  }),
  doc({
    id: "DN-H-STEEL-001",
    kind: "delivery_note",
    titleHe: "תעודת משלוח ברזל — ספק ברזל א׳",
    date: "2026-09-07",
    receivedAt: "2026-09-07T08:40:00+03:00",
    supplierId: "SUP-STEEL-A",
    projectIds: ["HAD"],
    costCodeIds: ["H10"],
    anchors: [
      a("line1", "סופקו 20 טון ברזל להזמנה PO-H-STEEL-001, אתר מגורי הדרים.", "שורה 1"),
      a("receipt", "התקבל באתר; תעודת הדגמה מאושרת.", "קבלה"),
    ],
    facts: { material: "steel", deliveredQuantity: 20, unit: "טון", purchaseOrderId: "PO-H-STEEL-001" },
  }),
  doc({
    id: "PO-H-STEEL-001",
    kind: "purchase_order",
    titleHe: "הזמנת רכש ברזל — ספק ברזל א׳",
    date: "2026-09-04",
    receivedAt: "2026-09-04T09:00:00+03:00",
    supplierId: "SUP-STEEL-A",
    projectIds: ["HAD"],
    costCodeIds: ["H10"],
    anchors: [
      a("line1", "הזמנה חד-פעמית: 20 טון ברזל R500 במחיר 3,300 ₪ לטון, כולל הובלה.", "שורה 1"),
      a("scope", "הזמנה זו אינה קובעת את מחיר יתרת הברזל בפרויקט.", "תכולה"),
    ],
    facts: { material: "steel", spec: "R500", quantity: 20, unit: "טון", unitPrice: ils(3300), amount: ils(66000), freightIncluded: true, signed: true },
  }),
  doc({
    id: "INV-H-CONC-001",
    kind: "invoice",
    titleHe: "חשבונית בטון — יציקת תקרה A",
    date: "2026-08-28",
    receivedAt: "2026-08-28T10:00:00+03:00",
    supplierId: "SUP-CONCRETE",
    projectIds: ["HAD"],
    costCodeIds: ["H20"],
    anchors: [a("line1", "יציקת תקרה A: 100 מ״ק בטון C30 × 400 ₪ = 40,000 ₪.", "שורה 1")],
    facts: { material: "concrete", spec: "C30", quantity: 100, unit: "מ״ק", unitPrice: ils(400), amount: ils(40000), contractId: "CT-H-CONC", chargeType: "material", descriptionDecisive: true },
  }),
  doc({
    id: "PLAN-SLAB-A",
    kind: "plan",
    titleHe: "תכנון יציקת תקרה A",
    date: "2026-08-20",
    projectIds: ["HAD"],
    costCodeIds: ["H20"],
    anchors: [
      a("quantity", "כמות מתוכננת ליציקת תקרה A: 100 מ״ק.", "כמות"),
      a("status", "אין במסמך זה אישור לשינוי הכמות.", "סטטוס"),
    ],
    facts: { material: "concrete", plannedQuantity: 100, unit: "מ״ק", taskHe: "תקרה A" },
  }),
  doc({
    id: "CT-H-CONC",
    kind: "contract",
    titleHe: "הסכם אספקת בטון — ספק בטון דמו",
    date: "2026-03-01",
    supplierId: "SUP-CONCRETE",
    projectIds: ["HAD"],
    costCodeIds: ["H20"],
    anchors: [
      a("price", "מחיר הדגמה לבטון C30: 400 ₪ למ״ק.", "מחיר"),
      a("freight", "המחיר כולל הובלה לאתר מגורי הדרים; אין לחייב הובלה בנפרד ללא תוספת הסכם מאושרת.", "הובלה"),
      a("scope", "שאיבה ושירותים מיוחדים ייבדקו בנפרד; אינם כלולים בהשוואת מחיר הבטון בדמו.", "תכולה"),
    ],
    facts: { material: "concrete", spec: "C30", unitPrice: ils(400), freightIncluded: true, pumpingIncluded: false },
  }),
  doc({
    id: "CT-H-FRAME",
    kind: "contract",
    titleHe: "חוזה עבודות שלד — קבלן שלד דמו",
    date: "2026-03-01",
    supplierId: "SUP-FRAME",
    projectIds: ["HAD"],
    costCodeIds: ["H30"],
    anchors: [
      a("value", "עבודות שלד לפי תכולה מוסכמת, סך חוזה 1,000,000 ₪.", "סכום"),
      a("scope", "עבודה והרכבה בלבד; ברזל ובטון מסופקים בנפרד על ידי החברה ואינם כלולים במחיר החוזה.", "תכולה"),
      a("billing", "חשבונות הקבלן מוצגים במצטבר. סכום החשבון לתקופה הוא הסכום המצטבר המאושר בניכוי המצטבר שאושר קודם.", "חיוב"),
    ],
    facts: { material: "frame", contractValue: ils(1000000), signed: true },
  }),
  doc({
    id: "INV-H-FRAME-001",
    kind: "certificate",
    titleHe: "חשבון עבודות שלד — קבלן שלד דמו",
    date: "2026-08-25",
    receivedAt: "2026-08-25T10:00:00+03:00",
    supplierId: "SUP-FRAME",
    projectIds: ["HAD"],
    costCodeIds: ["H30"],
    anchors: [a("line1", "חשבון עבודות שלד מאושר בסך 200,000 ₪.", "שורה 1")],
    facts: { material: "frame", amount: ils(200000), cumulativeApproved: ils(200000), priorCumulative: 0, contractId: "CT-H-FRAME" },
  }),
  doc({
    id: "EQ-FRAMEWORK-01",
    kind: "framework",
    titleHe: "מסגרת השכרת ציוד — ספק ציוד דמו",
    date: "2026-08-01",
    supplierId: "SUP-EQUIPMENT",
    projectIds: ["HAD", "PAR"],
    costCodeIds: ["H40", "P40"],
    anchors: [
      a("scope", "מסגרת השכרת ציוד לאתרים מגורי הדרים ומתחם הפארק.", "תכולה"),
      a("billing", "חשבונית חודשית משותפת; שיוך העלות לכל אתר מחייב פירוט שימוש או אישור תפעול.", "חיוב"),
      a("validity", "בתוקף עד 31/12/2026.", "תוקף"),
    ],
    facts: { material: "equipment", frameworkProjectIds: ["HAD", "PAR"], validUntil: "2026-12-31", chargeType: "rental" },
  }),
  doc({
    id: "INV-EQ-001",
    kind: "invoice",
    titleHe: "חשבונית ציוד אוגוסט — ספק ציוד דמו",
    date: "2026-08-31",
    receivedAt: "2026-08-31T08:30:00+03:00",
    supplierId: "SUP-EQUIPMENT",
    projectIds: ["HAD", "PAR"],
    costCodeIds: ["H40", "P40"],
    anchors: [
      a("line1", "השכרת ציוד לחודש אוגוסט במסגרת EQ-FRAMEWORK-01, סה״כ 60,000 ₪.", "שורה 1"),
      a("allocation", "החשבונית אינה כוללת פירוט עלות לפי אתר.", "שיוך"),
    ],
    facts: { material: "equipment", amount: ils(60000), contractId: "EQ-FRAMEWORK-01", allocationDetail: false, chargeType: "rental" },
  }),
  doc({
    id: "CT-H-WATER",
    kind: "contract",
    titleHe: "חוזה עבודות איטום — קבלן איטום דמו",
    date: "2026-03-01",
    supplierId: "SUP-WATER",
    projectIds: ["HAD"],
    costCodeIds: ["H50"],
    anchors: [
      a("value", "עבודות איטום בתכולה מוסכמת, סך חוזה 350,000 ₪.", "סכום"),
      a("scope", "עבודה נוספת מחייבת הוראת שינוי; חשבונות ואישורי ביצוע יקושרו לחוזה.", "תכולה"),
    ],
    facts: { material: "waterproofing", contractValue: ils(350000), signed: true },
  }),
  doc({
    id: "INV-H-WATER-001",
    kind: "invoice",
    titleHe: "חשבונית איטום — קבלן איטום דמו",
    date: "2026-08-25",
    receivedAt: "2026-08-25T11:00:00+03:00",
    supplierId: "SUP-WATER",
    projectIds: ["HAD"],
    costCodeIds: ["H50"],
    anchors: [a("line1", "עבודות איטום בתכולת החוזה, 100,000 ₪.", "שורה 1")],
    facts: { material: "waterproofing", amount: ils(100000), contractId: "CT-H-WATER" },
  }),
  doc({
    id: "PLAN-H-SITE",
    kind: "plan",
    titleHe: "תכנון תקורות אתר — מגורי הדרים",
    date: "2026-03-01",
    projectIds: ["HAD"],
    costCodeIds: ["H70"],
    anchors: [
      a("duration", "תקופת האתר המתוכננת 01/03/2026–28/02/2027, 12 חודשים.", "משך"),
      a(
        "monthly",
        "עלות חודשית תלויה במשך: צוות אתר 20,000 ₪, שכירות משרדי ומתקני אתר 15,000 ₪, אבטחה 10,000 ₪, שירותים 5,000 ₪; סה״כ 50,000 ₪.",
        "עלות חודשית",
      ),
    ],
    facts: {
      months: 12,
      siteStart: "2026-03-01",
      siteFinish: "2027-02-28",
      monthlyComponents: [
        { id: "team", nameHe: "צוות אתר", amount: ils(20000) },
        { id: "rent", nameHe: "שכירות משרדי ומתקני אתר", amount: ils(15000) },
        { id: "security", nameHe: "אבטחה", amount: ils(10000) },
        { id: "services", nameHe: "שירותים", amount: ils(5000) },
      ],
    },
    annotationHe: "ששת החודשים שהוכרו עד כה מקורם ביתרת הפתיחה OPEN-H70, לא במסמך התכנון המקורי.",
  }),
  doc({
    id: "INV-P-STEEL-001",
    kind: "invoice",
    titleHe: "חשבונית ברזל — ספק ברזל ב׳ (מתחם הפארק)",
    date: "2026-09-02",
    receivedAt: "2026-09-02T10:00:00+03:00",
    supplierId: "SUP-STEEL-B",
    projectIds: ["PAR"],
    costCodeIds: ["P10"],
    anchors: [
      a("line1", "ספק ברזל ב׳; מתחם הפארק; 20 טון ברזל R500 × 2,900 ₪ = 58,000 ₪.", "שורה 1"),
      a("terms", "המחיר כולל הובלה לרעננה; שוטף + 60; ההזמנה המסוימת נפרעה.", "תנאים"),
      a("limitation", "המחיר מתייחס להזמנה זו; זמינות ומחיר להזמנה עתידית דורשים הצעה חדשה.", "הגבלה"),
    ],
    facts: { material: "steel", spec: "R500", quantity: 20, unit: "טון", unitPrice: ils(2900), amount: ils(58000), freightIncluded: true, paymentTermsHe: "שוטף + 60", destinationHe: "רעננה", descriptionDecisive: true },
  }),
  doc({
    id: "BUD-NOF-DRAFT-V1",
    kind: "budget",
    titleHe: "טיוטת תקציב — נוף הגבעה (גרסה 1)",
    date: "2026-09-07",
    receivedAt: "2026-09-07T08:00:00+03:00",
    projectIds: ["NOF"],
    costCodeIds: ["N20", "N60"],
    anchors: [
      a("concrete", "תקציב טיוטה לבטון C30: 1,000 מ״ק × 300 ₪ = 300,000 ₪.", "בטון"),
      a("other", "יתר העבודות 4,700,000 ₪.", "יתר העבודות"),
      a("status", "טיוטה שטרם אושרה.", "סטטוס"),
    ],
    facts: { material: "concrete", spec: "C30", quantity: 1000, unit: "מ״ק", unitPrice: ils(300), amount: ils(300000) },
  }),
  doc({
    id: "QUOTE-NOF-A",
    kind: "quote",
    titleHe: "הצעת מחיר בטון — מציע א׳",
    date: "2026-09-03",
    receivedAt: "2026-09-03T09:00:00+03:00",
    projectIds: ["NOF"],
    costCodeIds: ["N20"],
    bidderHe: "מציע א׳ (פיקטיבי)",
    anchors: [
      a("price", "הצעת הדגמה לבטון C30, 1,000 מ״ק, 380 ₪ למ״ק כולל הובלה לכפר סבא, ללא שאיבה, שוטף + 60.", "מחיר"),
      a("valid", "בתוקף עד 30/09/2026.", "תוקף"),
    ],
    facts: { material: "concrete", spec: "C30", quantity: 1000, unit: "מ״ק", unitPrice: ils(380), freightIncluded: true, pumpingIncluded: false, paymentTermsHe: "שוטף + 60", validUntil: "2026-09-30", comparable: true, destinationHe: "כפר סבא" },
  }),
  doc({
    id: "QUOTE-NOF-B",
    kind: "quote",
    titleHe: "הצעת מחיר בטון — מציע ב׳",
    date: "2026-09-04",
    receivedAt: "2026-09-04T09:00:00+03:00",
    projectIds: ["NOF"],
    costCodeIds: ["N20"],
    bidderHe: "מציע ב׳ (פיקטיבי)",
    anchors: [
      a("price", "הצעת הדגמה לבטון C30, 1,000 מ״ק, 390 ₪ למ״ק כולל הובלה לכפר סבא, ללא שאיבה, שוטף + 60.", "מחיר"),
      a("valid", "בתוקף עד 30/09/2026.", "תוקף"),
    ],
    facts: { material: "concrete", spec: "C30", quantity: 1000, unit: "מ״ק", unitPrice: ils(390), freightIncluded: true, pumpingIncluded: false, paymentTermsHe: "שוטף + 60", validUntil: "2026-09-30", comparable: true, destinationHe: "כפר סבא" },
  }),
  doc({
    id: "QUOTE-NOF-C",
    kind: "quote",
    titleHe: "הצעת מחיר בטון — מציע ג׳",
    date: "2026-09-05",
    receivedAt: "2026-09-05T09:00:00+03:00",
    projectIds: ["NOF"],
    costCodeIds: ["N20"],
    bidderHe: "מציע ג׳ (פיקטיבי)",
    anchors: [
      a("price", "הצעת הדגמה לבטון C30, 1,000 מ״ק, 400 ₪ למ״ק כולל הובלה לכפר סבא, ללא שאיבה, שוטף + 60.", "מחיר"),
      a("valid", "בתוקף עד 30/09/2026.", "תוקף"),
    ],
    facts: { material: "concrete", spec: "C30", quantity: 1000, unit: "מ״ק", unitPrice: ils(400), freightIncluded: true, pumpingIncluded: false, paymentTermsHe: "שוטף + 60", validUntil: "2026-09-30", comparable: true, destinationHe: "כפר סבא" },
  }),
  doc({
    id: "QUOTE-NOF-X",
    kind: "quote",
    titleHe: "הצעת מחיר בטון — מציע ד׳ (מפרט שונה)",
    date: "2026-09-03",
    receivedAt: "2026-09-03T09:00:00+03:00",
    projectIds: ["NOF"],
    costCodeIds: ["N20"],
    bidderHe: "מציע ד׳ (פיקטיבי)",
    anchors: [
      a("price", "הצעת הדגמה לבטון C20, 310 ₪ למ״ק, איסוף עצמי ותשלום מראש.", "מחיר"),
      a("exclusion", "הצעה זו אינה מקבילה למפרט ולתנאים של תקציב C30.", "הסתייגות"),
    ],
    facts: { material: "concrete", spec: "C20", unitPrice: ils(310), freightIncluded: false, paymentTermsHe: "תשלום מראש", comparable: false, incomparableReasonHe: "מפרט C20 במקום C30, איסוף עצמי ותשלום מראש" },
  }),
];

/**
 * Documents introduced by scenarios (Section 6.2). They are created at the moment a scenario event
 * introduces them, stamped with that clock, and are never part of the clean baseline.
 */
export type ScenarioDocumentId =
  | "ADD-H-FRAME-100"
  | "CERT-H-FRAME-PREV"
  | "CERT-H-FRAME-CURRENT"
  | "CERT-H-WATER-080"
  | "INV-H-WATER-080"
  | "DN-H-SLAB-120"
  | "INV-H-SLAB-120"
  | "INV-H-FREIGHT-002"
  | "CREDIT-H-FREIGHT-002"
  | "ADD-H-FREIGHT-VALID"
  | "CO-H-WATER-080"
  | "SCHEDULE-H-14"
  | "INV-EQ-002"
  | "QUOTE-H-STEEL-3100"
  | "PO-H-STEEL-LOCKED-200"
  | "CT-NOF-CONC-300"
  | "DN-H-STEEL-018";

export function makeScenarioDocument(id: ScenarioDocumentId, receivedAt: ISODateTime): SourceDocument {
  const date = receivedAt.slice(0, 10);
  const base = { receivedAt, scenarioOnly: true as const };
  switch (id) {
    case "ADD-H-FRAME-100":
      return doc({
        ...base,
        id,
        kind: "addendum",
        titleHe: "תוספת חתומה לחוזה השלד",
        date,
        supplierId: "SUP-FRAME",
        projectIds: ["HAD"],
        costCodeIds: ["H30"],
        anchors: [a("text", "תוספת מוסכמת לחוזה השלד: 100,000 ₪ עבור תכולה נוספת. סכום החוזה המעודכן 1,100,000 ₪. התוספת טרם חויבה בחשבונית.", "תוספת")],
        facts: { material: "frame", amount: ils(100000), contractId: "CT-H-FRAME", contractValue: ils(1100000), isAdditionalScope: true, signed: true },
      });
    case "CERT-H-FRAME-PREV":
      return doc({
        id,
        kind: "certificate",
        titleHe: "חשבון קודם — קבלן שלד דמו",
        date: "2026-08-25",
        receivedAt: "2026-08-25T10:00:00+03:00",
        scenarioOnly: true,
        supplierId: "SUP-FRAME",
        projectIds: ["HAD"],
        costCodeIds: ["H30"],
        anchors: [a("text", "חשבון קודם: מצטבר מאושר 220,000 ₪. הסכום הוכר ושולם במלואו.", "חשבון קודם")],
        facts: { material: "frame", amount: ils(220000), cumulativeApproved: ils(220000), priorCumulative: 0, contractId: "CT-H-FRAME" },
      });
    case "CERT-H-FRAME-CURRENT":
      return doc({
        ...base,
        id,
        kind: "certificate",
        titleHe: "חשבון נוכחי — קבלן שלד דמו",
        date,
        supplierId: "SUP-FRAME",
        projectIds: ["HAD"],
        costCodeIds: ["H30"],
        anchors: [a("text", "חשבון נוכחי: מצטבר מאושר 300,000 ₪. מצטבר קודם 220,000 ₪. לתשלום בגין התקופה: 80,000 ₪.", "חשבון נוכחי")],
        facts: { material: "frame", cumulativeApproved: ils(300000), priorCumulative: ils(220000), periodAmount: ils(80000), contractId: "CT-H-FRAME" },
      });
    case "CERT-H-WATER-080":
      return doc({
        ...base,
        id,
        kind: "approval",
        titleHe: "אישור ביצוע עבודות איטום — 80,000 ₪",
        date,
        supplierId: "SUP-WATER",
        projectIds: ["HAD"],
        costCodeIds: ["H50"],
        anchors: [a("text", "אישור ביצוע: בוצעו ואושרו עבודות איטום נוספות בסך 80,000 ₪ מתוך תכולת חוזה CT-H-WATER. טרם הוצאה חשבונית. אין זו תוספת לחוזה.", "אישור ביצוע")],
        facts: { material: "waterproofing", amount: ils(80000), contractId: "CT-H-WATER", approved: true, isAdditionalScope: false },
      });
    case "INV-H-WATER-080":
      return doc({
        ...base,
        id,
        kind: "invoice",
        titleHe: "חשבונית איטום — 80,000 ₪ (בגין אישור הביצוע)",
        date,
        supplierId: "SUP-WATER",
        projectIds: ["HAD"],
        costCodeIds: ["H50"],
        anchors: [a("text", "חשבונית 80,000 ₪ בגין אותן עבודות שאושרו ב-CERT-H-WATER-080; יש לקזז את הרישום הזמני של עבודה שבוצעה וטרם חויבה.", "חשבונית")],
        facts: { material: "waterproofing", amount: ils(80000), contractId: "CT-H-WATER", matchesCertificateId: "CERT-H-WATER-080" },
      });
    case "DN-H-SLAB-120":
      return doc({
        ...base,
        id,
        kind: "delivery_note",
        titleHe: "תעודת משלוח בטון — יציקת תקרה A (120 מ״ק)",
        date,
        supplierId: "SUP-CONCRETE",
        projectIds: ["HAD"],
        costCodeIds: ["H20"],
        anchors: [a("text", "סופקו ליציקת תקרה A סך 120 מ״ק. במועד התעודה אין מסמך החזרה או הוראת שינוי מצורפת.", "תעודת משלוח")],
        facts: { material: "concrete", deliveredQuantity: 120, unit: "מ״ק" },
      });
    case "INV-H-SLAB-120":
      return doc({
        ...base,
        id,
        kind: "invoice",
        titleHe: "חשבונית בטון — יציקת תקרה A (120 מ״ק)",
        date,
        supplierId: "SUP-CONCRETE",
        projectIds: ["HAD"],
        costCodeIds: ["H20"],
        anchors: [a("line1", "חשבונית לאספקת בטון, יציקת תקרה A: 120 מ״ק × 400 ₪ = 48,000 ₪.", "שורה 1")],
        facts: { material: "concrete", spec: "C30", quantity: 120, unit: "מ״ק", unitPrice: ils(400), amount: ils(48000), contractId: "CT-H-CONC", descriptionDecisive: true },
      });
    case "INV-H-FREIGHT-002":
      return doc({
        ...base,
        id,
        kind: "invoice",
        titleHe: "חיוב הובלת בטון — ספק בטון דמו",
        date,
        supplierId: "SUP-CONCRETE",
        projectIds: ["HAD"],
        costCodeIds: ["H20"],
        anchors: [a("line1", "חיוב נוסף בגין הובלת בטון לאתר מגורי הדרים: 2,000 ₪. מופנה לאספקה לפי CT-H-CONC.", "שורה 1")],
        facts: { material: "concrete", amount: ils(2000), chargeType: "freight", contractId: "CT-H-CONC" },
      });
    case "CREDIT-H-FREIGHT-002":
      return doc({
        ...base,
        id,
        kind: "credit",
        titleHe: "זיכוי הובלה — ספק בטון דמו",
        date,
        supplierId: "SUP-CONCRETE",
        projectIds: ["HAD"],
        costCodeIds: ["H20"],
        anchors: [a("text", "זיכוי מאושר בסך 2,000 ₪ כנגד INV-H-FREIGHT-002; סיבה: ההובלה כלולה במחיר לפי החוזה.", "זיכוי")],
        facts: { amount: ils(2000), creditOfDocumentId: "INV-H-FREIGHT-002", approved: true },
      });
    case "ADD-H-FREIGHT-VALID":
      return doc({
        ...base,
        id,
        kind: "addendum",
        titleHe: "תוספת מאושרת לאספקה מיוחדת",
        date,
        supplierId: "SUP-CONCRETE",
        projectIds: ["HAD"],
        costCodeIds: ["H20"],
        anchors: [a("text", "תוספת מאושרת חלופית לתרחיש: אספקה מיוחדת מחוץ לתנאי ההסכם תחויב ב-2,000 ₪ נוספים. יש לבדוק התאמה לאספקה המסוימת.", "תוספת")],
        facts: { amount: ils(2000), chargeType: "freight", contractId: "CT-H-CONC", approved: true },
      });
    case "CO-H-WATER-080":
      return doc({
        ...base,
        id,
        kind: "change_order",
        titleHe: "הוראת שינוי — תוספת איטום 80,000 ₪",
        date,
        supplierId: "SUP-WATER",
        projectIds: ["HAD"],
        costCodeIds: ["H50"],
        anchors: [
          a(
            "text",
            "הוראת שינוי שנחתמה על ידי החברה וקבלן האיטום: תוספת איטום שאינה בתכולת החוזה המקורי או בתחזית העבודה הנוספת הקיימת, בעלות מוסכמת 80,000 ₪. העבודה טרם בוצעה. דרישת החזר מלקוח הקצה בסך 80,000 ₪ הוגשה אך טרם אושרה.",
            "הוראת שינוי",
          ),
        ],
        facts: { material: "waterproofing", amount: ils(80000), contractId: "CT-H-WATER", isAdditionalScope: true, signed: true, recoveryClaim: ils(80000) },
      });
    case "SCHEDULE-H-14":
      return doc({
        ...base,
        id,
        kind: "schedule",
        titleHe: "עדכון לוח זמנים — 14 חודשים",
        date,
        projectIds: ["HAD"],
        costCodeIds: ["H70"],
        anchors: [a("text", "עדכון מאושר לאחר בירור: משך האתר הכולל מתארך מ-12 ל-14 חודשים; סיום חדש 30/04/2027. צוות האתר, השכירות, האבטחה והשירותים נדרשים לשני החודשים הנוספים.", "עדכון")],
        facts: { months: 14, siteFinish: "2027-04-30", approved: true },
      });
    case "INV-EQ-002":
      return doc({
        id,
        kind: "invoice",
        titleHe: "חשבונית ציוד ספטמבר — ספק ציוד דמו",
        date: "2026-09-30",
        receivedAt,
        scenarioOnly: true,
        supplierId: "SUP-EQUIPMENT",
        projectIds: ["HAD", "PAR"],
        costCodeIds: ["H40", "P40"],
        anchors: [a("line1", "חשבונית ספטמבר: EQ-FRAMEWORK-01, אותה תכולת ציוד ואותם שני אתרים, סה״כ 60,000 ₪. טרם שולמה.", "שורה 1")],
        facts: { material: "equipment", amount: ils(60000), contractId: "EQ-FRAMEWORK-01", allocationDetail: false, chargeType: "rental" },
      });
    case "QUOTE-H-STEEL-3100":
      return doc({
        ...base,
        id,
        kind: "quote",
        titleHe: "הצעת מחיר חדשה לברזל — ספק ברזל ב׳",
        date,
        supplierId: "SUP-STEEL-B",
        projectIds: ["HAD"],
        costCodeIds: ["H10"],
        anchors: [a("text", "הצעת הדגמה חדשה: 480 טון ברזל R500 למגורי הדרים, 3,100 ₪ לטון כולל הובלה, שוטף + 60, זמינות לפי תוכנית האספקה, בתוקף עד 30/09/2026. זו הצעה בלבד; טרם הוצאה הזמנה.", "הצעה")],
        facts: { material: "steel", spec: "R500", quantity: 480, unit: "טון", unitPrice: ils(3100), freightIncluded: true, paymentTermsHe: "שוטף + 60", validUntil: "2026-09-30", comparable: true, signed: false },
      });
    case "PO-H-STEEL-LOCKED-200":
      return doc({
        ...base,
        id,
        kind: "purchase_order",
        titleHe: "הזמנה חתומה — 200 טון ברזל במחיר קבוע",
        date,
        supplierId: "SUP-STEEL-A",
        projectIds: ["HAD"],
        costCodeIds: ["H10"],
        anchors: [a("text", "הזמנה חתומה לאספקה עתידית: 200 טון ברזל R500 למגורי הדרים במחיר קבוע של 3,000 ₪ לטון, כולל הובלה; סה״כ 600,000 ₪. הכמות טרם סופקה וטרם חויבה.", "הזמנה")],
        facts: { material: "steel", spec: "R500", quantity: 200, unit: "טון", unitPrice: ils(3000), amount: ils(600000), freightIncluded: true, signed: true },
      });
    case "CT-NOF-CONC-300":
      return doc({
        ...base,
        id,
        kind: "contract",
        titleHe: "הסכם בטון תקף — נוף הגבעה (300 ₪ למ״ק)",
        date,
        projectIds: ["NOF"],
        costCodeIds: ["N20"],
        anchors: [a("text", "הסכם הדגמה תקף: 1,000 מ״ק בטון C30 במחיר 300 ₪ למ״ק, כולל הובלה לכפר סבא וללא שאיבה, שוטף + 60, לתכולת טיוטת נוף הגבעה.", "הסכם")],
        facts: { material: "concrete", spec: "C30", quantity: 1000, unit: "מ״ק", unitPrice: ils(300), freightIncluded: true, pumpingIncluded: false, paymentTermsHe: "שוטף + 60", signed: true, comparable: true, destinationHe: "כפר סבא" },
      });
    case "DN-H-STEEL-018":
      return doc({
        ...base,
        id,
        kind: "delivery_note",
        titleHe: "תעודת משלוח ברזל — 18 מתוך 20 טון",
        date,
        supplierId: "SUP-STEEL-A",
        projectIds: ["HAD"],
        costCodeIds: ["H10"],
        anchors: [a("text", "התקבלו באתר 18 מתוך 20 הטון שבהזמנה PO-H-STEEL-001. יתרת האספקה טרם אושרה בתעודה זו.", "תעודת משלוח")],
        facts: { material: "steel", deliveredQuantity: 18, unit: "טון", purchaseOrderId: "PO-H-STEEL-001" },
        supersedesId: "DN-H-STEEL-001",
      });
  }
}
