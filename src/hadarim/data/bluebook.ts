/**
 * The chapters of the Interministerial Specification for building works ("המפרט הכללי הבין-משרדי", the Blue Book):
 * the national standard construction budgets and bills of quantities are organised by. Reference data, not
 * scenario data — a project's sections say which chapters they cover (`HSection.chapters`, the first is the
 * primary), and BOQ lines carry their chapter. The list holds the commonly used chapters; add to it as needed.
 */
export const BLUE_BOOK_CHAPTERS: Record<string, string> = {
  "00": "מוקדמות",
  "01": "עבודות עפר",
  "02": "עבודות בטון יצוק באתר",
  "03": "מוצרי בטון טרום",
  "04": "עבודות בנייה",
  "05": "עבודות איטום",
  "06": "נגרות אומן ומסגרות פלדה",
  "07": "מתקני תברואה",
  "08": "מתקני חשמל",
  "09": "עבודות טיח",
  "10": "עבודות ריצוף וחיפוי",
  "11": "עבודות צביעה",
  "12": "עבודות אלומיניום",
  "13": "עבודות בטון דרוך",
  "14": "עבודות אבן",
  "15": "מתקני מיזוג אוויר",
  "16": "מתקני הרמה",
  "19": "מסגרות חרש",
  "22": "רכיבים מתועשים בבניין",
  "23": "כלונסאות קדוחים",
  "24": "הריסות ופירוקים",
  "34": "מערכות גילוי וכיבוי אש",
  "40": "פיתוח האתר",
  "41": "גינון והשקיה",
  "51": "סלילת כבישים ורחבות",
  "57": "קווי מים, ביוב ותיעול",
};

export function chapterNameHe(code: string): string {
  return BLUE_BOOK_CHAPTERS[code] ?? `פרק ${code}`;
}

/** "02 — עבודות בטון יצוק באתר" */
export function chapterLabelHe(code: string): string {
  return `${code} — ${chapterNameHe(code)}`;
}

/**
 * Cost groups of a construction budget, by Blue Book chapter — the grouping the report's cost-per-m² view
 * uses (structure / envelope and finishes / systems / site works). Reference data: a section belongs to the
 * group of its primary chapter; overhead and contingency sections (no chapter) have their own groups.
 */
export interface CostGroup {
  id: string;
  labelHe: string;
  chapters: string[];
}

export const COST_GROUPS: CostGroup[] = [
  { id: "structure", labelHe: "שלד (עפר, ביסוס, בטון וברזל)", chapters: ["01", "02", "03", "13", "19", "23", "24"] },
  { id: "envelope_finish", labelHe: "מעטפת וגמר", chapters: ["04", "05", "06", "09", "10", "11", "12", "14", "22"] },
  { id: "systems", labelHe: "מערכות", chapters: ["07", "08", "15", "16", "34", "44"] },
  { id: "site", labelHe: "פיתוח ותשתיות חוץ", chapters: ["40", "41", "51", "57"] },
  { id: "overhead", labelHe: "ארגון אתר והנהלה (תקורה)", chapters: ["00"] },
  { id: "contingency", labelHe: "בלתי צפוי", chapters: [] },
];

/** The cost group of a chapter code, or the overhead group when the chapter is unknown. */
export function costGroupOf(chapter: string | undefined): CostGroup {
  return COST_GROUPS.find((g) => chapter != null && g.chapters.includes(chapter)) ?? COST_GROUPS.find((g) => g.id === "overhead")!;
}

/**
 * The material quantity indices a residential budget is benchmarked by: a Blue Book chapter and the unit its
 * lines are measured in, read off the bill of quantities and divided by the gross floor area. `perSqmFactor`
 * restates the BOQ unit for the index (tons of steel are read as kg per m²). Reference data; a project's
 * reference ranges for these ids live in its KPI policy.
 */
export interface MaterialIndexDef {
  id: string;
  labelHe: string;
  chapter: string;
  unit: string;
  /** Multiplier from the BOQ unit to the index unit (1,000 for טון → ק״ג). */
  perSqmFactor: number;
  perSqmUnitHe: string;
  /** Digits shown for the index value. */
  digits: number;
}

export const MATERIAL_INDICES: MaterialIndexDef[] = [
  { id: "steel", labelHe: "ברזל זיון", chapter: "02", unit: "טון", perSqmFactor: 1000, perSqmUnitHe: "ק״ג/מ״ר", digits: 1 },
  { id: "concrete", labelHe: "בטון יצוק באתר", chapter: "02", unit: "מ״ק", perSqmFactor: 1, perSqmUnitHe: "מ״ק/מ״ר", digits: 2 },
  { id: "formwork", labelHe: "טפסות", chapter: "02", unit: "מ״ר", perSqmFactor: 1, perSqmUnitHe: "מ״ר/מ״ר", digits: 2 },
  { id: "earthworks", labelHe: "עבודות עפר", chapter: "01", unit: "מ״ק", perSqmFactor: 1, perSqmUnitHe: "מ״ק/מ״ר", digits: 2 },
  { id: "blockwork", labelHe: "בנייה בבלוקים", chapter: "04", unit: "מ״ר", perSqmFactor: 1, perSqmUnitHe: "מ״ר/מ״ר", digits: 2 },
  { id: "waterproofing", labelHe: "איטום", chapter: "05", unit: "מ״ר", perSqmFactor: 1, perSqmUnitHe: "מ״ר/מ״ר", digits: 2 },
  { id: "plaster", labelHe: "טיח", chapter: "09", unit: "מ״ר", perSqmFactor: 1, perSqmUnitHe: "מ״ר/מ״ר", digits: 2 },
  { id: "flooring", labelHe: "ריצוף וחיפוי", chapter: "10", unit: "מ״ר", perSqmFactor: 1, perSqmUnitHe: "מ״ר/מ״ר", digits: 2 },
];
