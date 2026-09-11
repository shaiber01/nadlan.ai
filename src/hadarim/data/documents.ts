import type { HDocument, HDocumentBlock } from "./types";

export const DEMO_FOOTER_HE = "מסמך הדגמה — נתונים בדויים";

function build(id: string, kind: HDocument["kind"], titleHe: string, date: string, supplierId: string | null, fileName: string, blocks: (HDocumentBlock & { anchor?: string })[]): HDocument {
  const anchors: Record<string, number> = {};
  blocks.forEach((b, i) => {
    if (b.anchor) anchors[b.anchor] = i;
  });
  return { id, kind, titleHe, date, supplierId, fileName, blocks: blocks.map(({ anchor: _a, ...rest }) => rest), footerHe: DEMO_FOOTER_HE, anchors };
}

/** Structured facts a check can read without parsing text (the "extracted" reading of each document). */
export const documentFacts = {
  quote_pladot_12t: { qtyKg: 12000, qtyTon: 12, pricePerTon: 4800, amount: 57600, supplierId: "SUP-PLADOT" },
  appendix_A2_steel_price_2026_07_15: { pricePerTon: 4800, validFrom: "2026-07-15", contractId: "03-F" },
  appendix_A_steel_price_2025_11: { pricePerTon: 4000, validFrom: "2025-11-01", contractId: "03-F" },
  quote_ycohen_drainage: { qty: 80, unit: "מ׳", unitPrice: 1500, amount: 120000, validUntil: "2026-09-19", supplierId: "SUP-YCOHEN", boqLineId: "57.03.040" },
  contract_07_01_excerpt: { contractId: "07-01", exclusionClause: "3.4" },
  inv_1147_ntb_partial7: { invoiceId: 1147, cumulativePrev: 2100000, amountThis: 180000, cumulativeNow: 2280000 },
  boq_v4_ch57: { boqLineId: "57.03.040" },
} as const;

export const hadarimDocuments: HDocument[] = [
  build("inv_1147_ntb_partial7", "invoice", "חשבון חלקי מס׳ 7 — נ.ת.ב. תשתיות ופיתוח בע״מ", "2026-08-31", "SUP-NTB", "inv_1147_ntb_partial7.pdf", [
    { kind: "heading", text: "נ.ת.ב. תשתיות ופיתוח בע״מ · ח.פ. 51-555555-5 · חשבון עסקה מס׳ 2026-087", anchor: "header" },
    { kind: "paragraph", text: "לכבוד: אופק ביצוע בע״מ · פרויקט: הדרים, כפר סבא · חוזה: 07-01 · תאריך: 31.8.2026 · תקופה: אוגוסט 2026" },
    { kind: "heading", text: "חשבון חלקי מס׳ 7 — עבודות עפר וקווי ניקוז, פיתוח חוץ שלב א׳", anchor: "description" },
    {
      kind: "table",
      anchor: "cumulative",
      rows: [
        ["פירוט", "מצטבר קודם", "חשבון זה", "מצטבר נוכחי"],
        ["עבודות עפר לפיתוח — 1,150 מ״ק × 60 ₪", "540,000", "69,000", "609,000"],
        ["קירות תומכים — 210 מ״ק × 1,200 ₪", "780,000", "48,000", "828,000"],
        ["תשתיות ראשיות בתחום המגרש", "560,000", "38,000", "598,000"],
        ["קווי ניקוז פנימיים בתחום המגרש — 60 מ׳ × 350 ₪", "220,000", "25,000", "245,000"],
        ["סה״כ לפני מע״מ", "2,100,000", "180,000", "2,280,000"],
      ],
    },
    { kind: "table", anchor: "retention", rows: [["עכבון 5%", "9,000"], ["לתשלום (לפני מע״מ)", "171,000"], ["תנאי תשלום", "שוטף + 60"]] },
    { kind: "signature", text: "אישור מנהל הפרויקט: אייל · 2.9.2026 · הערה: הוזן ע״י שרית, סעיף תקציבי 07 — פיתוח", anchor: "approval" },
    { kind: "stamp", text: "התקבל 31.8.2026 · הנהלת חשבונות אופק ביצוע" },
  ]),
  build("quote_pladot_12t", "quote", "הצעת מחיר / אישור הזמנה — פלדות הצפון בע״מ", "2026-08-20", "SUP-PLADOT", "quote_pladot_12t.pdf", [
    { kind: "heading", text: "פלדות הצפון בע״מ · הצעת מחיר מס׳ 8834 · 20.8.2026" },
    { kind: "paragraph", text: "לכבוד: אופק ביצוע בע״מ · אתר: הדרים, כפר סבא · במסגרת הסכם המסגרת ⁨03-F⁩ ונספח המחיר א׳-2" },
    { kind: "highlight", text: "ברזל זיון מצולע, קטרים 8–16 מ״מ — 12,000 ק״ג (12 טון) × 4,800 ₪/טון = 57,600 ₪ לפני מע״מ", anchor: "line" },
    { kind: "paragraph", text: "אספקה לאתר תוך 5 ימי עבודה מאישור ההזמנה · הובלה כלולה · תשלום שוטף + 60 · תוקף ההצעה 14 יום" },
    { kind: "signature", text: "מחלקת מכירות, פלדות הצפון · אושר להזמנה: אייל, 22.8.2026 · הזמנת רכש 2291" },
  ]),
  build("appendix_A2_steel_price_2026_07_15", "appendix", "נספח א׳-2 להסכם מסגרת ⁨03-F⁩ — מחירון ברזל זיון", "2026-07-15", "SUP-PLADOT", "appendix_A2_steel_price_2026-07-15.pdf", [
    { kind: "heading", text: "נספח א׳-2 להסכם מסגרת ⁨03-F⁩ מיום 1.11.2025 — עדכון מחירים" },
    { kind: "paragraph", text: "בין: פלדות הצפון בע״מ (הספק) לבין: אופק ביצוע בע״מ (המזמין) · פרויקט הדרים" },
    { kind: "highlight", text: "מחיר בסיס לברזל זיון מצולע: 4,800 ₪ לטון לפני מע״מ · בתוקף מיום 15.7.2026 · מחליף את נספח א׳ (4,000 ₪ לטון)", anchor: "price" },
    {
      kind: "table",
      anchor: "table",
      rows: [
        ["קוטר", "מחיר לטון (₪)"],
        ["8 מ״מ", "4,900"],
        ["10 מ״מ", "4,850"],
        ["12 מ״מ", "4,800"],
        ["14 מ״מ", "4,780"],
        ["16 מ״מ", "4,760"],
        ["20 מ״מ ומעלה", "4,740"],
      ],
    },
    { kind: "paragraph", text: "הצמדה: המחירים יעודכנו אחת לרבעון לפי מדד תשומות הבנייה, בסיס יולי 2026 · הובלה לאתר כלולה · תוקף: עד הודעה חדשה בכתב" },
    { kind: "signature", text: "חתימות: הספק — פלדות הצפון · המזמין — אופק ביצוע (רועי, סמנכ״ל ביצוע) · 15.7.2026" },
  ]),
  build("appendix_A_steel_price_2025_11", "appendix", "נספח א׳ להסכם מסגרת ⁨03-F⁩ — מחירון ברזל זיון (מקורי)", "2025-11-01", "SUP-PLADOT", "appendix_A_steel_price_2025-11.pdf", [
    { kind: "heading", text: "נספח א׳ להסכם מסגרת ⁨03-F⁩ — מחירון" },
    { kind: "highlight", text: "מחיר בסיס לברזל זיון מצולע: 4,000 ₪ לטון לפני מע״מ · בתוקף מיום 1.11.2025", anchor: "price" },
    { kind: "paragraph", text: "הובלה לאתר כלולה · תשלום שוטף + 60 · עדכון מחירים בהודעה בכתב ובנספח חתום" },
    { kind: "signature", text: "חתימות: הספק — פלדות הצפון · המזמין — אופק ביצוע · 1.11.2025" },
  ]),
  build("contract_07_01_excerpt", "contract_excerpt", "חוזה קבלנות משנה 07-01 — נ.ת.ב. תשתיות ופיתוח — עמ׳ 3–4, סעיף 3 היקף העבודות", "2026-01-05", "SUP-NTB", "contract_07-01_excerpt.pdf", [
    { kind: "heading", text: "חוזה קבלנות משנה מס׳ 07-01 · עבודות פיתוח ותשתיות חוץ · פרויקט הדרים · סכום החוזה 3,200,000 ₪ לפני מע״מ" },
    { kind: "heading", text: "סעיף 3 — היקף העבודות" },
    { kind: "paragraph", text: "3.3 העבודות הכלולות: עבודות עפר לפיתוח; קירות תומכים; תשתיות ראשיות בתחום המגרש (מים, חשמל, תקשורת); ריצוף ואבן בשטחים החיצוניים; גינון והשקיה בהיקף המפרט; קווי ניקוז פנימיים בתחום המגרש.", anchor: "included" },
    { kind: "highlight", text: "3.4 העבודות שאינן כלולות: לא כולל אגרות חיבור לתאגיד המים; לא כולל עבודות סלילה ברשות הרבים.", anchor: "exclusion" },
    { kind: "paragraph", text: "3.5 כל עבודה שאינה מפורטת בסעיף 3.3 תבוצע רק לפי הוראת שינוי חתומה." },
    { kind: "signature", text: "חתימות: הקבלן — נ.ת.ב. תשתיות ופיתוח · המזמין — אופק ביצוע · 5.1.2026" },
  ]),
  build("quote_ycohen_drainage", "quote", "הצעת מחיר — י. כהן תשתיות — קו ניקוז חוץ Ø400", "2026-08-20", "SUP-YCOHEN", "quote_ycohen_drainage.pdf", [
    { kind: "heading", text: "י. כהן תשתיות בע״מ · הצעת מחיר מס׳ 2026-311 · 20.8.2026" },
    { kind: "paragraph", text: "לכבוד: אופק ביצוע בע״מ · פרויקט הדרים, כפר סבא · הנדון: קו ניקוז ראשי עד נקודת החיבור העירונית" },
    { kind: "highlight", text: "צינור ניקוז PVC קשיח SN8 קוטר 400 מ״מ, כולל חפירה, מצע ומילוי חוזר, עומק עד 2.5 מ׳ — 80 מ׳ × 1,500 ₪/מ׳ = 120,000 ₪ לפני מע״מ", anchor: "line" },
    { kind: "paragraph", text: "לא כולל אגרת חיבור לתאגיד המים · לא כולל שוחות בקרה מעבר ל-4 יח׳ · משך ביצוע 10 ימי עבודה" },
    { kind: "paragraph", text: "תוקף ההצעה: 30 יום (עד 19.9.2026) · תשלום שוטף + 45", anchor: "validity" },
    { kind: "signature", text: "י. כהן, מנהל · חתימה וחותמת" },
  ]),
  build("boq_v4_ch57", "boq_page", "כתב כמויות גרסה 4 (12.8.2026) — פרק 57: קווי מים, ביוב וניקוז", "2026-08-12", null, "boq_v4_ch57.pdf", [
    { kind: "heading", text: "כתב כמויות לביצוע — הדרים · גרסה 4 · 12.8.2026 · פרק 57 — קווי מים, ביוב וניקוז" },
    {
      kind: "table",
      anchor: "line",
      rows: [
        ["סעיף", "תיאור", "יח׳", "כמות", "מחיר יח׳", "סה״כ"],
        ["57.01.010", "צינור מים פוליאתילן 110 מ״מ, כולל חפירה ומילוי", "מ׳", "140", "380", "53,200"],
        ["57.02.020", "קו ביוב PVC SN8 200 מ״מ בתחום המגרש", "מ׳", "95", "620", "58,900"],
        ["57.02.030", "שוחות בקרה לביוב קוטר 100 ס״מ", "יח׳", "6", "5,500", "33,000"],
        ["57.03.030", "קווי ניקוז פנימיים PVC 250 מ״מ", "מ׳", "60", "560", "33,600"],
        ["57.03.040", "צינור ניקוז PVC קשיח SN8 קוטר 400 מ״מ, כולל חפירה, מצע ומילוי, עומק עד 2.5 מ׳ — קו ראשי עד נקודת החיבור העירונית", "מ׳", "80", "1,500", "120,000"],
        ["57.04.010", "מחבר לתשתית עירונית כולל קידוח ואטימה", "קומפ׳", "1", "110,000", "110,000"],
        ["", "סה״כ פרק 57", "", "", "", "408,700"],
      ],
    },
    { kind: "paragraph", text: "הוכן: משרד יועצי תשתיות (מטעם האדריכל) · מנוהל כגרסה בתיקיית הפרויקט" },
  ]),
];
